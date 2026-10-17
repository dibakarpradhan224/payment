import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^192\.0\.0\./, /^198\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./];

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(v) === 4) return PRIVATE_V4.some((r) => r.test(v));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

/** Syntax-level checks (sync). */
export function assertSafeUrl(raw: string, allowHttp = false): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL.'); }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw new Error('URL must use https.');
  if (u.username || u.password) throw new Error('URL must not contain credentials.');
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) throw new Error('URL host is not allowed.');
  if (isIP(h) && isPrivateIp(h)) throw new Error('URL host is not allowed.');
  return u;
}

/** Also resolve DNS and refuse private targets (best effort against SSRF; run right before each request). */
export async function assertSafeHost(raw: string, allowHttp = false): Promise<URL> {
  const u = assertSafeUrl(raw, allowHttp);
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(h)) {
    const addrs = await lookup(h, { all: true }).catch(() => { throw new Error('URL host cannot be resolved.'); });
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('URL host is not allowed.');
  }
  return u;
}
