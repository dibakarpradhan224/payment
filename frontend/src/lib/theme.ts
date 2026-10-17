export type Theme = 'gold' | 'gojo' | 'sukuna';
export const THEMES: { id: Theme; name: string; tag: string; colors: string[] }[] = [
  { id: 'gold', name: 'Cafin Gold', tag: 'Cursed energy', colors: ['#ffd36b', '#ff9f1c', '#ef233c'] },
  { id: 'gojo', name: 'Gojo', tag: 'Limitless: blue & violet', colors: ['#bae6fd', '#38bdf8', '#7c3aed'] },
  { id: 'sukuna', name: 'Sukuna', tag: 'Dismantle: crimson & black', colors: ['#fca5a5', '#ef233c', '#7f1d1d'] },
];
const KEY = 'pg.theme';
export const getTheme = (): Theme => { try { const t = localStorage.getItem(KEY); return t === 'gojo' || t === 'sukuna' ? t : 'gold'; } catch { return 'gold'; } };
/** Applies a theme to the whole page without saving it. */
export const applyTheme = (t: Theme) => { if (t === 'gold') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); };
export const saveTheme = (t: Theme) => { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } applyTheme(t); };
