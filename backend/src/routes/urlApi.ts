/**
 * URL-style API, e.g.  GET /api/transfer?token=…&number={wallet}&amount={amount}&comment={comment}
 * Built so simple bots and no-code tools can use it:
 *  - `number` (aliases: wallet, upi, to) accepts a wallet number (registered mobile), a Payment ID, an email, or a UPI ID
 *  - Every request pays. Calling the same URL again sends the money again.
 *  - `ref` is optional. Only if you add one, repeating that exact ref never pays twice (a retry-safety switch you opt into).
 * Safety rules: daily cap (URL calls cannot carry the PIN), token redacted from logs, per-token rate limit.
 * Prefer the header-based API for servers; use this for simple integrations.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { amountSchema, formatPaise } from '../lib/money.js';
import { requireApiTokenQuery, requireScope } from '../middleware/apiToken.js';
import { attachApiLogging } from './apiLogging.js';
import { createPaymentRequest, requestDto } from '../services/paymentRequests.js';
import { requestWithdrawal, submitPayout, UPI_RE, withdrawalDto, withdrawalMessage } from '../services/withdrawals.js';
import { walletSummary } from '../services/transactions.js';
import { resolveRecipient, sendMoney } from '../services/transfers.js';

const MIN_WALLET_TRANSFER = 50n; // ₹0.50

const ref = z.string().regex(/^[A-Za-z0-9_.:-]{8,64}$/, 'ref must be 8-64 letters, digits or - _ . :');
const tok = z.string().min(20).max(80); // validated by the middleware; listed so it is accepted in the query

const payoutQuery = z.object({
  token: tok,
  number: z.string().trim().max(100).optional(), wallet: z.string().trim().max(100).optional(),
  upi: z.string().trim().max(100).optional(), to: z.string().trim().max(100).optional(),
  amount: amountSchema, ref: ref.optional(), comment: z.string().max(60).optional(),
});

const simple = (status: string) => (status === 'SUCCESSFUL' ? 'success' : status === 'REFUNDED' || status === 'FAILED' ? 'failed' : 'processing');

async function dailyCap(): Promise<bigint> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'api.url_payout_cap' } });
  try { return row ? BigInt((row.value as { paise: string }).paise) : 1_000_000n; } catch { return 1_000_000n; } // default ₹10,000
}
const istDayStart = () => { const t = new Date(Date.now() + 19_800_000); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - 19_800_000); };

/** Everything sent through URL calls today: UPI payouts + wallet transfers. */
async function spentToday(uid: string): Promise<bigint> {
  const since = istDayStart();
  const [w, t] = await Promise.all([
    prisma.withdrawal.aggregate({ _sum: { amount: true }, where: { userId: uid, idempotencyKey: { startsWith: 'url:' }, createdAt: { gte: since }, status: { notIn: ['REFUNDED', 'FAILED'] } } }),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { userId: uid, type: 'TRANSFER', direction: 'DEBIT', idempotencyKey: { startsWith: 'url:' }, createdAt: { gte: since }, status: 'SUCCESSFUL' } }),
  ]);
  return (w._sum.amount ?? 0n) + (t._sum.amount ?? 0n);
}

async function payoutHandler(req: FastifyRequest) {
  const q = payoutQuery.parse(req.query);
  const dest = (q.number ?? q.wallet ?? q.upi ?? q.to)?.trim();
  if (!dest) throw new AppError('VALIDATION_ERROR', 'number is required: a wallet number, Payment ID or UPI ID.', 422);
  const uid = req.apiAuth!.userId;
  const isUpi = UPI_RE.test(dest);
  const need = isUpi ? 'withdraw' : 'transfer';
  if (!req.apiAuth!.scopes.includes(need)) throw new AppError('INSUFFICIENT_SCOPE', `Sending to ${isUpi ? 'a UPI ID' : 'a wallet'} needs a token with the "${need}" scope.`, 403);

  // Without a ref every request is a new payment. With a ref, that ref never pays twice.
  const key = q.ref ? `url:${q.ref}` : `url:auto-${randomUUID()}`;

  const capCheck = async () => {
    const cap = await dailyCap();
    if ((await spentToday(uid)) + q.amount > cap) throw new AppError('DAILY_LIMIT_EXCEEDED', `URL payouts are limited to ₹${formatPaise(cap)} per day. Use the header API with your PIN for larger amounts.`, 403);
  };

  // ---------- UPI payout ----------
  if (isUpi) {
    const prior = await prisma.withdrawal.findFirst({ where: { userId: uid, idempotencyKey: key } });
    if (prior && (prior.amount !== q.amount || prior.destination !== dest)) throw new AppError('REF_REUSED', 'This ref was already used with different details. Use a new ref.', 422);
    if (!prior) await capCheck();
    const { withdrawal } = await requestWithdrawal(uid, q.amount, dest, key);
    const final = withdrawal.status === 'PENDING' ? await submitPayout(withdrawal.withdrawalId) : withdrawal;
    return ok({ ref: q.ref ?? null, type: 'upi', status: simple(final.status), message: withdrawalMessage(final.status), withdrawal: withdrawalDto(final) });
  }

  // ---------- wallet-to-wallet transfer ----------
  if (q.amount < MIN_WALLET_TRANSFER) throw new AppError('INVALID_AMOUNT', 'Minimum amount is ₹0.50.', 422);
  const to = await resolveRecipient(dest, uid); // 404 USER_NOT_FOUND if there is no such wallet; nothing is debited
  const prior = await prisma.transaction.findFirst({ where: { userId: uid, type: 'TRANSFER', direction: 'DEBIT', idempotencyKey: key } });
  if (prior) {
    const recv = prior.reference ? await prisma.transaction.findFirst({ where: { reference: prior.reference, type: 'RECEIVE' } }) : null;
    if (prior.amount !== q.amount || (recv && recv.userId !== to.userId)) throw new AppError('REF_REUSED', 'This ref was already used with different details. Use a new ref.', 422);
  } else await capCheck();
  const out = await sendMoney(uid, dest, q.amount, key, q.comment);
  return ok({
    ref: q.ref ?? null, type: 'wallet', status: 'success', message: 'Transfer successful.',
    transaction: { id: out.transaction.id, amount: out.transaction.amount }, recipient: out.recipient,
  });
}

