'use client';
import { useParams, useRouter } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { W } from '@/lib/api';
import { inr, when } from '@/lib/format';
import { Badge, Button, ErrorBox, PageTitle, Skeleton } from '@/components/ui';

export default function Receipt() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const r = useApi<any>(`${W}/transactions/${id}/receipt`);
  const t = r.data?.receipt;
  const rows: [string, React.ReactNode][] = t ? [
    ['Transaction ID', <span key="i" className="font-mono">{t.id}</span>], ['Status', <Badge key="s" status={t.status} />], ['Type', t.type],
    ['Amount', inr(t.amount.rupees)], ['Fee', inr(t.fee.rupees)], ['Tax', `${inr(t.tax.rupees)}${t.taxRatePercent ? ` (${t.taxRatePercent}%)` : ''}`],
    [t.direction === 'CREDIT' ? 'Net credited' : 'Net debited', <b key="n">{inr(t.net.rupees)}</b>],
    ['Sender', `${t.sender.name} (${t.sender.paymentId})`], ['Receiver', `${t.receiver.name} (${t.receiver.paymentId})`], ['Payment method', t.paymentMethod],
    ['Provider reference', t.providerReference ?? '—'], ['Reference', t.reference ?? '—'], ['Date & time', when(t.createdAt)],
  ] : [];
  return (
    <div className="mx-auto max-w-lg">
      <div className="no-print"><PageTitle>Receipt</PageTitle></div>
      {r.loading ? <Skeleton className="h-96" /> : r.error ? <ErrorBox message={r.error.message} /> : (
        <div className="print-area glass rounded-2xl p-6">
          <div className="mb-4 text-center"><p className="text-xl font-extrabold"><span className="gold-text">Cafin</span> Pay</p><p className="text-xs text-zinc-500">Transaction receipt</p></div>
          <dl className="divide-y divide-ink-700">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2.5 text-sm"><dt className="text-zinc-500">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl>
          <p className="mt-4 text-center text-xs text-zinc-600">Generated {when(t.generatedAt)}. Computer generated; no signature required.</p>
        </div>)}
      <div className="no-print mt-4 flex gap-3"><Button variant="ghost" className="flex-1" onClick={() => router.back()}>Back</Button><Button className="flex-1" onClick={() => window.print()}>Print / Save PDF</Button></div>
    </div>
  );
}
