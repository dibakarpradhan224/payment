import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { ok } from '../lib/errors.js';
import { money } from '../lib/money.js';
import { requireAuth } from '../middleware/auth.js';
import * as v from '../validators/phase3.js';
import { quoteDeposit } from '../services/deposits.js';
import { cancelUpiOrder, createUpiOrder, getUpiOrder } from '../services/upiOrders.js';
import { submitUtr } from '../services/utr.js';
import { getDepositLimits, upiConfig } from '../services/settings.js';

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export async function depositRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/deposits/config', async () => {
    const lim = await getDepositLimits();
    const upi = upiConfig();
    return ok({ limits: { min: money(lim.min), max: money(lim.max) }, upi: upi ? { enabled: true, name: upi.name, instructions: upi.instructions ?? null } : { enabled: false } });
  });

  app.get('/deposits/quote', async (req) => ok(await quoteDeposit(v.quoteQuery.parse(req.query).amount)));

  // Amount typed -> the page calls this after a short pause and gets the "Pay With UPI" link.
  app.post('/deposits/upi/order', limit(20), async (req) => ok(await createUpiOrder(req.auth!.userId, v.upiOrderCreate.parse(req.body).amount)));
  app.get<{ Params: { id: string } }>('/deposits/upi/order/:id', limit(60), async (req) => ok(await getUpiOrder(req.auth!.userId, req.params.id)));
  app.post<{ Params: { id: string } }>('/deposits/upi/order/:id/cancel', limit(20), async (req) => ok(await cancelUpiOrder(req.auth!.userId, req.params.id)));

  // Fallback when automatic detection did not catch a payment: the user enters the bank transaction ID.
  app.post('/deposits/utr', limit(5), async (req, reply) => {
    const b = v.utrSubmit.parse(req.body);
    const r = await submitUtr(req.auth!.userId, b.amount, b.utr);
    if (r.status === 'MANUAL_REVIEW') reply.code(202);
    return ok(r);
  });

  app.get('/deposits/history', async (req) => {
    const userId = req.auth!.userId;
    const [orders, utr] = await Promise.all([
      prisma.upiOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.utrSubmission.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const now = Date.now();
    return ok({
      upi: orders.map((o) => ({ id: o.orderRef, amount: money(o.amount), status: o.status === 'CREATED' && o.expiresAt.getTime() <= now ? 'EXPIRED' : o.status, txnId: o.txnId, createdAt: o.createdAt })),
      utr: utr.map((s) => ({ id: s.id, utr: s.utr, amount: money(s.amount), status: s.status, txnId: s.txnId, createdAt: s.createdAt })),
    });
  });
}
