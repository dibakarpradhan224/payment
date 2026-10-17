import type { FastifyInstance } from 'fastify';
import { AppError, ok } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { findOwnTransaction, listQuery, listTransactions, txDto, walletSummary } from '../services/transactions.js';

export async function walletRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.get('/wallet', async (req) => ok(await walletSummary(req.auth!.userId)));
  app.get('/transactions', async (req) => ok(await listTransactions(req.auth!.userId, listQuery.parse(req.query))));
  app.get<{ Params: { txnId: string } }>('/transactions/:txnId', async (req) => {
    const t = await findOwnTransaction(req.auth!.userId, req.params.txnId);
    if (!t) throw new AppError('NOT_FOUND', 'Transaction not found.', 404); // 404, not 403: IDs can't be probed
    return ok({ transaction: txDto(t) });
  });
}
