'use client';
import { useRef, useState } from 'react';
import { api, ApiError, newKey, W } from '@/lib/api';
import { inr, when } from '@/lib/format';
import { Badge, Button, Card, PinModal, SuccessMark } from './ui';

/** Shows a payment request (from QR or link) and pays it. All checks are repeated by the server at pay time. */
export function PayRequest({ request, onDone }: { request: any; onDone?: () => void }) {
  const [pinOpen, setPinOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<any>(null);
  const key = useRef(newKey());
  const payable = request.status === 'PENDING';
  async function pay(pin: string) {
    setBusy(true); setErr('');
    try { const r = await api<any>(`${W}/pay/request`, { body: { requestId: request.id, pin }, idem: key.current }); setDone(r); setPinOpen(false); onDone?.(); }
    catch (e) { setErr((e as ApiError).message); if (!['INVALID_PIN'].includes((e as ApiError).code)) key.current = newKey(); } finally { setBusy(false); }
  }
  if (done) return <Card className="text-center"><SuccessMark /><p className="mt-4 text-xl font-bold">{inr(request.amount.rupees)} paid</p><p className="text-sm text-zinc-400">Transaction {done.transaction.id}</p></Card>;
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Payment request</h2><Badge status={request.status} /></div>
      <p className="text-center text-4xl font-extrabold">{inr(request.amount.rupees)}</p>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-zinc-500">To</dt><dd>{request.recipient.displayName} <span className="font-mono text-xs text-zinc-500">{request.recipient.paymentId}</span></dd></div>
        {request.description && <div className="flex justify-between"><dt className="text-zinc-500">For</dt><dd>{request.description}</dd></div>}
        <div className="flex justify-between"><dt className="text-zinc-500">Request</dt><dd className="font-mono text-xs">{request.id}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-500">Expires</dt><dd>{when(request.expiresAt)}</dd></div>
      </dl>
      {!payable && <p className="rounded-xl bg-ink-900 p-3 text-center text-sm text-zinc-400">{request.status === 'PAID' ? 'This request has already been paid.' : `This request is ${request.status.toLowerCase()} and can no longer be paid.`}</p>}
      {err && !pinOpen && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" disabled={!payable} onClick={() => { setErr(''); setPinOpen(true); }}>Pay {inr(request.amount.rupees)}</Button>
      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={pay} busy={busy} error={err} />
    </Card>
  );
}
