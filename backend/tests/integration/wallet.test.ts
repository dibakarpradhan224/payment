/**
 * Concurrency & financial-integrity tests. They need a REAL Postgres with the migrations
 * AND prisma/sql/constraints.sql applied. Use a throwaway database, never production.
 *   DATABASE_URL=... npm run test:integration
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma.js';
import { creditDeposit, debitWallet, refundDebit, transferInternal } from '../../src/services/wallet.js';
import { withIdempotency, fingerprintOf } from '../../src/services/idempotency.js';

const rs = (n: number) => BigInt(n) * 100n;
const key = () => `k-${randomUUID()}`;

async function mkUser(balanceRupees = 0) {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, email: `${id}@t.test`, mobile: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`, passwordHash: 'x', paymentId: `PAY-${id.slice(0, 8)}`, wallet: { create: { available: rs(balanceRupees) } } },
  });
  return id;
}
const bal = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).available;

afterAll(() => prisma.$disconnect());

describe('deposit & tax', () => {
  it('₹30 deposit credits ₹29.40 and records the tax applied', async () => {
    const u = await mkUser();
    const { tx } = await creditDeposit({ userId: u, gross: rs(30), idempotencyKey: key(), provider: 'TEST', providerReference: randomUUID() });
    expect(tx.tax).toBe(60n);
    expect(tx.netAmount).toBe(2940n);
    expect(await bal(u)).toBe(2940n);
  });
});

describe('Case 1: simultaneous withdrawals', () => {
  it('₹100 balance, two ₹100 withdrawals -> exactly one succeeds', async () => {
    const u = await mkUser(100);
    const r = await Promise.allSettled([1, 2].map(() => debitWallet({ userId: u, type: 'WITHDRAWAL', amount: rs(100), idempotencyKey: key() })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const bad = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(bad.reason.code).toBe('INSUFFICIENT_BALANCE');
    expect(bad.reason.message).toBe('Insufficient balance.');
    expect(await bal(u)).toBe(0n);
  });
  it('30 parallel ₹10 debits against ₹100 -> exactly 10 succeed, balance 0, never negative', async () => {
    const u = await mkUser(100);
    const r = await Promise.allSettled(Array.from({ length: 30 }, () => debitWallet({ userId: u, type: 'WITHDRAWAL', amount: rs(10), idempotencyKey: key() })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(10);
    expect(await bal(u)).toBe(0n);
  });
});

describe('Case 2/3: duplicate UTR / webhook', () => {
  it('same UTR twice (different idempotency keys, even different users) -> one credit only', async () => {
    const a = await mkUser(); const b = await mkUser();
    const utr = `UTR${Date.now()}`;
    const r = await Promise.allSettled([
      creditDeposit({ userId: a, gross: rs(500), idempotencyKey: key(), provider: 'UPI_UTR', providerReference: utr }),
      creditDeposit({ userId: a, gross: rs(500), idempotencyKey: key(), provider: 'UPI_UTR', providerReference: utr }),
      creditDeposit({ userId: b, gross: rs(500), idempotencyKey: key(), provider: 'UPI_UTR', providerReference: utr }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const x of r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      expect(x.reason.message).toBe('This transaction has already been added to your account and cannot be added twice.');
    }
    expect((await bal(a)) + (await bal(b))).toBe(rs(500) - 1000n); // one credit of ₹500 less 2% tax
  });
  it('same event/idempotency key replayed 10x concurrently -> one credit', async () => {
    const u = await mkUser(); const k = key(); const ref = randomUUID();
    const r = await Promise.all(Array.from({ length: 10 }, () => creditDeposit({ userId: u, gross: rs(100), idempotencyKey: k, provider: 'UPI_UTR', providerReference: ref })));
    expect(new Set(r.map((x) => x.tx.txnId)).size).toBe(1);
    expect(r.filter((x) => !x.replayed)).toHaveLength(1);
    expect(await bal(u)).toBe(rs(100) - 200n);
  });
});

describe('Case 5: refunds', () => {
  it('failed debit refunded concurrently 8x -> refunded exactly once', async () => {
    const u = await mkUser(100);
    const { tx } = await debitWallet({ userId: u, type: 'WITHDRAWAL', amount: rs(60), fee: rs(1), idempotencyKey: key() });
    expect(await bal(u)).toBe(rs(39));
    const r = await Promise.all(Array.from({ length: 8 }, () => refundDebit({ txnId: tx.txnId, reason: 'provider failed' })));
    expect(new Set(r.map((x) => x.tx.txnId)).size).toBe(1);
    expect(await bal(u)).toBe(rs(100));
    expect(await prisma.transaction.count({ where: { refundOf: tx.id } })).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe('REFUNDED');
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: u } });
    expect(w.totalWithdrawn).toBe(0n);
  });
  it('successful withdrawals are not refundable', async () => {
    const u = await mkUser(50);
    const { tx } = await debitWallet({ userId: u, type: 'WITHDRAWAL', amount: rs(10), status: 'SUCCESSFUL', idempotencyKey: key() });
    await expect(refundDebit({ txnId: tx.txnId, reason: 'x' })).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
  });
});

describe('transfers', () => {
  it('moves money atomically and conserves the total', async () => {
    const a = await mkUser(100); const b = await mkUser(0);
    const r = await transferInternal({ fromUserId: a, toUserId: b, amount: rs(40), idempotencyKey: key() });
    expect(r.sent.type).toBe('TRANSFER'); expect(r.received.type).toBe('RECEIVE');
    expect(await bal(a)).toBe(rs(60)); expect(await bal(b)).toBe(rs(40));
  });
  it('insufficient balance changes nothing on either side', async () => {
    const a = await mkUser(10); const b = await mkUser(0);
    await expect(transferInternal({ fromUserId: a, toUserId: b, amount: rs(11), idempotencyKey: key() })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await bal(a)).toBe(rs(10)); expect(await bal(b)).toBe(0n);
  });
  it('replaying a transfer key does not send twice', async () => {
    const a = await mkUser(100); const b = await mkUser(0); const k = key();
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => transferInternal({ fromUserId: a, toUserId: b, amount: rs(10), idempotencyKey: k })));
    expect(new Set(r.map((x) => x.sent.txnId)).size).toBe(1);
    expect(await bal(a)).toBe(rs(90)); expect(await bal(b)).toBe(rs(10));
  });
  it('opposing simultaneous transfers do not deadlock and conserve money', async () => {
    const a = await mkUser(100); const b = await mkUser(100);
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      i % 2 ? transferInternal({ fromUserId: a, toUserId: b, amount: rs(5), idempotencyKey: key() })
              : transferInternal({ fromUserId: b, toUserId: a, amount: rs(3), idempotencyKey: key() })));
    expect((await bal(a)) + (await bal(b))).toBe(rs(200));
  });
  it('cannot send to yourself', async () => {
    const a = await mkUser(10);
    await expect(transferInternal({ fromUserId: a, toUserId: a, amount: rs(1), idempotencyKey: key() })).rejects.toMatchObject({ code: 'SELF_TRANSFER' });
  });
});

describe('guards', () => {
  it('frozen wallet cannot debit', async () => {
    const u = await mkUser(50);
    await prisma.wallet.update({ where: { userId: u }, data: { frozen: true } });
    await expect(debitWallet({ userId: u, type: 'WITHDRAWAL', amount: rs(1), idempotencyKey: key() })).rejects.toMatchObject({ code: 'WALLET_FROZEN' });
  });
  it('DB itself rejects a negative balance', async () => {
    const u = await mkUser(5);
    await expect(prisma.wallet.update({ where: { userId: u }, data: { available: -1n } })).rejects.toThrow();
  });
  it('ledger rows are immutable and undeletable', async () => {
    const u = await mkUser(10);
    const { tx } = await debitWallet({ userId: u, type: 'WITHDRAWAL', amount: rs(1), idempotencyKey: key() });
    await expect(prisma.transaction.update({ where: { id: tx.id }, data: { amount: 1n } })).rejects.toThrow();
    await expect(prisma.transaction.delete({ where: { id: tx.id } })).rejects.toThrow();
  });
});

describe('API idempotency layer', () => {
  it('same key+body replays result; different body is rejected; run once', async () => {
    const u = await mkUser(); const k = key(); let runs = 0;
    const fp = fingerprintOf({ amount: '10' });
    const fn = async () => { runs++; await new Promise((r) => setTimeout(r, 50)); return { ok: true, n: runs }; };
    const r = await Promise.allSettled([1, 2, 3].map(() => withIdempotency(u, 'transfer', k, fp, fn)));
    expect(runs).toBe(1);
    const again = await withIdempotency(u, 'transfer', k, fp, fn);
    expect(again.replayed).toBe(true); expect(runs).toBe(1);
    await expect(withIdempotency(u, 'transfer', k, fingerprintOf({ amount: '99' }), fn)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(r.some((x) => x.status === 'fulfilled')).toBe(true);
  });
});
