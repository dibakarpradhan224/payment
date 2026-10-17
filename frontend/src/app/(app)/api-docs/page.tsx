'use client';
import { useEffect, useState } from 'react';
import { copy } from '@/lib/format';
import { newKey } from '@/lib/api';
import { Badge, Button, Card, Field, PageTitle, Tabs, useToast } from '@/components/ui';
import { EndpointUrlCard, ResponsesModal, TokenCard, WebhookCard, useApiToken } from '@/components/ApiManage';
import { applyTheme, getTheme } from '@/lib/theme';

type Ep = {
  id: string; title: string; group: 'Accept payments' | 'Send payouts' | 'Account'; method: 'GET' | 'POST'; path: string; scope: string; summary: string;
  idem?: boolean; money?: boolean; urlToken?: boolean; body?: Record<string, unknown>; response: unknown; notes?: string[]; pathParam?: { name: string; example: string };
};

const EPS: Ep[] = [
  { id: 'payment-create', title: 'Create a payment', group: 'Accept payments', method: 'POST', path: '/api/v1/payment/create', scope: 'payments',
    summary: 'Creates a payment request for a customer. Send them to payment_url, or show qr_payload as a QR code. The customer pays from their Cafin Pay wallet with their PIN.',
    body: { amount: '500', orderId: 'order-1001', description: 'Product payment', expiresInMinutes: 30 },
    response: { success: true, data: { payment_id: 'REQ-8H29XKQ4', amount: '500.00', currency: 'INR', status: 'pending', order_id: 'order-1001', payment_url: 'https://yourdomain.com/pay/REQ-8H29XKQ4', qr_payload: 'payment://receive?request=REQ-8H29XKQ4', expires_at: '2026-10-08T10:30:00.000Z', created_at: '2026-10-08T10:00:00.000Z' } },
    notes: ['amount is a string in rupees ("500" or "500.50"). expiresInMinutes: 5 to 10080 (default 60).', 'orderId is your own reference. Sending the same orderId again returns the original payment instead of creating a duplicate.', 'You are told about the result by webhook (payment.success) or by checking the status below.'] },
  { id: 'payment-status', title: 'Check a payment', group: 'Accept payments', method: 'GET', path: '/api/v1/payment/{payment_id}', scope: 'payments', pathParam: { name: 'payment_id', example: 'REQ-8H29XKQ4' },
    summary: 'Returns the current status. Always confirm a payment with your server before delivering goods.',
    response: { success: true, data: { payment_id: 'REQ-8H29XKQ4', amount: '500.00', currency: 'INR', status: 'paid', order_id: 'order-1001', payment_url: 'https://yourdomain.com/pay/REQ-8H29XKQ4', paid_at: '2026-10-08T10:04:11.000Z', transaction_id: 'TXN-ABCDEFGHJKLM', expires_at: '2026-10-08T10:30:00.000Z' } },
    notes: ['status is one of: pending, paid, expired, cancelled.'] },
  { id: 'payout', title: 'Create a payout (withdraw to UPI)', group: 'Send payouts', method: 'POST', path: '/api/v1/withdraw', scope: 'withdraw', idem: true, money: true,
    summary: 'Sends money from the wallet to any UPI ID. Funds are reserved immediately; the payout then completes or is refunded automatically.',
    body: { amount: '100', upiId: 'name@bank', pin: '1234' },
    response: { success: true, data: { withdrawal: { id: 'WDR-K3M7QX2P', amount: { paise: '10000', rupees: '100.00' }, fee: { paise: '0', rupees: '0.00' }, destination: 'na***@bank', status: 'PROCESSING', failureReason: null, txnId: 'TXN-ZYXWVUTSRQPN', createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:01.000Z' }, message: 'Withdrawal is processing. You will be notified when it completes.' } },
    notes: ['The Idempotency-Key header is optional. Without it, every request sends money again. If you send one (any unique string, 8-128 chars), retrying with the same key never pays twice.', 'pin is the 4-digit PIN of the account that owns the token. Keep it only on your server.', 'HTTP 202. status goes PROCESSING, then SUCCESSFUL, or REFUNDED if the provider fails (your money comes back once).', 'Fails with INSUFFICIENT_BALANCE ("Insufficient balance.") when the wallet cannot cover amount plus fee. A payout provider must be configured by the admin.'] },
  { id: 'payout-status', title: 'List payouts / check status', group: 'Send payouts', method: 'GET', path: '/api/v1/withdrawals', scope: 'read',
    summary: 'Your latest 50 payouts with their status. Poll this, or use the withdrawal.success / withdrawal.failed webhooks.',
    response: { success: true, data: { withdrawals: [{ id: 'WDR-K3M7QX2P', amount: { paise: '10000', rupees: '100.00' }, status: 'SUCCESSFUL', destination: 'na***@bank', txnId: 'TXN-ZYXWVUTSRQPN' }] } },
    notes: ['Statuses: PENDING, PROCESSING, SUCCESSFUL, REFUNDED, MANUAL_REVIEW (an admin is checking it; funds stay reserved).'] },
  { id: 'transfer', title: 'Transfer to another user', group: 'Send payouts', method: 'POST', path: '/api/v1/transfer', scope: 'transfer', idem: true, money: true,
    summary: 'Instantly moves money to another Cafin Pay wallet by Payment ID, email or mobile.',
    body: { to: 'PAY-ABCD2345', amount: '50', pin: '1234', description: 'Settlement' },
    response: { success: true, data: { transaction: { id: 'TXN-QWERTYUIOPAS', type: 'TRANSFER', status: 'SUCCESSFUL', amount: { paise: '5000', rupees: '50.00' } }, recipient: { paymentId: 'PAY-ABCD2345', displayName: 'Rahul Kumar' }, replayed: false } },
    notes: ['Needs the account PIN. The Idempotency-Key header is optional, like payouts.'] },
  { id: 'balance', title: 'Get balance', group: 'Account', method: 'GET', path: '/api/v1/balance', scope: 'read', summary: 'Available and locked balance.',
    response: { success: true, data: { available: { paise: '294000', rupees: '2940.00' }, locked: { paise: '0', rupees: '0.00' }, frozen: false, currency: 'INR' } } },
  { id: 'transactions', title: 'List transactions', group: 'Account', method: 'GET', path: '/api/v1/transactions?filter=deposits&limit=20', scope: 'read',
    summary: 'Filters: all, deposits, transfers, received, withdrawals, refunds, payments. Add q=<id or reference> to search and cursor=<nextCursor> to page.',
    response: { success: true, data: { transactions: [{ id: 'TXN-ABCDEFGHJKLM', type: 'DEPOSIT', direction: 'CREDIT', status: 'SUCCESSFUL', amount: { paise: '3000', rupees: '30.00' }, tax: { paise: '60', rupees: '0.60' }, net: { paise: '2940', rupees: '29.40' } }], nextCursor: null } } },
];


const URL_EPS: Ep[] = [
  { id: 'url-transfer-wallet', title: 'Send to a wallet number', group: 'Send payouts', method: 'GET', path: '/api/transfer?token=YOUR_TOKEN&number=9876543210&amount=10&comment=Payout', scope: 'transfer', urlToken: true, money: true,
    summary: 'Instantly sends money to another wallet. number can be their registered mobile number, a Payment ID (PAY-XXXXXXXX) or an email. Works without any payout provider.',
    response: { success: true, data: { ref: null, type: 'wallet', status: 'success', message: 'Transfer successful.', transaction: { id: 'TXN-QWERTYUIOPAS', amount: { paise: '1000', rupees: '10.00' } }, recipient: { paymentId: 'PAY-ABCD2345', displayName: 'Rahul Kumar' } } },
    notes: ['Token scope needed: transfer.', 'Every request sends money. Calling the same URL again sends again. ref is optional: add &ref=YOUR_UNIQUE_REF (8-64 characters) only if you want retry protection, because the same ref never pays twice.', 'If no wallet matches the number you get USER_NOT_FOUND and nothing is debited.', 'Always replace every {placeholder} with a real value. A literal {wallet} or {amount} is rejected.'] },
  { id: 'url-transfer-upi', title: 'Send to a UPI ID (bank payout)', group: 'Send payouts', method: 'GET', path: '/api/transfer?token=YOUR_TOKEN&number=name@bank&amount=10&comment=Payout&ref=PAYOUT-1001', scope: 'withdraw', urlToken: true, money: true,
    summary: 'Same URL, but a UPI ID in number. Paid out through your payout provider (set up by the admin).',
    response: { success: true, data: { ref: 'PAYOUT-1001', type: 'upi', status: 'processing', message: 'Withdrawal is processing. You will be notified when it completes.', withdrawal: { id: 'WDR-K3M7QX2P', status: 'PROCESSING', amount: { paise: '1000', rupees: '10.00' } } } },
    notes: ['Token scope needed: withdraw.', 'status is success, processing or failed. If processing, check it with transfer-status and the same ref, or use the withdrawal.success / withdrawal.failed webhooks. A failed payout is refunded to your wallet automatically.', 'URL payouts and transfers share a daily limit (default ₹10,000) because a URL cannot carry your PIN. Use the header API below for larger amounts.', 'Using a ref twice with a different amount or destination returns REF_REUSED.'] },
  { id: 'url-transfer-status', title: 'Check a payout', group: 'Send payouts', method: 'GET', path: '/api/transfer-status?token=YOUR_TOKEN&ref=PAYOUT-1001', scope: 'withdraw', urlToken: true,
    summary: 'Returns the current status of a payout or transfer you sent with a ref.',
    response: { success: true, data: { ref: 'PAYOUT-1001', type: 'upi', status: 'success', message: 'Withdrawal successful.', withdrawal: { id: 'WDR-K3M7QX2P', status: 'SUCCESSFUL' } } } },
  { id: 'url-pay', title: 'Create a payment', group: 'Accept payments', method: 'GET', path: '/api/payment?token=YOUR_TOKEN&amount=500&order_id=order-1001&comment=Product%20payment', scope: 'payments', urlToken: true,
    summary: 'Creates a payment and returns payment_url. Send your customer there; they pay with their PIN.',
    response: { success: true, data: { payment_id: 'REQ-8H29XKQ4', amount: '500.00', currency: 'INR', status: 'pending', order_id: 'order-1001', payment_url: 'https://yourdomain.com/pay/REQ-8H29XKQ4', qr_payload: 'payment://receive?request=REQ-8H29XKQ4', expires_at: '2026-10-08T10:30:00.000Z' } },
    notes: ['Always send order_id: calling the URL again with the same order_id returns the original payment instead of making a duplicate.'] },
  { id: 'url-status', title: 'Check a payment', group: 'Accept payments', method: 'GET', path: '/api/payment-status?token=YOUR_TOKEN&payment_id=REQ-8H29XKQ4', scope: 'payments', urlToken: true,
    summary: 'Returns pending, paid, expired or cancelled. Confirm this on your server before delivering goods.',
    response: { success: true, data: { payment_id: 'REQ-8H29XKQ4', amount: '500.00', status: 'paid', order_id: 'order-1001', paid_at: '2026-10-08T10:04:11.000Z', transaction_id: 'TXN-ABCDEFGHJKLM' } } },
];

const LANGS = [{ id: 'curl', label: 'cURL' }, { id: 'node', label: 'Node.js' }, { id: 'python', label: 'Python' }, { id: 'php', label: 'PHP' }];
const pretty = (o: unknown) => JSON.stringify(o, null, 2);
const phpVal = (v: unknown, ind = 4): string => {
  const pad = ' '.repeat(ind);
  if (v && typeof v === 'object') return `[\n${Object.entries(v as object).map(([k, x]) => `${pad}'${k}' => ${phpVal(x, ind + 4)},`).join('\n')}\n${' '.repeat(ind - 4)}]`;
  return typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v);
};

function snippet(lang: string, ep: Ep, base: string, token: string) {
  const path = ep.pathParam ? ep.path.replace(`{${ep.pathParam.name}}`, ep.pathParam.example) : ep.path;
  const url = `${base}${path}`;
  const hdr: [string, string][] = ep.urlToken ? [] : [['Authorization', `Bearer ${token}`]];
  if (ep.body) hdr.push(['Content-Type', 'application/json']);
  if (ep.idem) hdr.push(['Idempotency-Key', 'UNIQUE_KEY_PER_REQUEST']);
  const bodyStr = ep.body ? pretty(ep.body) : '';
  if (lang === 'curl') {
    return [`curl -X ${ep.method} "${url}" \\`, ...hdr.map(([k, v]) => `  -H "${k}: ${v}" \\`), ...(ep.body ? [`  -d '${JSON.stringify(ep.body)}'`] : [])].join('\n').replace(/ \\$/, '');
  }
  if (lang === 'node') {
    const h = hdr.map(([k, v]) => `    '${k}': ${k === 'Idempotency-Key' ? 'randomUUID()' : `'${v}'`},`).join('\n');
    return `${ep.idem ? "import { randomUUID } from 'node:crypto';\n\n" : ''}const res = await fetch('${url}', {\n  method: '${ep.method}',${hdr.length ? `\n  headers: {\n${h}\n  },` : ''}${ep.body ? `\n  body: JSON.stringify(${bodyStr.replace(/\n/g, '\n  ')}),` : ''}\n});\nconsole.log(res.status, await res.json());`;
  }
  if (lang === 'python') {
    const h = hdr.map(([k, v]) => `        "${k}": ${k === 'Idempotency-Key' ? 'str(uuid.uuid4())' : `"${v}"`},`).join('\n');
    return `import requests${ep.idem ? ', uuid' : ''}\n\nr = requests.${ep.method.toLowerCase()}(\n    "${url}",${hdr.length ? `\n    headers={\n${h}\n    },` : ''}${ep.body ? `\n    json=${bodyStr.replace(/\n/g, '\n    ')},` : ''}\n    timeout=30,\n)\nprint(r.status_code, r.json())`;
  }
  const h = hdr.map(([k, v]) => `        '${k}: ${k === 'Idempotency-Key' ? "' . bin2hex(random_bytes(16))" : v + "'"},`).join('\n');
  return `<?php\n$ch = curl_init('${url}');\ncurl_setopt_array($ch, [\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_CUSTOMREQUEST => '${ep.method}',${hdr.length ? `\n    CURLOPT_HTTPHEADER => [\n${h}\n    ],` : ''}${ep.body ? `\n    CURLOPT_POSTFIELDS => json_encode(${phpVal(ep.body)}),` : ''}\n]);\n$out = curl_exec($ch);\necho curl_getinfo($ch, CURLINFO_HTTP_CODE) . "\\n" . $out;`;
}

function Code({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div className="relative">
      <button onClick={async () => toast((await copy(text)) ? 'Copied' : 'Copy failed')} className="absolute right-2 top-2 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-zinc-300 hover:text-gold-300">Copy</button>
      <pre className="max-h-[28rem] overflow-auto rounded-xl bg-black/60 p-4 pr-16 text-xs leading-relaxed text-emerald-100">{text}</pre>
    </div>
  );
}

/** Sends a REAL request from your browser to this server. Same behaviour as the code samples. */
function TryIt({ ep }: { ep: Ep }) {
  const [token, setToken] = useState(''); const [body, setBody] = useState(ep.body ? pretty(ep.body) : ''); const [param, setParam] = useState(ep.pathParam?.example ?? '');
  const [pathEdit, setPathEdit] = useState(ep.path); const [ack, setAck] = useState(!ep.money); const [busy, setBusy] = useState(false); const [out, setOut] = useState<{ status: number; ms: number; text: string } | null>(null);
  async function run() {
    setBusy(true); setOut(null);
    const path = ep.urlToken ? pathEdit.replace('YOUR_TOKEN', encodeURIComponent(token)) : ep.pathParam ? ep.path.replace(`{${ep.pathParam.name}}`, encodeURIComponent(param)) : ep.path;
    const started = Date.now();
    try {
      const res = await fetch(path, { method: ep.method, headers: { ...(ep.urlToken ? {} : { Authorization: `Bearer ${token}` }), ...(ep.body ? { 'Content-Type': 'application/json' } : {}), ...(ep.idem ? { 'Idempotency-Key': newKey() } : {}) }, body: ep.body ? body : undefined });
      const t = await res.text(); let shown = t; try { shown = pretty(JSON.parse(t)); } catch { /* not json */ }
      setOut({ status: res.status, ms: Date.now() - started, text: shown });
    } catch (e) { setOut({ status: 0, ms: Date.now() - started, text: `Network error: ${(e as Error).message}` }); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 rounded-xl border border-gold-500/30 bg-gold-500/5 p-4">
      <p className="text-sm font-semibold text-gold-300">Try it live</p>
      {ep.money && <p className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-200">This sends a real request and moves real money from the account that owns the token. Use a small amount.</p>}
      <Field label={`API token (needs the "${ep.scope}" scope)`} type="password" autoComplete="off" placeholder="pg_live_…" value={token} onChange={(e) => setToken(e.target.value.trim())} hint="Generate one in the token card at the top of this page. It is only used for this request and is not stored." />
      {ep.urlToken && <Field label="Request URL (edit the values)" value={pathEdit} onChange={(e) => setPathEdit(e.target.value)} />}
      {ep.pathParam && <Field label={ep.pathParam.name} value={param} onChange={(e) => setParam(e.target.value.trim())} />}
      {ep.body && <label className="block space-y-1.5"><span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Request body (JSON)</span><textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} className="h-40 w-full rounded-xl border border-ink-600 bg-ink-900 p-3 font-mono text-xs outline-none focus:border-gold-500" /></label>}
      {ep.money && <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" className="accent-orange-500" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this moves real money</label>}
      <Button onClick={run} loading={busy} disabled={!token.startsWith('pg_live_') || !ack || (!!ep.pathParam && !param)}>Send {ep.method} request</Button>
      {out && <div><p className="mb-1 text-xs text-zinc-400">Status <span className={out.status >= 200 && out.status < 300 ? 'font-bold text-emerald-300' : 'font-bold text-red-300'}>{out.status || 'error'}</span> · {out.ms} ms</p><Code text={out.text} /></div>}
    </div>
  );
}

function EndpointCard({ ep, base }: { ep: Ep; base: string }) {
  const [lang, setLang] = useState('curl'); const [live, setLive] = useState(false);
  return (
    <Card id={ep.id} className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-center gap-2"><span className={ep.method === 'GET' ? 'rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-bold text-sky-300' : 'rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-300'}>{ep.method}</span><code className="break-all text-sm text-zinc-200">{ep.path}</code><span className="ml-auto rounded-full border border-ink-600 px-2 py-0.5 text-[11px] text-zinc-400">scope: {ep.scope}</span></div>
      <div><h3 className="text-lg font-bold">{ep.title}</h3><p className="mt-1 text-sm text-zinc-400">{ep.summary}</p></div>
      <Tabs tabs={LANGS} value={lang} onChange={setLang} />
      <Code text={snippet(lang, ep, base, 'YOUR_API_TOKEN')} />
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Example response</p><Code text={pretty(ep.response)} /></div>
      {ep.notes && <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">{ep.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <Button variant="ghost" onClick={() => setLive(!live)}>{live ? 'Hide live console' : 'Try it live'}</Button>
      {live && <TryIt ep={ep} />}
    </Card>
  );
}

const TAB: Record<string, 'payout' | 'merchant'> = { payout: 'payout', 'payout-status': 'payout', transfer: 'payout', balance: 'payout', 'url-transfer-wallet': 'payout', 'url-transfer-upi': 'payout', 'url-transfer-status': 'payout',
  'payment-create': 'merchant', 'payment-status': 'merchant', transactions: 'merchant', 'url-pay': 'merchant', 'url-status': 'merchant' };
const INTRO = {
  payout: { title: 'Payout API', steps: ['Press Copy on the URL above (you will be asked for your PIN) and put it in your bot or server. Replace {wallet}, {amount} and {comment} with real values.', 'wallet can be a wallet number (mobile), a Payment ID, or a UPI ID. Wallet transfers are instant.', 'Optional: add &ref=UNIQUE to make a retry safe. An identical request within 30 seconds is already treated as the same payment.'] },
  merchant: { title: 'Merchant API', steps: ['Press Copy on the URL above and call it from your server for each order, with a unique order_id.', 'Send your customer to the returned payment_url. They pay from their wallet with their PIN.', 'Confirm with the payment.success webhook or the status URL before delivering goods.'] },
} as const;

export default function ApiDocs() {
  const [base, setBase] = useState('https://yourdomain.com');
  const [tab, setTab] = useState<'payout' | 'merchant'>('payout');
  const [resp, setResp] = useState(false); const [adv, setAdv] = useState(false);
  const kp = useApiToken('payout'); const km = useApiToken('merchant');
  const k = tab === 'payout' ? kp : km;
  useEffect(() => setBase(window.location.origin), []);
  // Payout API = Sukuna, Merchant API = Gojo. Your own theme comes back when you leave this page.
  useEffect(() => { applyTheme(tab === 'payout' ? 'sukuna' : 'gojo'); return () => applyTheme(getTheme()); }, [tab]);
  const intro = INTRO[tab];
  const urlEps = URL_EPS.filter((e) => TAB[e.id] === tab);
  const hdrEps = EPS.filter((e) => TAB[e.id] === tab);
  return (
    <>
      <PageTitle sub="Copy a URL, add it to your server, done. Header-based API for larger integrations is below.">API documentation</PageTitle>
      <Tabs tabs={[{ id: 'payout', label: 'Payout API' }, { id: 'merchant', label: 'Merchant API' }]} value={tab} onChange={(t) => setTab(t as 'payout' | 'merchant')} />
      <div key={`d-${tab}`} aria-hidden className="domain-flash z-[55]" />
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[.3em] text-gold-400">{tab === 'payout' ? 'Malevolent Shrine · Payout API' : 'Limitless · Merchant API'}</p>
      <div key={tab} className="mt-3 space-y-4">
        <EndpointUrlCard k={k} kind={tab} base={base} />
        <TokenCard k={k} onResponses={() => setResp(true)} />
        <Card className="space-y-2">
          <h2 className="text-lg font-bold"><span className="gold-text">How {intro.title} works</span></h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-300">{intro.steps.map((x) => <li key={x}>{x}</li>)}</ol>
          <div className="flex flex-wrap gap-2 pt-1 text-xs">{[...urlEps, ...hdrEps].map((e) => <a key={e.id} href={`#${e.id}`} onClick={() => e.urlToken || setAdv(true)} className="rounded-full border border-ink-600 px-3 py-1 text-zinc-300 hover:border-gold-500 hover:text-gold-300">{e.title}</a>)}</div>
        </Card>

        <h3 className="pt-2 text-xl font-bold"><span className="gold-text">Request examples</span></h3>
        {urlEps.map((e) => <EndpointCard key={e.id} ep={e} base={base} />)}

        {tab === 'merchant' && (<>
          <WebhookCard />
          <Card className="space-y-3">
            <h3 className="font-semibold">Verify webhook signatures</h3>
            <p className="text-sm text-zinc-400">Events: <code>payment.created</code>, <code>payment.success</code>, <code>payment.failed</code> (expired or cancelled), <code>withdrawal.success</code>, <code>withdrawal.failed</code>. Reply with HTTP 2xx within 10 seconds; failures are retried 8 times. Verify the signature and ignore repeated event ids.</p>
            <Code text={`import { createHmac, timingSafeEqual } from 'node:crypto';\n\n// rawBody = the exact request body string; header = req.headers['x-gateway-signature']\nexport function verify(rawBody, header, secret) {\n  const p = Object.fromEntries(header.split(',').map((x) => x.split('=')));\n  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;\n  const mine = createHmac('sha256', secret).update(p.t + '.' + rawBody).digest();\n  const theirs = Buffer.from(p.v1, 'hex');\n  return mine.length === theirs.length && timingSafeEqual(mine, theirs);\n}`} />
          </Card>
        </>)}

        <Card className="space-y-3">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setAdv(!adv)}>
            <span><span className="font-semibold">Advanced: header-authenticated API</span><span className="block text-sm text-zinc-400">Token in a header (not the URL), PIN on money moves. Recommended for production servers.</span></span>
            <span className="text-gold-400">{adv ? 'Hide' : 'Show'}</span>
          </button>
        </Card>
        {adv && hdrEps.map((e) => <EndpointCard key={e.id} ep={e} base={base} />)}

        <Card className="space-y-2">
          <h3 className="font-semibold">Errors</h3>
          <p className="text-sm text-zinc-400">Every error looks like <code>{'{"success":false,"error":{"code":"INSUFFICIENT_BALANCE","message":"Insufficient balance."}}'}</code></p>
          <p className="text-sm text-zinc-400">INVALID_API_TOKEN (401) · INSUFFICIENT_SCOPE (403) · DAILY_LIMIT_EXCEEDED (403) · REF_REUSED (422) · INSUFFICIENT_BALANCE (400) · VALIDATION_ERROR (422) · RATE_LIMITED (429) · INVALID_PIN (400, header API)</p>
        </Card>
      </div>
      <ResponsesModal open={resp} onClose={() => setResp(false)} kind={tab} />
      {k.node}
    </>
  );
}
