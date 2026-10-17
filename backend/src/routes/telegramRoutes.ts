import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { env } from '../config/env.js';
import { verifyInitData } from '../telegram/initData.js';
import { handleUpdate } from '../telegram/bot.js';
import { createSession } from '../services/session.js';
import { audit } from '../services/audit.js';

/** Mini App login: the ONLY identity accepted is Telegram's signed initData, verified here with the bot token. */
export async function telegramAuthRoutes(app: FastifyInstance) {
  app.post('/telegram/auth', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!env.TELEGRAM_BOT_TOKEN) throw new AppError('METHOD_UNAVAILABLE', 'Telegram is not configured.', 503);
    const { initData } = z.object({ initData: z.string().min(20).max(4000) }).parse(req.body);
    let info;
    try { info = verifyInitData(initData, env.TELEGRAM_BOT_TOKEN); }
    catch { await audit({ action: 'telegram.miniapp.auth', result: 'FAILURE', ip: req.ip }); throw new AppError('INVALID_TELEGRAM_AUTH', 'Telegram authentication failed.', 401); }
    const link = await prisma.telegramLink.findUnique({ where: { telegramId: BigInt(info.user.id) }, include: { user: true } });
    if (!link) throw new AppError('NOT_LINKED', 'Link your account first: send /link CODE to the bot.', 404);
    if (link.user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 'Your account is suspended.', 403);
    const s = await createSession(req, reply, link.userId);
    await audit({ actorId: link.userId, sessionId: s.id, ip: req.ip, action: 'telegram.miniapp.auth', result: 'SUCCESS' });
    return ok({ startParam: info.startParam ?? null, user: { id: link.user.id, paymentId: link.user.paymentId, pinSet: !!link.user.pinHash } });
  });
}

export async function telegramWebhookRoutes(app: FastifyInstance) {
  app.post('/telegram', async (req) => {
    const want = env.TELEGRAM_WEBHOOK_SECRET;
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (!want || typeof got !== 'string' || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
      throw new AppError('INVALID_SIGNATURE', 'Forbidden.', 403);
    }
    await handleUpdate(req.body).catch((e) => req.log.error({ err: e }, 'telegram.update_failed'));
    return ok({});
  });
}
