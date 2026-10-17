'use client';
import { createPortal } from 'react-dom';
import { PinPad } from './PinPad';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', loading, className, children, disabled, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }) {
  const base = 'btn-ff inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-50 disabled:pointer-events-none';
  const v = {
    primary: 'bg-gradient-to-r from-gold-400 to-gold-600 text-ink-950 hover:brightness-110 shadow-glow',
    ghost: 'bg-ink-700 text-zinc-100 hover:bg-ink-600 border border-ink-600',
    danger: 'bg-red-600/90 text-white hover:bg-red-600',
  }[variant];
  return <button data-variant={variant} className={cn(base, v, className)} disabled={disabled || loading} {...p}>{loading && <Spinner />}{children}</button>;
}

export const Spinner = () => <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label="loading" />;

export const Card = ({ className, children, id }: { className?: string; children: ReactNode; id?: string }) => <div id={id} className={cn('glass rounded-2xl p-5 animate-rise', className)}>{children}</div>;

export function Field({ label, error, hint, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>}
      <input className={cn('w-full rounded-xl border bg-ink-900 px-3.5 py-2.5 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20', error ? 'border-red-500' : 'border-ink-600', className)} {...p} />
      {hint && !error && <span className="text-xs text-zinc-500">{hint}</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  );
}

const TONES: Record<string, string> = {
  SUCCESSFUL: 'green', VERIFIED: 'green', PAID: 'green', DELIVERED: 'green', ACTIVE: 'green', REVOKED: 'zinc', LINKED: 'green',
  PENDING: 'amber', PROCESSING: 'amber', MANUAL_REVIEW: 'amber', CREATED: 'amber', REFUND_REVIEW: 'amber',
  FAILED: 'red', REJECTED: 'red', MISMATCH: 'red', EXPIRED: 'zinc', CANCELLED: 'zinc', REFUNDED: 'blue',
};
export function Badge({ status }: { status: string }) {
  const t = TONES[status] ?? 'zinc';
  const c = { green: 'bg-emerald-500/15 text-emerald-300', amber: 'bg-amber-500/15 text-amber-300', red: 'bg-red-500/15 text-red-300', blue: 'bg-sky-500/15 text-sky-300', zinc: 'bg-zinc-500/15 text-zinc-300' }[t];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', c)}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status.replace('_', ' ')}</span>;
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton h-5 w-full', className)} />;
export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="py-10 text-center"><div className="mx-auto mb-3 h-12 w-12 rounded-full bg-ink-700" /><p className="font-medium text-zinc-300">{title}</p>{hint && <p className="mt-1 text-sm text-zinc-500">{hint}</p>}</div>
);
export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{message}{retry && <button onClick={retry} className="ml-3 underline">Retry</button>}</div>
);

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open || !mounted) return null;
  // Portal to <body>: a fixed overlay inside an animated/blurred parent can end up clipped or invisible.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-ink-600 bg-ink-800 p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title && <h3 className="mb-4 text-lg font-semibold">{title}</h3>}
        {children}
      </div>
    </div>, document.body);
}

/** PIN prompt with the full keypad. Auto-submits on the 4th digit. The PIN lives only in memory, never in the URL, storage or logs. */
export function PinModal({ open, onClose, onSubmit, title = 'Enter your PIN', busy, error }: { open: boolean; onClose: () => void; onSubmit: (pin: string) => void; title?: string; busy?: boolean; error?: string }) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(''); }, [open]);
  useEffect(() => { if (error) setV(''); }, [error]);
  return (
    <Modal open={open} onClose={onClose}>
      <PinPad title={title} subtitle="Enter your 4-digit PIN" value={v} onChange={setV} onComplete={onSubmit} busy={busy} error={error} active={open} />
      <button className="mt-5 w-full text-sm text-zinc-400 hover:text-zinc-200" onClick={onClose}>Cancel</button>
    </Modal>
  );
}

export const SuccessMark = () => (
  <svg viewBox="0 0 52 52" className="mx-auto h-20 w-20 animate-pop" aria-hidden>
    <circle cx="26" cy="26" r="24" fill="none" stroke="#ff9f1c" strokeWidth="2.5" />
    <path d="M15 27l8 8 14-16" fill="none" stroke="#ffd36b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40" strokeDashoffset="40" className="animate-draw" />
  </svg>
);

type Toast = { id: number; text: string; tone: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {list.map((t) => <div key={t.id} className={cn('pointer-events-auto animate-rise rounded-xl border px-4 py-3 text-sm shadow-xl', t.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-100' : 'border-red-500/30 bg-red-950/90 text-red-100')}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export const Tabs = ({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) => (
  <div className="flex gap-1 overflow-x-auto rounded-xl bg-ink-900 p-1">
    {tabs.map((t) => <button key={t.id} onClick={() => onChange(t.id)} className={cn('tab-ff whitespace-nowrap py-2 text-sm font-bold transition', value === t.id ? 'bg-gradient-to-r from-gold-400 to-gold-600 text-ink-950' : 'text-zinc-400 hover:text-zinc-100')}>{t.label}</button>)}
  </div>
);

export const PageTitle = ({ children, sub }: { children: ReactNode; sub?: string }) => (
  <div className="mb-5"><h1 className="text-2xl font-bold tracking-tight">{children}</h1>{sub && <p className="mt-1 text-sm text-zinc-400">{sub}</p>}</div>
);
