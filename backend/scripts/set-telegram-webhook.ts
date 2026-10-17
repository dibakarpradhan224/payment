// Usage: npx tsx scripts/set-telegram-webhook.ts   (reads backend/.env via your shell, e.g. `set -a; . ./.env; set +a`)
const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET, app = process.env.APP_URL;
if (!token || !secret || !app) { console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL first.'); process.exit(1); }
const call = (m: string, body: object) => fetch(`https://api.telegram.org/bot${token}/${m}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
console.log(await call('setWebhook', { url: `${app}/webhooks/telegram`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }));
console.log(await call('setMyCommands', { commands: [
  { command: 'balance', description: 'Wallet balance' }, { command: 'addmoney', description: 'Add money' }, { command: 'send', description: 'Send money' },
  { command: 'receive', description: 'Receive / payment request' }, { command: 'withdraw', description: 'Withdraw to UPI' }, { command: 'transactions', description: 'Recent transactions' },
  { command: 'profile', description: 'Your account' }, { command: 'api', description: 'API token status' }, { command: 'help', description: 'Help' } ] }));
console.log(await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Wallet', web_app: { url: `${app}/miniapp` } } }));
