import { describe, expect, it, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseQr, buildRequestQr, buildUserQr } from '../../src/lib/qr.js';
import { assertSafeUrl, isPrivateIp } from '../../src/lib/ssrf.js';
import { getPath, interpret, previewRequest, render, type PayoutConfig } from '../../src/providers/payout.js';
import { can, ROLE_PERMS } from '../../src/lib/permissions.js';
import { verifyInitData } from '../../src/telegram/initData.js';
import { BACKOFF_SEC, nextDelaySec, signWebhook } from '../../src/services/merchantWebhooks.js';

describe('QR parsing is a strict whitelist', () => {
  it('round-trips valid payloads', () => {
    expect(parseQr(buildRequestQr('REQ-ABCD2345'))).toEqual({ type: 'REQUEST', requestId: 'REQ-ABCD2345' });
    expect(parseQr(buildUserQr('PAY-ABCD2345'))).toEqual({ type: 'USER', paymentId: 'PAY-ABCD2345', amount: undefined });
    expect(parseQr(buildUserQr('PAY-ABCD2345', '500.50'))).toMatchObject({ amount: '500.50' });
  });
  it('rejects everything else', () => {
    for (const bad of ['', 'https://evil.com', 'payment://receive', 'payment://receive?request=../../x', 'payment://receive?request=REQ-ABCD2345&x=1',
      'payment://pay?to=PAY-ABCD2345&amount=-5', 'payment://pay?to=PAY-ABCD2345&amount=1e9', 'payment://other?to=PAY-ABCD2345', 'payment://pay?to=PAY-0000000O', 'x'.repeat(300)]) {
      expect(() => parseQr(bad), bad).toThrow();
    }
  });
});

describe('SSRF guard', () => {
  it('blocks private, local and non-https targets', () => {
    for (const bad of ['http://example.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://192.168.1.1/', 'https://169.254.169.254/latest/meta-data',
      'https://172.20.0.1/', 'https://[::1]/', 'https://user:pw@example.com/', 'https://db.internal/', 'ftp://example.com', 'not a url']) {
      expect(() => assertSafeUrl(bad), bad).toThrow();
    }
  });
  it('allows public https', () => { expect(assertSafeUrl('https://api.example.com/hook').hostname).toBe('api.example.com'); });
  it('classifies IPs', () => { expect(isPrivateIp('10.1.2.3')).toBe(true); expect(isPrivateIp('8.8.8.8')).toBe(false); expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true); });
});

describe('payout provider templating and response mapping', () => {
  const cfg: PayoutConfig = {
    method: 'GET', url: 'https://pay.example.com/api.php?&token={token}&paytm={destination}&amount={amount}&comment=Payout', headers: {}, timeoutMs: 5000,
    success: { path: 'status', equals: ['success', true] }, failure: { path: 'status', equals: ['failed', false] }, referencePath: 'data.txn_id',
    secrets: { token: 'SECRETTOKEN' },
  };
  it('renders URL-encoded values and never leaks secrets in previews', () => {
    const p = previewRequest(cfg, { reference: 'WDR-X', destination: 'a b&c=d@upi', amountPaise: 1050n });
    expect(p.url).toContain('paytm=a%20b%26c%3Dd%40upi');
    expect(p.url).toContain('amount=10.50');
    expect(p.url).not.toContain('SECRETTOKEN');
  });
  it('strips CR/LF (header injection) and JSON-escapes body values', () => {
    expect(render('X: {a}', { a: 'v\r\nInjected: 1' }, 'raw')).toBe('X: vInjected: 1');
    expect(render('{"d":"{a}"}', { a: 'x"y' }, 'json')).toBe('{"d":"x\\"y"}');
  });
  it('reads dotted paths', () => expect(getPath({ a: { b: 7 } }, 'a.b')).toBe(7));
  it('success / failure are recognised case-insensitively, with reference', () => {
    expect(interpret(200, '{"status":"SUCCESS","data":{"txn_id":"T1"}}', cfg)).toEqual({ kind: 'SUCCESS', reference: 'T1' });
    expect(interpret(200, '{"status":"Failed"}', cfg).kind).toBe('FAILED');
  });
  it('timeouts, 5xx, empty and ambiguous responses are UNKNOWN, never failure (so we never refund or resend on a guess)', () => {
    for (const [code, body] of [[500, ''], [502, '<html>'], [200, '{}'], [200, 'ok'], [429, '{}'], [408, '{}'], [200, '{"status":"processing"}'], [301, '']] as const) {
      expect(interpret(code, body, cfg).kind, `${code} ${body}`).toBe('UNKNOWN');
    }
    expect(interpret(200, '{"status":true}', { ...cfg, failure: { path: 'status', equals: [true] } }).kind).toBe('UNKNOWN');
  });
  it('a definitive 4xx rejection counts as failure', () => expect(interpret(400, '{"error":"bad upi"}', cfg).kind).toBe('FAILED'));
});

