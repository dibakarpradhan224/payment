import { z } from 'zod';
import { amountSchema } from '../lib/money.js';
import { pin, password, nameSchema } from './auth.js';
import { WEBHOOK_EVENTS } from '../services/merchantWebhooks.js';

export const requestCreate = z.object({
  amount: amountSchema,
  description: z.string().trim().max(120).optional(),
  payerInfo: z.string().trim().max(120).optional(),
  expiresInMinutes: z.number().int().min(5).max(10_080).optional(),
});
export const transferBody = z.object({ to: z.string().trim().min(3).max(100), amount: amountSchema, pin, description: z.string().trim().max(120).optional() });
export const resolveBody = z.object({ to: z.string().trim().min(3).max(100) });
export const qrBody = z.object({ payload: z.string().min(5).max(200) });
export const payRequestBody = z.object({ requestId: z.string().regex(/^REQ-[2-9A-HJ-NP-Z]{8}$/), pin });
export const withdrawBody = z.object({ amount: amountSchema, upiId: z.string().trim().min(5).max(100), pin });
export const webhookBody = z.object({ url: z.string().url().max(300), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), active: z.boolean().default(true) });
export const profileBody = z.object({ name: nameSchema.optional(), notifyEmail: z.boolean().optional(), notifyTelegram: z.boolean().optional() });
export const passwordChange = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
export const merchantPayment = z.object({
  amount: amountSchema,
  description: z.string().trim().max(120).optional(),
  orderId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
  expiresInMinutes: z.number().int().min(5).max(10_080).optional(),
  payerInfo: z.string().trim().max(120).optional(),
});
