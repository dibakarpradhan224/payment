'use client';
import { useCallback, useEffect, useState } from 'react';
import { A, api, ApiError } from '@/lib/api';
import { inr, shortDay, when } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, Skeleton, Tabs, useToast } from '@/components/ui';
import { BarChart } from '@/components/Chart';

const TABS = ['Dashboard', 'Users', 'Transactions', 'Deposits', 'Reconciliation', 'Withdrawals', 'Site', 'Settings', 'Risk & API', 'Logs'].map((l) => ({ id: l, label: l }));
const rupees = (paise: string) => Number(BigInt(paise) / 100n);

function useLoad<T = any>(path: string | null, dep: unknown = 0) {
  const [d, setD] = useState<T | null>(null); const [e, setE] = useState(''); const [l, setL] = useState(true);
  const load = useCallback(async () => { if (!path) return; setL(true); try { setD(await api<T>(path)); setE(''); } catch (x) { setE((x as ApiError).message); } finally { setL(false); } }, [path]);
  useEffect(() => { void load(); }, [load, dep]);
  return { d, e, l, load };
}

function Login({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center p-4"><form className="glass w-full max-w-sm space-y-4 rounded-3xl p-8" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api(`${A}/auth/login`, { body: f }); onDone(); } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); } }}>
      <h1 className="text-xl font-bold"><span className="gold-text">Admin</span> sign in</h1>
      <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Field label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {err && <p className="text-sm text-red-400">{err}</p>}<Button className="w-full" loading={busy}>Sign in</Button></form></div>
  );
}

function Dashboard() {
  const s = useLoad<any>(`${A}/dashboard`); const a = useLoad<any>(`${A}/analytics?days=14`);
  if (s.l) return <Skeleton className="h-40" />; if (s.e) return <ErrorBox message={s.e} retry={s.load} />;
  const d = s.d; const stat = (l: string, v: string, sub?: string) => <Card key={l}><p className="text-xs text-zinc-500">{l}</p><p className="text-xl font-bold">{v}</p>{sub && <p className="text-xs text-zinc-500">{sub}</p>}</Card>;
  const series = (type: string, f: 'volume' | 'revenue' = 'volume') => { const m = new Map<string, number>(); (a.d?.series ?? []).filter((r: any) => type === 'ALL' || r.type === type).forEach((r: any) => m.set(r.day, (m.get(r.day) ?? 0) + rupees(r[f]))); return [...m].map(([day, value]) => ({ label: shortDay(day), value })); };
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stat('Users', String(d.totals.users), `${d.totals.activeUsers} active (30d) · +${d.today.newUsers} today`)}{stat('Deposits', inr(d.totals.deposits.volume.rupees), `${d.totals.deposits.count} · today ${inr(d.today.deposits.volume.rupees)}`)}
      {stat('Withdrawals', inr(d.totals.withdrawals.volume.rupees), `${d.totals.withdrawals.count} · today ${inr(d.today.withdrawals.volume.rupees)}`)}{stat('Transfers', inr(d.totals.transfers.volume.rupees), `today ${inr(d.today.transfers.volume.rupees)}`)}
      {stat('Payment volume', inr(d.totals.paymentVolume.volume.rupees))}{stat('Tax & fee revenue', inr(d.totals.revenue.rupees), `today ${inr(d.today.revenue.rupees)}`)}
      {stat('Pending payments', String(d.pending.payments), `${d.pending.reconciliation} awaiting reconciliation`)}{stat('Pending withdrawals', String(d.pending.withdrawals), `${d.failedPayments} failed payments`)}
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <Card><h3 className="mb-2 text-sm font-semibold">Deposits (₹/day)</h3><BarChart data={series('DEPOSIT')} format={(n) => inr(n)} /></Card>
      <Card><h3 className="mb-2 text-sm font-semibold">Withdrawals (₹/day)</h3><BarChart data={series('WITHDRAWAL')} color="#f27d0c" format={(n) => inr(n)} /></Card>
      <Card><h3 className="mb-2 text-sm font-semibold">Transfers (₹/day)</h3><BarChart data={series('TRANSFER')} color="#ffd36b" format={(n) => inr(n)} /></Card>
      <Card><h3 className="mb-2 text-sm font-semibold">Revenue (₹/day)</h3><BarChart data={series('ALL', 'revenue')} color="#34d399" format={(n) => inr(n)} /></Card>
      <Card><h3 className="mb-2 text-sm font-semibold">New users / day</h3><BarChart data={(a.d?.users ?? []).map((u: any) => ({ label: shortDay(u.day), value: u.count }))} color="#60a5fa" /></Card>
      <Card><h3 className="text-sm font-semibold">Pay With UPI success rate (14d)</h3><p className="mt-3 text-4xl font-extrabold text-gold-300">{a.d?.successRate ?? '–'}{a.d?.successRate != null && '%'}</p></Card>
    </div></div>);
}