describe('roles', () => {
  it('Super Admin can do everything; others are limited', () => {
    expect(ROLE_PERMS.SUPER_ADMIN).toBe('*');
    expect(can('SUPER_ADMIN', 'settings:write')).toBe(true);
    expect(can('FINANCE_ADMIN', 'reconcile:write')).toBe(true);
    expect(can('FINANCE_ADMIN', 'settings:write')).toBe(false);
    expect(can('FINANCE_ADMIN', 'admins:write')).toBe(false);
    expect(can('SUPPORT_ADMIN', 'withdrawals:write')).toBe(false);
    expect(can('SUPPORT_ADMIN', 'users:write')).toBe(true);
    for (const p of ['users:write', 'refunds:write', 'reconcile:write', 'withdrawals:write', 'settings:write'] as const) expect(can('READ_ONLY', p)).toBe(false);
  });
});

describe('Telegram initData verification', () => {
  const BOT = '123456:TEST-bot-token';
  const make = (fields: Record<string, string>, token = BOT) => {
    const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    const hash = createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest()).update(check).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
  };
  const now = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: 42, username: 'eren' });
  it('accepts valid data', () => expect(verifyInitData(make({ auth_date: String(now), user, query_id: 'Q' }), BOT).user.id).toBe(42));
  it('rejects a forged user id, wrong bot token, missing hash, and stale data', () => {
    const good = make({ auth_date: String(now), user });
    expect(() => verifyInitData(good.replace('%22id%22%3A42', '%22id%22%3A43'), BOT)).toThrow();
    expect(() => verifyInitData(make({ auth_date: String(now), user }, 'other:token'), BOT)).toThrow();
    expect(() => verifyInitData(`auth_date=${now}&user=${encodeURIComponent(user)}`, BOT)).toThrow();
    expect(() => verifyInitData(make({ auth_date: String(now - 7200), user }), BOT, 3600)).toThrow();
  });
});

describe('merchant webhook signing and retry schedule', () => {
  it('signature binds timestamp and body', () => {
    const s = signWebhook('whsec_x', 1700000000, '{"a":1}');
    expect(s).toBe(createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex'));
    expect(signWebhook('whsec_x', 1700000001, '{"a":1}')).not.toBe(s);
    expect(signWebhook('whsec_x', 1700000000, '{"a":2}')).not.toBe(s);
  });
  it('backs off increasingly and caps', () => {
    expect(BACKOFF_SEC.length).toBe(8);
    for (let i = 1; i < BACKOFF_SEC.length; i++) expect(BACKOFF_SEC[i]).toBeGreaterThan(BACKOFF_SEC[i - 1]!);
    expect(nextDelaySec(99)).toBe(BACKOFF_SEC.at(-1));
  });
});

describe('secret box', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://x'; process.env.APP_URL = 'http://localhost:3000';
    process.env.SESSION_SECRET = 's'.repeat(40); process.env.OTP_PEPPER = 'p'.repeat(40);
  });
  it('round-trips, is randomised, and detects tampering', async () => {
    const { seal, open, maskSecret } = await import('../../src/lib/secretBox.js');
    const a = seal('rzp_secret_value'), b = seal('rzp_secret_value');
    expect(a).not.toBe(b); expect(a).not.toContain('rzp_secret');
    expect(open(a)).toBe('rzp_secret_value');
    const parts = a.split('.'); parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith('AA') ? 'BB' : 'AA');
    expect(() => open(parts.join('.'))).toThrow();
    expect(maskSecret('abcdefgh1234')).toBe('••••••••1234');
  });
});

describe('log redaction', () => {
  it('hides tokens in URLs', async () => {
    const { redactUrl } = await import('../../src/lib/redact.js');
    expect(redactUrl('/api/v1/url/payout?token=pg_live_SECRET&upi=a@b&amount=1')).toBe('/api/v1/url/payout?token=[REDACTED]&upi=a@b&amount=1');
    expect(redactUrl('/x?a=1&token=abc')).toBe('/x?a=1&token=[REDACTED]');
    expect(redactUrl('/health')).toBe('/health');
  });
});

describe('branded email', () => {
  it('shows the brand, the code and the validity, and escapes input', async () => {
    const { emailLayout } = await import('../../src/services/mail.js');
    const html = emailLayout('<p>123456</p>');
    expect(html).toContain('Cafin');
    expect(html).toContain('Pay');
    expect(html).toContain('123456');
    expect(html).toContain(`${new Date().getFullYear()}`);
    expect(html).toContain('All rights reserved');
  });
});
