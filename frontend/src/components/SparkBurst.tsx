'use client';
import { useEffect } from 'react';

const PALETTES: Record<string, string[]> = {
  gold: ['#ffd36b', '#ff9f1c', '#ef233c', '#7c3aed', '#38bdf8'],
  gojo: ['#e0f2fe', '#7dd3fc', '#38bdf8', '#818cf8', '#a78bfa'],
  sukuna: ['#fecaca', '#f87171', '#ef233c', '#b91c1c', '#111111'],
};

/** Effects where a button is pressed. Gold = sparks, Gojo = expanding "Limitless" rings, Sukuna = crossing slashes.
 *  Purely visual; skipped for people who prefer reduced motion. */
export function SparkBurst() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const add = (el: HTMLElement, ms: number) => { document.body.appendChild(el); setTimeout(() => el.remove(), ms); };
    const on = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.('button, [data-spark]') as HTMLButtonElement | null;
      if (!t || t.disabled) return;
      const theme = (t.closest('[data-theme]') as HTMLElement | null)?.dataset.theme ?? document.documentElement.dataset.theme ?? 'gold';
      const colors = PALETTES[theme] ?? PALETTES.gold!;
      const pos = `left:${e.clientX}px;top:${e.clientY}px;`;
      if (theme === 'gojo') {
        for (const c of ['ring', 'ring r2']) { const r = document.createElement('span'); r.className = c; r.style.cssText = pos; add(r, 1100); }
      } else if (theme === 'sukuna') {
        const base = Math.random() * 180 - 90;
        [base, base + 55 + Math.random() * 30].forEach((deg, i) => { const c = document.createElement('span'); c.className = 'cut'; c.style.cssText = `${pos}--rot:${deg}deg;animation-delay:${i * 0.06}s`; add(c, 700); });
      }
      for (let i = 0; i < (theme === 'gold' ? 14 : 10); i++) {
        const s = document.createElement('span');
        const a = Math.random() * Math.PI * 2, d = 28 + Math.random() * 56;
        s.className = i % 3 === 0 ? 'spark line' : 'spark';
        s.style.cssText = `${pos}color:${colors[i % colors.length]};background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--rot:${(a * 180) / Math.PI}deg`;
        add(s, 700);
      }
    };
    document.addEventListener('pointerdown', on, true);
    return () => document.removeEventListener('pointerdown', on, true);
  }, []);
  return null;
}
