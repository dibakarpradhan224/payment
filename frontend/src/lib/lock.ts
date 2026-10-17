/** The PIN is asked when opening sensitive pages (dashboard, pay to user, withdrawal, API docs).
 *  After a correct PIN the pages stay open for GRACE_MS so moving between them does not nag. Set GRACE_MS = 0 to ask every time.
 *  This is only a convenience flag in this tab; the server always checks the PIN itself. */
const KEY = 'pg.unlocked.at';
export const GRACE_MS = 2 * 60_000;
export const GATED_PAGES = ['/dashboard', '/send', '/withdraw', '/api-docs'];
export const isGated = (path: string) => GATED_PAGES.some((g) => path === g || path.startsWith(g + '/'));
export const markUnlocked = () => { try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ } };
export const clearUnlock = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
export const withinGrace = () => { try { const t = Number(sessionStorage.getItem(KEY) || 0); return GRACE_MS > 0 && t > 0 && Date.now() - t < GRACE_MS; } catch { return false; } };
