import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { hashSecret, verifySecret } from '../lib/crypto.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export async function setInitialPin(userId: string, pin: string) {
  const hash = await hashSecret(pin);
  // Conditional update: only succeeds if no PIN exists yet (race-safe).
  const r = await prisma.user.updateMany({ where: { id: userId, pinHash: null }, data: { pinHash: hash } });
  if (r.count !== 1) throw new AppError('PIN_ALREADY_SET', 'A PIN is already set. Use change PIN instead.', 409);
}

/**
 * Required before every sensitive money action (Phase 2+).
 * A 4-digit PIN has only 10,000 combinations, so the lockout is what protects it.
 */
export async function verifyPin(userId: string, pin: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.pinHash) throw new AppError('PIN_NOT_SET', 'Create your 4-digit PIN first.', 403);
  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw new AppError('PIN_LOCKED', 'Too many incorrect PIN attempts. Try again later or reset your PIN.', 429);
  }
  if (await verifySecret(user.pinHash, pin)) {
    if (user.pinFailedAttempts) await prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    return;
  }
  const after = await prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: { increment: 1 } } });
  if (after.pinFailedAttempts >= MAX_FAILS) {
    await prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: new Date(Date.now() + LOCK_MS) } });
    throw new AppError('PIN_LOCKED', 'Too many incorrect PIN attempts. Try again later or reset your PIN.', 429);
  }
  throw new AppError('INVALID_PIN', 'Incorrect PIN.', 400, { attemptsRemaining: MAX_FAILS - after.pinFailedAttempts });
}

export async function replacePin(userId: string, pin: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash: await hashSecret(pin), pinFailedAttempts: 0, pinLockedUntil: null },
  });
}
