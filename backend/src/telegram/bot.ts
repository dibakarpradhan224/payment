/**
 * Telegram bot (webhook mode). Read-only and request-creating commands run in chat.
 * Anything that MOVES money opens the Mini App, so the 4-digit PIN is never typed into a chat history.
 */
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { formatPaise, parseRupees } from '../lib/money.js';
import { buildUserQr } from '../lib/qr.js';
import { sendMessage } from './api.js';
import { redeemLinkCode } from './link.js';
import { createPaymentRequest } from '../services/paymentRequests.js';
import { audit } from '../services/audit.js';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const app = (path: string, label: string) => ({ inline_keyboard: [[{ text: label, web_app: { url: `${env.APP_URL}${path}` } }]] });

const HELP = `<b>Commands</b>
/balance - wallet balance
/transactions - last 5 transactions
/receive [amount] - your Payment ID or a payment request
/profile - your account
/api - API token status
/addmoney /send /withdraw - open the secure Mini App
/link CODE - link this chat to your account (get a code in Settings &gt; Telegram)`;

export async function handleUpdate(update: any) {
  const m = update?.message;
  if (!m?.text || !m.from || m.from.is_bot) return;
  if (m.chat.type !== 'private') return void sendMessage(m.chat.id, 'Please message me in a private chat.');
  const [cmdRaw, ...args] = m.text.trim().split(/\s+/);
  const cmd = cmdRaw!.toLowerCase().replace(/@\w+$/, '');
  const chat = m.chat.id;
  const tgId = BigInt(m.from.id);

  if (cmd === '/start' || cmd === '/help') {
    return void sendMessage(chat, `Welcome to <b>Cafin Pay</b>! Manage your wallet from Telegram.\n\n${HELP}`, app('/miniapp', 'Open wallet'));
  }
  if (cmd === '/link') {
    if (!args[0]) return void sendMessage(chat, 'Send <code>/link CODE</code> with the code from Settings &gt; Telegram on the website.');
    try {
      const userId = await redeemLinkCode(args[0], tgId, m.from.username);
      await audit({ actorId: userId, action: 'telegram.linked', result: 'SUCCESS' });
      return void sendMessage(chat, 'Linked. Your Telegram now shares the same wallet as the website. Try /balance.', app('/miniapp', 'Open wallet'));
    } catch (e) {
      return void sendMessage(chat, esc((e as Error).message));
    }
  }

  const link = await prisma.telegramLink.findUnique({ where: { telegramId: tgId }, include: { user: { include: { wallet: true } } } });
  if (!link) return void sendMessage(chat, 'This chat is not linked yet. Register on the website, open Settings &gt; Telegram, then send <code>/link CODE</code> here.');
  const u = link.user;
  if (u.status !== 'ACTIVE') return void sendMessage(chat, 'Your account is suspended. Contact support.');

  switch (cmd) {
    case '/balance':
      return void sendMessage(chat, `Available balance: <b>₹${formatPaise(u.wallet?.available ?? 0n)}</b>${u.wallet?.frozen ? '\n(Wallet is frozen)' : ''}`);
    case '/transactions': {
      const rows = await prisma.transaction.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 5 });
      if (!rows.length) return void sendMessage(chat, 'No transactions yet.');
      return void sendMessage(chat, rows.map((t) => `${t.direction === 'CREDIT' ? '＋' : '－'} ₹${formatPaise(t.netAmount)}  ${t.type} · ${t.status}\n<code>${t.txnId}</code>`).join('\n\n'));
    }
    case '/profile':
      return void sendMessage(chat, `<b>${esc(u.name ?? 'Cafin Pay user')}</b>\nPayment ID: <code>${u.paymentId}</code>`);
    case '/receive': {
      if (!args[0]) return void sendMessage(chat, `Your Payment ID: <code>${u.paymentId}</code>\nQR payload: <code>${buildUserQr(u.paymentId)}</code>`, app('/receive', 'Show my QR'));
      let amount: bigint;
      try { amount = parseRupees(args[0]); } catch { return void sendMessage(chat, 'Usage: /receive 500'); }
      try {
        const r = await createPaymentRequest(u.id, { amount, description: 'Telegram request', expiresInMinutes: 60 });
        return void sendMessage(chat, `Payment request <code>${r.id}</code>\nAmount: ₹${r.amount.rupees}\nExpires in 1 hour\n${r.paymentUrl}`, app('/receive', 'Show QR'));
      } catch (e) { return void sendMessage(chat, esc((e as Error).message)); }
    }
    case '/api': {
      const toks = await prisma.apiToken.findMany({ where: { userId: u.id, status: 'ACTIVE' } });
      const label: Record<string, string> = { PAYOUT: 'Payout', MERCHANT: 'Merchant', ALL: 'Legacy (all-in-one)' };
      return void sendMessage(chat, toks.length ? toks.map((t) => `${label[t.kind] ?? t.kind} token <code>${t.prefix}…</code>\nScopes: ${t.scopes.join(', ')}\nLast used: ${t.lastUsedAt?.toISOString() ?? 'never'}`).join('\n\n') + '\n\nTokens are never sent over chat.' : 'No API tokens yet.', app('/api-docs', 'Manage API'));
    }
    case '/addmoney': return void sendMessage(chat, 'Add money securely:', app('/add-money', 'Add money'));
    case '/send': return void sendMessage(chat, 'Send money (PIN is entered in the app, never in chat):', app('/send', 'Send money'));
    case '/withdraw': return void sendMessage(chat, 'Withdraw (PIN is entered in the app, never in chat):', app('/withdraw', 'Withdraw'));
    default: return void sendMessage(chat, HELP);
  }
}
