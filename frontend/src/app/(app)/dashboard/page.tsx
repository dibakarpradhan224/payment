'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { W } from '@/lib/api';
import { inr, when } from '@/lib/format';
import { Badge, Card, Empty, ErrorBox, Skeleton } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';

const ACTIONS: [string, IconName, string][] = [
  ['/send', 'send', 'Pay to user'], ['/add-money', 'plus', 'Add money'], ['/receive', 'receive', 'Receive'],
  ['/scan', 'scan', 'Scan QR'], ['/withdraw', 'wallet', 'Withdraw'], ['/transactions', 'history', 'History'],
];

export default function Dashboard() {
  const me = useApi<any>(`${W}/auth/me`);
  const w = useApi<any>(`${W}/wallet`);
  const t = useApi<any>(`${W}/transactions?limit=6`);
  const [hide, setHide] = useState(false);
  useEffect(() => { setHide(localStorage.getItem('pg.hide') === '1'); }, []);
  const toggle = () => { setHide(!hide); localStorage.setItem('pg.hide', hide ? '0' : '1'); };
  const name = me.data?.user.name;
  const hour = new Date().getHours();

  return (
    <div className="space-y-5">
      <div><p className="text-sm text-zinc-500">{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</p><h1 className="text-2xl font-extrabold tracking-tight">{me.loading ? '…' : name ?? 'Welcome'}</h1></div>
      {me.data && !name && <Link href="/settings" className="block rounded-2xl border border-gold-500/40 bg-gold-500/10 px-4 py-3 text-sm text-gold-300">Add your name so people can recognise you when you pay them. <span className="font-bold underline">Set name</span></Link>}
      {w.error && <ErrorBox message={w.error.message} retry={w.reload} />}

      <Card className="relative overflow-hidden border-gold-500/20 bg-gradient-to-br from-gold-500/25 via-ink-800 to-ink-900">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-gold-500/25 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Wallet balance</p>
          <button onClick={toggle} className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:text-white" aria-label={hide ? 'Show balance' : 'Hide balance'}>{hide ? 'Show' : 'Hide'}</button>
        </div>
        {w.loading ? <Skeleton className="mt-3 h-11 w-52" /> : <p className="relative mt-1 text-4xl font-black tracking-tight sm:text-5xl">{hide ? '₹ ••••••' : inr(w.data?.available.rupees ?? 0)}</p>}
        {w.data?.frozen && <p className="relative mt-2 text-sm text-red-300">Your wallet is frozen. Contact support.</p>}
        <div className="relative mt-5 flex gap-3">
          <Link href="/add-money" data-variant="primary" className="btn-ff flex flex-1 items-center justify-center gap-2 bg-gradient-to-r from-gold-400 to-gold-600 py-3 text-sm font-bold text-ink-950"><Icon name="plus" className="h-4 w-4" />Add money</Link>
          <Link href="/withdraw" data-variant="ghost" className="btn-ff flex flex-1 items-center justify-center gap-2 border border-white/15 bg-black/40 py-3 text-sm font-bold"><Icon name="wallet" className="h-4 w-4" />Withdraw</Link>
        </div>
        {!!w.data?.pendingTransactions && <p className="relative mt-3 text-sm text-amber-300">{w.data.pendingTransactions} transaction(s) in progress</p>}
      </Card>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {ACTIONS.map(([h, i, l]) => (
          <Link key={h} href={h} className="card-aura slash group flex flex-col items-center gap-2 rounded-2xl border border-ink-600 bg-ink-800/60 py-4 text-xs font-semibold text-zinc-300">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-gold-500/25 to-gold-600/10 text-gold-400 transition group-hover:from-gold-500/40"><Icon name={i} className="h-5 w-5" /></span>{l}
          </Link>))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Deposited', w.data?.totalDeposited], ['Withdrawn', w.data?.totalWithdrawn], ['Transferred', w.data?.totalTransferred], ['Fees & tax', w.data?.totalFees]].map(([l, v]: any) => (
          <div key={l} className="rounded-2xl border border-ink-600 bg-ink-800/40 p-3.5"><p className="text-xs text-zinc-500">{l}</p>{w.loading ? <Skeleton className="mt-1.5 h-5" /> : <p className="mt-0.5 font-bold">{hide ? '••••' : inr(v?.rupees ?? 0)}</p>}</div>))}
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Recent transactions</h2><Link href="/transactions" className="text-sm font-medium text-gold-400">View all</Link></div>
        {t.loading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !t.data?.transactions.length ? <Empty title="No transactions yet" hint="Add money to get started." />
          : <ul className="divide-y divide-ink-700">{t.data.transactions.map((x: any) => (
            <li key={x.id}><Link href={`/transactions/${x.id}`} className="flex items-center gap-3 py-3 transition hover:bg-ink-700/20">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${x.direction === 'CREDIT' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gold-500/15 text-gold-400'}`}><Icon name={x.direction === 'CREDIT' ? 'receive' : 'send'} className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{x.description ?? x.type}</p><p className="text-xs text-zinc-500">{when(x.createdAt)}</p></div>
              <div className="shrink-0 text-right"><p className={x.direction === 'CREDIT' ? 'font-bold text-emerald-300' : 'font-bold'}>{x.direction === 'CREDIT' ? '+' : '−'}{hide ? '••••' : inr(x.net.rupees)}</p><Badge status={x.status} /></div>
            </Link></li>))}</ul>}
      </Card>
    </div>
  );
}
