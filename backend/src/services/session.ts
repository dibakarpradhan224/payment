import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { isProd } from '../config/env.js';

export const SESSION_COOKIE = 'sid';
const DAY = 86_400_000;

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string, remember = false) {
  const token = randomToken(32);
  const ttl = (remember ? 30 : 7) * DAY;
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
      expiresAt: new Date(Date.now() + ttl),
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(ttl / 1000),
  });
  return session;
}

export const revokeAllSessions = (userId: string, exceptId?: string) =>
  prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
