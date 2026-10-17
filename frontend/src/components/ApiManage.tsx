'use client';
import { useRef, useState, type ReactNode } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { copy, when } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Modal, PinModal, Skeleton, useToast } from './ui';
import { Icon, type IconName } from './Icon';

const SCOPES: [string, string][] = [['read', 'Read balance & transactions'], ['payments', 'Create & check payments'], ['transfer', 'Send money'], ['withdraw', 'Payouts (withdraw)']];
const PRESETS: [string, string[]][] = [['Payout API', ['read', 'withdraw', 'transfer']], ['Merchant API', ['read', 'payments']], ['All', ['read', 'payments', 'transfer', 'withdraw']]];

export type TokenKind = 'payout' | 'merchant';

/** One hook per token kind. The full token is only fetched after the PIN is entered, and only kept in memory. */
export function useApiToken(kind: TokenKind) {
  const tok = useApi<any>(`${W}/api-token`);
  const [token, setToken] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'reveal' | 'create' | 'regenerate'>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const resolver = useRef<((t: string | null) => void) | null>(null);
  const ask = (purpose: 'reveal' | 'create' | 'regenerate') => new Promise<string | null>((res) => { resolver.current = res; setErr(''); setModal(purpose); });
  const finish = (t: string | null) => { resolver.current?.(t); resolver.current = null; };

  async function submit(pin: string) {
    if (!modal) return;
    setBusy(true); setErr('');
    try {
      const r = await api<any>(`${W}/api-token${modal === 'reveal' ? '/reveal' : modal === 'regenerate' ? '/regenerate' : ''}`, { body: { pin, kind } });
      setToken(r.token); setModal(null); tok.reload(); finish(r.token);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  const label = kind === 'payout' ? 'payout' : 'merchant';
  const node = <PinModal open={!!modal} onClose={() => { setModal(null); finish(null); }} onSubmit={submit} busy={busy} error={err}
    title={modal === 'reveal' ? `PIN to view ${label} token` : modal === 'regenerate' ? `PIN to reset ${label} token` : `PIN to create ${label} token`} />;
  return {
    kind, t: (tok.data?.tokens?.[kind] ?? null) as any, legacy: (tok.data?.tokens?.legacy ?? null) as any, loading: tok.loading, error: tok.error, warning: tok.data?.warning as string | undefined,
    reload: tok.reload, token, node,
    ensure: () => (token ? Promise.resolve(token) : ask('reveal')),
    create: () => ask('create'), regenerate: () => ask('regenerate'),
    hide: () => setToken(null),
    revoke: async () => { await api(`${W}/api-token/revoke`, { method: 'POST', body: { kind } }); setToken(null); tok.reload(); },
    revokeLegacy: async () => { await api(`${W}/api-token/revoke`, { method: 'POST', body: { kind: 'legacy' } }); tok.reload(); },
  };
}
export type ApiTok = ReturnType<typeof useApiToken>;

const Head = ({ icon, title }: { icon: IconName; title: string }) => (
  <div className="-mx-5 -mt-5 mb-5 flex items-center gap-3 border-b border-ink-700 px-5 py-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-500/15 text-gold-400"><Icon name={icon} /></span><h2 className="text-lg font-bold">{title}</h2></div>
);
const Label = ({ children }: { children: ReactNode }) => <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-zinc-500">{children}</p>;

const PARAMS = {
  payout: [
    ['wallet', 'Recipient: a wallet number (their registered mobile number) or Payment ID (PAY-XXXXXXXX) for an instant wallet transfer, or a UPI ID (name@bank) for a bank payout. Also accepted as number, upi or to'],
    ['amount', 'Amount in rupees, e.g. 10 or 10.50 (wallet transfer minimum ₹0.50, UPI payout minimum set by the admin, default ₹15)'],
    ['comment', 'Optional note'],
    ['ref', 'Optional: your own unique reference (8-64 characters). If you send one, the same ref never pays twice (safe retries). Without it, every request sends money again'],
  ],
  merchant: [['amount', 'Amount to collect in rupees'], ['order_id', 'Your order reference (recommended). The same order_id returns the same payment'], ['comment', 'Optional description'], ['expires', 'Optional minutes until it expires (5 to 10080)']],
} as const;

/** "API Endpoint URL" card: the ready-to-use URL with the parameters explained. */
export function EndpointUrlCard({ k, kind, base }: { k: ApiTok; kind: 'payout' | 'merchant'; base: string }) {
  const toast = useToast();
  const path = kind === 'payout' ? 'transfer' : 'payment';
  const qs = kind === 'payout' ? '&number={wallet}&amount={amount}&comment={comment}' : '&amount={amount}&order_id={order_id}&comment={comment}';
  const shown = k.token ?? (k.t ? `${k.t.prefix.replace('…', '')}••••••••••••` : 'YOUR_TOKEN');
  const url = (tok: string) => `${base}/api/${path}?token=${tok}${qs}`;
  return (
    <Card>
      <Head icon="gateway" title="API Endpoint URL" />
      <Label>Use this URL to {kind === 'payout' ? 'send payouts' : 'create payments'}</Label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 font-mono text-sm text-zinc-200">{url(shown)}</div>
        <Button onClick={async () => { const t = await k.ensure(); if (t) toast((await copy(url(t))) ? 'URL copied' : 'Token is now visible. Press Copy once more.', 'ok'); }}>Copy</Button>
      </div>
      <div className="mt-4 rounded-xl border border-ink-600 bg-ink-900/60 p-4">
        <Label>Parameters</Label>
        <ul className="space-y-2 text-sm">{PARAMS[kind].map(([n, d]) => <li key={n}><code className="font-bold text-gold-400">{`{${n}}`}</code> <span className="text-zinc-400">— {d}</span></li>)}</ul>
      </div>
      <p className="mt-3 text-xs text-zinc-500">Open it from your server. Anyone who has the URL has your token, so never put it in a web page, app or shared message.</p>
    </Card>
  );
}

const KIND_INFO = {
  payout: { title: 'Your Payout API Token', can: 'Can send money: wallet transfers and UPI payouts. Cannot create payments.', scopes: 'read, withdraw, transfer' },
  merchant: { title: 'Your Merchant API Token', can: 'Can create and check payments. Cannot send money out.', scopes: 'read, payments' },
} as const;

/** "Your API Token" card with copy / show / reset / view responses. Payout and Merchant are two separate tokens. */
export function TokenCard({ k, onResponses }: { k: ApiTok; onResponses: () => void }) {
  const toast = useToast();
  const t = k.t; const info = KIND_INFO[k.kind];
  const masked = t ? `${t.prefix.replace('…', '')}${'•'.repeat(30)}` : 'No token yet';
  return (
    <Card>
      <Head icon="lock" title={info.title} />
      {k.loading ? <Skeleton className="h-24" /> : k.error ? <ErrorBox message={k.error.message} retry={k.reload} /> : (<div className="space-y-4">
        <div className="rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-sm text-gold-300"><b>{info.can}</b><span className="block text-xs text-zinc-400">Permissions: {info.scopes}</span></div>
        <div><Label>Secret authentication token</Label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 font-mono text-sm">{k.token ?? masked}</div>
            <Button variant="ghost" disabled={!t} onClick={() => (k.token ? k.hide() : void k.ensure())} aria-label={k.token ? 'Hide token' : 'Show token'}>{k.token ? 'Hide' : 'Show'}</Button>
            <Button className="bg-gradient-to-r from-emerald-500 to-emerald-700 text-white" disabled={!t} onClick={async () => { const v = await k.ensure(); if (v) toast((await copy(v)) ? 'Token copied' : 'Token is now visible. Press Copy once more.', 'ok'); }}>Copy</Button>
          </div>
          {t && <p className="mt-2 text-xs text-zinc-500">Created {when(t.createdAt)} · Last used {t.lastUsedAt ? when(t.lastUsedAt) : 'never'}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {t ? <Button variant="danger" className="py-3.5" onClick={() => void k.regenerate()}>↻ Reset token</Button> : <Button className="py-3.5" onClick={() => void k.create()}>Generate token</Button>}
          <Button className="bg-gradient-to-r from-blue-500 to-indigo-600 py-3.5 text-white" onClick={onResponses}>View responses</Button>
        </div>
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"><span className="text-lg">⚠</span><p><b>Warning:</b> your API token is highly sensitive. <b>Do not share</b> it with anyone. Sharing it can lead to <b>fund loss</b> or misuse of your account. {k.warning}</p></div>
        {k.legacy && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">You also have an older all-in-one token (<span className="font-mono">{k.legacy.prefix}</span>) that can do both payouts and payments. For safety, use the two separate tokens and remove it.
          <button className="mt-2 block font-bold underline" onClick={async () => { await k.revokeLegacy(); toast('Old token removed'); }}>Remove the old token</button></div>}
        {t && <button className="text-xs text-red-300 hover:underline" onClick={async () => { await k.revoke(); toast('Token revoked'); }}>Revoke this token</button>}
      </div>)}
    </Card>
  );
}

const SAMPLES = {
  payout: [
    ['Wallet transfer: success', { success: true, data: { ref: null, type: 'wallet', status: 'success', message: 'Transfer successful.', transaction: { id: 'TXN-QWERTYUIOPAS', amount: { paise: '1000', rupees: '10.00' } }, recipient: { paymentId: 'PAY-ABCD2345', displayName: 'Rahul Kumar' } } }],
    ['UPI payout: processing (check later with transfer-status and your ref)', { success: true, data: { ref: 'PAYOUT-1001', type: 'upi', status: 'processing', message: 'Withdrawal is processing. You will be notified when it completes.' } }],
    ['UPI payout: failed (money returned to your wallet)', { success: true, data: { ref: 'PAYOUT-1001', type: 'upi', status: 'failed', message: 'Withdrawal failed. Your funds have been refunded.' } }],
    ['Error: wallet not found', { success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found.' } }],
    ['Error: not enough balance', { success: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance.' } }],
  ],
  merchant: [
    ['Payment created', { success: true, data: { payment_id: 'REQ-8H29XKQ4', amount: '500.00', status: 'pending', order_id: 'order-1001', payment_url: 'https://yourdomain.com/pay/REQ-8H29XKQ4' } }],
    ['Payment paid', { success: true, data: { payment_id: 'REQ-8H29XKQ4', status: 'paid', paid_at: '2026-10-08T10:04:11.000Z', transaction_id: 'TXN-ABCDEFGHJKLM' } }],
    ['Error', { success: false, error: { code: 'INVALID_API_TOKEN', message: 'Invalid or missing API token.' } }],
  ],
} as const;

export function ResponsesModal({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: 'payout' | 'merchant' }) {
  const usage = useApi<any>(open ? `${W}/api-token/usage?kind=${kind}` : null);
  return (
    <Modal open={open} onClose={onClose} title="API responses">
      <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
        <p className="text-xs text-zinc-400">What your server receives. Every reply has <code>success</code> true or false.</p>
        {SAMPLES[kind].map(([l, j]) => <div key={l}><p className="mb-1 text-xs font-semibold text-gold-300">{l}</p><pre className="overflow-x-auto rounded-lg bg-black/60 p-3 text-[11px] text-emerald-100">{JSON.stringify(j, null, 2)}</pre></div>)}
        <div><p className="mb-1 text-xs font-semibold text-gold-300">Your latest calls</p>
          {usage.data?.recent.length ? <ul className="divide-y divide-ink-700 text-xs">{usage.data.recent.slice(0, 15).map((r: any, i: number) => <li key={i} className="flex justify-between py-1.5"><span className="font-mono">{r.method} {r.path.replace('/api/v1', '')}</span><span className={r.status >= 400 ? 'text-red-300' : 'text-emerald-300'}>{r.status} · {r.durationMs}ms</span></li>)}</ul> : <p className="text-xs text-zinc-500">No calls yet.</p>}</div>
      </div>
    </Modal>
  );
}

export function WebhookCard() {
  const hook = useApi<any>(`${W}/webhook-endpoint`); const dels = useApi<any>(`${W}/webhook-deliveries`); const toast = useToast();
  const [wh, setWh] = useState<{ url: string; events: string[] } | null>(null); const [secret, setSecret] = useState<string | null>(null);
  const form = wh ?? { url: hook.data?.endpoint?.url ?? '', events: hook.data?.endpoint?.events ?? ['payment.success'] };
  return (<>
    <Card className="space-y-3">
      <h3 className="font-semibold">Webhook endpoint</h3><p className="text-sm text-zinc-400">We send signed JSON here when a payment is paid, fails or expires, and when a payout finishes.</p>
      <Field label="Webhook URL (https)" value={form.url} onChange={(e) => setWh({ ...form, url: e.target.value })} placeholder="https://yourserver.com/webhooks/cafin" />
      <div className="grid gap-2 sm:grid-cols-2">{(hook.data?.availableEvents ?? []).map((ev: string) => <label key={ev} className="flex items-center gap-2 rounded-lg bg-ink-900 p-2 font-mono text-xs"><input type="checkbox" className="accent-orange-500" checked={form.events.includes(ev)} onChange={(e) => setWh({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x: string) => x !== ev) })} />{ev}</label>)}</div>
      {secret && <div className="rounded-xl border border-gold-500/40 bg-gold-500/10 p-3 text-xs"><p className="font-semibold text-gold-300">Signing secret (shown once)</p><p className="mt-1 break-all font-mono">{secret}</p></div>}
      <div className="flex gap-2"><Button onClick={async () => { try { const r = await api<any>(`${W}/webhook-endpoint`, { method: 'PUT', body: { ...form, active: true } }); if (r.secret) setSecret(r.secret); toast('Saved'); hook.reload(); } catch (e) { toast((e as ApiError).message, 'err'); } }}>Save</Button>
        {hook.data?.endpoint && <Button variant="ghost" onClick={async () => { const r = await api<any>(`${W}/webhook-endpoint/rotate-secret`, { method: 'POST', body: {} }); setSecret(r.secret); }}>Rotate secret</Button>}</div>
    </Card>
    <Card><h3 className="mb-3 font-semibold">Delivery history</h3>
      {dels.data?.deliveries.length ? <ul className="divide-y divide-ink-700 text-sm">{dels.data.deliveries.map((d: any) => <li key={d.id} className="flex items-center justify-between gap-2 py-2.5"><div><p className="font-mono text-xs">{d.event}</p><p className="text-xs text-zinc-500">{when(d.createdAt)} · attempts {d.attempts}{d.lastError ? ` · ${d.lastError}` : ''}</p></div><div className="flex items-center gap-2"><Badge status={d.status} />{d.status !== 'PENDING' && <button className="text-xs text-gold-400" onClick={async () => { await api(`${W}/webhook-deliveries/${d.id}/redeliver`, { method: 'POST', body: {} }); dels.reload(); }}>Redeliver</button>}</div></li>)}</ul> : <p className="text-sm text-zinc-500">No deliveries yet.</p>}
    </Card>
  </>);
}
