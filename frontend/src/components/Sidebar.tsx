'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { copy, inr } from '@/lib/format';
import { cn, Skeleton, useToast } from './ui';
import { Icon, type IconName } from './Icon';

type Item = { href: string; label: string; icon: IconName; external?: boolean };
const MAIN: Item[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' }, { href: '/send', label: 'Pay to user', icon: 'send' }, { href: '/add-money', label: 'Add money', icon: 'plus' },
  { href: '/receive', label: 'Receive', icon: 'receive' }, { href: '/scan', label: 'Scan QR', icon: 'scan' }, { href: '/transactions', label: 'History', icon: 'history' }, { href: '/withdraw', label: 'Withdrawal', icon: 'wallet' },
];
const DEV: Item[] = [
  { href: '/api-docs', label: 'API documentation', icon: 'code' },
  { href: process.env.NEXT_PUBLIC_CHANNEL_URL || '#', label: 'Official channel', icon: 'megaphone', external: true },
  { href: process.env.NEXT_PUBLIC_SUPPORT_URL || '#', label: 'Contact support', icon: 'headset', external: true },
];
const ACCOUNT: Item[] = [{ href: '/profile', label: 'Profile', icon: 'user' }, { href: '/settings', label: 'Settings', icon: 'settings' }];
const QUICK: [string, IconName, string][] = [['/add-money', 'plus', 'Add money'], ['/send', 'send', 'Send'], ['/withdraw', 'wallet', 'Withdraw']];

