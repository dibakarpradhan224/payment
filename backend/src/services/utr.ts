import { Prisma, type UtrSubmission } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { normalizeUtr } from '../lib/utr.js';
import { creditDeposit } from './wallet.js';
import { assertFeature, getDepositLimits, upiConfig } from './settings.js';
import { matchBankCredit } from './upiOrders.js';
import { audit } from './audit.js';

export const DUPLICATE_UTR_MSG = 'This transaction ID has already been added and cannot be added twice.';
export const UNDER_VERIFICATION_MSG = 'Payment is under verification. Your balance will be updated after successful verification.';
const OPEN: string[] = ['PENDING', 'MANUAL_REVIEW'];
const MAX_OPEN_PER_USER = 5;

const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

type Outcome = { status: 'VERIFIED' | 'MANUAL_REVIEW' | 'REJECTED'; message: string; txnId?: string; submissionId: string };

/** User claims "I paid this UTR". Never credits from user input alone: it needs a matching verified bank record. */
export async function submitUtr(userId: string, amount: bigint, rawUtr: string): Promise<Outcome> {
  assertFeature('deposits');
  const utr = normalizeUtr(rawUtr);
  const lim = await getDepositLimits();
  if (amount < lim.min || amount > lim.max) throw new AppError('INVALID_AMOUNT', 'Amount is outside the allowed deposit range.', 422);

  const open = await prisma.utrSubmission.count({ where: { userId, status: { in: OPEN } } });
  if (open >= MAX_OPEN_PER_USER) throw new AppError('TOO_MANY_PENDING', 'You have too many payments awaiting verification. Please wait for them to be reviewed.', 429);

  let sub: UtrSubmission;
  try {
    sub = await prisma.utrSubmission.create({ data: { userId, utr, amount, status: 'PENDING' } });
  } catch (e) {
    if (!unique(e)) throw e;
    const prior = await prisma.utrSubmission.findUnique({ where: { utr } });
    // Same user re-submitting while it is still being checked is not an error; anything else is a duplicate.
    if (prior && prior.userId === userId && OPEN.includes(prior.status)) {
      return { status: 'MANUAL_REVIEW', message: UNDER_VERIFICATION_MSG, submissionId: prior.id };
    }
    await audit({ actorId: userId, action: 'deposit.utr.duplicate', result: 'FAILURE', resourceType: 'UTR', resourceId: utr });
    throw new AppError('DUPLICATE_TRANSACTION', DUPLICATE_UTR_MSG, 409);
  }
  await audit({ actorId: userId, action: 'deposit.utr.submitted', result: 'SUCCESS', resourceType: 'UtrSubmission', resourceId: sub.id });
  return reconcile(sub.id);
}

async function setReview(id: string, reason: string): Promise<Outcome> {
  await prisma.utrSubmission.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'MANUAL_REVIEW', reason } });
  await audit({ actorType: 'SYSTEM', action: 'deposit.utr.reconciliation_required', result: 'SUCCESS', resourceType: 'UtrSubmission', resourceId: id, metadata: { reason } });
  return { status: 'MANUAL_REVIEW', message: UNDER_VERIFICATION_MSG, submissionId: id };
}

async function credit(sub: UtrSubmission, reviewedBy?: string, adminNote?: string): Promise<Outcome> {
  try {
    const { tx } = await creditDeposit({
      userId: sub.userId, gross: sub.amount, idempotencyKey: `utr:${sub.utr}`,
      provider: 'UPI_UTR', providerReference: sub.utr, reference: sub.id, description: 'UPI deposit',
    });
    await prisma.utrSubmission.updateMany({
      where: { id: sub.id, status: { in: OPEN } },
      data: { status: 'VERIFIED', txnId: tx.txnId, reason: null, ...(reviewedBy ? { reviewedBy, adminNote } : {}) },
    });
    await audit({ actorId: reviewedBy ?? sub.userId, actorType: reviewedBy ? 'ADMIN' : 'SYSTEM', action: 'deposit.utr.verified', result: 'SUCCESS', resourceType: 'Transaction', resourceId: tx.txnId });
    return { status: 'VERIFIED', message: 'Payment verified. Your wallet has been credited.', txnId: tx.txnId, submissionId: sub.id };
  } catch (e) {
    if (e instanceof AppError && e.code === 'DUPLICATE_TRANSACTION') {
      await prisma.utrSubmission.updateMany({ where: { id: sub.id, status: { in: OPEN } }, data: { status: 'REJECTED', reason: 'DUPLICATE' } });
      throw e;
    }
    throw e;
  }
}

