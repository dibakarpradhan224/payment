import { describe, expect, it } from 'vitest';
import { calculateTax, DEFAULT_SLABS } from '../../src/services/tax.js';
import { amountSchema, formatPaise, parseRupees } from '../../src/lib/money.js';
import { fingerprintOf } from '../../src/lib/fingerprint.js';

describe('tax engine', () => {
  it('spec example: ₹30 -> tax ₹0.60, credit ₹29.40', () => {
    const t = calculateTax(3000n);
    expect(formatPaise(t.tax)).toBe('0.60');
    expect(formatPaise(t.net)).toBe('29.40');
    expect(t.rateBps).toBe(200);
  });
  it('slab boundaries', () => {
    expect(calculateTax(100_000n).rateBps).toBe(200); // ₹1,000 -> 2%
    expect(calculateTax(100_001n).rateBps).toBe(150); // just above -> 1.5%
    expect(calculateTax(1_000_000n).rateBps).toBe(150); // ₹10,000 -> 1.5%
    expect(calculateTax(1_000_001n).rateBps).toBe(100); // above -> 1%
  });
  it('known values', () => {
    expect(formatPaise(calculateTax(500_000n).tax)).toBe('75.00'); // ₹5,000 @1.5%
    expect(formatPaise(calculateTax(2_500_000n).tax)).toBe('250.00'); // ₹25,000 @1%
    expect(formatPaise(calculateTax(100n).tax)).toBe('0.02'); // ₹1 @2%
  });
  it('rounds half up and never loses a paisa', () => {
    for (const g of [101n, 333n, 12_345n, 99_999n, 100_001n, 777_777n, 1_234_567n]) {
      const t = calculateTax(g);
      expect(t.tax + t.net).toBe(g);
      expect(t.tax).toBeGreaterThanOrEqual(0n);
    }
    expect(calculateTax(125n).tax).toBe(3n); // 2.5 paise -> 3
  });
  it('rejects below ₹1', () => {
    expect(() => calculateTax(99n)).toThrow();
    expect(() => calculateTax(0n)).toThrow();
  });
  it('uses supplied slabs (admin-changed rates) without touching defaults', () => {
    const t = calculateTax(10_000n, [{ upToPaise: null, rateBps: 500 }]);
    expect(t.tax).toBe(500n);
    expect(DEFAULT_SLABS[0]!.rateBps).toBe(200);
  });
});

describe('money parsing', () => {
  it('parses exactly, no float drift', () => {
    expect(parseRupees('30')).toBe(3000n);
    expect(parseRupees('0.1')).toBe(10n);
    expect(parseRupees('19.99')).toBe(1999n);
    expect(parseRupees(500)).toBe(50_000n);
  });
  it('rejects malformed amounts', () => {
    for (const bad of ['-5', '1e3', '1.234', 'abc', '', '1,000', '0.1.2', 1e21, 0.1 + 0.2]) {
      expect(() => parseRupees(bad as any)).toThrow();
    }
  });
  it('amountSchema enforces positive and ceiling', () => {
    expect(amountSchema.parse('30')).toBe(3000n);
    expect(() => amountSchema.parse('0')).toThrow();
    expect(() => amountSchema.parse('999999999')).toThrow();
  });
  it('formats paise', () => {
    expect(formatPaise(2940n)).toBe('29.40');
    expect(formatPaise(5n)).toBe('0.05');
  });
});

describe('idempotency fingerprint', () => {
  it('ignores key order, detects changes', () => {
    expect(fingerprintOf({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprintOf({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprintOf({ amount: '100' })).not.toBe(fingerprintOf({ amount: '101' }));
  });
});
