import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { formatPaise } from '../lib/money.js';
import { displayName } from '../lib/displayName.js';
import { transferInternal } from './wallet.js';
import { txDto } from './transactions.js';
import { notify } from './notify.js';
import { checkMovement } from './risk.js';
import { parseQr } from '../lib/qr.js';
import { assertFeature } from './settings.js';

/** Recipient can be a Payment ID (PAY-XXXXXXXX), email or 10-digit mobile. */
export async function resolveRecipient(input: string, excludeUserId?: string) {
  const v = input.trim();
  const where = /^PAY-/i.test(v) ? { paymentId: v.toUpperCase() }
    : v.includes('@') ? { email: v.toLowerCase() }
    : /^\d{10}$/.test(v.replace(/^(\+91|91)/, '')) ? { mobile: v.replace(/^(\+91|91)(?=\d{10}$)/, '') }
    : null;
  if (!where) throw new AppError('INVALID_RECIPIENT', 'Enter a Payment ID, email or 10-digit mobile number.', 422);
  const u = await prisma.user.findFirst({ where: { ...where, status: 'ACTIVE' }, select: { id: true, paymentId: true, name: true, email: true } });
  if (!u) throw new AppError('USER_NOT_FOUND', 'User not found.', 404); // nothing is debited when the destination is missing
  if (u.id === excludeUserId) throw new AppError('SELF_TRANSFER', 'You cannot send money to yourself.', 400);
  return { userId: u.id, paymentId: u.paymentId, name: u.name, displayName: displayName(u.name) };
}

export async function sendMoney(fromUserId: string, to: string, amount: bigint, idempotencyKey: string, description?: string) {
  assertFeature('transfers');
  const r = await resolveRecipient(to, fromUserId);
  const res = await transferInternal({ fromUserId, toUserId: r.userId, amount, idempotencyKey, description: description?.slice(0, 120) });
  if (!res.replayed) {
    void notify(fromUserId, 'transfer.sent', 'Money sent', `₹${formatPaise(amount)} sent to ${r.paymentId}.`);
    void notify(r.userId, 'transfer.received', 'Money received', `You received ₹${formatPaise(amount)}.`);
    void checkMovement(fromUserId, 'TRANSFER', amount);
  }
  return { transaction: txDto(res.sent), recipient: { paymentId: r.paymentId, displayName: r.displayName }, replayed: res.replayed };
}

/** Decode a scanned QR into something the app can show. Never trusted: payment re-validates server-side. */
export async function resolveQr(payload: string, viewerId: string) {
  let t;
  try { t = parseQr(payload); } catch { throw new AppError('INVALID_QR', 'Invalid QR code.', 422); }
  if (t.type === 'REQUEST') {
    const { lookupRequest } = await import('./paymentRequests.js');
    return { type: 'REQUEST' as const, request: await lookupRequest(t.requestId) };
  }
  const r = await resolveRecipient(t.paymentId, viewerId);
  return { type: 'USER' as const, recipient: { paymentId: r.paymentId, name: r.name, displayName: r.displayName }, amount: t.amount ?? null };
}
