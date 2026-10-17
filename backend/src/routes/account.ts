import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pin } from '../validators/auth.js';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { hashSecret, verifySecret } from '../lib/crypto.js';
import { maskEmail, maskMobile } from '../lib/mask.js';
import { displayName } from '../lib/displayName.js';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validators/money.js';
import { revokeAllSessions } from '../services/session.js';
import { findOwnTransaction, txDto } from '../services/transactions.js';
import { rotateSecret, saveEndpoint, WEBHOOK_EVENTS } from '../services/merchantWebhooks.js';
import { createLinkCode } from '../telegram/link.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.js';
import { verifyPin } from '../services/pin.js';

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ----- Profile & settings -----
  app.get('/profile', async (req) => {
    const u = req.auth!.user;
    return ok({ profile: { id: u.id, name: u.name, email: u.email, mobile: u.mobile, paymentId: u.paymentId, createdAt: u.createdAt, emailVerified: !!u.emailVerifiedAt, pinSet: !!u.pinHash, notifyEmail: u.notifyEmail, notifyTelegram: u.notifyTelegram } });
  });
  app.patch('/profile', limit(20), async (req) => {
    const b = v.profileBody.parse(req.body);
    await prisma.user.update({ where: { id: req.auth!.userId }, data: b });
    await audit({ actorId: req.auth!.userId, ip: req.ip, action: 'profile.updated', result: 'SUCCESS', metadata: { fields: Object.keys(b) } });
    return ok({ message: 'Saved.' });
  });
  app.post('/profile/password', limit(5), async (req) => {
    const b = v.passwordChange.parse(req.body);
    if (!(await verifySecret(req.auth!.user.passwordHash, b.currentPassword))) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.', 400);
    await prisma.user.update({ where: { id: req.auth!.userId }, data: { passwordHash: await hashSecret(b.newPassword) } });
    await revokeAllSessions(req.auth!.userId, req.auth!.sessionId); // other devices are signed out
    await audit({ actorId: req.auth!.userId, ip: req.ip, action: 'auth.password_changed', result: 'SUCCESS' });
    return ok({ message: 'Password changed. Other devices were signed out.' });
  });

  // ----- Receipt -----
  app.get<{ Params: { txnId: string } }>('/transactions/:txnId/receipt', async (req) => {
    const t = await findOwnTransaction(req.auth!.userId, req.params.txnId);
    if (!t) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);
    const me = req.auth!.user;
    const mine = { paymentId: me.paymentId, name: displayName(me.name) };
    let other: { paymentId: string; name: string } | null = null;
    if (t.reference && ['TRANSFER', 'RECEIVE', 'PAYMENT'].includes(t.type)) {
      const c = await prisma.transaction.findFirst({ where: { reference: t.reference, userId: { not: t.userId }, type: { in: ['TRANSFER', 'RECEIVE', 'PAYMENT'] } }, include: { user: true } });
      if (c) other = { paymentId: c.user.paymentId, name: displayName(c.user.name) };
    }
    const label = (p: string) => ({ paymentId: p, name: p });
    const [sender, receiver] = t.direction === 'DEBIT' ? [mine, other ?? label(t.provider ?? 'External')] : [other ?? label(t.provider ?? 'External'), mine];
    return ok({ receipt: { ...txDto(t), sender, receiver, paymentMethod: t.provider ?? 'WALLET', generatedAt: new Date() } });
  });

  // ----- Notifications -----
  app.get('/notifications', async (req) => {
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.auth!.userId, read: false } }),
    ]);
    return ok({ unread, notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt })) });
  });
  app.post('/notifications/read-all', async (req) => {
    await prisma.notification.updateMany({ where: { userId: req.auth!.userId, read: false }, data: { read: true } });
    return ok({ message: 'Done.' });
  });

  // ----- Merchant webhook endpoint -----
  app.get('/webhook-endpoint', async (req) => {
    const e = await prisma.webhookEndpoint.findUnique({ where: { userId: req.auth!.userId } });
    return ok({ endpoint: e ? { url: e.url, events: e.events, active: e.active } : null, availableEvents: WEBHOOK_EVENTS });
  });
  app.put('/webhook-endpoint', limit(10), async (req) => {
    const b = v.webhookBody.parse(req.body);
    const { secret } = await saveEndpoint(req.auth!.userId, b.url, b.events, b.active);
    await audit({ actorId: req.auth!.userId, ip: req.ip, action: 'webhook_endpoint.saved', result: 'SUCCESS' });
    return ok({ saved: true, secret, notice: secret ? 'Copy this signing secret now. It will not be shown again.' : undefined });
  });
  app.post('/webhook-endpoint/rotate-secret', limit(5), async (req) => {
    const secret = await rotateSecret(req.auth!.userId);
    await audit({ actorId: req.auth!.userId, ip: req.ip, action: 'webhook_endpoint.secret_rotated', result: 'SUCCESS' });
    return ok({ secret, notice: 'Copy this signing secret now. It will not be shown again.' });
  });
  app.get('/webhook-deliveries', async (req) => {
    const rows = await prisma.webhookDelivery.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return ok({ deliveries: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, lastStatus: d.lastStatus, lastError: d.lastError, createdAt: d.createdAt, deliveredAt: d.deliveredAt })) });
  });
  app.post<{ Params: { id: string } }>('/webhook-deliveries/:id/redeliver', limit(10), async (req) => {
    const r = await prisma.webhookDelivery.updateMany({ where: { id: req.params.id, userId: req.auth!.userId, status: { in: ['FAILED', 'DELIVERED'] } }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } });
    if (r.count !== 1) throw new AppError('NOT_FOUND', 'Delivery not found.', 404);
    return ok({ message: 'Queued for redelivery.' });
  });

  // ----- Telegram -----
  app.get('/telegram', async (req) => {
    const l = await prisma.telegramLink.findUnique({ where: { userId: req.auth!.userId } });
    return ok({ linked: !!l, username: l?.username ?? null, botUsername: env.TELEGRAM_BOT_USERNAME ?? null });
  });
  app.post('/telegram/link-code', limit(5), async (req) => ok({ code: await createLinkCode(req.auth!.userId), expiresInSeconds: 600, botUsername: env.TELEGRAM_BOT_USERNAME ?? null }));
  app.delete('/telegram', limit(5), async (req) => {
    await prisma.telegramLink.deleteMany({ where: { userId: req.auth!.userId } });
    await audit({ actorId: req.auth!.userId, ip: req.ip, action: 'telegram.unlinked', result: 'SUCCESS' });
    return ok({ message: 'Unlinked.' });
  });

  // ----- Security overview used by the Settings page -----
  app.get('/security', async (req) => {
    const u = req.auth!.user;
    const sessions = await prisma.session.count({ where: { userId: u.id, revokedAt: null, expiresAt: { gt: new Date() } } });
    return ok({ emailMasked: maskEmail(u.email), mobileMasked: maskMobile(u.mobile), pinSet: !!u.pinHash, activeSessions: sessions });
  });
  // Re-check PIN without side effects (used before showing sensitive screens).
  app.post('/security/verify-pin', limit(10), async (req) => {
    const b = z.object({ pin }).parse(req.body);
    await verifyPin(req.auth!.userId, b.pin);
    return ok({ valid: true });
  });
}
