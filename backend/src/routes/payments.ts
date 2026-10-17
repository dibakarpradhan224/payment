import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { json } from '../lib/json.js';
import { buildUserQr } from '../lib/qr.js';
import { requireAuth, needsPin } from '../middleware/auth.js';
import { fingerprintOf } from '../lib/fingerprint.js';
import { getIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { verifyPin } from '../services/pin.js';
import { cancelRequest, createPaymentRequest, lookupRequest, payRequest, requestDto } from '../services/paymentRequests.js';
import { resolveQr, resolveRecipient, sendMoney } from '../services/transfers.js';
import { requestWithdrawal, submitPayout, withdrawalDto, withdrawalMessage } from '../services/withdrawals.js';
import * as v from '../validators/money.js';
import { audit } from '../services/audit.js';
import { getWithdrawRules } from '../services/settings.js';
import { money } from '../lib/money.js';

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export async function paymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ----- Receive -----
  app.get('/receive/me', async (req) => {
    const u = req.auth!.user;
    return ok({ paymentId: u.paymentId, name: u.name, qrPayload: buildUserQr(u.paymentId) });
  });

  app.post('/receive/requests', { ...limit(20), preHandler: needsPin }, async (req, reply) => {
    const b = v.requestCreate.parse(req.body);
    const r = await createPaymentRequest(req.auth!.userId, b);
    reply.code(201);
    return ok({ request: r });
  });
  app.get('/receive/requests', async (req) => {
    const rows = await prisma.paymentRequest.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return ok({ requests: rows.map(requestDto) });
  });
  app.get<{ Params: { id: string } }>('/receive/requests/:id', async (req) => {
    const r = await prisma.paymentRequest.findFirst({ where: { requestId: req.params.id, userId: req.auth!.userId } });
    if (!r) throw new AppError('NOT_FOUND', 'Request not found.', 404);
    return ok({ request: requestDto(r) });
  });
  app.post<{ Params: { id: string } }>('/receive/requests/:id/cancel', limit(20), async (req) => {
    await cancelRequest(req.auth!.userId, req.params.id);
    return ok({ message: 'Request cancelled.' });
  });

  // ----- QR / lookup (read-only, nothing here moves money) -----
  app.post('/qr/resolve', limit(30), async (req) => ok(await resolveQr(v.qrBody.parse(req.body).payload, req.auth!.userId)));
  app.post('/transfers/resolve', limit(30), async (req) => {
    const r = await resolveRecipient(v.resolveBody.parse(req.body).to, req.auth!.userId);
    return ok({ recipient: { paymentId: r.paymentId, name: r.name, displayName: r.displayName } });
  });
  app.get<{ Params: { requestId: string } }>('/pay/request/:requestId', limit(30), async (req) => ok({ request: await lookupRequest(req.params.requestId) }));

  // ----- Money movement: PIN + Idempotency-Key required -----
  app.post('/transfers', limit(10), async (req) => {
    const b = v.transferBody.parse(req.body);
    const key = getIdempotencyKey(req), uid = req.auth!.userId;
    const { result, replayed } = await withIdempotency(uid, 'transfer', key, fingerprintOf({ to: b.to, a: b.amount.toString(), d: b.description ?? null }), async () => {
      await verifyPin(uid, b.pin);
      return json(await sendMoney(uid, b.to, b.amount, key, b.description));
    });
    await audit({ actorId: uid, sessionId: req.auth!.sessionId, ip: req.ip, action: 'transfer.sent', result: 'SUCCESS', metadata: { replayed } });
    return ok(result);
  });

  app.post('/pay/request', limit(10), async (req) => {
    const b = v.payRequestBody.parse(req.body);
    const key = getIdempotencyKey(req), uid = req.auth!.userId;
    const { result } = await withIdempotency(uid, 'pay_request', key, fingerprintOf({ r: b.requestId }), async () => {
      await verifyPin(uid, b.pin);
      return json(await payRequest(uid, b.requestId, key));
    });
    await audit({ actorId: uid, sessionId: req.auth!.sessionId, ip: req.ip, action: 'payment_request.paid', result: 'SUCCESS', resourceType: 'PaymentRequest', resourceId: b.requestId });
    return ok(result);
  });

  // ----- Withdraw -----
  app.get('/withdrawals/rules', async () => {
    const r = await getWithdrawRules();
    return ok({ min: money(r.min), max: money(r.max), flatFee: money(r.flatFee), feeBps: r.feeBps });
  });

  app.post('/withdrawals', limit(5), async (req, reply) => {
    const b = v.withdrawBody.parse(req.body);
    const key = getIdempotencyKey(req), uid = req.auth!.userId;
    const { result } = await withIdempotency(uid, 'withdraw', key, fingerprintOf({ a: b.amount.toString(), u: b.upiId }), async () => {
      await verifyPin(uid, b.pin);
      const { withdrawal } = await requestWithdrawal(uid, b.amount, b.upiId, key);
      const final = withdrawal.status === 'PENDING' ? await submitPayout(withdrawal.withdrawalId) : withdrawal;
      return json({ withdrawal: withdrawalDto(final), message: withdrawalMessage(final.status) });
    });
    await audit({ actorId: uid, sessionId: req.auth!.sessionId, ip: req.ip, action: 'withdrawal.requested', result: 'SUCCESS' });
    reply.code(202);
    return ok(result);
  });
  app.get('/withdrawals', async (req) => {
    const rows = await prisma.withdrawal.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return ok({ withdrawals: rows.map(withdrawalDto) });
  });
  app.get<{ Params: { id: string } }>('/withdrawals/:id', async (req) => {
    const w = await prisma.withdrawal.findFirst({ where: { withdrawalId: req.params.id, userId: req.auth!.userId } });
    if (!w) throw new AppError('NOT_FOUND', 'Withdrawal not found.', 404);
    return ok({ withdrawal: withdrawalDto(w), message: withdrawalMessage(w.status) });
  });
}
