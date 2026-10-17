'use client';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { buildUserQr } from '@/lib/qr';
import { copy, inr, when } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, Modal, PageTitle, Skeleton, useToast } from '@/components/ui';
import { QR } from '@/components/QR';

export default function Receive() {
  const me = useApi<any>(`${W}/receive/me`);
  const reqs = useApi<any>(`${W}/receive/requests`);
  const toast = useToast();
  const [f, setF] = useState({ amount: '', description: '', expiresInMinutes: '60' }); const [busy, setBusy] = useState(false); const [show, setShow] = useState<any>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const r = await api<any>(`${W}/receive/requests`, { body: { amount: f.amount, description: f.description || undefined, expiresInMinutes: Number(f.expiresInMinutes) } }); setShow(r.request); setF({ ...f, amount: '', description: '' }); reqs.reload(); }
    catch (x) { toast((x as ApiError).message, 'err'); } finally { setBusy(false); }
  }
  const share = async (url: string) => { if (navigator.share) { try { await navigator.share({ title: 'Payment request', url }); return; } catch { /* cancelled */ } } toast((await copy(url)) ? 'Link copied' : 'Copy failed'); };

  return (
    <>
      <PageTitle sub="Share your Payment ID or create a payment request.">Receive</PageTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="text-center">
          {me.loading ? <Skeleton className="mx-auto h-56 w-56" /> : (<>
            <p className="text-sm text-zinc-400">{me.data.name ?? 'Your Payment ID'}</p>
            <p className="my-1 font-mono text-2xl font-bold text-gold-300">{me.data.paymentId}</p>
            <QR value={buildUserQr(me.data.paymentId)} name={me.data.paymentId} />
            <div className="mt-3 flex justify-center gap-2"><Button variant="ghost" onClick={async () => toast((await copy(me.data.paymentId)) ? 'Payment ID copied' : 'Copy failed')}>Copy</Button><Button variant="ghost" onClick={() => share(me.data.paymentId)}>Share</Button></div>
          </>)}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">New payment request</h2>
          <form onSubmit={create} className="space-y-3">
            <Field label="Amount (₹)" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
            <Field label="Description" maxLength={120} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <label className="block space-y-1.5"><span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Expires in</span>
              <select value={f.expiresInMinutes} onChange={(e) => setF({ ...f, expiresInMinutes: e.target.value })} className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3 py-2.5"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option></select></label>
            <Button className="w-full" loading={busy} disabled={!f.amount}>Create request</Button>
          </form>
        </Card>
      </div>
      <Card className="mt-5">
        <h2 className="mb-3 font-semibold">Your requests</h2>
        {reqs.loading ? <Skeleton className="h-16" /> : !reqs.data?.requests.length ? <Empty title="No requests yet" /> : (
          <ul className="divide-y divide-ink-700">{reqs.data.requests.map((r: any) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <button className="text-left" onClick={() => setShow(r)}><p className="font-semibold">{inr(r.amount.rupees)} <span className="font-mono text-xs text-zinc-500">{r.id}</span></p><p className="text-xs text-zinc-500">{r.description ?? '—'} · {when(r.createdAt)}</p></button>
              <div className="flex items-center gap-2"><Badge status={r.status} />{r.status === 'PENDING' && <button className="text-xs text-red-300" onClick={async () => { await api(`${W}/receive/requests/${r.id}/cancel`, { method: 'POST', body: {} }).catch((e) => toast(e.message, 'err')); reqs.reload(); }}>Cancel</button>}</div>
            </li>))}</ul>)}
      </Card>
      <Modal open={!!show} onClose={() => setShow(null)} title={show?.id}>
        {show && <div className="space-y-3 text-center"><p className="text-3xl font-extrabold">{inr(show.amount.rupees)}</p><Badge status={show.status} />
          <div><QR value={show.qrPayload} name={show.id} /></div>
          <p className="break-all rounded-lg bg-ink-900 p-2 font-mono text-xs text-zinc-400">{show.paymentUrl}</p>
          <div className="flex gap-2"><Button variant="ghost" className="flex-1" onClick={async () => toast((await copy(show.paymentUrl)) ? 'Link copied' : 'Copy failed')}>Copy link</Button><Button className="flex-1" onClick={() => share(show.paymentUrl)}>Share</Button></div></div>}
      </Modal>
    </>
  );
}
