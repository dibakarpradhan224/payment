/**
 * Public API gateway. Auth: `Authorization: Bearer pg_live_...` (no cookies).
 * Every request is authenticated, scope-checked, rate limited per token, and logged (metadata only, never bodies or secrets).
 * Money-moving calls need the account's PIN in the body; the Idempotency-Key header is optional (without it every request sends money).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { attachApiLogging } from './apiLogging.js';
import { AppError, ok } from '../lib/errors.js';
import { json } from '../lib/json.js';
import { fingerprintOf } from '../lib/fingerprint.js';
import { requireApiToken, requireScope } from '../middleware/apiToken.js';
import { findOwnTransaction, listQuery, listTransactions, txDto, walletSummary } from '../services/transactions.js';
import { getIdempotencyKey, getOptionalIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { verifyPin } from '../services/pin.js';
import { createPaymentRequest, requestDto } from '../services/paymentRequests.js';
import { sendMoney } from '../services/transfers.js';
import { requestWithdrawal, submitPayout, withdrawalDto, withdrawalMessage } from '../services/withdrawals.js';
import { merchantPayment, transferBody, withdrawBody } from '../validators/money.js';

export async function gatewayRoutes(app: FastifyInstance) {
  attachApiLogging(app);
  app.addHook('preHandler', requireApiToken);

  const uid = (r: FastifyRequest) => r.apiAuth!.userId;

  // ----- read -----
  app.get('/user', { preHandler: requireScope('read') }, async (req) => {
    const u = req.apiAuth!.user;
    return ok({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, paymentId: u.paymentId, createdAt: u.createdAt });
  });
  app.get('/balance', { preHandler: requireScope('read') }, async (req) => {
    const s = await walletSummary(uid(req));
    return ok({ available: s.available, locked: s.locked, frozen: s.frozen, currency: 'INR' });
  });
  app.get('/transactions', { preHandler: requireScope('read') }, async (req) => ok(await listTransactions(uid(req), listQuery.parse(req.query))));
  app.get<{ Params: { id: string } }>('/transactions/:id', { preHandler: requireScope('read') }, async (req) => {
    const t = await findOwnTransaction(uid(req), req.params.id);
    if (!t) throw new AppError('NOT_FOUND', 'Transaction not found.', 404);
    return ok({ transaction: txDto(t) });
  });
  app.get('/withdrawals', { preHandler: requireScope('read') }, async (req) =>
    ok({ withdrawals: (await prisma.withdrawal.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 50 })).map(withdrawalDto) }));

  // ----- payments / receive (merchant integration) -----
  const createPayment = async (req: FastifyRequest) => {
    const b = merchantPayment.parse(req.body);
    const r = await createPaymentRequest(uid(req), { ...b, source: 'MERCHANT_API' });
    return { payment_id: r.id, amount: r.amount.rupees, currency: 'INR', status: r.status.toLowerCase(), order_id: r.orderId, payment_url: r.paymentUrl, qr_payload: r.qrPayload, expires_at: r.expiresAt, created_at: r.createdAt };
  };
  const getPayment = async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const r = await prisma.paymentRequest.findFirst({ where: { requestId: req.params.id, userId: uid(req) } });
    if (!r) throw new AppError('NOT_FOUND', 'Payment not found.', 404);
    const d = requestDto(r);
    return { payment_id: d.id, amount: d.amount.rupees, currency: 'INR', status: d.status.toLowerCase(), order_id: d.orderId, payment_url: d.paymentUrl, paid_at: d.paidAt, transaction_id: r.paidTxnId, expires_at: d.expiresAt };
  };
  for (const base of ['/payment', '/merchant/payment']) {
    app.post(`${base}/create`, { preHandler: requireScope('payments') }, async (req, reply) => { reply.code(201); return ok(await createPayment(req)); });
  }
  app.get<{ Params: { id: string } }>('/payment/:id', { preHandler: requireScope('payments') }, async (req) => ok(await getPayment(req)));
  app.get<{ Params: { id: string } }>('/merchant/payment/:id', { preHandler: requireScope('payments') }, async (req) => ok(await getPayment(req)));
  app.post('/receive/request', { preHandler: requireScope('payments') }, async (req, reply) => { reply.code(201); return ok(await createPayment(req)); });
  app.get<{ Params: { id: string } }>('/receive/:id', { preHandler: requireScope('payments') }, async (req) => ok(await getPayment(req)));

  // ----- money movement -----
  app.post('/transfer', { preHandler: requireScope('transfer') }, async (req) => {
    const b = transferBody.parse(req.body);
    const key = getOptionalIdempotencyKey(req);
    const { result } = await withIdempotency(uid(req), 'api_transfer', key, fingerprintOf({ to: b.to, a: b.amount.toString(), d: b.description ?? null }), async () => {
      await verifyPin(uid(req), b.pin);
      return json(await sendMoney(uid(req), b.to, b.amount, key, b.description));
    });
    return ok(result);
  });

  app.post('/withdraw', { preHandler: requireScope('withdraw') }, async (req, reply) => {
    const b = withdrawBody.parse(req.body);
    const key = getOptionalIdempotencyKey(req);
    const { result } = await withIdempotency(uid(req), 'api_withdraw', key, fingerprintOf({ a: b.amount.toString(), u: b.upiId }), async () => {
      await verifyPin(uid(req), b.pin);
      const { withdrawal } = await requestWithdrawal(uid(req), b.amount, b.upiId, key);
      const final = withdrawal.status === 'PENDING' ? await submitPayout(withdrawal.withdrawalId) : withdrawal;
      return json({ withdrawal: withdrawalDto(final), message: withdrawalMessage(final.status) });
    });
    reply.code(202);
    return ok(result);
  });
}