function Users() {
  const [q, setQ] = useState(''); const [sub, setSub] = useState(''); const u = useLoad<any>(`${A}/users?limit=30${sub ? `&q=${encodeURIComponent(sub)}` : ''}`); const [sel, setSel] = useState<string | null>(null);
  const det = useLoad<any>(sel ? `${A}/users/${sel}` : null); const toast = useToast(); const [reason, setReason] = useState('');
  const act = async (action: string) => { try { await api(`${A}/users/${sel}/action`, { body: { action, reason } }); toast('Done'); det.load(); u.load(); } catch (e) { toast((e as ApiError).message, 'err'); } };
  return (<>
    <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSub(q); }}><div className="flex-1"><Field placeholder="Email, mobile, Payment ID or user ID" value={q} onChange={(e) => setQ(e.target.value)} /></div><Button>Search</Button></form>
    <Card>{u.l ? <Skeleton className="h-32" /> : u.e ? <ErrorBox message={u.e} /> : !u.d.users.length ? <Empty title="No users" /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="py-2">Email</th><th>Payment ID</th><th>Balance</th><th>Status</th><th>Joined</th></tr></thead><tbody className="divide-y divide-ink-700">
      {u.d.users.map((x: any) => <tr key={x.id} className="cursor-pointer hover:bg-ink-700/30" onClick={() => setSel(x.id)}><td className="py-2.5">{x.email}</td><td className="font-mono text-xs">{x.paymentId}</td><td>{inr(x.balance.rupees)}{x.frozen && ' ❄'}</td><td><Badge status={x.status} /></td><td className="text-xs text-zinc-500">{when(x.createdAt)}</td></tr>)}</tbody></table></div>}</Card>
    <Modal open={!!sel} onClose={() => setSel(null)} title="User">
      {det.l || !det.d ? <Skeleton className="h-40" /> : <div className="max-h-[70vh] space-y-3 overflow-auto text-sm">
        <p><b>{det.d.user.email}</b> · {det.d.user.mobile} · <span className="font-mono">{det.d.user.paymentId}</span></p>
        <p>Balance {inr(det.d.wallet.available.rupees)} · deposited {inr(det.d.wallet.totalDeposited.rupees)} · withdrawn {inr(det.d.wallet.totalWithdrawn.rupees)} · transferred {inr(det.d.wallet.totalTransferred.rupees)} {det.d.wallet.frozen && <Badge status="FAILED" />}</p>
        <p className="text-zinc-400">API: {det.d.api.activeToken ? `${det.d.api.activeToken.prefix}… (${det.d.api.callsLast24h} calls/24h)` : 'no token'} · Sessions: {det.d.sessions.map((s: any) => s.ip).join(', ') || '–'}</p>
        {det.d.riskFlags.length > 0 && <div className="rounded-lg bg-amber-500/10 p-2 text-amber-200">Risk: {det.d.riskFlags.map((f: any) => `${f.type} (${f.status})`).join(', ')}</div>}
        <div><p className="mb-1 text-xs text-zinc-500">Recent transactions</p>{det.d.transactions.slice(0, 6).map((t: any) => <p key={t.id} className="font-mono text-xs">{t.id} {t.type} {t.direction === 'CREDIT' ? '+' : '−'}{t.net.rupees} {t.status}</p>)}</div>
        <Field label="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex flex-wrap gap-2">{[['suspend', 'Suspend'], ['unsuspend', 'Unsuspend'], ['freeze', 'Freeze wallet'], ['unfreeze', 'Unfreeze'], ['reset-pin', 'Reset PIN (super admin)']].map(([a, l]) => <Button key={a} variant="ghost" disabled={reason.trim().length < 3} onClick={() => act(a!)}>{l}</Button>)}</div></div>}
    </Modal></>);
}

