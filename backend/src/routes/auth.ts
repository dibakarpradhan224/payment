import { assertFeature } from '../services/settings.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { dummyVerify, generatePaymentId, hashSecret, randomToken, sha256, verifySecret } from '../lib/crypto.js';
import * as v from '../validators/auth.js';
import { issueOtp, verifyOtp, OTP_TTL_MIN } from '../services/otp.js';
import { createSession, revokeAllSessions, SESSION_COOKIE } from '../services/session.js';
import { replacePin, setInitialPin, verifyPin } from '../services/pin.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';

const MAX_LOGIN_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60_000;

const limit = (max: number, timeWindow = '1 minute') => ({ config: { rateLimit: { max, timeWindow } } });
const publicUser = (u: { id: string; email: string; mobile: string; name: string | null; paymentId: string; pinHash: string | null; createdAt: Date }) => ({
  id: u.id, email: u.email, mobile: u.mobile, name: u.name, paymentId: u.paymentId, pinSet: !!u.pinHash, createdAt: u.createdAt,
});
const ctx = (req: FastifyRequest) => ({ ip: req.ip, sessionId: req.auth?.sessionId, actorId: req.auth?.userId });

async function createUserWithWallet(email: string, mobile: string, passwordHash: string, name?: string | null) {
  for (let i = 0; i < 5; i++) {
    try {
      return await prisma.user.create({
        data: { email, mobile, name: name ?? null, passwordHash, paymentId: generatePaymentId(), emailVerifiedAt: new Date(), wallet: { create: {} } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = String(e.meta?.target ?? '');
        if (target.includes('paymentId')) continue; // astronomically rare collision, retry
        throw new AppError('ACCOUNT_EXISTS', 'An account with this email or mobile already exists.', 409);
      }
      throw e;
    }
  }
  throw new AppError('INTERNAL_ERROR', 'Could not create account.', 500);
}

async function issueResetToken(userId: string, purpose: 'PASSWORD_RESET' | 'PIN_RESET') {
  const token = randomToken(32);
  await prisma.resetToken.create({
    data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return token;
}

/** Single-use, atomic redemption. */
async function redeemResetToken(token: string, purpose: 'PASSWORD_RESET' | 'PIN_RESET') {
  const row = await prisma.resetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError('INVALID_RESET_TOKEN', 'Reset link expired. Please start again.', 400);
  }
  const r = await prisma.resetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (r.count !== 1) throw new AppError('INVALID_RESET_TOKEN', 'Reset link expired. Please start again.', 400);
  return row.userId;
}

export async function authRoutes(app: FastifyInstance) {
  // ---------- Registration ----------
  app.post('/auth/register/start', limit(5), async (req) => {
    assertFeature('registrations');
    const b = v.registerStart.parse(req.body);
    const [byEmail, byMobile] = await Promise.all([
      prisma.user.findUnique({ where: { email: b.email } }),
      prisma.user.findUnique({ where: { mobile: b.mobile } }),
    ]);
    if (byEmail) throw new AppError('EMAIL_TAKEN', 'This email is already registered.', 409);
    if (byMobile) throw new AppError('MOBILE_TAKEN', 'This mobile number is already registered.', 409);
    await issueOtp(b.email, 'REGISTER', { mobile: b.mobile, name: b.name ?? null, passwordHash: await hashSecret(b.password) });
    await audit({ action: 'auth.register.otp_sent', result: 'SUCCESS', ip: req.ip, metadata: { email: b.email } });
    return ok({ message: 'OTP sent to your email.', expiresInSeconds: OTP_TTL_MIN * 60 });
  });

  app.post('/auth/register/verify', limit(10), async (req, reply) => {
    const b = v.registerVerify.parse(req.body);
    let otp;
    try {
      otp = await verifyOtp(b.email, 'REGISTER', b.otp);
    } catch (e) {
      await audit({ action: 'auth.register.otp_failed', result: 'FAILURE', ip: req.ip, metadata: { email: b.email } });
      throw e;
    }
    const meta = otp.meta as { mobile: string; passwordHash: string; name?: string | null };
    const user = await createUserWithWallet(b.email, meta.mobile, meta.passwordHash, meta.name);
    await createSession(req, reply, user.id);
    await audit({ actorId: user.id, action: 'auth.register.success', result: 'SUCCESS', ip: req.ip, resourceType: 'User', resourceId: user.id });
    reply.code(201);
    return ok({ message: 'Account created successfully.', user: publicUser(user) });
  });

  // ---------- Login / logout ----------
  app.post('/auth/login', limit(10), async (req, reply) => {
    const b = v.login.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: b.email } });
    const bad = new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.', 401);
    if (!user) {
      await dummyVerify(b.password);
      await audit({ action: 'auth.login', result: 'FAILURE', ip: req.ip, metadata: { reason: 'unknown_email' } });
      throw bad;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.', 429);
    }
    if (!(await verifySecret(user.passwordHash, b.password))) {
      const after = await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: { increment: 1 } } });
      if (after.failedLoginAttempts >= MAX_LOGIN_FAILS) {
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS) } });
      }
      await audit({ actorId: user.id, action: 'auth.login', result: 'FAILURE', ip: req.ip, metadata: { reason: 'bad_password' } });
      throw bad;
    }
    if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 'Your account is suspended.', 403);
    if (user.failedLoginAttempts || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }
    const s = await createSession(req, reply, user.id, b.remember);
    await audit({ actorId: user.id, action: 'auth.login', result: 'SUCCESS', ip: req.ip, sessionId: s.id });
    return ok({ user: publicUser(user) });
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { revokedAt: new Date() } });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await audit({ ...ctx(req), action: 'auth.logout', result: 'SUCCESS' });
    return ok({ message: 'Logged out.' });
  });

  app.post('/auth/logout-all', { preHandler: requireAuth }, async (req, reply) => {
    await revokeAllSessions(req.auth!.userId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await audit({ ...ctx(req), action: 'auth.logout_all', result: 'SUCCESS' });
    return ok({ message: 'Logged out from all devices.' });
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => ok({ user: publicUser(req.auth!.user) }));

  // ---------- Session management ----------
  app.get('/auth/sessions', { preHandler: requireAuth }, async (req) => {
    const rows = await prisma.session.findMany({
      where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return ok({
      sessions: rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.auth!.sessionId })),
    });
  });

  app.delete<{ Params: { id: string } }>('/auth/sessions/:id', { preHandler: requireAuth }, async (req) => {
    // userId in the filter prevents revoking someone else's session (IDOR).
    const r = await prisma.session.updateMany({ where: { id: req.params.id, userId: req.auth!.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw new AppError('NOT_FOUND', 'Session not found.', 404);
    await audit({ ...ctx(req), action: 'auth.session_revoked', result: 'SUCCESS', resourceType: 'Session', resourceId: req.params.id });
    return ok({ message: 'Session revoked.' });
  });

  // ---------- PIN ----------
  app.post('/auth/pin/set', { preHandler: requireAuth, ...limit(5) }, async (req) => {
    const b = v.setPin.parse(req.body);
    await setInitialPin(req.auth!.userId, b.pin);
    await audit({ ...ctx(req), action: 'auth.pin_set', result: 'SUCCESS' });
    return ok({ message: 'PIN created successfully.' });
  });

  app.post('/auth/pin/change', { preHandler: requireAuth, ...limit(5) }, async (req) => {
    const b = v.changePin.parse(req.body);
    await verifyPin(req.auth!.userId, b.oldPin);
    await replacePin(req.auth!.userId, b.pin);
    await audit({ ...ctx(req), action: 'auth.pin_changed', result: 'SUCCESS' });
    return ok({ message: 'PIN updated.' });
  });

  // PIN reset: user must be logged in AND prove email access (OTP goes to the account email).
  app.post('/auth/pin/forgot', { preHandler: requireAuth, ...limit(3) }, async (req) => {
    await issueOtp(req.auth!.user.email, 'PIN_RESET');
    await audit({ ...ctx(req), action: 'auth.pin_reset.otp_sent', result: 'SUCCESS' });
    return ok({ message: 'OTP sent to your email.', expiresInSeconds: OTP_TTL_MIN * 60 });
  });

  app.post('/auth/pin/verify-otp', { preHandler: requireAuth, ...limit(10) }, async (req) => {
    const b = v.pinVerifyOtp.parse(req.body);
    await verifyOtp(req.auth!.user.email, 'PIN_RESET', b.otp);
    return ok({ resetToken: await issueResetToken(req.auth!.userId, 'PIN_RESET') });
  });

  app.post('/auth/pin/reset', { preHandler: requireAuth, ...limit(5) }, async (req) => {
    const b = v.resetPin.parse(req.body);
    const userId = await redeemResetToken(b.resetToken, 'PIN_RESET');
    if (userId !== req.auth!.userId) throw new AppError('INVALID_RESET_TOKEN', 'Reset link expired. Please start again.', 400);
    await replacePin(userId, b.pin); // old PIN stops working immediately
    await audit({ ...ctx(req), action: 'auth.pin_reset', result: 'SUCCESS' });
    return ok({ message: 'PIN reset successfully.' });
  });

  // ---------- Password reset ----------
  app.post('/auth/password/forgot', limit(3), async (req) => {
    const b = v.forgot.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: b.email } });
    if (user) {
      try { await issueOtp(b.email, 'PASSWORD_RESET'); } catch (e) { if (!(e instanceof AppError)) throw e; }
      await audit({ actorId: user.id, action: 'auth.password_reset.otp_sent', result: 'SUCCESS', ip: req.ip });
    }
    // Same response whether or not the account exists.
    return ok({ message: 'If this email is registered, an OTP has been sent.', expiresInSeconds: OTP_TTL_MIN * 60 });
  });

  app.post('/auth/password/verify-otp', limit(10), async (req) => {
    const b = v.verifyResetOtp.parse(req.body);
    await verifyOtp(b.email, 'PASSWORD_RESET', b.otp);
    const user = await prisma.user.findUnique({ where: { email: b.email } });
    if (!user) throw new AppError('INVALID_OTP', 'Incorrect OTP. Enter OTP again.', 400);
    return ok({ resetToken: await issueResetToken(user.id, 'PASSWORD_RESET') });
  });

  app.post('/auth/password/reset', limit(5), async (req, reply) => {
    const b = v.resetPassword.parse(req.body);
    const userId = await redeemResetToken(b.resetToken, 'PASSWORD_RESET');
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashSecret(b.newPassword), failedLoginAttempts: 0, lockedUntil: null },
    });
    await revokeAllSessions(userId); // old password and every old session become invalid
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await audit({ actorId: userId, action: 'auth.password_reset', result: 'SUCCESS', ip: req.ip });
    return ok({ message: 'Password reset successfully. Please log in.' });
  });
}
