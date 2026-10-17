import { z } from 'zod';
import { amountSchema } from '../lib/money.js';
import { normalizeUtr } from '../lib/utr.js';
import { pin } from './auth.js';

export const upiOrderCreate = z.object({ amount: amountSchema });
export const utrSubmit = z.object({
  amount: amountSchema,
  transactionId: z.string().optional(),
  utr: z.string().optional(), // old field name, still accepted
}).transform((b, ctx) => {
  try { return { amount: b.amount, utr: normalizeUtr(b.transactionId ?? b.utr ?? '') }; }
  catch (e) { ctx.addIssue({ code: 'custom', message: (e as Error).message }); return z.NEVER; }
});
export const quoteQuery = z.object({ amount: amountSchema });

export const SCOPES = ['read', 'payments', 'transfer', 'withdraw'] as const;
export const tokenCreate = z.object({
  pin,
  name: z.string().trim().min(1).max(40).optional(),
  scopes: z.array(z.enum(SCOPES)).min(1).default(['read']),
});
export const bankCreditBody = z.object({
  utr: z.string().min(12).max(40),
  amount: amountSchema,
  payeeUpi: z.string().max(100).optional(),
  payerName: z.string().max(100).optional(),
  note: z.string().max(200).optional(),
  receivedAt: z.string().datetime().optional(),
});