/** Compare a submission with the verified bank record. Safe to call repeatedly and concurrently. */
export async function reconcile(submissionId: string): Promise<Outcome> {
  const sub = await prisma.utrSubmission.findUniqueOrThrow({ where: { id: submissionId } });
  if (sub.status === 'VERIFIED') return { status: 'VERIFIED', message: 'Payment verified.', txnId: sub.txnId ?? undefined, submissionId };
  if (sub.status === 'REJECTED') return { status: 'REJECTED', message: 'This payment was rejected.', submissionId };

  const bank = await prisma.bankCredit.findUnique({ where: { utr: sub.utr } });
  if (!bank) return setReview(sub.id, 'NO_BANK_RECORD');
  if (bank.amount !== sub.amount) return setReview(sub.id, 'AMOUNT_MISMATCH');
  const upi = upiConfig();
  if (upi && bank.payeeUpi && bank.payeeUpi.toLowerCase() !== upi.upiId.toLowerCase()) return setReview(sub.id, 'DESTINATION_MISMATCH');
  // If the payer put a PAY-... id in the UPI note, it must be the submitting user's own id (blocks claiming someone else's UTR).
  const noteId = bank.note?.match(/PAY-[A-Z0-9]{8}/)?.[0];
  if (noteId) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: sub.userId }, select: { paymentId: true } });
    if (u.paymentId !== noteId) return setReview(sub.id, 'NOTE_MISMATCH');
  }
  return credit(sub);
}

/** Called by the signed bank/aggregator webhook or a statement import. Also resolves earlier submissions waiting for this UTR. */
export async function ingestBankCredit(i: { utr: string; amount: bigint; payeeUpi?: string; payerName?: string; note?: string; receivedAt?: Date; source: string }) {
  const utr = normalizeUtr(i.utr);
  try {
    await prisma.bankCredit.create({
      data: { utr, amount: i.amount, payeeUpi: i.payeeUpi, payerName: i.payerName, note: i.note, source: i.source, receivedAt: i.receivedAt ?? new Date() },
    });
  } catch (e) {
    if (!unique(e)) throw e; // already recorded: feeds are retried, so this is fine
  }
  // 1) A "Pay With UPI" order waiting for this money is credited automatically.
  const order = await matchBankCredit({ utr, amount: i.amount, note: i.note, payeeUpi: i.payeeUpi }).catch(() => null);
  // 2) Anyone who typed this transaction ID by hand is resolved too.
  const waiting = await prisma.utrSubmission.findMany({ where: { utr, status: 'MANUAL_REVIEW' } });
  for (const s of waiting) await reconcile(s.id).catch(() => {});
  return { utr, resolved: waiting.length, orderMatched: order?.orderRef ?? null };
}

/** Admin decision for the reconciliation queue (HTTP + RBAC wiring lands with the admin panel in Phase 8). */
export async function adminResolveUtr(submissionId: string, adminId: string, action: 'VERIFY' | 'REJECT', note: string): Promise<Outcome> {
  const sub = await prisma.utrSubmission.findUniqueOrThrow({ where: { id: submissionId } });
  if (!OPEN.includes(sub.status)) throw new AppError('ALREADY_RESOLVED', 'This case is already resolved.', 409);
  if (action === 'REJECT') {
    await prisma.utrSubmission.updateMany({ where: { id: sub.id, status: { in: OPEN } }, data: { status: 'REJECTED', reviewedBy: adminId, adminNote: note, reason: 'ADMIN_REJECTED' } });
    await audit({ actorId: adminId, actorType: 'ADMIN', action: 'deposit.utr.rejected', result: 'SUCCESS', resourceType: 'UtrSubmission', resourceId: sub.id, metadata: { note } });
    return { status: 'REJECTED', message: 'Rejected.', submissionId: sub.id };
  }
  return credit(sub, adminId, note);
}
