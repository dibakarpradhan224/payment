import type { FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { API_TOKEN_RE, hashToken } from '../lib/apiTokenFormat.js';
import { assertFeature } from '../services/settings.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiAuth?: { tokenId: string; userId: string; scopes: string[]; user: User };
    rawBody?: string;
  }
}

export { consumeToken, TOKEN_LIMIT_PER_MIN } from '../lib/tokenLimiter.js';
import { consumeToken } from '../lib/tokenLimiter.js';

async function authenticate(req: FastifyRequest, token: string | undefined) {
  // Same error for every failure: nothing leaks about which tokens exist.
  assertFeature('api');
  const bad = new AppError('INVALID_API_TOKEN', 'Invalid or missing API token.', 401);
  if (!token || !API_TOKEN_RE.test(token)) throw bad;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.status !== 'ACTIVE') throw bad;
  if (row.user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 'Account suspended.', 403);

  const lim = consumeToken(row.id);
  if (!lim.allowed) throw new AppError('RATE_LIMITED', `Too many requests. Retry in ${lim.retryAfterSec}s.`, 429);

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    void prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  req.apiAuth = { tokenId: row.id, userId: row.userId, scopes: row.scopes, user: row.user };
}

export const requireApiToken = (req: FastifyRequest) => authenticate(req, /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]);
/** URL-style API only (`?token=`). Never used by the header-based gateway. */
export const requireApiTokenQuery = (req: FastifyRequest) => {
  const t = (req.query as { token?: unknown } | undefined)?.token;
  return authenticate(req, typeof t === 'string' ? t : undefined);
};

export const requireScope = (scope: string) => async (req: FastifyRequest) => {
  if (!req.apiAuth?.scopes.includes(scope)) throw new AppError('INSUFFICIENT_SCOPE', `This token lacks the "${scope}" scope.`, 403);
};
