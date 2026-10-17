import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/** AES-256-GCM for provider secrets saved from the admin panel. Key comes from SETTINGS_KEY (falls back to SESSION_SECRET in dev). */
const key = () => Buffer.from(hkdfSync('sha256', env.SETTINGS_KEY ?? env.SESSION_SECRET, 'gateway-settings', 'v1', 32));

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function open(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad sealed value');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const maskSecret = (s?: string | null) => (s ? `${'•'.repeat(8)}${s.slice(-4)}` : null);
