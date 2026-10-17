import { z } from 'zod';

/** 1 INR = 100 paise. Money is always bigint paise internally, never floats. */
export const MAX_AMOUNT_PAISE = 10_000_000n * 100n; // sanity ceiling: ₹1 crore per operation

export function parseRupees(input: string | number): bigint {
  const s = typeof input === 'number' ? String(input) : input.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new Error('Enter a valid amount with up to 2 decimals.');
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
}

export function formatPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

export const money = (p: bigint) => ({ paise: p.toString(), rupees: formatPaise(p) });

/** Zod schema: accepts "30", "30.5", 30.50 and yields bigint paise. */
export const amountSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const p = parseRupees(v);
      if (p <= 0n) throw new Error('Amount must be greater than zero.');
      if (p > MAX_AMOUNT_PAISE) throw new Error('Amount is too large.');
      return p;
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
      return z.NEVER;
    }
  });
