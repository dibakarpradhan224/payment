import { prisma } from '../lib/prisma.js';
import { audit } from './audit.js';

/** Risk flags only RAISE A HAND for admin review. They never freeze, block or take funds. */
const T = { rapidWithdrawals: 5, manyDeposits: 10, manyTransfers: 20, highValuePaise: 5_000_000n, sharedIpAccounts: 4 };
const HOUR = 3_600_000;

export async function raiseFlag(userId: string, type: string, detail?: string) {
  try {
    const recent = await prisma.riskFlag.findFirst({ where: { userId, type, createdAt: { gt: new Date(Date.now() - 24 * HOUR) } } });
    if (recent) return;
    await prisma.riskFlag.create({ data: { userId, type, detail } });
    await audit({ actorType: 'SYSTEM', actorId: userId, action: 'risk.flag', result: 'SUCCESS', metadata: { type, detail } });
  } catch { /* never block the money path */ }
}

export async function checkMovement(userId: string, kind: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER', amount: bigint) {
  try {
    const since = new Date(Date.now() - HOUR);
    const type = kind === 'DEPOSIT' ? 'DEPOSIT' : kind === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'TRANSFER';
    const n = await prisma.transaction.count({ where: { userId, type, createdAt: { gte: since } } });
    if (kind === 'WITHDRAWAL' && n >= T.rapidWithdrawals) await raiseFlag(userId, 'RAPID_WITHDRAWALS', `${n} withdrawals in 1h`);
    if (kind === 'DEPOSIT' && n >= T.manyDeposits) await raiseFlag(userId, 'MANY_DEPOSITS', `${n} deposits in 1h`);
    if (kind === 'TRANSFER' && n >= T.manyTransfers) await raiseFlag(userId, 'MANY_TRANSFERS', `${n} transfers in 1h`);
    if (amount >= T.highValuePaise) await raiseFlag(userId, 'HIGH_VALUE', `${kind} of ${amount / 100n} INR`);
  } catch { /* ignore */ }
}

export async function checkSharedIp(userId: string, ip?: string | null) {
  if (!ip) return;
  try {
    const rows = await prisma.session.findMany({ where: { ip, createdAt: { gt: new Date(Date.now() - 24 * HOUR) } }, distinct: ['userId'], select: { userId: true }, take: 10 });
    if (rows.length >= T.sharedIpAccounts) await raiseFlag(userId, 'SHARED_IP_ACCOUNTS', `${rows.length} accounts from one IP in 24h`);
  } catch { /* ignore */ }
}
