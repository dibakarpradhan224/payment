'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, W } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { inr, when } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, PageTitle, Skeleton, Tabs } from '@/components/ui';

const FILTERS = ['all', 'deposits', 'transfers', 'received', 'withdrawals', 'refunds', 'payments'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));

export default function Transactions() {
  const [filter, setFilter] = useState('all'); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [rows, setRows] = useState<any[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState('');

  async function load(reset: boolean) {
    setLoading(true); setErr('');
    try {
      const p = new URLSearchParams({ filter, limit: '20' }); if (dq) p.set('q', dq); if (!reset && cursor) p.set('cursor', cursor);
      const r = await api<any>(`${W}/transactions?${p}`);
      setRows(reset ? r.transactions : [...rows, ...r.transactions]); setCursor(r.nextCursor);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(true); }, [filter, dq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageTitle>Transactions</PageTitle>
      <Tabs tabs={FILTERS} value={filter} onChange={setFilter} />
      <div className="my-4"><Field placeholder="Search by transaction ID, reference or bank transaction ID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Card>
        {err && <ErrorBox message={err} retry={() => load(true)} />}
        {loading && !rows.length ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !rows.length ? <Empty title="Nothing here" hint="Try another filter or search." />
          : <ul className="divide-y divide-ink-700">{rows.map((x) => (
            <li key={x.id}><Link href={`/transactions/${x.id}`} className="flex items-center justify-between gap-3 py-3.5 hover:bg-ink-700/30">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{x.description ?? x.type}</p><p className="font-mono text-xs text-zinc-500">{x.id}</p><p className="text-xs text-zinc-500">{when(x.createdAt)}</p></div>
              <div className="shrink-0 text-right"><p className={x.direction === 'CREDIT' ? 'font-semibold text-emerald-300' : 'font-semibold'}>{x.direction === 'CREDIT' ? '+' : '−'}{inr(x.net.rupees)}</p>
                {(Number(x.tax.rupees) > 0 || Number(x.fee.rupees) > 0) && <p className="text-xs text-zinc-500">fee/tax {inr(Number(x.tax.rupees) + Number(x.fee.rupees))}</p>}<Badge status={x.status} /></div>
            </Link></li>))}</ul>}
        {cursor && <Button variant="ghost" className="mt-4 w-full" onClick={() => load(false)} loading={loading}>Load more</Button>}
      </Card>
    </>
  );
}