function Transactions() {
  const [q, setQ] = useState(''); const [sub, setSub] = useState(''); const t = useLoad<any>(`${A}/transactions?limit=40${sub ? `&q=${encodeURIComponent(sub)}` : ''}`); const toast = useToast();
  const refund = async (id: string) => { const reason = prompt('Reason for refund?'); if (!reason) return; try { await api(`${A}/transactions/${id}/refund`, { body: { reason } }); toast('Refunded'); t.load(); } catch (e) { toast((e as ApiError).message, 'err'); } };
  return (<>
    <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSub(q); }}><div className="flex-1"><Field placeholder="User ID, email, mobile, txn ID, bank transaction ID, PAY-/REQ-/WDR-/DEP- ID, provider ref" value={q} onChange={(e) => setQ(e.target.value)} /></div><Button>Search</Button></form>
    <Card>{t.l ? <Skeleton className="h-32" /> : t.e ? <ErrorBox message={t.e} /> : !t.d.transactions.length ? <Empty title="No results" /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase text-zinc-500"><tr><th className="py-2">Txn</th><th>User</th><th>Type</th><th>Amount</th><th>Tax/Fee</th><th>Status</th><th>Provider ref</th><th>Date</th><th /></tr></thead><tbody className="divide-y divide-ink-700">
      {t.d.transactions.map((x: any) => <tr key={x.id}><td className="py-2 font-mono">{x.id}</td><td>{x.email}</td><td>{x.type}</td><td>{x.direction === 'CREDIT' ? '+' : '−'}{x.net.rupees}</td><td>{x.tax.rupees}/{x.fee.rupees}</td><td><Badge status={x.status} /></td><td className="max-w-[8rem] truncate font-mono">{x.providerReference ?? '–'}</td><td className="whitespace-nowrap text-zinc-500">{when(x.createdAt)}</td>
        <td>{x.direction === 'DEBIT' && ['PROCESSING', 'PENDING', 'FAILED', 'MANUAL_REVIEW'].includes(x.status) && <button className="text-gold-400" onClick={() => refund(x.id)}>Refund</button>}</td></tr>)}</tbody></table></div>}</Card></>);
}

function Reconciliation() {
  const r = useLoad<any>(`${A}/reconciliation`); const toast = useToast(); const [bc, setBc] = useState({ utr: '', amount: '', payeeUpi: '', note: '' });
  const resolve = async (id: string, action: string) => { const note = prompt(`Note for ${action}?`); if (!note) return; try { await api(`${A}/reconciliation/${id}/resolve`, { body: { action, note } }); toast('Resolved'); r.load(); } catch (e) { toast((e as ApiError).message, 'err'); } };
  return (<>
    <Card><h3 className="mb-2 font-semibold">Enter a verified bank credit</h3><p className="mb-3 text-xs text-zinc-500">From your bank statement. Pay With UPI orders (matched by the DEP- note or exact amount) and waiting Transaction ID submissions are credited automatically.</p>
      <div className="grid gap-2 sm:grid-cols-4"><Field placeholder="Bank transaction ID" value={bc.utr} onChange={(e) => setBc({ ...bc, utr: e.target.value })} /><Field placeholder="Amount ₹" value={bc.amount} onChange={(e) => setBc({ ...bc, amount: e.target.value })} /><Field placeholder="Payee UPI (optional)" value={bc.payeeUpi} onChange={(e) => setBc({ ...bc, payeeUpi: e.target.value })} /><Field placeholder="Note (optional)" value={bc.note} onChange={(e) => setBc({ ...bc, note: e.target.value })} /></div>
      <Button className="mt-3" onClick={async () => { try { await api(`${A}/reconciliation/bank-credits`, { body: { ...bc, payeeUpi: bc.payeeUpi || undefined, note: bc.note || undefined } }); toast('Recorded'); setBc({ utr: '', amount: '', payeeUpi: '', note: '' }); r.load(); } catch (e) { toast((e as ApiError).message, 'err'); } }}>Record credit</Button></Card>
    <Card className="mt-4"><h3 className="mb-2 font-semibold">Open cases</h3>{r.l ? <Skeleton className="h-24" /> : r.e ? <ErrorBox message={r.e} /> : !r.d.cases.length ? <Empty title="Queue is clear" /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase text-zinc-500"><tr><th className="py-2">Transaction ID</th><th>User</th><th>Claimed</th><th>Bank</th><th>Reason</th><th>Submitted</th><th /></tr></thead><tbody className="divide-y divide-ink-700">
      {r.d.cases.map((c: any) => <tr key={c.id}><td className="py-2 font-mono">{c.utr}</td><td>{c.user.email}</td><td>{inr(c.amount.rupees)}</td><td>{c.providerAmount ? inr(c.providerAmount.rupees) : <span className="text-zinc-600">no record</span>}</td><td><Badge status="MANUAL_REVIEW" /> <span className="text-zinc-400">{c.reason}</span></td><td className="text-zinc-500">{when(c.submittedAt)}</td>
        <td className="whitespace-nowrap"><button className="mr-3 text-emerald-300" onClick={() => resolve(c.id, 'VERIFY')}>Verify</button><button className="text-red-300" onClick={() => resolve(c.id, 'REJECT')}>Reject</button></td></tr>)}</tbody></table></div>}</Card></>);
}

