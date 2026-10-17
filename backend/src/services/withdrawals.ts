import { Prisma, type Withdrawal } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateWithdrawalId } from '../lib/crypto.js';
import { formatPaise, money } from '../lib/money.js';
import { maskUpi } from '../lib/mask.js';
import { checkPayout, createPayout, type PayoutConfig } from '../providers/payout.js';
import { assertFeature, getWithdrawRules, payoutConfig } from './settings.js';
import { debitWallet, refundDebit, transitionStatus } from './wallet.js';
import { enqueueWebhook } from './merchantWebhooks.js';
import { notify } from './notify.js';
import { audit } from './audit.js';
import { checkMovement } from './risk.js';

export const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;
const MAX_CHECKS = 10;

export const withdrawalDto = (w: Withdrawal) => ({
  id: w.withdrawalId, amount: money(w.amount), fee: money(w.fee), destination: maskUpi(w.destination),
  status: w.status, failureReason: w.status === 'REFUNDED' || w.status === 'FAILED' ? w.failureReason : null,
  txnId: w.txnId, createdAt: w.createdAt, updatedAt: w.updatedAt,
});

const MESSAGES: Record<string, string> = {
  SUCCESSFUL: 'Withdrawal successful.',
  REFUNDED: 'Withdrawal failed. Your funds have been refunded.',
  FAILED: 'Withdrawal failed. Your funds are being refunded.',
  PROCESSING: 'Withdrawal is processing. You will be notified when it completes.',
  PENDING: 'Withdrawal is processing. You will be notified when it completes.',
  MANUAL_REVIEW: 'Withdrawal is under review.',
};
export const withdrawalMessage = (status: string) => MESSAGES[status] ?? '';

/** Step 1: validate, then reserve the funds and record the withdrawal in ONE database transaction. PIN is verified by the caller. */
export async function requestWithdrawal(userId: string, amount: bigint, upiId: string, idempotencyKey: string) {
  assertFeature('withdrawals');
  if (!UPI_RE.test(upiId)) throw new AppError('INVALID_UPI', 'Enter a valid UPI ID.', 422);
  const rules = await getWithdrawRules();
  if (amount < rules.min || amount > rules.max) throw new AppError('INVALID_AMOUNT', `Withdrawal must be between ₹${formatPaise(rules.min)} and ₹${formatPaise(rules.max)}.`, 422);
  const fee = rules.flatFee + (amount * BigInt(rules.feeBps)) / 10_000n;
  const withdrawalId = generateWithdrawalId();

  try {
    const { tx, replayed } = await debitWallet({
      userId, type: 'WITHDRAWAL', amount, fee, status: 'PROCESSING', idempotencyKey: `wd:${idempotencyKey}`,
      reference: withdrawalId, description: `Withdrawal to ${maskUpi(upiId)}`,
      inTx: async (db, t) => { await db.withdrawal.create({ data: { withdrawalId, userId, amount, fee, destination: upiId, txnId: t.txnId, idempotencyKey } }); },
    });
    if (replayed) return { withdrawal: await prisma.withdrawal.findFirstOrThrow({ where: { userId, idempotencyKey } }), created: false };
    void checkMovement(userId, 'WITHDRAWAL', amount);
    return { withdrawal: await prisma.withdrawal.findUniqueOrThrow({ where: { withdrawalId } }), created: true };
  } catch (e) {
    if (e instanceof AppError && e.code === 'DUPLICATE_TRANSACTION') {
      const w = await prisma.withdrawal.findFirst({ where: { userId, idempotencyKey } });
      if (w) return { withdrawal: w, created: false };
    }
    throw e;
  }
}

// ---------- finalisation (each is idempotent and safe under concurrency) ----------
export async function finalizeSuccess(w: Withdrawal, providerRef?: string) {
  const r = await prisma.withdrawal.updateMany({ where: { id: w.id, status: { in: ['PROCESSING', 'MANUAL_REVIEW', 'PENDING'] } }, data: { status: 'SUCCESSFUL', providerRef, failureReason: null, nextCheckAt: null } });
  if (r.count !== 1) return;
  await prisma.transaction.updateMany({ where: { txnId: w.txnId, status: { in: ['PROCESSING', 'MANUAL_REVIEW', 'PENDING'] } }, data: { status: 'SUCCESSFUL', provider: 'PAYOUT', providerReference: providerRef ?? undefined } }).catch(async () => {
    await transitionStatus(w.txnId, ['PROCESSING', 'MANUAL_REVIEW', 'PENDING'], 'SUCCESSFUL'); // provider ref clash: still mark success
  });
  await prisma.$transaction((db) => enqueueWebhook(db, w.userId, 'withdrawal.success', { withdrawal_id: w.withdrawalId, amount: formatPaise(w.amount), status: 'success' }));
  void notify(w.userId, 'withdrawal.success', 'Withdrawal successful', `₹${formatPaise(w.amount)} was sent to ${maskUpi(w.destination)}.`);
  await audit({ actorType: 'SYSTEM', actorId: w.userId, action: 'withdrawal.success', result: 'SUCCESS', resourceType: 'Withdrawal', resourceId: w.withdrawalId });
}

