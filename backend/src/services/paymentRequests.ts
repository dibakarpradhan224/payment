import { assertFeature } from './settings.js';
import { Prisma, type PaymentRequest } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateRequestId } from '../lib/crypto.js';
import { money, formatPaise } from '../lib/money.js';
import { buildRequestQr } from '../lib/qr.js';
import { displayName } from '../lib/displayName.js';
import { env } from '../config/env.js';
import { applyEntry, lockWallets, run } from './wallet.js';
import { enqueueWebhook } from './merchantWebhooks.js';
import { notify } from './notify.js';
import { txDto } from './transactions.js';
import { checkMovement } from './risk.js';

const MIN = 100n, MAX = 10_000_000n;

export const effectiveStatus = (r: PaymentRequest) => (r.status === 'PENDING' && r.expiresAt < new Date() ? 'EXPIRED' : r.status);

export const requestDto = (r: PaymentRequest) => ({
  id: r.requestId, amount: money(r.amount), description: r.description, payerInfo: r.payerInfo,
  status: effectiveStatus(r), source: r.source, orderId: r.merchantOrderId,
  expiresAt: r.expiresAt, createdAt: r.createdAt, paidAt: r.paidAt,
  qrPayload: buildRequestQr(r.requestId), paymentUrl: `${env.APP_URL}/pay/${r.requestId}`,
});

export async function createPaymentRequest(userId: string, a: {
  amount: bigint; description?: string; payerInfo?: string; expiresInMinutes?: number; source?: 'WALLET' | 'MERCHANT_API'; orderId?: string;
}) {
  assertFeature('payments');
  if (a.amount < MIN || a.amount > MAX) throw new AppError('INVALID_AMOUNT', `Amount must be between ₹${formatPaise(MIN)} and ₹${formatPaise(MAX)}.`, 422);
  const mins = a.expiresInMinutes ?? 60;
  if (!Number.isInteger(mins) || mins < 5 || mins > 10_080) throw new AppError('INVALID_EXPIRY', 'Expiry must be between 5 minutes and 7 days.', 422);

  if (a.orderId) {
    const prior = await prisma.paymentRequest.findUnique({ where: { userId_merchantOrderId: { userId, merchantOrderId: a.orderId } } });
    if (prior) {
      if (prior.amount !== a.amount) throw new AppError('DUPLICATE_ORDER', 'This order id was already used with a different amount.', 409);
      return requestDto(prior); // same order again: return the original
    }
  }
  for (let i = 0; i < 5; i++) {
    try {
      const created = await prisma.$transaction(async (db) => {
        const r = await db.paymentRequest.create({
          data: {
            requestId: generateRequestId(), userId, amount: a.amount, description: a.description?.slice(0, 120), payerInfo: a.payerInfo?.slice(0, 120),
            source: a.source ?? 'WALLET', merchantOrderId: a.orderId, expiresAt: new Date(Date.now() + mins * 60_000),
          },
        });
        await enqueueWebhook(db, userId, 'payment.created', { payment_id: r.requestId, amount: formatPaise(r.amount), order_id: r.merchantOrderId, status: 'pending' });
        return r;
      });
      return requestDto(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (String(e.meta?.target ?? '').includes('requestId')) continue;
        const prior = a.orderId && (await prisma.paymentRequest.findUnique({ where: { userId_merchantOrderId: { userId, merchantOrderId: a.orderId } } }));
        if (prior) return requestDto(prior);
      }
      throw e;
    }
  }
  throw new AppError('INTERNAL_ERROR', 'Could not create request.', 500);
}

/** What a payer sees after scanning/opening a request. */
export async function lookupRequest(requestId: string) {
  const r = await prisma.paymentRequest.findUnique({ where: { requestId }, include: { user: { select: { paymentId: true, name: true } } } });
  if (!r) throw new AppError('NOT_FOUND', 'Payment request not found.', 404);
  return { ...requestDto(r), recipient: { paymentId: r.user.paymentId, name: r.user.name, displayName: displayName(r.user.name) } };
}