function Withdrawals() {
  const w = useLoad<any>(`${A}/withdrawals`); const toast = useToast();
  const resolve = async (id: string, action: string) => { const note = prompt(`Note for ${action}?`); if (!note) return; try { await api(`${A}/withdrawals/${id}/resolve`, { body: { action, note } }); toast('Resolved'); w.load(); } catch (e) { toast((e as ApiError).message, 'err'); } };
  return <Card>{w.l ? <Skeleton className="h-24" /> : w.e ? <ErrorBox message={w.e} /> : !w.d.withdrawals.length ? <Empty title="No open withdrawals" /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase text-zinc-500"><tr><th className="py-2">ID</th><th>User</th><th>Amount</th><th>UPI</th><th>Status</th><th>Attempts</th><th>Provider ref</th><th /></tr></thead><tbody className="divide-y divide-ink-700">
    {w.d.withdrawals.map((x: any) => <tr key={x.id}><td className="py-2 font-mono">{x.id}</td><td>{x.email}</td><td>{inr(x.amount.rupees)}</td><td className="font-mono">{x.destinationFull}</td><td><Badge status={x.status} /></td><td>{x.attempts}</td><td className="font-mono">{x.providerRef ?? '–'}</td>
      <td className="whitespace-nowrap">{['PROCESSING', 'MANUAL_REVIEW', 'FAILED'].includes(x.status) && <><button className="mr-3 text-emerald-300" onClick={() => resolve(x.id, 'MARK_SUCCESS')}>Mark paid</button><button className="text-red-300" onClick={() => resolve(x.id, 'REFUND')}>Refund</button></>}</td></tr>)}</tbody></table></div>}
    <p className="mt-3 text-xs text-zinc-500">Only mark a withdrawal paid after confirming the payout really left your provider account. A refund returns funds to the user&apos;s wallet exactly once.</p></Card>;
}

const PAYOUT_TEMPLATE = `{
  "method": "GET",
  "url": "https://provider.example.com/api.php?token={token}&paytm={destination}&amount={amount}&comment=Payout",
  "headers": {},
  "timeoutMs": 15000,
  "success": { "path": "status", "equals": ["success", "SUCCESS", true] },
  "failure": { "path": "status", "equals": ["failed", "error", false] },
  "referencePath": "txn_id",
  "status": null,
  "secrets": { "token": "" }
}`;
const toR = (p: string) => String(Number(p) / 100);
const toP = (r: string) => String(Math.round(Number(r) * 100));
const Check = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) => (
  <label className="flex items-start justify-between gap-3 py-2 text-sm"><span><span className="block">{label}</span>{hint && <span className="block text-xs text-zinc-500">{hint}</span>}</span>
    <input type="checkbox" className="mt-0.5 h-5 w-5 accent-orange-500" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>);

function useSave(reload: () => void) {
  const toast = useToast();
  return async (path: string, body: unknown, ok = 'Saved') => { try { await api(`${A}/settings/${path}`, { method: 'PUT', body }); toast(ok); reload(); } catch (e) { toast((e as ApiError).message ?? 'Could not save', 'err'); } };
}

