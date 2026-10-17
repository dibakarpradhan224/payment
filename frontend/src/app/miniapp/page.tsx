'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { Spinner } from '@/components/ui';

const ROUTES: Record<string, string> = { home: '/dashboard', balance: '/dashboard', 'add-money': '/add-money', transfer: '/send', send: '/send', receive: '/receive', scan: '/scan', withdraw: '/withdraw', transactions: '/transactions', api: '/api-docs', profile: '/profile', settings: '/settings' };

/** Telegram Mini App entry. Identity = Telegram's signed initData, verified by the backend. The id the page shows is never trusted. */
export default function MiniApp() {
  const router = useRouter(); const [err, setErr] = useState('');
  useEffect(() => {
    let tries = 0;
    const go = async () => {
      const tg = (window as any).Telegram?.WebApp;
      if (!tg?.initData) { if (tries++ < 20) return void setTimeout(go, 150); return setErr('Open this page from inside Telegram.'); }
      tg.ready(); tg.expand?.(); tg.setHeaderColor?.('#07070a'); tg.setBackgroundColor?.('#07070a');
      try {
        const r = await api<any>(`${W}/telegram/auth`, { body: { initData: tg.initData } });
        router.replace(!r.user.pinSet ? '/create-pin' : ROUTES[r.startParam ?? 'home'] ?? '/dashboard');
      } catch (e) { setErr((e as ApiError).message); }
    };
    void go();
  }, [router]);
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">{err ? <><p className="text-red-300">{err}</p><p className="text-sm text-zinc-500">If you have not linked your account yet, send <span className="font-mono">/link CODE</span> to the bot.</p></> : <Spinner />}</div>;
}
