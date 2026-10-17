'use client';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { PinPad } from './PinPad';
import { PinReset } from './PinReset';
import { GlowWaves } from './GlowWaves';
import { Icon } from './Icon';
import { Button } from './ui';

/** "Vault locked" screen. The menu button (top-left) opens the sidebar so other pages stay reachable. */
export function LockScreen({ name, onUnlock, onLogout, onMenu }: { name: string; onUnlock: () => void; onLogout: () => void; onMenu: () => void }) {
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [forgot, setForgot] = useState(false);
  async function submit(pin: string) {
    setBusy(true); setErr('');
    try { await api(`${W}/security/verify-pin`, { body: { pin } }); onUnlock(); }
    catch (e) {
      const a = e as ApiError; setV('');
      setErr(a.code === 'INVALID_PIN' ? `Incorrect PIN. ${a.extra?.attemptsRemaining ?? ''} attempt(s) left.` : a.message);
      if (a.status === 401) onLogout();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black">
      <GlowWaves />
      <button onClick={onMenu} aria-label="Open menu" className="absolute left-4 top-4 z-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/45 text-white"><Icon name="menu" className="h-6 w-6" /></button>
      <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-16">
        {forgot ? (
          <div className="w-full max-w-xs space-y-4 text-center"><h2 className="text-3xl font-black">Reset your PIN</h2><PinReset onDone={() => setForgot(false)} />
            <button className="text-sm text-zinc-300 hover:text-white" onClick={() => setForgot(false)}>Back to PIN</button></div>
        ) : (<>
          <PinPad glass title="Vault locked" subtitle="Enter your 4-digit PIN" value={v} onChange={setV} onComplete={submit} busy={busy} error={err} />
          <p className="mt-5 text-xs text-zinc-400">Welcome back, <span className="font-semibold text-zinc-200">{name}</span></p>
          <div className="mt-4 flex flex-col items-center gap-2"><Button variant="ghost" className="bg-black/40" onClick={() => { setErr(''); setForgot(true); }}>Forgot PIN?</Button><button className="text-sm text-zinc-400 hover:text-white" onClick={onLogout}>Log out</button></div></>)}
      </div>
    </div>
  );
}
