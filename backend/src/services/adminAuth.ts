import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Admin } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { dummyVerify, hashSecret, randomToken, sha256, verifySecret } from '../lib/crypto.js';
import { env, isProd } from '../config/env.js';
import { can, type Perm } from '../lib/permissions.js';
import { audit } from './audit.js';

export const ADMIN_COOKIE = 'asid';
declare module 'fastify' { interface FastifyRequest { admin?: Admin & { sessionId: string } } }

/** First start: create the Super Admin from ADMIN_EMAIL / ADMIN_SECRET (change the password after first login). */
export async function bootstrapAdmin() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_SECRET) return;
  if ((await prisma.admin.count()) > 0) return;
  await prisma.admin.create({ data: { email: env.ADMIN_EMAIL.toLowerCase(), passwordHash: await hashSecret(env.ADMIN_SECRET), role: 'SUPER_ADMIN' } });
  console.warn('admin.bootstrapped: Super Admin created from ADMIN_EMAIL');
}

export async function adminLogin(req: FastifyRequest, reply: FastifyReply, email: string, password: string) {
  const a = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
  const bad = new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401);
  const why = (r: string) => { if (!isProd) console.warn(`admin.login.failed: ${r} (shown only in development)`); };
  if (!a || !a.active) { why(a ? 'account disabled' : 'no admin with this email: run "npm run admin:reset"'); await dummyVerify(password); await audit({ actorType: 'ADMIN', action: 'admin.login', result: 'FAILURE', ip: req.ip }); throw bad; }
  if (a.lockedUntil && a.lockedUntil > new Date()) { why('locked after 5 wrong attempts: run "npm run admin:reset"'); throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', 429); }
  if (!(await verifySecret(a.passwordHash, password))) {
    why('password does not match the stored one (if you changed ADMIN_SECRET after the first start, run "npm run admin:reset")');
    const after = await prisma.admin.update({ where: { id: a.id }, data: { failedLoginAttempts: { increment: 1 } } });
    if (after.failedLoginAttempts >= 5) await prisma.admin.update({ where: { id: a.id }, data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
    await audit({ actorType: 'ADMIN', actorId: a.id, action: 'admin.login', result: 'FAILURE', ip: req.ip });
    throw bad;
  }
  await prisma.admin.update({ where: { id: a.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  const token = randomToken(32);
  const s = await prisma.adminSession.create({ data: { adminId: a.id, tokenHash: sha256(token), ip: req.ip, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
  reply.setCookie(ADMIN_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: 8 * 3600 });
  await audit({ actorType: 'ADMIN', actorId: a.id, sessionId: s.id, action: 'admin.login', result: 'SUCCESS', ip: req.ip });
  return a;
}

export async function requireAdmin(req: FastifyRequest) {
  const t = req.cookies[ADMIN_COOKIE];
  if (!t) throw new AppError('UNAUTHENTICATED', 'Admin login required.', 401);
  const s = await prisma.adminSession.findUnique({ where: { tokenHash: sha256(t) }, include: { admin: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.admin.active) throw new AppError('UNAUTHENTICATED', 'Admin session expired.', 401);
  req.admin = { ...s.admin, sessionId: s.id };
}

export const requirePerm = (perm: Perm) => async (req: FastifyRequest) => {
  await requireAdmin(req);
  if (!can(req.admin!.role, perm)) {
    await audit({ actorType: 'ADMIN', actorId: req.admin!.id, action: 'admin.forbidden', result: 'FAILURE', ip: req.ip, metadata: { perm, path: req.url.split('?')[0] } });
    throw new AppError('FORBIDDEN', 'Your role does not allow this action.', 403);
  }
};

export const adminAudit = (req: FastifyRequest, action: string, resourceType?: string, resourceId?: string, metadata?: Record<string, unknown>) =>
  audit({ actorType: 'ADMIN', actorId: req.admin!.id, sessionId: req.admin!.sessionId, ip: req.ip, action, result: 'SUCCESS', resourceType, resourceId, metadata });
