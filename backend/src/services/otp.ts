import type { OtpPurpose, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateOtp, hmacOtp, safeEqualHex } from '../lib/crypto.js';
import { sendOtpEmail } from './mail.js';

export const OTP_TTL_MIN = 10;
const RESEND_COOLDOWN_MS = 60_000;

export async function issueOtp(email: string, purpose: OtpPurpose, meta?: Prisma.InputJsonValue) {
  const recent = await prisma.otp.findFirst({
    where: { email, purpose, consumedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) throw new AppError('OTP_COOLDOWN', 'Please wait a minute before requesting another OTP.', 429);

  const code = generateOtp();
  // Invalidate earlier codes and create the new one together.
  const [, created] = await prisma.$transaction([
    prisma.otp.updateMany({ where: { email, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.otp.create({
      data: {
        email,
        purpose,
        codeHash: hmacOtp(email, purpose, code),
        meta,
        expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
      },
    }),
  ]);
  try { await sendOtpEmail(email, purpose, code, OTP_TTL_MIN); }
  catch (e) { await prisma.otp.deleteMany({ where: { id: created.id } }); throw e; } // let the user retry immediately
}

/** Verifies and atomically consumes the latest OTP. Verification happens only on the server. */
export async function verifyOtp(email: string, purpose: OtpPurpose, code: string) {
  const otp = await prisma.otp.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw new AppError('INVALID_OTP', 'Incorrect OTP. Enter OTP again.', 400);
  if (otp.expiresAt < new Date()) {
    await prisma.otp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    throw new AppError('OTP_EXPIRED', 'OTP expired. Request a new one.', 400);
  }

  // Count the attempt first so parallel guesses cannot exceed the limit.
  const updated = await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  if (updated.attempts > updated.maxAttempts) {
    await prisma.otp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new OTP.', 429);
  }
  if (!safeEqualHex(updated.codeHash, hmacOtp(email, purpose, code))) {
    throw new AppError('INVALID_OTP', 'Incorrect OTP. Enter OTP again.', 400);
  }
  const consumed = await prisma.otp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw new AppError('INVALID_OTP', 'Incorrect OTP. Enter OTP again.', 400);
  return otp;
}