/** Definitive failure only: refund exactly once. */
export async function finalizeFailure(w: Withdrawal, reason: string) {
  await prisma.withdrawal.updateMany({ where: { id: w.id, status: { in: ['PENDING', 'PROCESSING', 'MANUAL_REVIEW'] } }, data: { status: 'FAILED', failureReason: reason.slice(0, 200), nextCheckAt: null } });
  const cur = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
  if (cur.status !== 'FAILED') return; // already SUCCESSFUL/REFUNDED by someone else
  await refundDebit({ txnId: w.txnId, reason: `withdrawal ${w.withdrawalId} failed` }); // idempotent: UNIQUE(refundOf)
  const done = await prisma.withdrawal.updateMany({ where: { id: w.id, status: 'FAILED' }, data: { status: 'REFUNDED' } });
  if (done.count === 1) {
    await prisma.$transaction((db) => enqueueWebhook(db, w.userId, 'withdrawal.failed', { withdrawal_id: w.withdrawalId, amount: formatPaise(w.amount), status: 'failed' }));
    void notify(w.userId, 'withdrawal.failed', 'Withdrawal failed', `₹${formatPaise(w.amount)} has been refunded to your wallet.`);
    await audit({ actorType: 'SYSTEM', actorId: w.userId, action: 'withdrawal.refunded', result: 'SUCCESS', resourceType: 'Withdrawal', resourceId: w.withdrawalId, metadata: { reason } });
  }
}

const later = (attempts: number) => new Date(Date.now() + Math.min(60 * 2 ** attempts, 3600) * 1000);

/**
 * Step 2: send to the payout provider AT MOST ONCE per withdrawal.
 * The PENDING->PROCESSING claim is the guard. If the provider times out we do NOT resend and do NOT refund:
 * the status check (or an admin) settles it. This is what prevents paying twice.
 */
export async function submitPayout(withdrawalId: string, cfgOverride?: PayoutConfig | null) {
  const claim = await prisma.withdrawal.updateMany({ where: { withdrawalId, status: 'PENDING' }, data: { status: 'PROCESSING', submittedAt: new Date(), nextCheckAt: later(0) } });
  const w = await prisma.withdrawal.findUniqueOrThrow({ where: { withdrawalId } });
  if (claim.count !== 1) return w;

  const cfg = cfgOverride === undefined ? payoutConfig() : cfgOverride;
  if (!cfg) { // no provider configured: nothing was sent, so it is safe to refund
    await finalizeFailure(w, 'payout provider not configured');
    return prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
  }
  const out = await createPayout(cfg, { reference: w.withdrawalId, destination: w.destination, amountPaise: w.amount });
  await audit({ actorType: 'SYSTEM', actorId: w.userId, action: 'payout.submitted', result: out.kind === 'FAILED' ? 'FAILURE' : 'SUCCESS', resourceType: 'Withdrawal', resourceId: w.withdrawalId, metadata: { outcome: out.kind, detail: out.detail } });
  if (out.kind === 'SUCCESS') await finalizeSuccess(w, out.reference);
  else if (out.kind === 'FAILED') await finalizeFailure(w, out.detail ?? 'provider failed');
  else await prisma.withdrawal.update({ where: { id: w.id }, data: { providerRef: out.reference } }); // stay PROCESSING; job will check
  return prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
}

/** Job: settle PROCESSING payouts by asking the provider; escalate to manual review rather than guess. */
export async function checkProcessing(cfgOverride?: PayoutConfig | null): Promise<number> {
  const due = await prisma.withdrawal.findMany({ where: { status: 'PROCESSING', nextCheckAt: { lte: new Date() } }, take: 20 });
  const cfg = cfgOverride === undefined ? payoutConfig() : cfgOverride;
  let n = 0;
  for (const w of due) {
    const lease = await prisma.withdrawal.updateMany({ where: { id: w.id, status: 'PROCESSING', nextCheckAt: w.nextCheckAt }, data: { nextCheckAt: new Date(Date.now() + 120_000) } });
    if (lease.count !== 1) continue;
    n++;
    const o = cfg ? await checkPayout(cfg, { reference: w.withdrawalId, destination: w.destination, amountPaise: w.amount, providerRef: w.providerRef ?? undefined }) : null;
    if (o?.kind === 'SUCCESS') { await finalizeSuccess(w, o.reference ?? w.providerRef ?? undefined); continue; }
    if (o?.kind === 'FAILED') { await finalizeFailure(w, o.detail ?? 'provider reported failure'); continue; }
    const attempts = w.attempts + 1;
    if (!cfg?.status || attempts >= MAX_CHECKS) {
      await prisma.withdrawal.updateMany({ where: { id: w.id, status: 'PROCESSING' }, data: { status: 'MANUAL_REVIEW', attempts, nextCheckAt: null, failureReason: 'provider status unknown' } });
      await transitionStatus(w.txnId, ['PROCESSING'], 'MANUAL_REVIEW').catch(() => {});
      await audit({ actorType: 'SYSTEM', actorId: w.userId, action: 'payout.manual_review', result: 'SUCCESS', resourceType: 'Withdrawal', resourceId: w.withdrawalId });
    } else {
      await prisma.withdrawal.update({ where: { id: w.id }, data: { attempts, nextCheckAt: later(attempts) } });
    }
  }
  return n;
}

/** Job: crash recovery. Funds were reserved but the payout was never attempted. */
export async function submitStalePending(): Promise<number> {
  const stale = await prisma.withdrawal.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 30_000) } }, take: 20 });
  for (const w of stale) await submitPayout(w.withdrawalId).catch(() => {});
  return stale.length;
}

/** Job: a FAILED withdrawal whose refund did not complete (crash between steps). */
export async function finishFailedRefunds(): Promise<number> {
  const rows = await prisma.withdrawal.findMany({ where: { status: 'FAILED', updatedAt: { lt: new Date(Date.now() - 60_000) } }, take: 20 });
  for (const w of rows) await finalizeFailure(w, w.failureReason ?? 'failed').catch(() => {});
  return rows.length;
}
