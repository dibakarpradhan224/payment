'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn, Skeleton } from './ui';
import { Icon } from './Icon';
import { LockScreen } from './LockScreen';
import { Sidebar } from './Sidebar';
import { SiteBanner } from './SiteBanner';
import { clearUnlock, isGated, markUnlocked, withinGrace } from '@/lib/lock';

const BOTTOM = [{ href: '/dashboard', label: 'Home', icon: 'home' }, { href: '/add-money', label: 'Add money', icon: 'plus' }, { href: '/send', label: 'Send', icon: 'send' }, { href: '/receive', label: 'Receive', icon: 'receive' }] as const;

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname(); const router = useRouter();
  const me = useApi<{ user: any }>(`${W}/auth/me`);
  const wallet = useApi<any>(me.data ? `${W}/wallet` : null, [path]); // refresh the balance after every page change
  const notes = useApi<{ unread: number }>(me.data ? `${W}/notifications` : null);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { setOpen(false); }, [path]);
  // Settings tells us when the name changed, so the menu updates straight away.
  useEffect(() => { const h = () => me.reload(); window.addEventListener('pg:profile', h); return () => window.removeEventListener('pg:profile', h); }, [me.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (me.error?.status === 401) router.replace('/login');
    else if (me.data && !me.data.user.pinSet && path !== '/create-pin') router.replace('/create-pin');
  }, [me.error, me.data, path, router]);

  if (!me.data) return <div className="mx-auto max-w-md space-y-4 p-6"><Skeleton className="h-10" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div>;
  const logout = async () => { clearUnlock(); await api(`${W}/auth/logout`, { method: 'POST', body: {} }).catch(() => {}); router.replace('/login'); };
  const hideChrome = path === '/create-pin';
  // Dashboard, Pay to user, Withdrawal and API documentation ask for the PIN each time they are opened (after a short grace period).
  const needsPin = mounted && me.data.user.pinSet && isGated(path) && !withinGrace();
  const u = me.data.user;

  return (
    <div className="min-h-screen">
      {!hideChrome && (
        <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-ink-950/90">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 md:px-8">
            <div className="flex items-center gap-3">
              <button onClick={() => setOpen(true)} aria-label="Open menu" className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-100 shadow-sm transition btn-cursed slash hover:border-gold-500/40 hover:text-gold-300"><Icon name="menu" className="h-6 w-6" /></button>
              <Link href="/dashboard" className="glitch text-lg font-black tracking-tight"><span className="gold-text">Cafin</span> Pay</Link>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden font-mono text-xs text-zinc-500 sm:block">{u.paymentId}</span>
              <Link href="/withdraw" className="rounded-lg border border-gold-500/40 px-3 py-1.5 text-xs font-semibold text-gold-300 md:hidden">Withdraw</Link>
              <Link href="/settings" className="relative text-zinc-300 hover:text-white" aria-label="Notifications"><Icon name="bell" />{!!notes.data?.unread && <span className="absolute -right-2 -top-2 rounded-full bg-gold-500 px-1.5 text-[10px] font-bold text-ink-950">{notes.data.unread}</span>}</Link>
            </div>
          </div>
        </header>)}
      <SiteBanner />
      <div key={`d-${path}`} aria-hidden className="domain-flash z-[55]" />
      <main key={path} className="mx-auto w-full max-w-4xl animate-rise p-4 pb-28 md:p-8 md:pb-10">{needsPin ? null : children}</main>

      {!hideChrome && (
        <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/10 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] md:hidden">
          {BOTTOM.map((n) => <Link key={n.href} href={n.href} className={cn('flex flex-col items-center gap-0.5 py-2.5 text-[11px]', path.startsWith(n.href) ? 'text-gold-300' : 'text-zinc-500')}><Icon name={n.icon} className="h-5 w-5" />{n.label}</Link>)}
          <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] text-zinc-500"><Icon name="menu" className="h-5 w-5" />More</button>
        </nav>)}

      {needsPin && <LockScreen name={(u.name ?? 'User').toUpperCase()} onUnlock={() => { markUnlocked(); setTick((t) => t + 1); }} onLogout={logout} onMenu={() => setOpen(true)} />}
      <Sidebar open={open} onClose={() => setOpen(false)} me={{ name: u.name, email: u.email, paymentId: u.paymentId }} balance={wallet.data?.available.rupees} path={path} onLogout={logout} />
    </div>
  );
}