async function payoutStatusHandler(req: FastifyRequest) {
  const q = z.object({ token: tok, ref }).parse(req.query);
  const uid = req.apiAuth!.userId, key = `url:${q.ref}`;
  const w = await prisma.withdrawal.findFirst({ where: { userId: uid, idempotencyKey: key } });
  if (w) return ok({ ref: q.ref, type: 'upi', status: simple(w.status), message: withdrawalMessage(w.status), withdrawal: withdrawalDto(w) });
  const t = await prisma.transaction.findFirst({ where: { userId: uid, type: 'TRANSFER', direction: 'DEBIT', idempotencyKey: key } });
  if (t) return ok({ ref: q.ref, type: 'wallet', status: simple(t.status), transaction: { id: t.txnId } });
  throw new AppError('NOT_FOUND', 'No payout with this ref.', 404);
}

async function payHandler(req: FastifyRequest, reply: FastifyReply) {
  const q = z.object({ token: tok, amount: amountSchema, order_id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
    comment: z.string().trim().max(120).optional(), expires: z.coerce.number().int().min(5).max(10_080).optional() }).parse(req.query);
  const r = await createPaymentRequest(req.apiAuth!.userId, { amount: q.amount, orderId: q.order_id, description: q.comment, expiresInMinutes: q.expires, source: 'MERCHANT_API' });
  reply.code(201);
  return ok({ payment_id: r.id, amount: r.amount.rupees, currency: 'INR', status: r.status.toLowerCase(), order_id: r.orderId, payment_url: r.paymentUrl, qr_payload: r.qrPayload, expires_at: r.expiresAt, created_at: r.createdAt });
}

async function statusHandler(req: FastifyRequest) {
  const q = z.object({ token: tok, payment_id: z.string().regex(/^REQ-[2-9A-HJ-NP-Z]{8}$/) }).parse(req.query);
  const r = await prisma.paymentRequest.findFirst({ where: { requestId: q.payment_id, userId: req.apiAuth!.userId } });
  if (!r) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
  const d = requestDto(r);
  return ok({ payment_id: d.id, amount: d.amount.rupees, currency: 'INR', status: d.status.toLowerCase(), order_id: d.orderId, paid_at: d.paidAt, transaction_id: r.paidTxnId, expires_at: d.expiresAt });
}

async function balanceHandler(req: FastifyRequest) {
  z.object({ token: tok }).parse(req.query);
  const s = await walletSummary(req.apiAuth!.userId);
  return ok({ available: s.available, currency: 'INR' });
}

/** Original paths, kept so existing integrations keep working: /api/v1/url/... */
export async function urlApiRoutes(app: FastifyInstance) {
  attachApiLogging(app);
  app.addHook('preHandler', requireApiTokenQuery);
  app.get('/balance', { preHandler: requireScope('read') }, balanceHandler);
  app.get('/pay', { preHandler: requireScope('payments') }, payHandler);
  app.get('/status', { preHandler: requireScope('payments') }, statusHandler);
  app.get('/payout', payoutHandler);
  app.get('/payout-status', payoutStatusHandler);
}

/** Short paths: /api/transfer, /api/transfer-status, /api/payment, /api/payment-status, /api/balance */
export async function shortApiRoutes(app: FastifyInstance) {
  attachApiLogging(app);
  app.addHook('preHandler', requireApiTokenQuery);
  app.get('/transfer', payoutHandler);
  app.get('/transfer-status', payoutStatusHandler);
  app.get('/payment', { preHandler: requireScope('payments') }, payHandler);
  app.get('/payment-status', { preHandler: requireScope('payments') }, statusHandler);
  app.get('/balance', { preHandler: requireScope('read') }, balanceHandler);
}
