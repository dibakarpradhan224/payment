/** Needs a real throwaway Postgres (see wallet.test.ts header). Provider calls use a fake gateway; no network. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma.js';
import { createUpiOrder, adminSettleOrder } from '../../src/services/upiOrders.js';
import { submitUtr, ingestBankCredit, adminResolveUtr, DUPLICATE_UTR_MSG, UNDER_VERIFICATION_MSG } from '../../src/services/utr.js';
import { issueApiToken, activeToken } from '../../src/services/apiToken.js';
import { requireApiToken } from '../../src/middleware/apiToken.js';

const rs = (n: number) => BigInt(n) * 100n;
const bal = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).available;

async function mkUser() {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `${id}@t.test`, mobile: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`, passwordHash: 'x', paymentId: `PAY-${id.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '2')}`, wallet: { create: {} } } });
  return id;
}

afterAll(async () => { await prisma.$disconnect(); });

describe('Pay With UPI orders', () => {
  beforeAll(async () => { await prisma.systemSetting.upsert({ where: { key: 'upi' }, create: { key: 'upi', value: { upiId: 'merchant@upi', name: 'Test', autoMatchByAmount: true } }, update: { value: { upiId: 'merchant@upi', name: 'Test', autoMatchByAmount: true } } }); const { refreshSettings } = await import('../../src/services/settings.js'); await refreshSettings(); });

  it('same amount reuses the open order; the link carries amount and order reference', async () => {
    const u = await mkUser();
    const a = await createUpiOrder(u, rs(111)), b = await createUpiOrder(u, rs(111));
    expect(b.order.id).toBe(a.order.id);
    expect(a.order.uri).toContain('upi://pay?'); expect(a.order.uri).toContain('am=111.00'); expect(a.order.uri).toContain(`tn=${a.order.id}`);
  });

  it('bank credit with the order reference credits once, even when the feed repeats', async () => {
    const u = await mkUser(); const o = await createUpiOrder(u, rs(200)); const utr = `UPI${Date.now()}A1`;
    await Promise.all([1, 2, 3].map(() => ingestBankCredit({ utr, amount: rs(200), note: o.order.id, source: 't' })));
    expect(await bal(u)).toBe(rs(200) - 400n);
    expect((await prisma.upiOrder.findUniqueOrThrow({ where: { orderRef: o.order.id } })).status).toBe('PAID');
  });

  it('wrong amount is not credited; exact amount without reference matches a single open order', async () => {
    const u = await mkUser(); const o = await createUpiOrder(u, rs(333)); const u1 = `UPI${Date.now()}B1`, u2 = `UPI${Date.now()}B2`;
    await ingestBankCredit({ utr: u1, amount: rs(300), note: o.order.id, source: 't' });
    expect(await bal(u)).toBe(0n);
    await ingestBankCredit({ utr: u2, amount: rs(333), source: 't' });
    expect(await bal(u)).toBe(rs(333) - 666n);
  });

  it('two open orders with the same amount and no reference are not guessed', async () => {
    const a = await mkUser(), b = await mkUser(); await createUpiOrder(a, rs(777)); await createUpiOrder(b, rs(777));
    await ingestBankCredit({ utr: `UPI${Date.now()}C1`, amount: rs(777), source: 't' });
    expect(await bal(a)).toBe(0n); expect(await bal(b)).toBe(0n);
  });

  it('admin can settle an order with a bank transaction ID, once', async () => {
    const u = await mkUser(); const o = await createUpiOrder(u, rs(50)); const utr = `UPI${Date.now()}D1`;
    await adminSettleOrder(o.order.id, utr, 'a@t.test');
    expect(await bal(u)).toBe(rs(50) - 100n);
    await expect(adminSettleOrder(o.order.id, utr, 'a@t.test')).rejects.toMatchObject({ code: 'ALREADY_RESOLVED' });
  });
});

describe('Transaction ID (UTR)', () => {
  it('no bank record -> pending review, balance untouched; later bank feed auto-credits once', async () => {
    const u = await mkUser(); const utr = `UTR${Date.now()}A`;
    const r = await submitUtr(u, rs(500), utr);
    expect(r.status).toBe('MANUAL_REVIEW'); expect(r.message).toBe(UNDER_VERIFICATION_MSG);
    expect(await bal(u)).toBe(0n);
    await Promise.all([ingestBankCredit({ utr, amount: rs(500), payeeUpi: 'merchant@upi', source: 't' }), ingestBankCredit({ utr, amount: rs(500), source: 't' })]);
    expect(await bal(u)).toBe(rs(500) - 1000n); // ₹500 less 2% tax
    expect((await prisma.utrSubmission.findUniqueOrThrow({ where: { utr } })).status).toBe('VERIFIED');
  });

  it('matching bank record verifies immediately', async () => {
    const u = await mkUser(); const utr = `UTR${Date.now()}B`;
    await ingestBankCredit({ utr, amount: rs(100), payeeUpi: 'merchant@upi', source: 't' });
    expect((await submitUtr(u, rs(100), utr)).status).toBe('VERIFIED');
    expect(await bal(u)).toBe(rs(100) - 200n);
  });

  it('amount mismatch and wrong destination are not credited', async () => {
    const u = await mkUser(); const a = `UTR${Date.now()}C`, b = `UTR${Date.now()}D`;
    await ingestBankCredit({ utr: a, amount: rs(10), source: 't' });
    await ingestBankCredit({ utr: b, amount: rs(10), payeeUpi: 'someone-else@upi', source: 't' });
    expect((await submitUtr(u, rs(500), a)).status).toBe('MANUAL_REVIEW');
    expect((await submitUtr(u, rs(10), b)).status).toBe('MANUAL_REVIEW');
    expect(await bal(u)).toBe(0n);
  });

  it('a payment tagged with another user\'s PAY id cannot be claimed by someone else', async () => {
    const owner = await mkUser(), thief = await mkUser(); const utr = `UTR${Date.now()}E`;
    const ownerPid = (await prisma.user.findUniqueOrThrow({ where: { id: owner } })).paymentId;
    await ingestBankCredit({ utr, amount: rs(100), note: `deposit ${ownerPid}`, source: 't' });
    expect((await submitUtr(thief, rs(100), utr)).status).toBe('MANUAL_REVIEW');
    expect(await bal(thief)).toBe(0n);
  });

  it('Case 2: same UTR, 6 users at once -> exactly one claim and one credit', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, mkUser)); const utr = `UTR${Date.now()}F`;
    await ingestBankCredit({ utr, amount: rs(100), source: 't' });
    const r = await Promise.allSettled(users.map((u) => submitUtr(u, rs(100), utr)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const x of r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) expect(x.reason.message).toBe(DUPLICATE_UTR_MSG);
    const total = (await Promise.all(users.map(bal))).reduce((s, v) => s + v, 0n);
    expect(total).toBe(rs(100) - 200n);
  });

  it('resubmitting a verified UTR gives the duplicate message', async () => {
    const u = await mkUser(); const utr = `UTR${Date.now()}G`;
    await ingestBankCredit({ utr, amount: rs(100), source: 't' });
    await submitUtr(u, rs(100), utr);
    await expect(submitUtr(u, rs(100), utr)).rejects.toMatchObject({ code: 'DUPLICATE_TRANSACTION', message: DUPLICATE_UTR_MSG });
  });

  it('admin can verify or reject a queued case; only once', async () => {
    const u = await mkUser(); const utr = `UTR${Date.now()}H`;
    const s = await submitUtr(u, rs(100), utr);
    await adminResolveUtr(s.submissionId, 'admin-1', 'VERIFY', 'checked statement');
    expect(await bal(u)).toBe(rs(100) - 200n);
    await expect(adminResolveUtr(s.submissionId, 'admin-1', 'VERIFY', 'again')).rejects.toMatchObject({ code: 'ALREADY_RESOLVED' });
    expect(await bal(u)).toBe(rs(100) - 200n);
  });
});

describe('API gateway tokens', () => {
  const reqWith = (token?: string) => ({ headers: { authorization: token ? `Bearer ${token}` : undefined }, ip: '1.1.1.1' }) as any;

  it('regenerating invalidates the previous token immediately; only one is ever active', async () => {
    const u = await mkUser();
    const t1 = await issueApiToken(u, ['read']);
    await requireApiToken(reqWith(t1.token));
    const t2 = await issueApiToken(u, ['read', 'payments']);
    await expect(requireApiToken(reqWith(t1.token))).rejects.toMatchObject({ code: 'INVALID_API_TOKEN' });
    const r = reqWith(t2.token); await requireApiToken(r);
    expect(r.apiAuth.userId).toBe(u);
    expect(await prisma.apiToken.count({ where: { userId: u, status: 'ACTIVE' } })).toBe(1);
  });

  it('plaintext is never stored; revoked, malformed and missing tokens fail identically', async () => {
    const u = await mkUser();
    const t = await issueApiToken(u, ['read']);
    const row = (await activeToken(u))!;
    expect(row.tokenHash).not.toContain(t.token);
    await prisma.apiToken.update({ where: { id: row.id }, data: { status: 'REVOKED' } });
    for (const bad of [t.token, 'nonsense', undefined]) await expect(requireApiToken(reqWith(bad))).rejects.toMatchObject({ code: 'INVALID_API_TOKEN', status: 401 });
  });

  it('suspended users cannot use their token', async () => {
    const u = await mkUser(); const t = await issueApiToken(u, ['read']);
    await prisma.user.update({ where: { id: u }, data: { status: 'SUSPENDED' } });
    await expect(requireApiToken(reqWith(t.token))).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
  });

  it('concurrent regenerations leave exactly one active token', async () => {
    const u = await mkUser();
    await Promise.allSettled(Array.from({ length: 8 }, () => issueApiToken(u, ['read'])));
    expect(await prisma.apiToken.count({ where: { userId: u, status: 'ACTIVE' } })).toBe(1);
  });
});
