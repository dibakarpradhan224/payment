import { Prisma } from '@prisma/client';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { assertSafeHost, assertSafeUrl } from '../lib/ssrf.js';
import { open, seal } from '../lib/secretBox.js';
import { isProd } from '../config/env.js';

export const WEBHOOK_EVENTS = ['payment.created', 'payment.pending', 'payment.success', 'payment.failed', 'payment.refunded', 'withdrawal.success', 'withdrawal.failed'] as const;
export const BACKOFF_SEC = [30, 60, 300, 900, 3600, 10_800, 21_600, 43_200]; // 8 attempts over ~18h
type Db = Prisma.TransactionClient;

export const signWebhook = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
export const nextDelaySec = (attempts: number) => BACKOFF_SEC[Math.min(attempts, BACKOFF_SEC.length - 1)]!;

function checkConfig(url: string, events: string[]) {
  try { assertSafeUrl(url, !isProd); } catch (e) { throw new AppError('INVALID_WEBHOOK_URL', (e as Error).message, 422); }
  if (!events.length || events.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))) throw new AppError('INVALID_EVENTS', 'Unknown webhook event.', 422);
}
const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export async function saveEndpoint(userId: string, url: string, events: string[], active = true) {
  checkConfig(url, events);
  const existing = await prisma.webhookEndpoint.findUnique({ where: { userId } });
  if (existing) {
    await prisma.webhookEndpoint.update({ where: { userId }, data: { url, events, active } });
    return { secret: null as string | null };
  }
  const secret = newSecret();
  await prisma.webhookEndpoint.create({ data: { userId, url, events, active, secretEnc: seal(secret) } });
  return { secret }; // shown once
}

export async function rotateSecret(userId: string) {
  const secret = newSecret();
  const r = await prisma.webhookEndpoint.updateMany({ where: { userId }, data: { secretEnc: seal(secret) } });
  if (!r.count) throw new AppError('NOT_FOUND', 'Configure a webhook URL first.', 404);
  return secret;
}

/** Outbox: call inside the SAME transaction as the state change, so an event exists iff the change committed. */
export async function enqueueWebhook(db: Db, userId: string, event: (typeof WEBHOOK_EVENTS)[number], data: Record<string, unknown>) {
  const ep = await db.webhookEndpoint.findUnique({ where: { userId } });
  if (!ep || !ep.active || !ep.events.includes(event)) return;
  const id = `evt_${randomUUID()}`;
  await db.webhookDelivery.create({ data: { userId, event, payload: { id, event, created_at: new Date().toISOString(), data } as Prisma.InputJsonValue } });
}

async function deliverOne(d: { id: string; userId: string; attempts: number; payload: unknown; event: string }) {
  const ep = await prisma.webhookEndpoint.findUnique({ where: { userId: d.userId } });
  if (!ep || !ep.active) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', lastError: 'endpoint disabled or removed' } });
    return;
  }
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  let status: number | null = null, error: string | undefined;
  try {
    const u = await assertSafeHost(ep.url, !isProd);
    const res = await fetch(u, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), body,
      headers: {
        'Content-Type': 'application/json', 'User-Agent': 'CafinPay-Webhooks/1',
        'X-Gateway-Event': d.event, 'X-Gateway-Delivery': d.id,
        'X-Gateway-Signature': `t=${ts},v1=${signWebhook(open(ep.secretEnc), ts, body)}`,
      },
    });
    status = res.status;
  } catch (e) { error = (e as Error).message.slice(0, 200); }

  const attempts = d.attempts + 1;
  if (status !== null && status >= 200 && status < 300) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'DELIVERED', attempts, lastStatus: status, deliveredAt: new Date(), lastError: null } });
  } else if (attempts >= BACKOFF_SEC.length) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', attempts, lastStatus: status, lastError: error ?? `HTTP ${status}` } });
  } else {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts, lastStatus: status, lastError: error ?? `HTTP ${status}`, nextAttemptAt: new Date(Date.now() + nextDelaySec(attempts - 1) * 1000) } });
  }
}

export async function deliverDue(limit = 20) {
  const due = await prisma.webhookDelivery.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: limit });
  let n = 0;
  for (const d of due) {
    // Lease: only one worker wins the claim; a crashed worker's delivery becomes due again after the lease.
    const claim = await prisma.webhookDelivery.updateMany({ where: { id: d.id, status: 'PENDING', nextAttemptAt: d.nextAttemptAt }, data: { nextAttemptAt: new Date(Date.now() + 120_000) } });
    if (claim.count === 1) { await deliverOne(d); n++; }
  }
  return n;
}
