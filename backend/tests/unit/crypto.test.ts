import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://x';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.SESSION_SECRET = 's'.repeat(40);
  process.env.OTP_PEPPER = 'p'.repeat(40);
});

describe('crypto', () => {
  it('OTP is always 6 digits', async () => {
    const { generateOtp } = await import('../../src/lib/crypto.js');
    for (let i = 0; i < 500; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('OTP hash is bound to email, purpose and code', async () => {
    const { hmacOtp, safeEqualHex } = await import('../../src/lib/crypto.js');
    const h = hmacOtp('a@b.co', 'REGISTER', '123456');
    expect(safeEqualHex(h, hmacOtp('a@b.co', 'REGISTER', '123456'))).toBe(true);
    expect(safeEqualHex(h, hmacOtp('a@b.co', 'REGISTER', '123457'))).toBe(false);
    expect(safeEqualHex(h, hmacOtp('c@d.co', 'REGISTER', '123456'))).toBe(false);
    expect(safeEqualHex(h, hmacOtp('a@b.co', 'PASSWORD_RESET', '123456'))).toBe(false);
  });
  it('hashes and verifies secrets, never storing plaintext', async () => {
    const { hashSecret, verifySecret } = await import('../../src/lib/crypto.js');
    const h = await hashSecret('1234');
    expect(h).not.toContain('1234');
    expect(await verifySecret(h, '1234')).toBe(true);
    expect(await verifySecret(h, '4321')).toBe(false);
  });
  it('payment IDs are well-formed and non-sequential', async () => {
    const { generatePaymentId } = await import('../../src/lib/crypto.js');
    const ids = new Set(Array.from({ length: 1000 }, generatePaymentId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^PAY-[2-9A-HJ-NP-Z]{8}$/);
  });
});
