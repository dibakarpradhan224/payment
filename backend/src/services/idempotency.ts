import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';

const STALE_MS = 5 * 60_000;

export function getIdempotencyKey(req: FastifyRequest): string {
  const k = req.headers['idempotency-key'];
  if (typeof k !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(k)) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header (8-128 chars) is required.', 400);
  }
  return k;
}

/** Public API: the header is optional. With it, the same key never pays twice. Without it, every request is a new payment. */
export function getOptionalIdempotencyKey(req: FastifyRequest): string {
  return req.headers['idempotency-key'] === undefined ? `auto-${randomUUID()}` : getIdempotencyKey(req);
}

export { fingerprintOf } from '../lib/fingerprint.js';

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Same key + same request  -> returns the original result, performs nothing again.
 * Same key + different body -> rejected.
 * `fn` must return JSON-safe data (use string paise, not bigint).
 */
export async function withIdempotency<T extends Prisma.InputJsonValue>(
  userId: string, scope: string, key: string, fingerprint: string, fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const where = { userId_scope_key: { userId, scope, key } };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.idempotencyKey.create({ data: { userId, scope, key, fingerprint, status: 'IN_PROGRESS' } });
      break;
    } catch (e) {
      if (!isUnique(e)) throw e;
      const row = await prisma.idempotencyKey.findUnique({ where });
      if (!row) continue; // deleted between calls, retry insert
      if (row.fingerprint !== fingerprint) {
        throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.', 422);
      }
      if (row.status === 'COMPLETED') return { result: row.response as T, replayed: true };
      if (Date.now() - row.createdAt.getTime() > STALE_MS) {
        await prisma.idempotencyKey.deleteMany({ where: { id: row.id, status: 'IN_PROGRESS' } });
        continue;
      }
      throw new AppError('REQUEST_IN_PROGRESS', 'The original request is still being processed.', 409);
    }
    if (attempt === 1) throw new AppError('REQUEST_IN_PROGRESS', 'Please retry shortly.', 409);
  }

  try {
    const result = await fn();
    await prisma.idempotencyKey.update({ where, data: { status: 'COMPLETED', response: result } });
    return { result, replayed: false };
  } catch (e) {
    // fn is atomic: a thrown error means nothing was applied, so the client may retry with the same key.
    await prisma.idempotencyKey.deleteMany({ where: { userId, scope, key, status: 'IN_PROGRESS' } });
    throw e;
  }
}
