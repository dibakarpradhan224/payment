'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { Button, Field, SuccessMark } from '@/components/ui';

export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'otp' | 'done'>('form');
  const [f, setF] = useState({ name: '', mobile: '', email: '', password: '', confirmPassword: '' });
  const [otp, setOtp] = useState(''); const [err, setErr] = useState(''); const [fields, setFields] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function sendOtp(e?: React.FormEvent) {
    e?.preventDefault(); setBusy(true); setErr(''); setFields({});
    try { await api(`${W}/auth/register/start`, { body: { ...f, name: f.name.trim() || undefined } }); setStep('otp'); }
    catch (x) { const a = x as ApiError; setErr(a.message); setFields(Object.fromEntries((a.extra?.fields ?? []).map((i: any) => [i.path, i.message]))); } finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`${W}/auth/register/verify`, { body: { email: f.email, otp } }); setStep('done'); setTimeout(() => router.replace('/create-pin'), 1400); }
    catch (x) { setErr((x as ApiError).message); setOtp(''); } finally { setBusy(false); }
  }

  if (step === 'done') return <div className="py-6 text-center"><SuccessMark /><p className="mt-4 text-lg font-semibold">Account created successfully.</p><p className="text-sm text-zinc-400">Next: set your 4-digit PIN.</p></div>;
  if (step === 'otp') return (
    <form onSubmit={verify} className="space-y-4">
      <h1 className="text-xl font-semibold">Verify your email</h1>
      <p className="text-sm text-zinc-400">We sent a 6-digit code to <b className="text-zinc-200">{f.email}</b>. It expires in 10 minutes.</p>
      <Field label="OTP" inputMode="numeric" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="text-center tracking-[.6em]" />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" loading={busy} disabled={otp.length !== 6}>Verify & create account</Button>
      <button type="button" onClick={() => sendOtp()} className="w-full text-sm text-zinc-400 hover:text-gold-300">Resend OTP</button>
    </form>
  );
  return (
    <form onSubmit={sendOtp} className="space-y-4">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <Field label="Your name (shown to people you pay)" autoComplete="name" maxLength={60} value={f.name} onChange={set('name')} error={fields.name} hint="Optional. You can change it later in Settings. Never your email." />
      <Field label="Mobile number" inputMode="tel" placeholder="9876543210" required value={f.mobile} onChange={set('mobile')} error={fields.mobile} />
      <Field label="Gmail / email" type="email" required value={f.email} onChange={set('email')} error={fields.email} />
      <Field label="Password" type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} error={fields.password} hint="8+ characters with a letter and a number" />
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={f.confirmPassword} onChange={set('confirmPassword')} error={fields.confirmPassword} />
      {err && !Object.keys(fields).length && <p className="text-sm text-red-400">{err}</p>}
      <Button className="w-full" loading={busy}>Send OTP</Button>
      <p className="text-center text-sm text-zinc-400">Already registered? <Link href="/login" className="text-gold-400">Log in</Link></p>
    </form>
  );
}
