'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { Button, Field } from '@/components/ui';

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(''); const [otp, setOtp] = useState(''); const [token, setToken] = useState('');
  const [pw, setPw] = useState({ newPassword: '', confirmPassword: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); } };

  if (step === 1) return (
    <form onSubmit={run(async () => { await api(`${W}/auth/password/forgot`, { body: { email } }); setStep(2); })} className="space-y-4">
      <h1 className="text-xl font-semibold">Reset password</h1>
      <Field label="Registered email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" loading={busy}>Send OTP</Button>
      <Link href="/login" className="block text-center text-sm text-zinc-400">Back to login</Link>
    </form>
  );
  if (step === 2) return (
    <form onSubmit={run(async () => { const r = await api<{ resetToken: string }>(`${W}/auth/password/verify-otp`, { body: { email, otp } }); setToken(r.resetToken); setStep(3); })} className="space-y-4">
      <h1 className="text-xl font-semibold">Enter the OTP</h1>
      <p className="text-sm text-zinc-400">If this email is registered, a code is on its way.</p>
      <Field label="OTP" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="text-center tracking-[.6em]" />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" loading={busy} disabled={otp.length !== 6}>Verify OTP</Button>
    </form>
  );
  return (
    <form onSubmit={run(async () => { await api(`${W}/auth/password/reset`, { body: { resetToken: token, ...pw } }); router.replace('/login'); })} className="space-y-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <Field label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
      <Field label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" loading={busy}>Save password</Button>
    </form>
  );
}
