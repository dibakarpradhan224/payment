import { createHmac } from 'node:crypto';
import { eqHex } from '../lib/signatures.js';

/** Validates Telegram Mini App initData exactly as Telegram documents it. Never trust a user id the frontend sends on its own. */
export function verifyInitData(initData: string, botToken: string, maxAgeSec = 3600, nowMs = Date.now()) {
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) throw new Error('missing hash');
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  if (!eqHex(createHmac('sha256', secret).update(check).digest('hex'), hash)) throw new Error('bad signature');
  const authDate = Number(p.get('auth_date'));
  if (!authDate || nowMs / 1000 - authDate > maxAgeSec || authDate > nowMs / 1000 + 60) throw new Error('expired');
  const user = JSON.parse(p.get('user') ?? 'null') as { id: number; username?: string; first_name?: string } | null;
  if (!user?.id) throw new Error('no user');
  return { user, authDate, startParam: p.get('start_param') ?? undefined };
}
