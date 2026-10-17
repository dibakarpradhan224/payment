/** Needs a real throwaway Postgres (see wallet.test.ts). Payout provider is faked: no network, no money. */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma.js';
import { createPaymentRequest, expireDue, payRequest, cancelRequest } from '../../src/services/paymentRequests.js';
import { sendMoney } from '../../src/services/transfers.js';
import { checkProcessing, requestWithdrawal, submitPayout } from '../../src/services/withdrawals.js';
import { saveEndpoint, deliverDue } from '../../src/services/merchantWebhooks.js';
import type { PayoutConfig } from '../../src/providers/payout.js';

const rs = (n: number) => BigInt(n) * 100n;
const key = () => `k-${randomUUID()}`;
const bal = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).available;
async function mkUser(balance = 0) {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `${id}@t.test`, mobile: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`, passwordHash: 'x', paymentId: `PAY-${id.replace(/[^A-Z0-9]/gi, '').toUpperCase().replace(/[01OI]/g, '2').slice(0, 8).padEnd(8, '2')}`, wallet: { create: { available: rs(balance) } } } });
  return id;
}
afterAll(() => prisma.$disconnect());

// A fake provider on a public-looking https host is never called: createPayout() uses fetch, so we stub it per test.
const realFetch = globalThis.fetch;
const stubFetch = (fn: (url: string) => Response | Promise<Response>) => { globalThis.fetch = (async (u: any) => fn(String(u))) as any; };
const restore = () => { globalThis.fetch = realFetch; };
const CFG: PayoutConfig = {
  method: 'GET', url: 'https://1.1.1.1/pay?to={destination}&amt={amount}&ref={reference}', headers: {}, timeoutMs: 3000,
  success: { path: 'status', equals: ['success'] }, failure: { path: 'status', equals: ['failed'] }, referencePath: 'txn',
  status: { method: 'GET', url: 'https://1.1.1.1/status?ref={reference}', success: { path: 'status', equals: ['success'] }, failure: { path: 'status', equals: ['failed'] } },
  secrets: {},
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe('payment requests', () => {
  it('two payers race for one request: exactly one pays, the other balance is untouched', async () => {
    const m = await mkUser(), a = await mkUser(100), b = await mkUser(100);
    const r = await createPaymentRequest(m, { amount: rs(60) });
    const res = await Promise.allSettled([payRequest(a, r.id, key()), payRequest(b, r.id, key())]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((res.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('ALREADY_PAID');
    expect(await bal(m)).toBe(rs(60)); expect((await bal(a)) + (await bal(b))).toBe(rs(140));
  });
  it('same idempotency key replays; expired and cancelled requests cannot be paid; self-pay blocked', async () => {
    const m = await mkUser(), p = await mkUser(100); const r = await createPaymentRequest(m, { amount: rs(10) }); const k = key();
    await Promise.all([payRequest(p, r.id, k), payRequest(p, r.id, k), payRequest(p, r.id, k)].map((x) => x.catch(() => null)));
    expect(await bal(p)).toBe(rs(90));
    const e = await createPaymentRequest(m, { amount: rs(5) });
    await prisma.paymentRequest.update({ where: { requestId: e.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(payRequest(p, e.id, key())).rejects.toMatchObject({ code: 'REQUEST_EXPIRED' });
    expect(await expireDue()).toBeGreaterThanOrEqual(1);
    const c = await createPaymentRequest(m, { amount: rs(5) }); await cancelRequest(m, c.id);
    await expect(payRequest(p, c.id, key())).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    const s = await createPaymentRequest(m, { amount: rs(5) });
    await expect(payRequest(m, s.id, key())).rejects.toMatchObject({ code: 'SELF_PAY' });
  });
  it('insufficient balance leaves the request pending (claim rolled back)', async () => {
    const m = await mkUser(), p = await mkUser(1); const r = await createPaymentRequest(m, { amount: rs(50) });
    await expect(payRequest(p, r.id, key())).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { requestId: r.id } })).status).toBe('PENDING');
  });
  it('merchant order id is idempotent', async () => {
    const m = await mkUser(); const o = `ord-${randomUUID()}`;
    const [x, y] = await Promise.all([createPaymentRequest(m, { amount: rs(9), orderId: o, source: 'MERCHANT_API' }), createPaymentRequest(m, { amount: rs(9), orderId: o, source: 'MERCHANT_API' })]);
    expect(x.id).toBe(y.id);
    await expect(createPaymentRequest(m, { amount: rs(10), orderId: o })).rejects.toMatchObject({ code: 'DUPLICATE_ORDER' });
  });
});

describe('transfers by Payment ID / email / mobile', () => {
  it('resolves all three and refuses unknown recipients without debiting', async () => {
    const a = await mkUser(50), b = await mkUser(0); const u = await prisma.user.findUniqueOrThrow({ where: { id: b } });
    for (const to of [u.paymentId, u.email, u.mobile]) await sendMoney(a, to, rs(1), key());
    expect(await bal(b)).toBe(rs(3));
    await expect(sendMoney(a, 'PAY-ZZZZZZZZ', rs(1), key())).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(await bal(a)).toBe(rs(47));
  });
});

describe('Case 4 & 5: withdrawals and payout failures', () => {
  it('provider success -> SUCCESSFUL, funds stay debited', async () => {
    const u = await mkUser(100); stubFetch(() => json({ status: 'success', txn: 'P1' }));
    const { withdrawal } = await requestWithdrawal(u, rs(40), 'me@upi', key());
    expect(await bal(u)).toBe(rs(60));
    expect((await submitPayout(withdrawal.withdrawalId, CFG)).status).toBe('SUCCESSFUL'); restore();
    expect(await bal(u)).toBe(rs(60));
  });
  it('provider says failed -> refunded exactly once', async () => {
    const u = await mkUser(100); stubFetch(() => json({ status: 'failed' }));
    const { withdrawal } = await requestWithdrawal(u, rs(40), 'me@upi', key());
    const w = await submitPayout(withdrawal.withdrawalId, CFG); restore();
    expect(w.status).toBe('REFUNDED'); expect(await bal(u)).toBe(rs(100));
    expect(await prisma.transaction.count({ where: { userId: u, type: 'REFUND' } })).toBe(1);
  });
  it('Case 4: timeout after sending -> NOT refunded, NOT resent; status check settles it', async () => {
    const u = await mkUser(100); let sends = 0;
    stubFetch((url) => { if (url.includes('/pay?')) { sends++; throw new Error('timeout'); } return json({ status: 'success' }); });
    const { withdrawal } = await requestWithdrawal(u, rs(40), 'me@upi', key());
    const w1 = await submitPayout(withdrawal.withdrawalId, CFG);
    expect(w1.status).toBe('PROCESSING'); expect(await bal(u)).toBe(rs(60));
    await submitPayout(withdrawal.withdrawalId, CFG); await submitPayout(withdrawal.withdrawalId, CFG); // retries must not resend
    expect(sends).toBe(1);
    await prisma.withdrawal.update({ where: { id: w1.id }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
    await checkProcessing(CFG); restore();
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w1.id } })).status).toBe('SUCCESSFUL');
    expect(await bal(u)).toBe(rs(60));
  });
  it('timeout with no status API -> manual review, funds stay reserved (never guessed)', async () => {
    const u = await mkUser(100); stubFetch(() => { throw new Error('timeout'); });
    const { withdrawal } = await requestWithdrawal(u, rs(40), 'me@upi', key());
    const w = await submitPayout(withdrawal.withdrawalId, { ...CFG, status: undefined });
    await prisma.withdrawal.update({ where: { id: w.id }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
    await checkProcessing({ ...CFG, status: undefined }); restore();
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('MANUAL_REVIEW');
    expect(await bal(u)).toBe(rs(60));
  });
  it('two simultaneous withdrawals of the full balance: one succeeds', async () => {
    const u = await mkUser(100);
    const r = await Promise.allSettled([requestWithdrawal(u, rs(100), 'me@upi', key()), requestWithdrawal(u, rs(100), 'me@upi', key())]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('Insufficient balance.');
  });
  it('same idempotency key twice creates one withdrawal and one debit', async () => {
    const u = await mkUser(100); const k = key();
    await Promise.all([1, 2, 3].map(() => requestWithdrawal(u, rs(10), 'me@upi', k).catch(() => null)));
    expect(await prisma.withdrawal.count({ where: { userId: u } })).toBe(1); expect(await bal(u)).toBe(rs(90));
  });
});

describe('merchant webhooks (outbox)', () => {
  it('payment.success is queued in the same transaction, signed, and retried on failure', async () => {
    const m = await mkUser(), p = await mkUser(100);
    await prisma.webhookDelivery.updateMany({ where: { status: 'PENDING' }, data: { status: 'FAILED' } }); // ignore leftovers from earlier runs
    await saveEndpoint(m, 'https://1.1.1.1/hook', ['payment.success', 'payment.created']);
    const r = await createPaymentRequest(m, { amount: rs(5) }); await payRequest(p, r.id, key());
    const rows = await prisma.webhookDelivery.findMany({ where: { userId: m } });
    expect(rows.map((x) => x.event).sort()).toEqual(['payment.created', 'payment.success']);
    let calls = 0, sig = '';
    globalThis.fetch = (async (_u: any, init: any) => { calls++; sig = init.headers['X-Gateway-Signature']; return new Response('', { status: 500 }); }) as any;
    await deliverDue(); restore();
    expect(calls).toBe(2); expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const after = await prisma.webhookDelivery.findMany({ where: { userId: m } });
    expect(after.every((x) => x.status === 'PENDING' && x.attempts === 1 && x.nextAttemptAt > new Date())).toBe(true);
  });
});
