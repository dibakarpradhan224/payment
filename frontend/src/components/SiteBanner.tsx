'use client';
import { W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn } from './ui';

/** Admin-controlled announcement and maintenance notice (Admin > Site). */
export function SiteBanner() {
  const s = useApi<any>(`${W}/site`);
  const a = s.data?.announcement, m = s.data?.maintenance;
  if (!a && !m) return null;
  return (
    <div className="no-print space-y-px">
      {m && <p className="bg-red-500/15 px-4 py-2 text-center text-sm text-red-200">🛠 {m.message}</p>}
      {a && <p className={cn('px-4 py-2 text-center text-sm', a.tone === 'warn' ? 'bg-amber-500/15 text-amber-200' : a.tone === 'success' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-sky-500/15 text-sky-200')}>{a.text}</p>}
    </div>
  );
}
