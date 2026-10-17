import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eqHex, hmacHex, verifyBodySignature } from '../../src/lib/signatures.js';
import { normalizeUtr } from '../../src/lib/utr.js';
import { API_TOKEN_RE, generateApiToken, hashToken } from '../../src/lib/apiTokenFormat.js';
import { consumeToken } from '../../src/lib/tokenLimiter.js';

describe('Signatures', () => {
  const secret = 'key_secret_abc';
  const good = createHmac('sha256', secret).update('order_X1|pay_Y2').digest('hex');
  it('rejects garbage signatures without throwing', () => {
    for (const bad of ['', 'zz', 'abc', 'g'.repeat(64), good.slice(0, 10)]) expect(eqHex(bad, good)).toBe(false);
  });
  it('webhook signature covers the exact raw body', () => {
    const body = '{"event":"payment.captured","payload":{}}';
    const sig = hmacHex('whsec', body);
    expect(verifyBodySignature(body, sig, 'whsec')).toBe(true);
    expect(verifyBodySignature(body + ' ', sig, 'whsec')).toBe(false); // even whitespace changes it
    expect(verifyBodySignature(body, sig, 'wrong')).toBe(false);
  });
});

describe('UTR normalisation', () => {
  it('uppercases and strips spaces', () => expect(normalizeUtr(' 4123 4567 8901 ')).toBe('412345678901'));
  it('rejects bad formats', () => {
    for (const bad of ['', '123', '12345678901', 'abc-def-ghi-jkl', 'x'.repeat(30)]) expect(() => normalizeUtr(bad)).toThrow();
  });
  it('the same UTR in different formatting collides (so duplicates cannot hide)', () => {
    expect(normalizeUtr('abc123def456')).toBe(normalizeUtr(' ABC123 DEF456 '));
  });
});

describe('API tokens', () => {
  it('has the expected format, is unique, and only its hash is derivable', () => {
    const a = generateApiToken(), b = generateApiToken();
    expect(a.token).toMatch(API_TOKEN_RE);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(a.prefix).toBe(a.token.slice(0, 12));
  });
  it('rejects malformed tokens', () => {
    for (const bad of ['', 'pg_live_short', 'sk_live_' + 'a'.repeat(43), 'pg_live_' + '!'.repeat(43)]) expect(API_TOKEN_RE.test(bad)).toBe(false);
  });
});

describe('per-token rate limiter', () => {
  it('allows up to the limit then blocks, and resets after the window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(consumeToken('tok-a', t0, 5).allowed).toBe(true);
    expect(consumeToken('tok-a', t0 + 10, 5).allowed).toBe(false);
    expect(consumeToken('tok-b', t0 + 10, 5).allowed).toBe(true); // other tokens unaffected
    expect(consumeToken('tok-a', t0 + 61_000, 5).allowed).toBe(true);
  });
});
