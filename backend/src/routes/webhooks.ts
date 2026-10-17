import type { FastifyInstance } from 'fastify';
import { AppError, ok } from '../lib/errors.js';
import { env } from '../config/env.js';
import { verifyBodySignature } from '../lib/signatures.js';
import { ingestBankCredit } from '../services/utr.js';
import { bankCreditBody } from '../validators/phase3.js';
import { audit } from '../services/audit.js';

export async function webhookRoutes(app: FastifyInstance) {
  // Bank / aggregator credit notification (the source of truth for UTR verification).
  app.post('/bank', async (req) => {
    const secret = env.BANK_WEBHOOK_SECRET;
    const sig = req.headers['x-signature'];
    if (!secret) throw new AppError('METHOD_UNAVAILABLE', 'Bank feed not configured.', 503);
    if (typeof sig !== 'string' || !verifyBodySignature(req.rawBody ?? '', sig, secret)) {
      await audit({ actorType: 'SYSTEM', action: 'webhook.bank.bad_signature', result: 'FAILURE', ip: req.ip });
      throw new AppError('INVALID_SIGNATURE', 'Invalid signature.', 400);
    }
    const b = bankCreditBody.parse(req.body);
    return ok(await ingestBankCredit({
      utr: b.utr, amount: b.amount, payeeUpi: b.payeeUpi, payerName: b.payerName, note: b.note,
      receivedAt: b.receivedAt ? new Date(b.receivedAt) : undefined, source: 'bank-webhook',
    }));
  });
}
