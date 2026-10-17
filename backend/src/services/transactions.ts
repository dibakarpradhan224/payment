import type { Prisma, Transaction, TxType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { money } from '../lib/money.js';

export const txDto = (t: Transaction) => ({
  id: t.txnId, type: t.type, direction: t.direction, status: t.status,
  amount: money(t.amount), tax: money(t.tax), taxRatePercent: t.taxRateBps / 100, fee: money(t.fee), net: money(t.netAmount),
  currency: t.currency, balanceAfter: t.balanceAfter === null ? null : money(t.balanceAfter),
  reference: t.reference, provider: t.provider, providerReference: t.providerReference,
  description: t.description, createdAt: t.createdAt, updatedAt: t.updatedAt,
});

const FILTERS: Record<string, TxType[] | undefined> = {
  all: undefined, deposits: ['DEPOSIT'], transfers: ['TRANSFER'], received: ['RECEIVE'],
  withdrawals: ['WITHDRAWAL', 'PAYOUT'], refunds: ['REFUND'], payments: ['PAYMENT'],
};
export const listQuery = z.object({
  filter: z.enum(['all', 'deposits', 'transfers', 'received', 'withdrawals', 'refunds', 'payments']).default('all'),
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

/** Always scoped to userId: callers can never read another user's ledger. */
export async function listTransactions(userId: string, q: z.infer<typeof listQuery>) {
  const types = FILTERS[q.filter];
  const where: Prisma.TransactionWhereInput = {
    userId,
    ...(types ? { type: { in: types } } : {}),
    ...(q.q ? { OR: [{ txnId: q.q }, { reference: q.q }, { providerReference: q.q }] } : {}),
  };
  const rows = await prisma.transaction.findMany({
    where, take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const more = rows.length > q.limit;
  const page = more ? rows.slice(0, q.limit) : rows;
  return { transactions: page.map(txDto), nextCursor: more ? page[page.length - 1]!.id : null };
}

export const findOwnTransaction = (userId: string, txnId: string) =>
  prisma.transaction.findFirst({ where: { txnId, userId } });

export async function walletSummary(userId: string) {
  const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const pending = await prisma.transaction.count({ where: { userId, status: { in: ['PENDING', 'PROCESSING', 'MANUAL_REVIEW'] } } });
  return {
    available: money(w.available), locked: money(w.locked), frozen: w.frozen,
    totalDeposited: money(w.totalDeposited), totalWithdrawn: money(w.totalWithdrawn),
    totalTransferred: money(w.totalTransferred), totalReceived: money(w.totalReceived),
    totalFees: money(w.totalFees), pendingTransactions: pending, updatedAt: w.updatedAt,
  };
}
