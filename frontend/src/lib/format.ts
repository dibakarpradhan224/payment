export const inr = (rupees: string | number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(rupees));
export const when = (d: string | Date) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const shortDay = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
export const copy = async (t: string) => {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* try the fallback */ }
  try {
    const el = document.createElement('textarea');
    el.value = t; el.setAttribute('readonly', ''); el.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(el); el.select();
    const ok = document.execCommand('copy'); document.body.removeChild(el); return ok;
  } catch { return false; }
};
