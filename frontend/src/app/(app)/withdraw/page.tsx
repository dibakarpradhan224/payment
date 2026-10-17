'use client';
import { useRef, useState } from 'react';
import { api, ApiError, newKey, W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { inr, when } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, PageTitle, PinModal, Skeleton, SuccessMark } from '@/components/ui';

export default function Withdraw() {
  const rules = useApi<any>(`${W}/withdrawals/rules`); const list = useApi<any>(`${W}/withdrawals`); const wallet = useApi<any>(`${W}/wallet`);
  const [amount, setAmount] = useState(''); const [upi, setUpi] = useState(''); const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [res, setRes] = useState<any>(null);
  const key = useRef(newKey());

  async function go(pin: string) {
    setBusy(true); setErr('');
    try { const r = await api<any>(`${W}/withdrawals`, { body: { amount, upiId: upi, pin }, idem: key.current }); setRes(r); setPinOpen(false); list.reload(); wallet.reload(); key.current = newKey(); }
    catch (e) { setErr((e as ApiError).message); if ((e as ApiError).code !== 'INVALID_PIN') key.current = newKey(); } finally { setBusy(false); }
  }
  const ok = res?.withdrawal.status === 'SUCCESSFUL', failed = ['REFUNDED', 'FAILED'].includes(res?.withdrawal.status);

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle sub={wallet.data ? `Available: ${inr(wallet.data.available.rupees)}` : undefined}>Withdraw to UPI</PageTitle>
      {res ? (
        <Card className="text-center">{ok ? <SuccessMark /> : <div className="mx-auto mb-2 text-5xl">{failed ? '↩' : '⏳'}</div>}
          <p className="mt-3 text-lg font-semibold">{res.message}</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{res.withdrawal.id}</p>
          <Button className="mt-5 w-full" onClick={() => { setRes(null); setAmount(''); }}>Done</Button></Card>
      ) : (
        <Card className="space-y-4">
          <Field label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} hint={rules.data ? `Min ${inr(rules.data.min.rupees)} · Max ${inr(rules.data.max.rupees)}${Number(rules.data.flatFee.rupees) || rules.data.feeBps ? ' · a fee applies' : ''}` : undefined} />
          <Field label="UPI ID" placeholder="name@bank" autoCapitalize="none" value={upi} onChange={(e) => setUpi(e.target.value.trim())} />
          {err && !pinOpen && <p className="text-sm text-red-400">{err}</p>}
          <Button className="w-full" disabled={!amount || !upi.includes('@')} onClick={() => { setErr(''); setPinOpen(true); }}>Withdraw</Button>
        </Card>
      )}
      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={go} busy={busy} error={err} />
      <Card className="mt-5"><h2 className="mb-3 font-semibold">History</h2>
        {list.loading ? <Skeleton className="h-16" /> : !list.data?.withdrawals.length ? <Empty title="No withdrawals yet" /> : (
          <ul className="divide-y divide-ink-700">{list.data.withdrawals.map((w: any) => <li key={w.id} className="flex items-center justify-between py-3"><div><p className="font-semibold">{inr(w.amount.rupees)} <span className="text-xs font-normal text-zinc-500">→ {w.destination}</span></p><p className="text-xs text-zinc-500">{when(w.createdAt)} · <span className="font-mono">{w.id}</span></p></div><Badge status={w.status} /></li>)}</ul>)}
      </Card>
    </div>
  );
}