function LimitsForm({ d, save }: { d: any; save: ReturnType<typeof useSave> }) {
  const [f, setF] = useState({ dMin: toR(d.deposit.minPaise), dMax: toR(d.deposit.maxPaise), wMin: toR(d.withdraw.minPaise), wMax: toR(d.withdraw.maxPaise), flat: toR(d.withdraw.flatFeePaise), pct: String(d.withdraw.feeBps / 100) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') });
  return (<div className="space-y-4">
    <div><h3 className="mb-2 font-semibold">Add money limits (₹)</h3><div className="grid gap-3 sm:grid-cols-2"><Field label="Minimum" value={f.dMin} onChange={set('dMin')} /><Field label="Maximum" value={f.dMax} onChange={set('dMax')} /></div>
      <Button className="mt-3" onClick={() => save('deposit', { minPaise: toP(f.dMin), maxPaise: toP(f.dMax) })}>Save deposit limits</Button></div>
    <div><h3 className="mb-2 font-semibold">Withdrawal rules</h3><div className="grid gap-3 sm:grid-cols-2"><Field label="Minimum withdrawal (₹)" value={f.wMin} onChange={set('wMin')} /><Field label="Maximum withdrawal (₹)" value={f.wMax} onChange={set('wMax')} />
      <Field label="Flat fee (₹)" value={f.flat} onChange={set('flat')} /><Field label="Percent fee (%)" value={f.pct} onChange={set('pct')} /></div>
      <Button className="mt-3" onClick={() => save('withdraw', { minPaise: toP(f.wMin), maxPaise: toP(f.wMax), flatFeePaise: toP(f.flat), feeBps: Math.round(Number(f.pct) * 100) })}>Save withdrawal rules</Button></div></div>);
}

function TaxForm({ d, save }: { d: any; save: ReturnType<typeof useSave> }) {
  const [rows, setRows] = useState<{ upTo: string; rate: string }[]>(d.tax.map((s: any) => ({ upTo: s.upToPaise ? toR(s.upToPaise) : '', rate: String(s.rateBps / 100) })));
  const upd = (i: number, k: 'upTo' | 'rate', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v.replace(/[^\d.]/g, '') } : r)));
  return (<div className="space-y-3"><p className="text-xs text-zinc-500">Deposit tax by amount. The last row has no upper limit. Changing tax only affects future deposits.</p>
    {rows.map((r, i) => <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"><Field label={i === 0 ? 'Up to (₹)' : undefined} placeholder={i === rows.length - 1 ? 'No limit' : ''} disabled={i === rows.length - 1} value={i === rows.length - 1 ? '' : r.upTo} onChange={(e) => upd(i, 'upTo', e.target.value)} />
      <Field label={i === 0 ? 'Tax (%)' : undefined} value={r.rate} onChange={(e) => upd(i, 'rate', e.target.value)} />
      <button className="mb-2 text-xs text-red-300 disabled:opacity-30" disabled={rows.length < 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></div>)}
    <div className="flex gap-2"><Button variant="ghost" onClick={() => setRows([...rows.slice(0, -1), { upTo: '', rate: '1' }, rows[rows.length - 1]!])}>Add slab</Button>
      <Button onClick={() => save('tax', { slabs: rows.map((r, i) => ({ upToPaise: i === rows.length - 1 ? null : toP(r.upTo), rateBps: Math.round(Number(r.rate) * 100) })) })}>Save tax slabs</Button></div></div>);
}

function UpiForm({ d, save }: { d: any; save: ReturnType<typeof useSave> }) {
  const [f, setF] = useState({ upiId: d.upi.upiId ?? '', name: d.upi.name ?? '', instructions: d.upi.instructions ?? '', autoMatchByAmount: d.upi.autoMatchByAmount !== false });
  return (<div className="space-y-3"><p className="text-xs text-zinc-500">Money from &quot;Pay With UPI&quot; goes to this UPI ID. Wallets are credited when your bank feed (<span className="font-mono">POST /webhooks/bank</span>) reports the payment.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Receiving UPI ID" placeholder="yourname@bank" autoCapitalize="none" value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value.trim() })} /><Field label="Name shown in the UPI app" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
    <Field label="Note shown to users (optional)" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
    <Check label="Match payments without a reference by exact amount" hint="If the UPI app drops the DEP- note, credit the one open order with exactly that amount. Two orders with the same amount are never guessed; they wait for review." checked={f.autoMatchByAmount} onChange={(v) => setF({ ...f, autoMatchByAmount: v })} />
    <Button onClick={() => save('upi', { ...f, instructions: f.instructions || undefined })}>Save UPI settings</Button></div>);
}

function Payout({ d, save }: { d: any; save: ReturnType<typeof useSave> }) {
  const toast = useToast(); const [text, setText] = useState(JSON.stringify(d.payout ? { ...d.payout, secrets: { token: '', secret: '' } } : JSON.parse(PAYOUT_TEMPLATE), null, 2)); const [preview, setPreview] = useState<any>(null);
  return (<div className="space-y-3"><p className="text-xs text-zinc-500">Payout provider used for withdrawals and UPI payouts. Secrets are encrypted at rest; leave a secret blank to keep the stored one.</p>
    <textarea className="h-72 w-full rounded-xl border border-ink-600 bg-ink-900 p-3 font-mono text-xs outline-none focus:border-gold-500" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
    <div className="flex gap-2"><Button onClick={() => { try { void save('payout', JSON.parse(text)); } catch { toast('Invalid JSON', 'err'); } }}>Save payout</Button>
      <Button variant="ghost" onClick={async () => { try { setPreview((await api<any>(`${A}/settings/payout/test`, { body: JSON.parse(text) })).preview); } catch (e) { toast((e as ApiError).message ?? 'Invalid JSON', 'err'); } }}>Test (no money moves)</Button></div>
    {preview && <pre className="overflow-x-auto rounded-xl bg-black/50 p-3 text-xs text-emerald-200">{JSON.stringify(preview, null, 2)}</pre>}</div>);
}

