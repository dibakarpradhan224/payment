'use client';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { PinPad } from '@/components/PinPad';
import { markUnlocked } from '@/lib/lock';

export default function CreatePin() {
  const [first, setFirst] = useState<string | null>(null);
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function done(pin: string) {
    if (first === null) { setFirst(pin); setV(''); setErr(''); return; }
    if (pin !== first) { setErr('PINs do not match. Start again.'); setFirst(null); setV(''); return; }
    setBusy(true); setErr('');
    try {
      await api(`${W}/auth/pin/set`, { body: { pin: first, confirmPin: pin } });
      markUnlocked();
      // Full reload: the app shell still holds the old "no PIN yet" session data and would bounce back here.
      window.location.assign('/dashboard');
    } catch (e) { setErr((e as ApiError).message); setFirst(null); setV(''); setBusy(false); }
  }

  return (
    <div className="py-6">
      <PinPad title={first === null ? 'Create your PIN' : 'Confirm your PIN'} subtitle={first === null ? 'Choose 4 digits. It protects transfers, withdrawals and API actions.' : 'Enter the same 4 digits again.'}
        value={v} onChange={setV} onComplete={done} busy={busy} error={err} />
      <p className="mt-6 text-center text-xs text-zinc-500">Never share your PIN. We will never ask for it in chat or email.</p>
    </div>
  );
}
