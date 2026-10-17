/**
 * The ONLY code allowed to change wallet balances.
 * Every operation runs in one DB transaction that first takes a row lock on the wallet(s)
 * (SELECT ... FOR UPDATE), so concurrent requests are serialised per wallet:
 * no lost updates, no two withdrawals spending the same balance.
 */
import { Prisma, type Transaction, type TxStatus, type TxType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { generateTxnId } from '../lib/crypto.js';
import { calculateTax } from './tax.js';
import { getActiveSlabs } from './taxSettings.js';

type Db = Prisma.TransactionClient;
type Direction = 'CREDIT' | 'DEBIT';
export type TxResult = { tx: Transaction; replayed: boolean };

const DUPLICATE_MSG = 'This transaction has already been added to your account and cannot be added twice.';

export interface Entry {
  userId: string;
  type: TxType;
  direction: Direction;
  gross: bigint;
  tax?: bigint;
  taxRateBps?: number;
  fee?: bigint;
  status?: TxStatus;
  idempotencyKey: string;
  description?: string;
  reference?: string;
  provider?: string;
  providerReference?: string;
  refundOf?: string;
  metadata?: Prisma.InputJsonValue;
}

export async function lockWallets(db: Db, userIds: string[]) {
  const ids = [...new Set(userIds)].sort(); // consistent order => no deadlocks
  const rows = await db.$queryRaw<{ userId: string; available: bigint; frozen: boolean }[]>(
    Prisma.sql`SELECT "userId", "available", "frozen" FROM "Wallet" WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR UPDATE`,
  );
  if (rows.length !== ids.length) throw new AppError('WALLET_NOT_FOUND', 'Wallet not found.', 404);
  return new Map(rows.map((r) => [r.userId, r]));
}

function totalsFor(type: TxType, gross: bigint, tax: bigint, fee: bigint, net: bigint): Prisma.WalletUpdateInput {
  switch (type) {
    case 'DEPOSIT': return { totalDeposited: { increment: gross }, totalFees: { increment: tax + fee } };
    case 'RECEIVE': return { totalReceived: { increment: net } };
    case 'TRANSFER': return { totalTransferred: { increment: gross }, totalFees: { increment: fee } };
    case 'WITHDRAWAL': return { totalWithdrawn: { increment: gross }, totalFees: { increment: fee } };
    default: return {};
  }
}

/** Caller must already hold the wallet lock. */
export async function applyEntry(db: Db, e: Entry, lock: { available: bigint; frozen: boolean }): Promise<TxResult> {
  const tax = e.tax ?? 0n;
  const fee = e.fee ?? 0n;
  if (e.gross <= 0n) throw new AppError('INVALID_AMOUNT', 'Amount must be greater than zero.', 422);

  // Replay: identical operation already applied for this user -> return it, change nothing.
  const existing = await db.transaction.findUnique({
    where: { userId_type_idempotencyKey: { userId: e.userId, type: e.type, idempotencyKey: e.idempotencyKey } },
  });
  if (existing) return { tx: existing, replayed: true };

  const net = e.direction === 'CREDIT' ? e.gross - tax - fee : e.gross;
  if (net < 0n) throw new AppError('INVALID_AMOUNT', 'Fees exceed the amount.', 422);
  const delta = e.direction === 'CREDIT' ? net : -(e.gross + fee);

  if (e.direction === 'DEBIT') {
    if (lock.frozen) throw new AppError('WALLET_FROZEN', 'Your wallet is frozen. Contact support.', 403);
    if (lock.available + delta < 0n) throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient balance.', 400);
  }

  const wallet = await db.wallet.update({
    where: { userId: e.userId },
    data: { available: { increment: delta }, ...totalsFor(e.type, e.gross, tax, fee, net) },
  });
  const tx = await db.transaction.create({
    data: {
      txnId: generateTxnId(),
      userId: e.userId,
      type: e.type,
      direction: e.direction,
      status: e.status ?? 'SUCCESSFUL',
      amount: e.gross,
      grossAmount: e.gross,
      tax, taxRateBps: e.taxRateBps ?? 0, fee,
      netAmount: net,
      balanceAfter: wallet.available,
      idempotencyKey: e.idempotencyKey,
      description: e.description, reference: e.reference,
      provider: e.provider, providerReference: e.providerReference,
      refundOf: e.refundOf, metadata: e.metadata,
    },
  });
  return { tx, replayed: false };
}

const TX_OPTS = { maxWait: 5_000, timeout: 15_000 } as const;

/** Runs fn in a locked transaction; maps unique-violations (duplicate UTR / payment ID) to a clean error. */
export async function run<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, TX_OPTS);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('DUPLICATE_TRANSACTION', DUPLICATE_MSG, 409);
    }
    throw e;
  }
}