/** Slide-in menu, opened by the 3-line button at the top-left. Closes on outside tap, Esc, or when you pick a page. */
export function Sidebar({ open, onClose, me, balance, path, onLogout }: { open: boolean; onClose: () => void; me: { name: string | null; email: string; paymentId: string }; balance?: string; path: string; onLogout: () => void }) {
  const toast = useToast();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [hide, setHide] = useState(false);
  useEffect(() => { setHide(localStorage.getItem('pg.hide') === '1'); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const t = setTimeout(() => closeBtn.current?.focus(), 80);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; clearTimeout(t); };
  }, [open, onClose]);

  const name = (me.name ?? 'User').toUpperCase();
  const active = (h: string) => h !== '#' && (path === h || path.startsWith(h + '/'));
  const toggleHide = () => { const n = !hide; setHide(n); localStorage.setItem('pg.hide', n ? '1' : '0'); };

  const link = (n: Item, i: number) => {
    const on = active(n.href);
    return (
      <Link key={n.label} href={n.href} onClick={onClose} {...(n.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} style={{ animationDelay: `${70 + i * 30}ms` }}
        className={cn('slash group relative flex animate-rise items-center gap-3.5 rounded-2xl px-3 py-2.5 transition', on ? 'bg-gradient-to-r from-gold-500/20 via-gold-500/5 to-transparent text-white' : 'text-zinc-300 hover:bg-white/5 hover:text-white')}>
        {on && <span className="absolute bottom-2.5 left-0 top-2.5 w-1 rounded-full bg-gold-500 shadow-glow" />}
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition', on ? 'bg-gold-500/25 text-gold-300' : 'bg-white/5 text-gold-500 group-hover:bg-gold-500/15')}><Icon name={n.icon} className="h-5 w-5" /></span>
        <span className="flex-1 text-[15px] font-semibold tracking-tight">{n.label}</span>
        <Icon name={n.external ? 'external' : 'chevron'} className="h-4 w-4 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-gold-400" />
      </Link>
    );
  };
  const section = (t: string) => <p className="mb-1.5 mt-6 px-3 text-[11px] font-bold uppercase tracking-[.22em] text-zinc-500">{t}</p>;

  return (
    <div className="fixed inset-0 z-[70]" style={{ visibility: open ? 'visible' : 'hidden', transition: `visibility 0s linear ${open ? '0s' : '.3s'}` }} aria-hidden={!open}>
      <div onClick={onClose} className={cn('absolute inset-0 bg-black/70 transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} />
      <aside role="dialog" aria-modal="true" aria-label="Main menu"
        className={cn('absolute inset-y-0 left-0 flex w-[86%] max-w-[22rem] flex-col overflow-y-auto border-r border-white/10 bg-gradient-to-b from-ink-900 via-ink-950 to-black px-5 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] shadow-[24px_0_60px_-24px_rgba(0,0,0,.95)] transition-transform duration-300 ease-out', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-gold-500/20 blur-3xl" />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center flicker rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 text-ink-950 shadow-glow"><Icon name="bolt" className="h-5 w-5" /></span>
            <div className="leading-tight"><p className="glitch text-[17px] font-black tracking-tight"><span className="gold-text">Cafin</span> Pay</p><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-zinc-500">Menu</p></div>
          </div>
          <button ref={closeBtn} onClick={onClose} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/10"><Icon name="close" className="h-5 w-5" /></button>
        </div>

        {/* profile + balance */}
        <div className="relative mt-5 rounded-2xl bg-gradient-to-br from-gold-500/50 via-ink-600 to-ink-700 p-px">
          <div className="rounded-[15px] bg-ink-900 p-4">
            <div className="flex items-center gap-3.5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 via-gold-500 to-gold-600 p-[2px]"><span className="flex h-full w-full items-center justify-center rounded-full bg-ink-900 text-xl font-black text-gold-300">{name[0]}</span></span>
              <div className="min-w-0">
                <p className="truncate text-[17px] font-extrabold tracking-tight">{name}</p>
                <button onClick={async () => toast((await copy(me.paymentId)) ? 'Payment ID copied' : 'Copy failed')} className="flex items-center gap-1.5 font-mono text-xs text-zinc-400 hover:text-gold-300" title="Copy Payment ID">{me.paymentId}<span className="text-[10px] text-zinc-600">copy</span></button>
              </div>
            </div>
            <div className="mt-4 flex items-end justify-between rounded-xl bg-black/40 px-3.5 py-3">
              <div><p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Wallet balance</p>
                {balance === undefined ? <Skeleton className="mt-1 h-6 w-24" /> : <p className="text-2xl font-black tracking-tight text-gold-400">{hide ? '₹ ••••••' : inr(balance)}</p>}</div>
              <button onClick={toggleHide} className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white" aria-label={hide ? 'Show balance' : 'Hide balance'}><Icon name={hide ? 'eye' : 'eyeoff'} className="h-5 w-5" /></button>
            </div>
          </div>
        </div>

        {/* quick actions */}
        <div className="relative mt-3 grid grid-cols-3 gap-2.5">
          {QUICK.map(([h, i, l]) => <Link key={h} href={h} onClick={onClose} className="card-aura slash flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[.04] py-3 text-[11px] font-semibold text-zinc-300 transition hover:text-gold-300"><Icon name={i} className="h-5 w-5 text-gold-500" />{l}</Link>)}
        </div>

        <nav key={String(open)} className="relative">
          {section('Main menu')}<div className="space-y-1">{MAIN.map((n, i) => link(n, i))}</div>
          {section('Developer & support')}<div className="space-y-1">{DEV.map((n, i) => link(n, i + MAIN.length))}</div>
          {section('Account')}<div className="space-y-1">{ACCOUNT.map((n, i) => link(n, i + MAIN.length + DEV.length))}</div>
        </nav>

        <div className="relative mt-auto pt-8">
          <button onClick={() => { onClose(); onLogout(); }} className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[.04] py-3 text-sm font-semibold text-zinc-300 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"><Icon name="logout" className="h-5 w-5" />Log out</button>
          <p className="mt-4 text-center text-[10px] font-semibold uppercase tracking-[.25em] text-zinc-600">Secured by PIN · Encrypted</p>
        </div>
      </aside>
    </div>
  );
}
