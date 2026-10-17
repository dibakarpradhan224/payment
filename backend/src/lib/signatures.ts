import { createHmac, timingSafeEqual } from 'node:crypto';

export const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

export function eqHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const A = Buffer.from(a, 'hex'), B = Buffer.from(b, 'hex');
  return A.length > 0 && A.length === B.length && timingSafeEqual(A, B);
}

/** Webhooks (bank feed): HMAC_SHA256(raw request body, webhook_secret) */
export const verifyBodySignature = (rawBody: string, sig: string, secret: string) => eqHex(hmacHex(secret, rawBody), sig);
