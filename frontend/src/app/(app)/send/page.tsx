'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, ApiError, newKey, W } from '@/lib/api';
import { inr } from '@/lib/format';
import { Button, Card, Field, Modal, PageTitle, PinModal, SuccessMark } from '@/components/ui';

function Send() {
  const sp = useSearchParams();
  const [to, setTo] = useState(sp.get('to') ?? ''); const [amount, setAmount] = useState(sp.get('amount') ?? ''); const [note, setNote] = useState('');
  const [rcpt, setRcpt] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false); const [pinOpen, setPinOpen] = useState(false); const [done, setDone] = useState<any>(null);
  const key = useRef(newKey());

  useEffect(() => { if (sp.get('to')) void lookup(sp.get('to')!); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function lookup(v = to) {
    setErr(''); setRcpt(null);
    try { setRcpt((await api<any>(`${W}/transfers/resolve`, { body: { to: v } })).recipient); } catch (e) { setErr((e as ApiError).message); }
  }
  async function send(pin: string) {
    setBusy(true); setErr('');
    try { setDone(await api<any>(`${W}/transfers`, { body: { to: rcpt.paymentId, amount, pin, description: note || undefined }, idem: key.current })); setPinOpen(false); setConfirm(false); }
    catch (e) { setErr((e as ApiError).message); if ((e as ApiError).code !== 'INVALID_PIN') key.current = newKey(); } finally { setBusy(false); }
  }

  if (done) return <div className="mx-auto max-w-md"><Card className="text-center"><SuccessMark /><p className="mt-4 text-2xl font-bold">{inr(done.transaction.amount.rupees)} sent</p><p className="text-sm text-zinc-400">to {done.recipient.paymentId}</p><p className="mt-1 font-mono text-xs text-zinc-500">{done.transaction.id}</p>
    <Button className="mt-5 w-full" onClick={() => { setDone(null); setAmount(''); setTo(''); setRcpt(null); key.current = newKey(); }}>Send another</Button></Card></div>;
  return (
    <div className="mx-auto max-w-md">
      <PageTitle sub="Send to a Payment ID, email or mobile number.">Send money</PageTitle>
      <Card className="space-y-4">
        <div className="flex gap-2"><div className="flex-1"><Field label="Recipient" placeholder="PAY-XXXXXXXX, email or mobile" value={to} onChange={(e) => { setTo(e.target.value); setRcpt(null); }} /></div><Button variant="ghost" className="self-end" onClick={() => lookup()} disabled={to.length < 3}>Find</Button></div>
        {rcpt && <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 p-3 text-sm"><p className="font-semibold">{rcpt.displayName}</p><p className="font-mono text-xs text-zinc-400">{rcpt.paymentId}</p></div>}
        <Field label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        <Field label="Note (optional)" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        {err && !pinOpen && <p className="text-sm text-red-400">{err}</p>}
        <Button className="w-full" disabled={!rcpt || !amount} onClick={() => setConfirm(true)}>Review</Button>
      </Card>
      <Modal open={confirm && !pinOpen} onClose={() => setConfirm(false)} title="Confirm transfer">
        <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-zinc-500">To</dt><dd className="text-right"><span className="block font-semibold">{rcpt?.displayName}</span><span className="font-mono text-xs text-zinc-500">{rcpt?.paymentId}</span></dd></div><div className="flex justify-between"><dt className="text-zinc-500">Amount</dt><dd className="text-lg font-bold">{inr(amount || 0)}</dd></div></dl>
        <Button className="mt-5 w-full" onClick={() => { setErr(''); setPinOpen(true); }}>Enter PIN to send</Button>
      </Modal>
      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={send} busy={busy} error={err} />
    </div>
  );
}
export default function Page() { return <Suspense><Send /></Suspense>; }
