'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { Button, Field } from '@/components/ui';
import { markUnlocked } from '@/lib/lock';

export default function Login() {
  const router = useRouter();
  const [f, setF] = useState({ email: '', password: '', remember: false });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`${W}/auth/login`, { body: f }); markUnlocked(); router.replace('/dashboard'); }
    catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Field label="Password" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <label className="flex items-center gap-2 text-sm text-zinc-400"><input type="checkbox" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} className="accent-orange-500" /> Remember this device</label>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" loading={busy}>Log in</Button>
      <div className="flex justify-between text-sm text-zinc-400"><Link href="/forgot-password" className="hover:text-gold-300">Forgot password?</Link><Link href="/register" className="text-gold-400">Create account</Link></div>
    </form>
  );
}