/** Verified deposit. Tax is computed HERE from the active slabs; callers cannot supply it. */
export async function creditDeposit(a: {
  userId: string; gross: bigint; idempotencyKey: string;
  provider: string; providerReference: string; reference?: string; description?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<TxResult> {
  const t = calculateTax(a.gross, await getActiveSlabs());
  return run(async (db) => {
    const locks = await lockWallets(db, [a.userId]);
    return applyEntry(db, {
      userId: a.userId, type: 'DEPOSIT', direction: 'CREDIT', gross: a.gross,
      tax: t.tax, taxRateBps: t.rateBps, idempotencyKey: a.idempotencyKey,
      provider: a.provider, providerReference: a.providerReference,
      reference: a.reference, description: a.description ?? 'Wallet deposit', metadata: a.metadata,
    }, locks.get(a.userId)!);
  });
}

/** Reserve/deduct funds for an outgoing operation (withdrawal, payout, payment). `inTx` runs in the SAME DB transaction. */
export async function debitWallet(a: {
  userId: string; type: Extract<TxType, 'WITHDRAWAL' | 'PAYOUT' | 'PAYMENT' | 'TRANSFER'>;
  amount: bigint; fee?: bigint; status?: TxStatus; idempotencyKey: string;
  reference?: string; provider?: string; providerReference?: string; description?: string;
  metadata?: Prisma.InputJsonValue;
  inTx?: (db: Db, tx: Transaction) => Promise<void>;
}): Promise<TxResult> {
  return run(async (db) => {
    const locks = await lockWallets(db, [a.userId]);
    const res = await applyEntry(db, {
      userId: a.userId, type: a.type, direction: 'DEBIT', gross: a.amount, fee: a.fee,
      status: a.status ?? 'PROCESSING', idempotencyKey: a.idempotencyKey,
      reference: a.reference, provider: a.provider, providerReference: a.providerReference,
      description: a.description, metadata: a.metadata,
    }, locks.get(a.userId)!);
    if (!res.replayed && a.inTx) await a.inTx(db, res.tx);
    return res;
  });
}

/** Wallet-to-wallet transfer. Both sides commit together or not at all. */
export async function transferInternal(a: {
  fromUserId: string; toUserId: string; amount: bigint; idempotencyKey: string; description?: string;
}): Promise<{ sent: Transaction; received: Transaction; replayed: boolean }> {
  if (a.fromUserId === a.toUserId) throw new AppError('SELF_TRANSFER', 'You cannot send money to yourself.', 400);
  return run(async (db) => {
    const locks = await lockWallets(db, [a.fromUserId, a.toUserId]);
    const recipient = await db.user.findUnique({ where: { id: a.toUserId }, select: { status: true } });
    if (recipient?.status !== 'ACTIVE') throw new AppError('RECIPIENT_UNAVAILABLE', 'Recipient account is unavailable.', 400);

    const transferId = randomUUID();
    const sent = await applyEntry(db, {
      userId: a.fromUserId, type: 'TRANSFER', direction: 'DEBIT', gross: a.amount,
      idempotencyKey: a.idempotencyKey, reference: transferId, description: a.description ?? 'Transfer sent',
    }, locks.get(a.fromUserId)!);
    if (sent.replayed) {
      const received = await db.transaction.findFirstOrThrow({ where: { reference: sent.tx.reference, type: 'RECEIVE' } });
      return { sent: sent.tx, received, replayed: true };
    }
    const received = await applyEntry(db, {
      userId: a.toUserId, type: 'RECEIVE', direction: 'CREDIT', gross: a.amount,
      idempotencyKey: `${a.idempotencyKey}:recv:${a.fromUserId}`, reference: transferId, description: a.description ?? 'Transfer received',
    }, locks.get(a.toUserId)!);
    return { sent: sent.tx, received: received.tx, replayed: false };
  });
}

/**
 * Refund a debit exactly once (failed transfer/withdrawal/payout).
 * Safe under retries and concurrency: the wallet lock serialises callers and
 * Transaction.refundOf is UNIQUE, so a second refund is impossible even if code is wrong.
 */
export async function refundDebit(a: { txnId: string; reason: string; allowSuccessful?: boolean }): Promise<TxResult> {
  const head = await prisma.transaction.findUnique({ where: { txnId: a.txnId } });
  if (!head) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);

  return run(async (db) => {
    const locks = await lockWallets(db, [head.userId]);
    const orig = await db.transaction.findUniqueOrThrow({ where: { id: head.id } }); // re-read under lock

    const prior = await db.transaction.findUnique({ where: { refundOf: orig.id } });
    if (prior) return { tx: prior, replayed: true };

    if (orig.direction !== 'DEBIT') throw new AppError('NOT_REFUNDABLE', 'Only outgoing payments can be refunded.', 400);
    const refundable: TxStatus[] = ['PENDING', 'PROCESSING', 'FAILED', 'MANUAL_REVIEW'];
    if (!refundable.includes(orig.status) && !(a.allowSuccessful && orig.status === 'SUCCESSFUL')) {
      throw new AppError('NOT_REFUNDABLE', `A ${orig.status.toLowerCase()} transaction cannot be refunded.`, 409);
    }

    const amount = orig.grossAmount + orig.fee; // give back everything that was taken
    const res = await applyEntry(db, {
      userId: orig.userId, type: 'REFUND', direction: 'CREDIT', gross: amount,
      idempotencyKey: `refund:${orig.id}`, refundOf: orig.id, reference: orig.txnId,
      description: `Refund: ${a.reason}`.slice(0, 200),
    }, locks.get(orig.userId)!);

    await db.transaction.update({ where: { id: orig.id }, data: { status: 'REFUNDED' } });
    // Undo the lifetime totals the original debit added.
    const undo: Prisma.WalletUpdateInput =
      orig.type === 'WITHDRAWAL' ? { totalWithdrawn: { decrement: orig.grossAmount }, totalFees: { decrement: orig.fee } }
      : orig.type === 'TRANSFER' ? { totalTransferred: { decrement: orig.grossAmount }, totalFees: { decrement: orig.fee } }
      : {};
    if (Object.keys(undo).length) await db.wallet.update({ where: { userId: orig.userId }, data: undo });
    return res;
  });
}

const TERMINAL: TxStatus[] = ['SUCCESSFUL', 'FAILED', 'REFUNDED', 'REJECTED'];
/** Guarded status change: terminal states never move, and concurrent callers cannot both win. */
export async function transitionStatus(txnId: string, from: TxStatus[], to: TxStatus): Promise<boolean> {
  if (from.some((s) => TERMINAL.includes(s))) throw new AppError('INVALID_TRANSITION', 'Cannot change a finished transaction.', 409);
  const r = await prisma.transaction.updateMany({ where: { txnId, status: { in: from } }, data: { status: to } });
  return r.count === 1;
}
