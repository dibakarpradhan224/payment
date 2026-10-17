import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server.js';
import { prisma } from '../../src/lib/prisma.js';
import { bootstrapAdmin } from '../../src/services/adminAuth.js';
import { ingestBankCredit } from '../../src/services/utr.js';

const ORIGIN = 'http://localhost:3000';
let app: FastifyInstance;
const otps: string[] = [];

let ipN = 0;
class Client {
  jar: Record<string, string> = {};
  ip = `10.1.${(++ipN >> 8) & 255}.${ipN & 255}`; // each simulated device has its own IP, like real users
  async call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}, withOrigin = true) {
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as any, url, remoteAddress: this.ip, payload: body as any, headers: { ...(cookie ? { cookie } : {}), ...(withOrigin && cookie ? { origin: ORIGIN } : {}), ...headers } });
    for (const c of res.cookies) { if (c.value) this.jar[c.name] = c.value; else delete this.jar[c.name]; }
    return { status: res.statusCode, body: res.json() as any };
  }
}

async function signup(email: string, mobile: string, name?: string) {
  const c = new Client(); const n = otps.length;
  let r = await c.call('POST', '/web/v1/auth/register/start', { mobile, email, password: 'Passw0rd99', confirmPassword: 'Passw0rd99', ...(name ? { name } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const code = otps.slice(n).pop()!;
  r = await c.call('POST', '/web/v1/auth/register/verify', { email, otp: code });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  r = await c.call('POST', '/web/v1/auth/pin/set', { pin: '1234', confirmPin: '1234' });
  expect(r.status).toBe(200);
  const me = await c.call('GET', '/web/v1/auth/me');
  return { c, user: me.body.data.user };
}
const rnd = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation((m: unknown) => { const x = /OTP for .*: (\d{6})/.exec(String(m)); if (x) otps.push(x[1]!); });
  await bootstrapAdmin();
  app = await buildApp(); await app.ready();
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('end to end over HTTP', () => {
  let A: Awaited<ReturnType<typeof signup>>; let B: Awaited<ReturnType<typeof signup>>;
  let tokenP = ''; let tokenM = '';

  it('health is ok', async () => { const r = await new Client().call('GET', '/health'); expect(r.status).toBe(200); expect(r.body.data.checks.database).toBe('up'); });

  it('registration: wrong OTP then right OTP; password rules; duplicate email', async () => {
    const email = `a-${randomUUID().slice(0, 8)}@t.test`; const c = new Client();
    let r = await c.call('POST', '/web/v1/auth/register/start', { mobile: rnd(), email, password: 'short', confirmPassword: 'short' });
    expect(r.status).toBe(422);
    r = await c.call('POST', '/web/v1/auth/register/start', { mobile: rnd(), email, password: 'Passw0rd99', confirmPassword: 'Passw0rd99' });
    expect(r.status).toBe(200);
    r = await c.call('POST', '/web/v1/auth/register/verify', { email, otp: '000000' });
    expect(r.status).toBe(400); expect(r.body.error.message).toBe('Incorrect OTP. Enter OTP again.');
    r = await c.call('POST', '/web/v1/auth/register/verify', { email, otp: otps.at(-1)! });
    expect(r.status).toBe(201); expect(r.body.data.message).toBe('Account created successfully.');
    r = await new Client().call('POST', '/web/v1/auth/register/start', { mobile: rnd(), email, password: 'Passw0rd99', confirmPassword: 'Passw0rd99' });
    expect(r.status).toBe(409);
  });

  it('two full accounts, PIN set, wallet shows 0', async () => {
    A = await signup(`a-${randomUUID().slice(0, 8)}@t.test`, rnd()); B = await signup(`b-${randomUUID().slice(0, 8)}@t.test`, rnd());
    expect(A.user.pinSet).toBe(true);
    const w = await A.c.call('GET', '/web/v1/wallet'); expect(w.body.data.available.rupees).toBe('0.00');
  });

  it('login: wrong password gives the same message as unknown email; lockout after 5', async () => {
    const c = new Client();
    const bad = await c.call('POST', '/web/v1/auth/login', { email: A.user.email, password: 'wrong-pass-1' });
    const unk = await c.call('POST', '/web/v1/auth/login', { email: 'nobody@t.test', password: 'wrong-pass-1' });
    expect(bad.status).toBe(401); expect(bad.body.error.message).toBe(unk.body.error.message);
    const ok = await c.call('POST', '/web/v1/auth/login', { email: A.user.email, password: 'Passw0rd99' });
    expect(ok.status).toBe(200); expect(c.jar.sid).toBeTruthy();
  });

  it('cookie requests without an allowed Origin are refused (CSRF)', async () => {
    const r = await A.c.call('POST', '/web/v1/auth/pin/change', { oldPin: '1234', pin: '4321', confirmPin: '4321' }, {}, false);
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('BAD_ORIGIN');
  });

  it('UTR deposit: under verification, then bank feed credits ₹98 for ₹100 (2% tax)', async () => {
    const utr = `4${Date.now()}`.slice(0, 12);
    let r = await A.c.call('POST', '/web/v1/deposits/utr', { amount: '100', utr });
    expect(r.status).toBe(202); expect(r.body.data.message).toBe('Payment is under verification. Your balance will be updated after successful verification.');
    await ingestBankCredit({ utr, amount: 10_000n, payeeUpi: 'merchant@upi', source: 'test' });
    const w = await A.c.call('GET', '/web/v1/wallet'); expect(w.body.data.available.rupees).toBe('98.00');
    r = await B.c.call('POST', '/web/v1/deposits/utr', { amount: '100', utr });
    expect(r.status).toBe(409); expect(r.body.error.message).toBe('This transaction has already been added to your account and cannot be added twice.');
    r = await A.c.call('GET', `/web/v1/deposits/quote?amount=30`); expect(r.body.data.net.rupees).toBe('29.40');
  });

  it('fund A with ₹2,000 more for later tests', async () => {
    const utr = `5${Date.now()}`.slice(0, 12);
    await ingestBankCredit({ utr, amount: 200_000n, source: 'test' });
    const r = await A.c.call('POST', '/web/v1/deposits/utr', { amount: '2000', utr }); expect(r.body.data.status).toBe('VERIFIED');
  });

  it('PIN required for transfers; wrong PIN rejected; success with Idempotency-Key; replay does not double-send', async () => {
    const key = randomUUID();
    let r = await A.c.call('POST', '/web/v1/transfers', { to: B.user.paymentId, amount: '10', pin: '9999' }, { 'idempotency-key': key });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('INVALID_PIN');
    r = await A.c.call('POST', '/web/v1/transfers', { to: B.user.paymentId, amount: '10', pin: '1234' }, {});
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const k2 = randomUUID();
    for (let i = 0; i < 3; i++) { r = await A.c.call('POST', '/web/v1/transfers', { to: B.user.paymentId, amount: '10', pin: '1234' }, { 'idempotency-key': k2 }); expect(r.status).toBe(200); }
    const wb = await B.c.call('GET', '/web/v1/wallet'); expect(wb.body.data.available.rupees).toBe('10.00');
  });

  it('PIN lockout after 5 wrong attempts, verify-pin endpoint (lock screen)', async () => {
    const fresh = await signup(`l-${randomUUID().slice(0, 8)}@t.test`, rnd());
    let r = await fresh.c.call('POST', '/web/v1/security/verify-pin', { pin: '1234' }); expect(r.body.data.valid).toBe(true);
    for (let i = 0; i < 5; i++) r = await fresh.c.call('POST', '/web/v1/security/verify-pin', { pin: '0000' });
    expect(r.body.error.code).toBe('PIN_LOCKED');
    r = await fresh.c.call('POST', '/web/v1/security/verify-pin', { pin: '1234' }); expect(r.body.error.code).toBe('PIN_LOCKED');
  });

  it('two API tokens (payout + merchant): PIN to create/view, fixed least-privilege scopes, reset kills only that token', async () => {
    let r = await A.c.call('POST', '/web/v1/api-token', { pin: '1234', kind: 'payout' });
    expect(r.status, JSON.stringify(r.body)).toBe(201); tokenP = r.body.data.token; expect([...r.body.data.meta.scopes].sort()).toEqual(['read', 'transfer', 'withdraw']);
    r = await A.c.call('POST', '/web/v1/api-token', { pin: '1234', kind: 'merchant' });
    expect(r.status).toBe(201); tokenM = r.body.data.token; expect([...r.body.data.meta.scopes].sort()).toEqual(['payments', 'read']);
    expect(tokenP).toMatch(/^pg_live_/); expect(tokenP).not.toBe(tokenM);
    r = await A.c.call('POST', '/web/v1/api-token', { pin: '1234', kind: 'payout' }); expect(r.body.error.code).toBe('TOKEN_EXISTS');
    r = await A.c.call('POST', '/web/v1/api-token/reveal', { pin: '0000', kind: 'payout' }); expect(r.body.error.code).toBe('INVALID_PIN');
    r = await A.c.call('POST', '/web/v1/api-token/reveal', { pin: '1234', kind: 'merchant' }); expect(r.body.data.token).toBe(tokenM);
    r = await A.c.call('GET', '/web/v1/api-token'); expect(r.body.data.tokens.payout.kind).toBe('PAYOUT'); expect(r.body.data.tokens.merchant.kind).toBe('MERCHANT'); expect(r.body.data.tokens.legacy).toBeNull();
    r = await A.c.call('POST', '/web/v1/api-token/regenerate', { pin: '1234', kind: 'payout' }); const newP = r.body.data.token; expect(newP).not.toBe(tokenP);
    let g = await new Client().call('GET', '/api/v1/balance', undefined, { authorization: `Bearer ${tokenP}` }); expect(g.status).toBe(401);
    tokenP = newP;
    g = await new Client().call('GET', '/api/v1/balance', undefined, { authorization: `Bearer ${tokenP}` }); expect(g.status).toBe(200); expect(g.body.data.available.rupees).toBe('2058.00');
    g = await new Client().call('GET', '/api/v1/balance', undefined, { authorization: `Bearer ${tokenM}` }); expect(g.status).toBe(200); // the merchant token was not affected
    expect(await prisma.apiToken.count({ where: { userId: A.user.id, status: 'ACTIVE' } })).toBe(2);
    const row = await prisma.apiToken.findFirstOrThrow({ where: { status: 'ACTIVE', userId: A.user.id, kind: 'PAYOUT' } });
    expect(row.tokenHash).not.toContain(tokenP); expect(row.tokenEnc).not.toContain(tokenP);
    // least privilege
    g = await new Client().call('GET', `/api/transfer?token=${tokenM}&number=name@bank&amount=10`); expect(g.body.error.code).toBe('INSUFFICIENT_SCOPE');
    g = await new Client().call('GET', `/api/payment?token=${tokenP}&amount=10`); expect(g.body.error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('header API scopes are enforced', async () => {
    const r = await new Client().call('POST', '/api/v1/transfer', { to: B.user.paymentId, amount: '1', pin: '1234' }, { authorization: `Bearer ${tokenM}`, 'idempotency-key': randomUUID() });
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('INSUFFICIENT_SCOPE');
  });

  it('Merchant URL API: create payment (idempotent by order_id), B pays with PIN, status turns paid', async () => {
    const order = `order-${randomUUID().slice(0, 8)}`; const g = new Client();
    let r = await g.call('GET', `/api/v1/url/pay?token=${tokenM}&amount=5&order_id=${order}&comment=Test`);
    expect(r.status).toBe(201); const id = r.body.data.payment_id; expect(id).toMatch(/^REQ-/);
    const again = await g.call('GET', `/api/v1/url/pay?token=${tokenM}&amount=5&order_id=${order}`); expect(again.body.data.payment_id).toBe(id);
    let s = await g.call('GET', `/api/v1/url/status?token=${tokenM}&payment_id=${id}`); expect(s.body.data.status).toBe('pending');
    const q = await B.c.call('POST', '/web/v1/qr/resolve', { payload: `payment://receive?request=${id}` }); expect(q.body.data.type).toBe('REQUEST');
    const pk = randomUUID();
    r = await B.c.call('POST', '/web/v1/pay/request', { requestId: id, pin: '1234' }, { 'idempotency-key': pk }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await B.c.call('POST', '/web/v1/pay/request', { requestId: id, pin: '1234' }, { 'idempotency-key': randomUUID() }); expect(r.body.error.code).toBe('ALREADY_PAID');
    s = await g.call('GET', `/api/v1/url/status?token=${tokenM}&payment_id=${id}`); expect(s.body.data.status).toBe('paid');
    const bad = await g.call('GET', `/api/v1/url/status?token=pg_live_${'x'.repeat(43)}&payment_id=${id}`); expect(bad.status).toBe(401);
  });

  it('Payout URL API: needs a unique ref, no provider configured -> refunded safely, repeat ref returns same result, cap enforced, bad UPI rejected', async () => {
    const g = new Client(); const before = (await A.c.call('GET', '/web/v1/wallet')).body.data.available.rupees;
    let r = await g.call('GET', `/api/v1/url/payout?token=${tokenP}&amount=100`); expect(r.status).toBe(422); // no destination
    r = await g.call('GET', `/api/v1/url/payout?token=${tokenP}&upi=notupi&amount=100&ref=REF-AAAA1111`); expect(r.status).toBe(422); // not a UPI id -> treated as a wallet number, which does not exist
    const ref = `REF-${randomUUID().slice(0, 8)}`;
    r = await g.call('GET', `/api/v1/url/payout?token=${tokenP}&upi=name@bank&amount=100&ref=${ref}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.data.status).toBe('failed'); expect(r.body.data.message).toBe('Withdrawal failed. Your funds have been refunded.');
    const r2 = await g.call('GET', `/api/v1/url/payout?token=${tokenP}&upi=name@bank&amount=100&ref=${ref}`); expect(r2.body.data.withdrawal.id).toBe(r.body.data.withdrawal.id);
    const mis = await g.call('GET', `/api/v1/url/payout?token=${tokenP}&upi=name@bank&amount=200&ref=${ref}`); expect(mis.body.error.code).toBe('REF_REUSED');
    expect((await A.c.call('GET', '/web/v1/wallet')).body.data.available.rupees).toBe(before); // refunded exactly once
    const big = await g.call('GET', `/api/v1/url/payout?token=${tokenP}&upi=name@bank&amount=20000&ref=REF-BIG${Date.now()}`); expect(big.body.error.code).toBe('DAILY_LIMIT_EXCEEDED');
    const st = await g.call('GET', `/api/v1/url/payout-status?token=${tokenP}&ref=${ref}`); expect(st.body.data.status).toBe('failed');
  });

  it('header Payout API: PIN + Idempotency-Key required; insufficient balance message', async () => {
    const g = new Client(); const h = (k = randomUUID()) => ({ authorization: `Bearer ${tokenP}`, 'idempotency-key': k });
    let r = await g.call('POST', '/api/v1/withdraw', { amount: '100', upiId: 'name@bank', pin: '0000' }, h()); expect(r.body.error.code).toBe('INVALID_PIN');
    r = await g.call('POST', '/api/v1/withdraw', { amount: '49999', upiId: 'name@bank', pin: '1234' }, h()); expect(r.body.error.message).toMatch(/Insufficient balance|between/);
  });

  it('simple /api/transfer URL (like the reference): wallet number, Payment ID, UPI, aliases, no ref needed', async () => {
    const g = new Client();
    let r: any; const t = tokenP;
    const bal = async (c: Client) => (await c.call('GET', '/web/v1/wallet')).body.data.available.rupees;
    const b0 = Number(await bal(B.c));

    // wallet number (registered mobile), no ref
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=3&comment=Hello`);
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.data.type).toBe('wallet'); expect(r.body.data.status).toBe('success');
    expect(Number(await bal(B.c))).toBeCloseTo(b0 + 3);
    // the identical request again pays again: without a ref every request is a new payment
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=3&comment=Hello`);
    expect(r.body.data.status).toBe('success'); expect(r.body.data).not.toHaveProperty('repeated'); expect(Number(await bal(B.c))).toBeCloseTo(b0 + 6);
    // Payment ID and the {wallet} alias work
    r = await g.call('GET', `/api/transfer?token=${t}&wallet=${B.user.paymentId}&amount=4&comment=Hello`); expect(r.body.data.status).toBe('success');
    expect(Number(await bal(B.c))).toBeCloseTo(b0 + 10);
    // explicit ref: exact idempotency, and reuse with different details is refused
    const ref = `REF-${randomUUID().slice(0, 8)}`;
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=1&ref=${ref}`); expect(r.body.data.status).toBe('success');
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=1&ref=${ref}`); expect(r.body.data.status).toBe('success'); // same ref: not paid twice
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=2&ref=${ref}`); expect(r.body.error.code).toBe('REF_REUSED');
    r = await g.call('GET', `/api/transfer-status?token=${t}&ref=${ref}`); expect(r.body.data.status).toBe('success');
    expect(Number(await bal(B.c))).toBeCloseTo(b0 + 11);
    // unknown wallet / self / bad amount: nothing is debited
    const a0 = await bal(A.c);
    r = await g.call('GET', `/api/transfer?token=${t}&number=9000000000&amount=5`); expect(r.status).toBe(404); expect(r.body.error.code).toBe('USER_NOT_FOUND');
    r = await g.call('GET', `/api/transfer?token=${t}&number=${A.user.mobile}&amount=5`); expect(r.body.error.code).toBe('SELF_TRANSFER');
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=0.1`); expect(r.status).toBe(422);
    r = await g.call('GET', `/api/transfer?token=${t}&number=${B.user.mobile}&amount=%7Bamount%7D`); expect(r.status).toBe(422); // unreplaced placeholder
    expect(await bal(A.c)).toBe(a0);
    // UPI id through the same URL: no payout provider here, so each request is refunded; every request is its own payout
    r = await g.call('GET', `/api/transfer?token=${t}&number=name@bank&amount=20&comment=Payout`);
    expect(r.body.data.type).toBe('upi'); expect(r.body.data.status).toBe('failed');
    r = await g.call('GET', `/api/transfer?token=${t}&number=name@bank&amount=20&comment=Payout`); expect(r.body.data.status).toBe('failed');
    expect(await bal(A.c)).toBe(a0);
    expect(await prisma.withdrawal.count({ where: { userId: A.user.id, destination: 'name@bank', amount: 2000n, idempotencyKey: { startsWith: 'url:auto-' } } })).toBe(2);
    // scope: a token without "transfer" cannot send to a wallet, but can pay a UPI id
    r = await g.call('GET', `/api/transfer?token=${tokenM}&number=${B.user.mobile}&amount=1`); expect(r.body.error.code).toBe('INSUFFICIENT_SCOPE');
    // merchant short URLs
    const t3 = tokenM;
    r = await g.call('GET', `/api/payment?token=${t3}&amount=7&order_id=short-${randomUUID().slice(0, 6)}`); expect(r.status).toBe(201);
    const pid = r.body.data.payment_id;
    r = await g.call('GET', `/api/payment-status?token=${t3}&payment_id=${pid}`); expect(r.body.data.status).toBe('pending');
    r = await g.call('GET', `/api/balance?token=${t3}`); expect(r.status).toBe(200);
  });

  it('names instead of emails: default name, name chosen at signup, change it in settings, find-user shows the name', async () => {
    let r = await A.c.call('POST', '/web/v1/transfers/resolve', { to: B.user.paymentId });
    expect(r.body.data.recipient.displayName).toBe('Cafin Pay user'); // B never set a name
    expect(JSON.stringify(r.body)).not.toContain(B.user.email); expect(JSON.stringify(r.body)).not.toContain('@');
    r = await B.c.call('PATCH', '/web/v1/profile', { name: 'bob@gmail.com' }); expect(r.status).toBe(422); // an email can never be a display name
    r = await B.c.call('PATCH', '/web/v1/profile', { name: 'A' }); expect(r.status).toBe(422);
    r = await B.c.call('PATCH', '/web/v1/profile', { name: '<script>alert(1)</script>' }); expect(r.status).toBe(422);
    r = await B.c.call('PATCH', '/web/v1/profile', { name: "Rahul O'Neil-Kumar" }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await A.c.call('POST', '/web/v1/transfers/resolve', { to: B.user.mobile }); expect(r.body.data.recipient.displayName).toBe("Rahul O'Neil-Kumar");
    r = await A.c.call('POST', '/web/v1/transfers/resolve', { to: B.user.email }); expect(r.body.data.recipient.displayName).toBe("Rahul O'Neil-Kumar");
    r = await A.c.call('POST', '/web/v1/qr/resolve', { payload: `payment://pay?to=${B.user.paymentId}` }); expect(r.body.data.recipient.displayName).toBe("Rahul O'Neil-Kumar");
    const N = await signup(`n-${randomUUID().slice(0, 8)}@t.test`, rnd(), 'Priya Sharma');
    expect(N.user.name).toBe('Priya Sharma');
    r = await A.c.call('POST', '/web/v1/transfers/resolve', { to: N.user.paymentId }); expect(r.body.data.recipient.displayName).toBe('Priya Sharma');
    const bad = new Client(); r = await bad.call('POST', '/web/v1/auth/register/start', { name: 'x@y.com', mobile: rnd(), email: `z-${randomUUID().slice(0, 6)}@t.test`, password: 'Passw0rd99', confirmPassword: 'Passw0rd99' }); expect(r.status).toBe(422);
    // a payment request shows the merchant's name, not their email
    const pr = await B.c.call('POST', '/web/v1/receive/requests', { amount: '1' }); expect(pr.status, JSON.stringify(pr.body)).toBe(201);
    r = await A.c.call('POST', '/web/v1/qr/resolve', { payload: pr.body.data.request.qrPayload });
    expect(r.body.data.request.recipient.displayName).toBe("Rahul O'Neil-Kumar"); expect(JSON.stringify(r.body)).not.toContain(B.user.email);
  });

  it('receipt, history filters, notifications work', async () => {
    const t = await B.c.call('GET', '/web/v1/transactions?filter=payments&limit=5'); expect(t.body.data.transactions.length).toBeGreaterThan(0);
    const id = t.body.data.transactions[0].id;
    const rc = await B.c.call('GET', `/web/v1/transactions/${id}/receipt`); expect(rc.body.data.receipt.sender.paymentId).toBe(B.user.paymentId);
    const other = await A.c.call('GET', `/web/v1/transactions/${id}/receipt`); expect(other.status).toBe(404); // not A's transaction (IDOR)
    const n = await B.c.call('GET', '/web/v1/notifications'); expect(n.body.data.notifications.length).toBeGreaterThan(0);
  });

  it('forgot PIN: OTP then reset; old PIN stops working', async () => {
    const n = otps.length;
    let r = await A.c.call('POST', '/web/v1/auth/pin/forgot', {}); expect(r.status).toBe(200);
    r = await A.c.call('POST', '/web/v1/auth/pin/verify-otp', { otp: otps.slice(n).pop() }); expect(r.status).toBe(200);
    r = await A.c.call('POST', '/web/v1/auth/pin/reset', { resetToken: r.body.data.resetToken, pin: '5678', confirmPin: '5678' }); expect(r.status).toBe(200);
    r = await A.c.call('POST', '/web/v1/security/verify-pin', { pin: '1234' }); expect(r.body.error.code).toBe('INVALID_PIN');
    r = await A.c.call('POST', '/web/v1/security/verify-pin', { pin: '5678' }); expect(r.body.data.valid).toBe(true);
  });

  it('admin: login with .env credentials, dashboard, users, RBAC', async () => {
    const ad = new Client();
    let r = await ad.call('POST', '/admin/v1/auth/login', { email: process.env.ADMIN_EMAIL, password: 'wrong-wrong-wrong' }); expect(r.status).toBe(401);
    r = await ad.call('POST', '/admin/v1/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_SECRET }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await ad.call('GET', '/admin/v1/dashboard'); expect(r.status).toBe(200); expect(r.body.data.totals.users).toBeGreaterThan(2);
    r = await ad.call('GET', `/admin/v1/users?q=${A.user.paymentId}`); expect(r.body.data.users.length).toBe(1);
    r = await ad.call('GET', `/admin/v1/transactions?q=${B.user.paymentId}`); expect(r.body.data.transactions.length).toBeGreaterThan(0);
    r = await ad.call('GET', '/admin/v1/settings'); expect(r.status).toBe(200);
    r = await ad.call('GET', '/admin/v1/analytics?days=7'); expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await A.c.call('GET', '/admin/v1/dashboard'); expect(r.status).toBe(401); // a normal user session is not admin
  });

  it('suspended users are cut off everywhere', async () => {
    const S = await signup(`s-${randomUUID().slice(0, 8)}@t.test`, rnd());
    await prisma.user.update({ where: { id: S.user.id }, data: { status: 'SUSPENDED' } });
    const r = await S.c.call('GET', '/web/v1/wallet'); expect(r.status).toBe(403);
  });
});
