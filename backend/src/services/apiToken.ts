import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateApiToken } from '../lib/apiTokenFormat.js';
import { open, seal } from '../lib/secretBox.js';

export type TokenKind = 'PAYOUT' | 'MERCHANT' | 'ALL';
/** Least privilege: a payout token cannot create payments and a merchant token cannot move money. */
export const KIND_SCOPES: Record<TokenKind, string[]> = { PAYOUT: ['read', 'withdraw', 'transfer'], MERCHANT: ['read', 'payments'], ALL: ['read', 'payments', 'transfer', 'withdraw'] };
export const toKind = (k: 'payout' | 'merchant' | 'legacy'): TokenKind => (k === 'payout' ? 'PAYOUT' : k === 'merchant' ? 'MERCHANT' : 'ALL');

/**
 * One active token per user per kind. Issuing a new one revokes the old one in the SAME transaction,
 * so the previous token stops working the instant the new one exists.
 * A partial unique index (see constraints.sql) makes two simultaneous "active" tokens impossible.
 */
export async function issueApiToken(userId: string, scopes: string[], name?: string, kind: TokenKind = 'ALL') {
  try {
    return await prisma.$transaction(async (db) => {
      await db.apiToken.updateMany({ where: { userId, kind, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      const t = generateApiToken();
      const row = await db.apiToken.create({ data: { userId, kind, tokenHash: t.hash, tokenEnc: seal(t.token), prefix: t.prefix, scopes, name } });
      return { token: t.token, row };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('CONFLICT', 'Another token change was in progress. Please retry.', 409);
    }
    throw e;
  }
}

export const activeToken = (userId: string, kind?: TokenKind) => prisma.apiToken.findFirst({ where: { userId, status: 'ACTIVE', ...(kind ? { kind } : {}) } });

export async function revokeApiToken(userId: string, kind?: TokenKind) {
  const r = await prisma.apiToken.updateMany({ where: { userId, status: 'ACTIVE', ...(kind ? { kind } : {}) }, data: { status: 'REVOKED', revokedAt: new Date() } });
  return r.count;
}

export const tokenDto = (t: { id: string; name: string | null; prefix: string; scopes: string[]; status: string; kind: string; lastUsedAt: Date | null; createdAt: Date }) => ({
  id: t.id, kind: t.kind, name: t.name, prefix: `${t.prefix}…`, scopes: t.scopes, status: t.status, lastUsedAt: t.lastUsedAt, createdAt: t.createdAt,
});

/** Owner-only (the route requires the PIN). Tokens made before this feature cannot be shown: reset them once. */
export async function revealApiToken(userId: string, kind?: TokenKind): Promise<string> {
  const t = await activeToken(userId, kind);
  if (!t) throw new AppError('NOT_FOUND', 'You have no active API token.', 404);
  if (!t.tokenEnc) throw new AppError('NOT_REVEALABLE', 'This token was created before viewing was available. Reset it once to enable viewing.', 409);
  try { return open(t.tokenEnc); } catch { throw new AppError('NOT_REVEALABLE', 'This token cannot be decrypted (SETTINGS_KEY changed). Reset it.', 409); }
}
