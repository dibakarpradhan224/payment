import type { FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { SESSION_COOKIE } from '../services/session.js';
import { allowedOrigins } from '../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; sessionId: string; user: User };
  }
}

export async function requireAuth(req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) throw new AppError('UNAUTHENTICATED', 'Please log in.', 401);
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 'Session expired. Please log in again.', 401);
  if (s.user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 'Your account is suspended.', 403);
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    void prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  req.auth = { userId: s.userId, sessionId: s.id, user: s.user };
}

/** CSRF defence on top of SameSite=Strict: state-changing cookie requests must come from our origins. */
export async function originGuard(req: FastifyRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !(req.cookies[SESSION_COOKIE] || req.cookies['asid'])) return;
  const origin = req.headers.origin?.replace(/\/$/, '');
  if (!origin || !allowedOrigins.includes(origin)) throw new AppError('BAD_ORIGIN', 'Request origin not allowed.', 403);
}

export const needsPin = async (req: FastifyRequest) => {
  if (!req.auth?.user.pinHash) throw new AppError('PIN_NOT_SET', 'Create your 4-digit PIN first.', 403);
};
