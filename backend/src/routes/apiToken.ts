import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyPin } from '../services/pin.js';
import { activeToken, issueApiToken, KIND_SCOPES, revealApiToken, revokeApiToken, toKind, tokenDto } from '../services/apiToken.js';
import { pin } from '../validators/auth.js';
import { audit } from '../services/audit.js';

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
const WARNING = 'Resetting an API token will invalidate the previous token of that type.';
const kind = z.enum(['payout', 'merchant']);
const withPin = z.object({ pin, kind });

/** Two separate tokens: PAYOUT (send money) and MERCHANT (accept payments). Each has fixed, minimal permissions. */
export async function apiTokenRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api-token', async (req) => {
    const rows = await prisma.apiToken.findMany({ where: { userId: req.auth!.userId, status: 'ACTIVE' } });
    const pick = (k: string) => { const r = rows.find((x) => x.kind === k); return r ? tokenDto(r) : null; };
    return ok({ tokens: { payout: pick('PAYOUT'), merchant: pick('MERCHANT'), legacy: pick('ALL') }, warning: WARNING });
  });

  app.post('/api-token', limit(5), async (req, reply) => {
    const b = withPin.parse(req.body); const uid = req.auth!.userId; const K = toKind(b.kind);
    await verifyPin(uid, b.pin);
    if (await activeToken(uid, K)) throw new AppError('TOKEN_EXISTS', 'You already have this token. Reset it instead.', 409);
    const { token, row } = await issueApiToken(uid, KIND_SCOPES[K], undefined, K);
    await audit({ actorId: uid, sessionId: req.auth!.sessionId, ip: req.ip, action: 'api_token.created', result: 'SUCCESS', resourceType: 'ApiToken', resourceId: row.id, metadata: { kind: K } });
    reply.code(201);
    return ok({ token, meta: tokenDto(row), notice: 'Copy this token now, or view it later with your PIN.' });
  });

  app.post('/api-token/regenerate', limit(5), async (req) => {
    const b = withPin.parse(req.body); const uid = req.auth!.userId; const K = toKind(b.kind);
    await verifyPin(uid, b.pin);
    const { token, row } = await issueApiToken(uid, KIND_SCOPES[K], undefined, K);
    await audit({ actorId: uid, sessionId: req.auth!.sessionId, ip: req.ip, action: 'api_token.regenerated', result: 'SUCCESS', resourceType: 'ApiToken', resourceId: row.id, metadata: { kind: K } });
    return ok({ token, meta: tokenDto(row), notice: WARNING });
  });

  // View the full token again. PIN required every time; rate limited; audited.
  app.post('/api-token/reveal', limit(5), async (req) => {
    const b = withPin.parse(req.body); const uid = req.auth!.userId;
    await verifyPin(uid, b.pin);
    const token = await revealApiToken(uid, toKind(b.kind));
    await audit({ actorId: uid, sessionId: req.auth!.sessionId, ip: req.ip, action: 'api_token.revealed', result: 'SUCCESS', metadata: { kind: b.kind } });
    return ok({ token });
  });

  // Revoking only reduces risk, so it does not require the PIN.
  app.post('/api-token/revoke', limit(10), async (req) => {
    const b = z.object({ kind: z.enum(['payout', 'merchant', 'legacy']) }).parse(req.body);
    const n = await revokeApiToken(req.auth!.userId, toKind(b.kind));
    await audit({ actorId: req.auth!.userId, sessionId: req.auth!.sessionId, ip: req.ip, action: 'api_token.revoked', result: 'SUCCESS', metadata: { kind: b.kind } });
    return ok({ revoked: n });
  });

  app.get('/api-token/usage', async (req) => {
    const userId = req.auth!.userId;
    const q = z.object({ kind: kind.optional() }).parse(req.query);
    const ids = q.kind ? (await prisma.apiToken.findMany({ where: { userId, kind: toKind(q.kind) }, select: { id: true } })).map((t) => t.id) : undefined;
    const base = { userId, ...(ids ? { tokenId: { in: ids } } : {}) };
    const since = new Date(Date.now() - 24 * 3600_000);
    const [total, errors, recent] = await Promise.all([
      prisma.apiRequestLog.count({ where: { ...base, createdAt: { gte: since } } }),
      prisma.apiRequestLog.count({ where: { ...base, createdAt: { gte: since }, status: { gte: 400 } } }),
      prisma.apiRequestLog.findMany({ where: base, orderBy: { createdAt: 'desc' }, take: 50, select: { method: true, path: true, status: true, durationMs: true, ip: true, createdAt: true } }),
    ]);
    return ok({ last24h: { requests: total, errors }, recent });
  });
}
