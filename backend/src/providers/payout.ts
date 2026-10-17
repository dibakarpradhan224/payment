/**
 * Provider-agnostic payout client. Everything provider-specific lives in an admin-editable config:
 * URL/body templates, headers, and how to read success/failure/reference out of the response.
 * Template variables: {destination} {amount} (rupees) {amount_paise} {reference} {token} {secret}
 */
import { formatPaise } from '../lib/money.js';
import { assertSafeHost, assertSafeUrl } from '../lib/ssrf.js';
import { isProd } from '../config/env.js';

export interface Match { path: string; equals: (string | number | boolean)[] }
export interface StatusConfig {
  method: 'GET' | 'POST'; url: string; headers?: Record<string, string>; body?: string;
  success: Match; failure: Match; referencePath?: string;
}
export interface PayoutConfig {
  method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string; timeoutMs: number;
  success: Match; failure: Match; referencePath?: string;
  status?: StatusConfig;
  secrets: { token?: string; secret?: string };
}
export type Outcome = { kind: 'SUCCESS' | 'FAILED' | 'UNKNOWN'; reference?: string; detail?: string };
export interface PayoutArgs { reference: string; destination: string; amountPaise: bigint; providerRef?: string }

type Mode = 'url' | 'json' | 'raw';
export function render(tpl: string, vars: Record<string, string | undefined>, mode: Mode): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = (vars[k] ?? '').replace(/[\r\n]/g, '');
    return mode === 'url' ? encodeURIComponent(v) : mode === 'json' ? JSON.stringify(v).slice(1, -1) : v;
  });
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

const same = (v: unknown, list: Match['equals']) => v !== undefined && v !== null && list.some((x) => String(x).toLowerCase() === String(v).toLowerCase());

/** Decide what a provider response means. Anything ambiguous is UNKNOWN: we never refund or retry on a guess. */
export function interpret(httpStatus: number, text: string, c: { success: Match; failure: Match; referencePath?: string }): Outcome {
  let parsed: unknown = undefined;
  try { parsed = JSON.parse(text); } catch { /* plain text */ }
  const read = (m: Match) => (m.path === 'body' || parsed === undefined ? text.trim() : getPath(parsed, m.path));
  const reference = c.referencePath && parsed !== undefined ? String(getPath(parsed, c.referencePath) ?? '') || undefined : undefined;
  const s = same(read(c.success), c.success.equals);
  const f = same(read(c.failure), c.failure.equals);
  if (s && !f) return { kind: 'SUCCESS', reference };
  if (f && !s) return { kind: 'FAILED', reference, detail: 'provider reported failure' };
  if (s && f) return { kind: 'UNKNOWN', detail: 'ambiguous response' };
  if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429) return { kind: 'FAILED', detail: `provider rejected (HTTP ${httpStatus})` };
  return { kind: 'UNKNOWN', detail: `unrecognised response (HTTP ${httpStatus})` };
}

async function http(method: string, url: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number) {
  const u = await assertSafeHost(url, !isProd);
  try {
    const res = await fetch(u, { method, headers, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return { status: res.status, text: (await res.text()).slice(0, 65_536) };
  } catch {
    return null; // timeout / network error: outcome is unknown, NOT a failure
  }
}

const vars = (cfg: PayoutConfig, a: PayoutArgs) => ({
  destination: a.destination, amount: formatPaise(a.amountPaise), amount_paise: a.amountPaise.toString(),
  reference: a.reference, provider_ref: a.providerRef, token: cfg.secrets.token, secret: cfg.secrets.secret,
});
const bodyMode = (h: Record<string, string>): Mode => (/json/i.test(Object.entries(h).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '') ? 'json' : 'url');

export async function createPayout(cfg: PayoutConfig, a: PayoutArgs): Promise<Outcome> {
  const v = vars(cfg, a);
  const headers = Object.fromEntries(Object.entries(cfg.headers).map(([k, x]) => [k, render(x, v, 'raw')]));
  const r = await http(cfg.method, render(cfg.url, v, 'url'), headers, cfg.body ? render(cfg.body, v, bodyMode(cfg.headers)) : undefined, cfg.timeoutMs);
  return r ? interpret(r.status, r.text, cfg) : { kind: 'UNKNOWN', detail: 'no response (timeout or network error)' };
}

/** null = provider has no status API configured. */
export async function checkPayout(cfg: PayoutConfig, a: PayoutArgs): Promise<Outcome | null> {
  const s = cfg.status;
  if (!s) return null;
  const v = vars(cfg, a);
  const headers = Object.fromEntries(Object.entries(s.headers ?? {}).map(([k, x]) => [k, render(x, v, 'raw')]));
  const r = await http(s.method, render(s.url, v, 'url'), headers, s.body ? render(s.body, v, bodyMode(s.headers ?? {})) : undefined, cfg.timeoutMs);
  if (!r) return { kind: 'UNKNOWN', detail: 'no response' };
  const o = interpret(r.status, r.text, s);
  // A status lookup that merely 4xx's must not be read as "payout failed".
  return o.kind === 'FAILED' && o.detail?.startsWith('provider rejected') ? { kind: 'UNKNOWN', detail: o.detail } : o;
}

/** Admin "test" button: shows exactly what would be sent, with secrets masked. Sends nothing, moves no money. */
export function previewRequest(cfg: PayoutConfig, a: PayoutArgs) {
  assertSafeUrl(render(cfg.url, { ...vars(cfg, a), token: 'TOKEN', secret: 'SECRET' }, 'url'), !isProd);
  const v = { ...vars(cfg, a), token: '••••', secret: '••••' };
  return {
    method: cfg.method, url: render(cfg.url, v, 'url'),
    headers: Object.fromEntries(Object.entries(cfg.headers).map(([k, x]) => [k, render(x, v, 'raw')])),
    body: cfg.body ? render(cfg.body, v, bodyMode(cfg.headers)) : null,
    hasStatusCheck: !!cfg.status,
  };
}