function SettingsTab() {
  const s = useLoad<any>(`${A}/settings`); const save = useSave(s.load); const [sec, setSec] = useState('limits');
  if (s.l && !s.d) return <Skeleton className="h-40" />; if (s.e || !s.d) return <ErrorBox message={s.e} retry={s.load} />;
  return (<Card className="space-y-4"><Tabs tabs={[{ id: 'limits', label: 'Limits & fees' }, { id: 'tax', label: 'Tax' }, { id: 'upi', label: 'UPI receiving' }, { id: 'payout', label: 'Payout provider' }]} value={sec} onChange={setSec} />
    <p className="text-xs text-zinc-500">Amounts here are in rupees.</p>
    {sec === 'limits' && <LimitsForm d={s.d} save={save} />}{sec === 'tax' && <TaxForm d={s.d} save={save} />}{sec === 'upi' && <UpiForm d={s.d} save={save} />}{sec === 'payout' && <Payout d={s.d} save={save} />}</Card>);
}

const FEATURES: [string, string, string][] = [
  ['registrations', 'New sign-ups', 'People can create new accounts'], ['deposits', 'Add money', 'Pay With UPI and Transaction ID deposits'], ['withdrawals', 'Withdrawals', 'Withdraw to UPI (web, Telegram and API)'],
  ['transfers', 'Wallet transfers', 'Send money to other wallets (web and API)'], ['payments', 'Payment requests / QR payments', 'Merchant payment links and QR pay'], ['api', 'Payout & Merchant API', 'All API token calls'],
];
function SiteTab() {
  const s = useLoad<any>(`${A}/settings`); const save = useSave(s.load);
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (s.d) setF(s.d.site); }, [s.d]);
  if (!f) return s.e ? <ErrorBox message={s.e} retry={s.load} /> : <Skeleton className="h-40" />;
  const up = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (<div className="space-y-4">
    <Card className="space-y-3"><h3 className="font-semibold">Maintenance mode</h3>
      <Check label="Turn maintenance mode on" hint="Blocks every money action (add money, withdraw, send, pay, API). People can still log in and see their balance." checked={f.maintenance.enabled} onChange={(v) => up('maintenance', { ...f.maintenance, enabled: v })} />
      <Field label="Message shown to users" value={f.maintenance.message} onChange={(e) => up('maintenance', { ...f.maintenance, message: e.target.value })} /></Card>
    <Card className="space-y-1"><h3 className="mb-1 font-semibold">Feature switches</h3>
      {FEATURES.map(([k, l, h]) => <Check key={k} label={l} hint={h} checked={f.features[k]} onChange={(v) => up('features', { ...f.features, [k]: v })} />)}</Card>
    <Card className="space-y-3"><h3 className="font-semibold">Announcement banner</h3>
      <Check label="Show a banner at the top of the website" checked={f.announcement.enabled} onChange={(v) => up('announcement', { ...f.announcement, enabled: v })} />
      <Field label="Text" value={f.announcement.text} onChange={(e) => up('announcement', { ...f.announcement, text: e.target.value })} />
      <div className="flex gap-2 text-xs">{['info', 'warn', 'success'].map((t) => <button key={t} onClick={() => up('announcement', { ...f.announcement, tone: t })} className={`rounded-lg border px-3 py-1.5 ${f.announcement.tone === t ? 'border-gold-500 text-gold-300' : 'border-ink-600 text-zinc-400'}`}>{t}</button>)}</div></Card>
    <Card className="space-y-3"><h3 className="font-semibold">Website details</h3>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Site name" value={f.name} onChange={(e) => up('name', e.target.value)} /><Field label="Tagline" value={f.tagline} onChange={(e) => up('tagline', e.target.value)} />
        <Field label="Support email" value={f.supportEmail} onChange={(e) => up('supportEmail', e.target.value)} /><Field label="Support Telegram" placeholder="@username" value={f.supportTelegram} onChange={(e) => up('supportTelegram', e.target.value)} /></div></Card>
    <Button className="w-full" onClick={() => save('site', f)}>Save site settings</Button></div>);
}

