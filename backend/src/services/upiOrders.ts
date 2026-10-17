/**
 * "Pay With UPI" deposits.
 *
 * 1. The user types an amount; the app creates an order (DEP-XXXXXXXX) and shows a `upi://pay?...` link.
 *    On a phone that link opens the system app chooser (PhonePe, Paytm, Amazon Pay, FamPay, GPay, BHIM, ...),
 *    pre-filled with the amount and the order reference as the payment note.
 * 2. The money lands in the owner's bank account. The verified bank feed (signed webhook or admin entry,
 *    see ingestBankCredit) is the ONLY thing that can credit a wallet. A browser "I paid" is never trusted.
 * 3. A bank credit is matched to an order by (a) the order reference in its note, else (b) exact amount when
 *    exactly one open order has that amount. The amount must match exactly; anything unclear goes to review.
 * 4. Crediting uses the same provider/reference key as the Transaction-ID flow, so one bank credit can only
 *    ever be credited once, whichever path reaches it first.
 */
import { Prisma, type UpiOrder } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateOrderRef } from '../lib/crypto.js';
import { normalizeUtr } from '../lib/utr.js';
import { formatPaise, money } from '../lib/money.js';
import { creditDeposit } from './wallet.js';
import { assertFeature, getAutoMatchByAmount, upiConfig } from './settings.js';
import { quoteDeposit } from './deposits.js';
import { audit } from './audit.js';
import { notify } from './notify.js';

