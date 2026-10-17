import { AppError } from '../lib/errors.js';

export interface Slab {
  upToPaise: bigint | null; // inclusive upper bound; null = no upper bound
  rateBps: number; // basis points: 200 = 2%
}

// Slab boundaries are inclusive upper bounds, so amounts like ₹1,000.50 are covered
// (the spec table leaves gaps between ₹1,000 and ₹1,001).
export const DEFAULT_SLABS: Slab[] = [
  { upToPaise: 100_000n, rateBps: 200 }, //  ₹1 – ₹1,000      2%
  { upToPaise: 1_000_000n, rateBps: 150 }, // up to ₹10,000     1.5%
  { upToPaise: null, rateBps: 100 }, //      above ₹10,000    1%
];
export const MIN_DEPOSIT_PAISE = 100n; // ₹1

export function calculateTax(gross: bigint, slabs: Slab[] = DEFAULT_SLABS) {
  if (gross < MIN_DEPOSIT_PAISE) throw new AppError('INVALID_AMOUNT', 'Minimum amount is ₹1.', 422);
  const slab = slabs.find((s) => s.upToPaise === null || gross <= s.upToPaise);
  if (!slab) throw new AppError('TAX_CONFIG_ERROR', 'Tax configuration is invalid.', 500);
  // Round half up to the nearest paisa, in integer math.
  const tax = (gross * BigInt(slab.rateBps) + 5000n) / 10000n;
  return { tax, rateBps: slab.rateBps, net: gross - tax };
}
