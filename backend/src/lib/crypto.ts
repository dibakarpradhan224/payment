import argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string) => argon2.hash(plain, ARGON_OPTS);
export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummy: string | undefined;
/** Burn equivalent CPU for unknown accounts so login timing doesn't reveal existence. */
export async function dummyVerify(plain: string) {
  dummy ??= await hashSecret('dummy-password-for-timing');
  await verifySecret(dummy, plain);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export const generateOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const hmacOtp = (email: string, purpose: string, code: string) =>
  createHmac('sha256', env.OTP_PEPPER).update(`${purpose}:${email}:${code}`).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// No 0/O/1/I to avoid look-alike confusion.
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function generatePaymentId(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
  return `PAY-${s}`;
}

export function generateOrderRef(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
  return `DEP-${s}`;
}

export function generateTxnId(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
  return `TXN-${s}`;
}

function idOf(prefix: string, n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += ID_ALPHABET[randomInt(0, ID_ALPHABET.length)];
  return `${prefix}-${s}`;
}
export const generateRequestId = () => idOf('REQ', 8);
export const generateWithdrawalId = () => idOf('WDR', 8);
export const generateLinkCode = () => idOf('LNK', 8).slice(4);