function Deposits() {
  const [st, setSt] = useState('all'); const o = useLoad<any>(`${A}/deposits?status=${st}&limit=50`); const bc = useLoad<any>(`${A}/bank-credits`); const toast = useToast();
  const settle = async (ref: string) => { const transactionId = prompt('Bank transaction ID (UTR) from your statement?'); if (!transactionId) return; const note = prompt('Note?') ?? ''; if (note.length < 3) return toast('A note of 3+ characters is required', 'err'); try { await api(`${A}/deposits/${ref}/settle`, { body: { transactionId, note } }); toast('Credited'); o.load(); bc.load(); } catch (e) { toast((e as ApiError).message, 'err'); } };
  const cancel = async (ref: string) => { try { await api(`${A}/deposits/${ref}/cancel`, { method: 'POST', body: {} }); toast('Cancelled'); o.load(); } catch (e) { toast((e as ApiError).message, 'err'); } };
  return (<div className="space-y-4">
    <Card><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">Pay With UPI orders</h3><Tabs tabs={['all', 'CREATED', 'PAID', 'EXPIRED'].map((id) => ({ id, label: id === 'CREATED' ? 'waiting' : id.toLowerCase() }))} value={st} onChange={setSt} /></div>
      {o.l ? <Skeleton className="h-24" /> : o.e ? <ErrorBox message={o.e} /> : !o.d.orders.length ? <Empty title="No orders" /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase text-zinc-500"><tr><th className="py-2">Order</th><th>User</th><th>Amount</th><th>Status</th><th>Bank txn ID</th><th>Created</th><th /></tr></thead><tbody className="divide-y divide-ink-700">
        {o.d.orders.map((x: any) => <tr key={x.ref}><td className="py-2 font-mono">{x.ref}</td><td>{x.email}</td><td>{inr(x.amount.rupees)}</td><td><Badge status={x.status} /></td><td className="font-mono">{x.bankUtr ?? '–'}</td><td className="whitespace-nowrap text-zinc-500">{when(x.createdAt)}</td>
          <td className="whitespace-nowrap">{x.status !== 'PAID' && <button className="mr-3 text-emerald-300" onClick={() => settle(x.ref)}>Mark paid</button>}{x.status === 'CREATED' && <button className="text-red-300" onClick={() => cancel(x.ref)}>Cancel</button>}</td></tr>)}</tbody></table></div>}
      <p className="mt-3 text-xs text-zinc-500">Orders are credited automatically when the bank feed reports the payment. Use &quot;Mark paid&quot; only after you see the money in your bank statement.</p></Card>
    <Card><h3 className="mb-2 font-semibold">Recent bank credits</h3>{bc.d?.credits.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="uppercase text-zinc-500"><tr><th className="py-2">Transaction ID</th><th>Amount</th><th>Note</th><th>Source</th><th>Received</th><th>Credited</th></tr></thead><tbody className="divide-y divide-ink-700">
      {bc.d.credits.map((c: any) => <tr key={c.id}><td className="py-2 font-mono">{c.utr}</td><td>{inr(c.amount.rupees)}</td><td className="max-w-[10rem] truncate">{c.note ?? '–'}</td><td>{c.source}</td><td className="whitespace-nowrap text-zinc-500">{when(c.receivedAt)}</td><td>{c.credited ? <span className="text-emerald-300">yes</span> : <span className="text-amber-300">not yet</span>}</td></tr>)}</tbody></table></div> : <Empty title="No bank credits received yet" hint="Send them to POST /webhooks/bank, or enter one under Reconciliation." />}</Card></div>);
}

