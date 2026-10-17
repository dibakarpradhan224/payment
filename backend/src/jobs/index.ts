import { prisma } from '../lib/prisma.js';
import { deliverDue } from '../services/merchantWebhooks.js';
import { checkProcessing, finishFailedRefunds, submitStalePending } from '../services/withdrawals.js';
import { expireDue } from '../services/paymentRequests.js';
import { expireOrders } from '../services/upiOrders.js';
import { reconcile } from '../services/utr.js';
import { refreshSettings } from '../services/settings.js';

/**
 * In-process workers. Every job is safe to run on several instances at once: each one claims its rows with a
 * conditional update (lease), so no item is processed twice. Heartbeats feed /health.
 */
export const heartbeat = new Map<string, number>();
const running = new Set<string>();

function every(name: string, ms: number, fn: () => Promise<unknown>) {
  const tick = async () => {
    if (running.has(name)) return;
    running.add(name);
    try { await fn(); heartbeat.set(name, Date.now()); }
    catch (e) { console.error(`job.${name}.failed`, (e as Error).message); }
    finally { running.delete(name); }
  };
  const t = setInterval(tick, ms);
  t.unref();
  void tick();
  return t;
}

async function cleanup() {
  const day = new Date(Date.now() - 86_400_000);
  await Promise.all([
    prisma.otp.deleteMany({ where: { OR: [{ expiresAt: { lt: day } }, { consumedAt: { lt: day } }] } }),
    prisma.resetToken.deleteMany({ where: { expiresAt: { lt: day } } }),
    prisma.telegramLinkCode.deleteMany({ where: { expiresAt: { lt: day } } }),
    prisma.idempotencyKey.deleteMany({ where: { status: 'COMPLETED', createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } }),
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }, { revokedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }] } }),
    prisma.adminSession.deleteMany({ where: { expiresAt: { lt: day } } }),
    prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } }),
  ]);
}

async function rereconcileUtr() {
  const waiting = await prisma.utrSubmission.findMany({ where: { status: 'MANUAL_REVIEW', reason: 'NO_BANK_RECORD' }, take: 50 });
  for (const s of waiting) await reconcile(s.id).catch(() => {});
}

export function startJobs() {
  const timers = [
    every('webhook-delivery', 10_000, () => deliverDue()),
    every('payout-check', 15_000, () => checkProcessing()),
    every('payout-submit-stale', 30_000, () => submitStalePending()),
    every('refund-finish', 30_000, () => finishFailedRefunds()),
    every('request-expiry', 30_000, () => expireDue()),
    every('upi-order-expiry', 60_000, () => expireOrders()),
    every('utr-rereconcile', 5 * 60_000, () => rereconcileUtr()),
    every('settings-refresh', 60_000, () => refreshSettings()),
    every('cleanup', 10 * 60_000, () => cleanup()),
  ];
  return () => timers.forEach(clearInterval);
}
