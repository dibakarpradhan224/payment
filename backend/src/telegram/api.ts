import { env } from '../config/env.js';

export async function tg(method: string, payload: Record<string, unknown>) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as any) : null;
}

export const sendMessage = (chatId: string | number, text: string, reply_markup?: unknown) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
