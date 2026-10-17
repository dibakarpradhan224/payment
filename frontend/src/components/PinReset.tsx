'use client';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { Button, Field, useToast } from './ui';

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);

/** Forgot-PIN flow: OTP to the registered email, then a new PIN. The old PIN stops working immediately. */
export function PinReset({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0); const [otp, setOtp] = useState(''); const [token, setToken] = useState(''); const [r, setR] = useState({ pin: '', confirmPin: '' }); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as ApiError).message, 'err'); } finally { setBusy(false); } };
  if (step === 0) return (<div className="space-y-4"><p className="text-sm text-zinc-400">We will email a 6-digit code to your registered address.</p><Button className="w-full" loading={busy} onClick={() => run(async () => { await api(`${W}/auth/pin/forgot`, { method: 'POST', body: {} }); toast('OTP sent. Check your email, and the Spam folder.'); setStep(1); })}>Send OTP</Button></div>);
  if (step === 1) return (<div className="space-y-4"><p className="text-sm text-zinc-400">Enter the 6-digit code from your email. It is valid for 10 minutes.</p><p className="text-xs text-zinc-500">Testing on your own computer without email set up? The code is printed in the backend terminal on a line starting <span className="font-mono">[dev-mail]</span>.</p><Field label="OTP" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="text-center tracking-[.6em]" /><Button className="w-full" loading={busy} disabled={otp.length !== 6} onClick={() => run(async () => { const x = await api<any>(`${W}/auth/pin/verify-otp`, { body: { otp } }); setToken(x.resetToken); setStep(2); })}>Verify OTP</Button></div>);
  return (<div className="space-y-4"><Field label="New PIN" type="password" inputMode="numeric" value={r.pin} onChange={(e) => setR({ ...r, pin: digits(e.target.value) })} /><Field label="Confirm new PIN" type="password" inputMode="numeric" value={r.confirmPin} onChange={(e) => setR({ ...r, confirmPin: digits(e.target.value) })} />
    <Button className="w-full" loading={busy} disabled={r.pin.length !== 4 || r.confirmPin.length !== 4} onClick={() => run(async () => { await api(`${W}/auth/pin/reset`, { body: { resetToken: token, ...r } }); toast('PIN reset. The old PIN no longer works.'); setStep(0); setOtp(''); setR({ pin: '', confirmPin: '' }); onDone?.(); })}>Save new PIN</Button></div>);
}
