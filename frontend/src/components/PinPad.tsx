'use client';
import { useEffect } from 'react';
import { cn, Spinner } from './ui';
import { Icon } from './Icon';

/** Full numeric keypad. Works with touch, mouse and a physical keyboard. The PIN lives only in component state. */
export function PinPad({ title, subtitle, value, onChange, onComplete, busy, error, active = true, glass = false }: {
  glass?: boolean; title: string; subtitle?: string; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; busy?: boolean; error?: string; active?: boolean;
}) {
  const press = (d: string) => {
    if (busy || value.length >= 4) return;
    navigator.vibrate?.(8);
    const n = value + d;
    onChange(n);
    if (n.length === 4) onComplete?.(n);
  };
  const back = () => !busy && onChange(value.slice(0, -1));
  const go = () => value.length === 4 && !busy && onComplete?.(value);

  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') back(); else if (e.key === 'Enter') go();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // re-bound every render so it always sees the latest value

  const key = cn('key-ff flex h-16 items-center justify-center border text-2xl font-bold text-white transition active:border-gold-500 disabled:opacity-50 sm:h-[72px]', glass ? 'border-white/10 bg-black/35 backdrop-blur-sm active:bg-black/60' : 'border-ink-600 bg-ink-900 active:bg-ink-700');
  return (
    <div className="mx-auto w-full max-w-xs text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-gold-500 bg-black/30 text-gold-400 shadow-glow"><Icon name={glass ? 'fingerprint' : 'lock'} className="h-9 w-9" /></div>
      <h2 className="mt-5 text-2xl font-extrabold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      <div className={cn('my-6 flex justify-center gap-4', error && 'animate-shake')} aria-label={`${value.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={cn('h-3.5 w-3.5 rounded-full border-2 transition', i < value.length ? 'border-gold-400 bg-gold-400 shadow-glow' : 'border-ink-500')} />)}
      </div>
      <p className="min-h-5 text-sm text-red-400" role="alert">{error}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" className={key} onClick={() => press(d)} disabled={busy}>{d}</button>)}
        <button type="button" className={key} onClick={back} disabled={busy} aria-label="Delete"><Icon name="backspace" className="h-6 w-6 text-zinc-400" /></button>
        <button type="button" className={key} onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" className={cn(key, value.length === 4 && 'border-gold-500')} onClick={go} disabled={busy || value.length !== 4} aria-label="Confirm">{busy ? <Spinner /> : <Icon name="check" className="h-7 w-7 text-gold-400" />}</button>
      </div>
    </div>
  );
}
