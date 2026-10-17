import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateLinkCode, sha256 } from '../lib/crypto.js';

export async function createLinkCode(userId: string) {
  const code = generateLinkCode();
  await prisma.telegramLinkCode.deleteMany({ where: { userId, usedAt: null } });
  await prisma.telegramLinkCode.create({ data: { userId, codeHash: sha256(code), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return code;
}

export async function redeemLinkCode(code: string, telegramId: bigint, username?: string) {
  return prisma.$transaction(async (db) => {
    const row = await db.telegramLinkCode.findUnique({ where: { codeHash: sha256(code.trim().toUpperCase()) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError('INVALID_LINK_CODE', 'That code is invalid or expired.', 400);
    const claim = await db.telegramLinkCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count !== 1) throw new AppError('INVALID_LINK_CODE', 'That code is invalid or expired.', 400);
    const taken = await db.telegramLink.findFirst({ where: { OR: [{ userId: row.userId }, { telegramId }] } });
    if (taken) throw new AppError('ALREADY_LINKED', 'This account or Telegram user is already linked. Unlink first.', 409);
    await db.telegramLink.create({ data: { userId: row.userId, telegramId, username } });
    return row.userId;
  });
}