function RiskApi() {
  const f = useLoad<any>(`${A}/risk-flags`); const t = useLoad<any>(`${A}/api-tokens`); const toast = useToast();
  return (<div className="space-y-4"><Card><h3 className="mb-2 font-semibold">Open risk flags</h3><p className="mb-2 text-xs text-zinc-500">Flags never block or take funds; they ask for a human look.</p>
    {f.d?.flags.length ? <ul className="divide-y divide-ink-700 text-sm">{f.d.flags.map((x: any) => <li key={x.id} className="flex items-center justify-between gap-2 py-2"><div><p className="font-mono text-xs">{x.type}</p><p className="text-xs text-zinc-500">{x.user.email} · {x.detail} · {when(x.createdAt)}</p></div><div className="flex gap-3 text-xs"><button className="text-emerald-300" onClick={async () => { await api(`${A}/risk-flags/${x.id}`, { body: { status: 'REVIEWED' } }); f.load(); }}>Reviewed</button><button className="text-zinc-400" onClick={async () => { await api(`${A}/risk-flags/${x.id}`, { body: { status: 'DISMISSED' } }); f.load(); }}>Dismiss</button></div></li>)}</ul> : <Empty title="No open flags" />}</Card>
    <Card><h3 className="mb-2 font-semibold">Active API tokens</h3>{t.d?.tokens.length ? <ul className="divide-y divide-ink-700 text-sm">{t.d.tokens.map((x: any) => <li key={x.id} className="flex items-center justify-between py-2"><div><p className="font-mono text-xs">{x.prefix}… · {x.email}</p><p className="text-xs text-zinc-500">{x.scopes.join(', ')} · last used {x.lastUsedAt ? when(x.lastUsedAt) : 'never'}</p></div><button className="text-xs text-red-300" onClick={async () => { await api(`${A}/api-tokens/${x.id}/revoke`, { method: 'POST', body: {} }); toast('Revoked'); t.load(); }}>Revoke</button></li>)}</ul> : <Empty title="No active tokens" />}</Card></div>);
}

function Logs() {
  const [act, setAct] = useState(''); const [sub, setSub] = useState(''); const a = useLoad<any>(`${A}/audit-logs?limit=50${sub ? `&action=${encodeURIComponent(sub)}` : ''}`); const w = useLoad<any>(`${A}/webhook-logs`);
  return (<div className="space-y-4"><Card><form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSub(act); }}><div className="flex-1"><Field placeholder="Filter by action prefix, e.g. auth. or admin." value={act} onChange={(e) => setAct(e.target.value)} /></div><Button>Filter</Button></form>
    <div className="max-h-96 overflow-auto"><table className="w-full text-left text-xs"><tbody className="divide-y divide-ink-700">{a.d?.logs.map((l: any) => <tr key={l.id}><td className="py-1.5 text-zinc-500">{when(l.createdAt)}</td><td className="font-mono">{l.action}</td><td className={l.result === 'SUCCESS' ? 'text-emerald-300' : 'text-red-300'}>{l.result}</td><td className="font-mono text-zinc-500">{l.actorType}:{l.actorId?.slice(0, 8)}</td><td className="text-zinc-500">{l.ip}</td></tr>)}</tbody></table></div></Card>
    <Card><h3 className="mb-2 font-semibold">Webhook logs</h3><div className="grid gap-4 md:grid-cols-2"><div><p className="mb-1 text-xs text-zinc-500">Provider events received</p>{w.d?.providerEvents.map((e: any) => <p key={e.id} className="font-mono text-xs">{e.provider} {e.eventType} <span className="text-zinc-600">{when(e.processedAt)}</span></p>)}</div>
      <div><p className="mb-1 text-xs text-zinc-500">Merchant deliveries</p>{w.d?.merchantDeliveries.map((e: any) => <p key={e.id} className="font-mono text-xs"><Badge status={e.status} /> {e.event} #{e.attempts}</p>)}</div></div></Card></div>);
}

export default function Admin() {
  const [me, setMe] = useState<any>(undefined); const [tab, setTab] = useState('Dashboard');
  const check = useCallback(async () => { try { setMe((await api<any>(`${A}/auth/me`)).admin); } catch { setMe(null); } }, []);
  useEffect(() => { void check(); }, [check]);
  if (me === undefined) return <div className="p-8"><Skeleton className="h-10" /></div>;
  if (!me) return <Login onDone={check} />;
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between"><h1 className="text-xl font-extrabold"><span className="gold-text">Cafin</span> Pay admin</h1><div className="flex items-center gap-3 text-sm text-zinc-400"><span>{me.email} · {me.role}</span><Button variant="ghost" onClick={async () => { await api(`${A}/auth/logout`, { method: 'POST', body: {} }); setMe(null); }}>Sign out</Button></div></div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="mt-4">{{ Dashboard: <Dashboard />, Users: <Users />, Transactions: <Transactions />, Deposits: <Deposits />, Reconciliation: <Reconciliation />, Withdrawals: <Withdrawals />, Site: <SiteTab />, Settings: <SettingsTab />, 'Risk & API': <RiskApi />, Logs: <Logs /> }[tab]}</div>
    </div>
  );
}