export const ORDER_TTL_MS = 30 * 60_000;
const MAX_OPEN_PER_USER = 5;
const REF_RE = /DEP-[2-9A-HJ-NP-Z]{8}/i;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export function upiUri(order: Pick<UpiOrder, 'orderRef' | 'amount'>) {
  const c = upiConfig();
  if (!c) return null;
  const q = new URLSearchParams({ pa: c.upiId, pn: c.name, am: formatPaise(order.amount), cu: 'INR', tn: order.orderRef });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

export function orderDto(o: UpiOrder) {
  const expired = o.status === 'CREATED' && o.expiresAt.getTime() <= Date.now();
  const c = upiConfig();
  return {
    id: o.orderRef, amount: money(o.amount), status: expired ? 'EXPIRED' : o.status, txnId: o.txnId,
    expiresAt: o.expiresAt, createdAt: o.createdAt, paidAt: o.paidAt,
    uri: o.status === 'CREATED' && !expired ? upiUri(o) : null,
    upiId: c?.upiId ?? null, payeeName: c?.name ?? null,
  };
}

/** Create (or reuse) the open order for this user and amount. Limits and tax are enforced by quoteDeposit. */
export async function createUpiOrder(userId: string, amount: bigint) {
  assertFeature('deposits');
  if (!upiConfig()) throw new AppError('METHOD_UNAVAILABLE', 'UPI payments are not available right now.', 503);
  const quote = await quoteDeposit(amount);

  const now = new Date();
  const same = await prisma.upiOrder.findFirst({ where: { userId, amount, status: 'CREATED', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
  if (same) return { order: orderDto(same), quote };

  // Typing different amounts must not pile up orders: keep the newest few, cancel the rest.
  const open = await prisma.upiOrder.findMany({ where: { userId, status: 'CREATED', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (open.length >= MAX_OPEN_PER_USER) {
    await prisma.upiOrder.updateMany({ where: { id: { in: open.slice(MAX_OPEN_PER_USER - 1).map((o) => o.id) }, status: 'CREATED' }, data: { status: 'CANCELLED' } });
  }

  for (let i = 0; i < 4; i++) {
    try {
      const o = await prisma.upiOrder.create({ data: { userId, amount, orderRef: generateOrderRef(), expiresAt: new Date(Date.now() + ORDER_TTL_MS) } });
      await audit({ actorId: userId, action: 'deposit.upi.order_created', result: 'SUCCESS', resourceType: 'UpiOrder', resourceId: o.orderRef });
      return { order: orderDto(o), quote };
    } catch (e) { if (!isUnique(e)) throw e; }
  }
  throw new AppError('TRY_AGAIN', 'Could not create the payment link. Please try again.', 503);
}

export async function getUpiOrder(userId: string, orderRef: string) {
  const o = await prisma.upiOrder.findFirst({ where: { orderRef: orderRef.toUpperCase(), userId } }); // owner only
  if (!o) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
  return orderDto(o);
}

export async function cancelUpiOrder(userId: string, orderRef: string) {
  await prisma.upiOrder.updateMany({ where: { orderRef: orderRef.toUpperCase(), userId, status: 'CREATED' }, data: { status: 'CANCELLED' } });
  return { cancelled: true };
}

/** Credit the order's owner for this bank credit. Safe to call repeatedly and concurrently: one credit, ever. */
async function settle(order: UpiOrder, utr: string, by: 'bank-feed' | 'admin') {
  try {
    const { tx } = await creditDeposit({
      userId: order.userId, gross: order.amount, idempotencyKey: `utr:${utr}`,
      provider: 'UPI_UTR', providerReference: utr, reference: order.orderRef, description: 'UPI deposit',
    });
    const r = await prisma.upiOrder.updateMany({ where: { id: order.id, status: { not: 'PAID' } }, data: { status: 'PAID', txnId: tx.txnId, bankUtr: utr, paidAt: new Date() } });
    if (r.count === 1) {
      await audit({ actorType: by === 'admin' ? 'ADMIN' : 'SYSTEM', actorId: order.userId, action: 'deposit.upi.credited', result: 'SUCCESS', resourceType: 'Transaction', resourceId: tx.txnId, metadata: { orderRef: order.orderRef } });
      void notify(order.userId, 'deposit.success', 'Money added', `₹${formatPaise(order.amount)} payment received. Your wallet has been credited.`);
    }
    return { orderRef: order.orderRef, txnId: tx.txnId };
  } catch (e) {
    // The same bank credit was already used for another account/order: never credit twice.
    if (e instanceof AppError && e.code === 'DUPLICATE_TRANSACTION') return null;
    throw e;
  }
}

/**
 * Called for every verified bank credit. Returns the matched order ref, or null when nothing matched
 * (the credit stays in the bank-credit list; a user can still claim it with the Transaction ID form, or an admin can settle it).
 */
export async function matchBankCredit(c: { utr: string; amount: bigint; note?: string | null; payeeUpi?: string | null }) {
  const upi = upiConfig();
  if (upi && c.payeeUpi && c.payeeUpi.toLowerCase() !== upi.upiId.toLowerCase()) return null; // money for another account

  const ref = c.note?.match(REF_RE)?.[0]?.toUpperCase();
  if (ref) {
    const o = await prisma.upiOrder.findUnique({ where: { orderRef: ref } });
    // Paid late (after expiry/cancel) is still real money: credit it. Amount must be exact.
    if (o && o.status !== 'PAID' && o.amount === c.amount) return settle(o, c.utr, 'bank-feed');
    return null;
  }
  if (!(await getAutoMatchByAmount())) return null;
  const open = await prisma.upiOrder.findMany({ where: { status: 'CREATED', amount: c.amount, expiresAt: { gt: new Date() } }, take: 2 });
  if (open.length === 1) return settle(open[0]!, c.utr, 'bank-feed'); // ambiguous (2+) -> left for review
  return null;
}

/** Admin: settle one order against a bank transaction ID taken from the bank statement. */
export async function adminSettleOrder(orderRef: string, utr: string, adminEmail: string) {
  const o = await prisma.upiOrder.findUnique({ where: { orderRef: orderRef.toUpperCase() } });
  if (!o) throw new AppError('NOT_FOUND', 'Order not found.', 404);
  if (o.status === 'PAID') throw new AppError('ALREADY_RESOLVED', 'This order is already paid.', 409);
  let id: string;
  try { id = normalizeUtr(utr); } catch (e) { throw new AppError('INVALID_TRANSACTION_ID', (e as Error).message, 422); }
  const { ingestBankCredit } = await import('./utr.js');
  await ingestBankCredit({ utr: id, amount: o.amount, note: o.orderRef, source: `admin:${adminEmail}` }).catch(() => {}); // records the credit; also tries the automatic match
  const fresh = await prisma.upiOrder.findUniqueOrThrow({ where: { id: o.id } });
  if (fresh.status === 'PAID') return fresh;
  const r = await settle(fresh, id, 'admin');
  if (!r) throw new AppError('DUPLICATE_TRANSACTION', 'This transaction ID was already credited to another payment.', 409);
  return prisma.upiOrder.findUniqueOrThrow({ where: { id: o.id } });
}

/** Job: mark unpaid orders that ran out of time. A late payment can still settle them (see matchBankCredit). */
export async function expireOrders() {
  const r = await prisma.upiOrder.updateMany({ where: { status: 'CREATED', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  return r.count;
}