const statusError = (r: PaymentRequest) =>
  r.status === 'PAID' ? new AppError('ALREADY_PAID', 'This payment request has already been paid.', 409)
  : r.status === 'CANCELLED' ? new AppError('REQUEST_CANCELLED', 'This payment request was cancelled.', 410)
  : new AppError('REQUEST_EXPIRED', 'This payment request has expired.', 410);

/** Pay a request. Claim + debit + credit commit together; two payers can never both succeed. PIN is verified by the caller. */
export async function payRequest(payerId: string, requestId: string, idempotencyKey: string) {
  assertFeature('payments');
  const head = await prisma.paymentRequest.findUnique({ where: { requestId } });
  if (!head) throw new AppError('NOT_FOUND', 'Payment request not found.', 404);
  if (head.userId === payerId) throw new AppError('SELF_PAY', 'You cannot pay your own request.', 400);

  const out = await run(async (db) => {
    const locks = await lockWallets(db, [payerId, head.userId]);
    const replay = await db.transaction.findUnique({ where: { userId_type_idempotencyKey: { userId: payerId, type: 'PAYMENT', idempotencyKey } } });
    if (replay) {
      const received = await db.transaction.findFirstOrThrow({ where: { reference: requestId, type: 'RECEIVE', userId: head.userId } });
      return { sent: replay, received, replayed: true };
    }
    const recipient = await db.user.findUnique({ where: { id: head.userId }, select: { status: true } });
    if (recipient?.status !== 'ACTIVE') throw new AppError('RECIPIENT_UNAVAILABLE', 'Recipient account is unavailable.', 400);

    const claim = await db.paymentRequest.updateMany({
      where: { id: head.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'PAID', paidByUserId: payerId, paidAt: new Date() },
    });
    if (claim.count !== 1) throw statusError(await db.paymentRequest.findUniqueOrThrow({ where: { id: head.id } }));

    const sent = await applyEntry(db, { userId: payerId, type: 'PAYMENT', direction: 'DEBIT', gross: head.amount, idempotencyKey, reference: requestId, description: `Payment ${requestId}` }, locks.get(payerId)!);
    const received = await applyEntry(db, { userId: head.userId, type: 'RECEIVE', direction: 'CREDIT', gross: head.amount, idempotencyKey: `${idempotencyKey}:recv:${payerId}`, reference: requestId, description: head.description ?? `Payment ${requestId}` }, locks.get(head.userId)!);
    await db.paymentRequest.update({ where: { id: head.id }, data: { paidTxnId: received.tx.txnId } });
    await enqueueWebhook(db, head.userId, 'payment.success', { payment_id: requestId, amount: formatPaise(head.amount), order_id: head.merchantOrderId, transaction_id: received.tx.txnId, status: 'success' });
    return { sent: sent.tx, received: received.tx, replayed: false };
  });

  if (!out.replayed) {
    void notify(payerId, 'payment.sent', 'Payment sent', `₹${formatPaise(head.amount)} paid for ${requestId}.`);
    void notify(head.userId, 'payment.request_paid', 'Payment request paid', `You received ₹${formatPaise(head.amount)} for ${requestId}.`);
    void checkMovement(payerId, 'TRANSFER', head.amount);
  }
  return { transaction: txDto(out.sent), replayed: out.replayed };
}

export async function cancelRequest(userId: string, requestId: string) {
  const ok = await prisma.$transaction(async (db) => {
    const r = await db.paymentRequest.updateMany({ where: { requestId, userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (r.count === 1) await enqueueWebhook(db, userId, 'payment.failed', { payment_id: requestId, status: 'cancelled' });
    return r.count === 1;
  });
  if (!ok) throw new AppError('NOT_CANCELLABLE', 'Only pending requests can be cancelled.', 409);
}

export async function expireDue(): Promise<number> {
  const due = await prisma.paymentRequest.findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, take: 200, select: { id: true } });
  let n = 0;
  for (const d of due) {
    await prisma.$transaction(async (db) => {
      const r = await db.paymentRequest.findUnique({ where: { id: d.id } });
      const u = await db.paymentRequest.updateMany({ where: { id: d.id, status: 'PENDING', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
      if (u.count === 1 && r) { n++; await enqueueWebhook(db, r.userId, 'payment.failed', { payment_id: r.requestId, order_id: r.merchantOrderId, status: 'expired' }); }
    });
  }
  return n;
}
