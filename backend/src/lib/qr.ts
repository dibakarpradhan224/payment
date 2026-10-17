/** QR payloads are untrusted input: strict whitelist parser. The backend re-validates everything at pay time. */
export type QrTarget =
  | { type: 'REQUEST'; requestId: string }
  | { type: 'USER'; paymentId: string; amount?: string };

const REQ = /^REQ-[2-9A-HJ-NP-Z]{8}$/;
const PAY = /^PAY-[2-9A-HJ-NP-Z]{8}$/;
const AMT = /^\d{1,9}(\.\d{1,2})?$/;

export const buildRequestQr = (requestId: string) => `payment://receive?request=${requestId}`;
export const buildUserQr = (paymentId: string, amount?: string) =>
  `payment://pay?to=${paymentId}${amount ? `&amount=${amount}` : ''}`;

export function parseQr(raw: string): QrTarget {
  if (raw.length > 200) throw new Error('Invalid QR code.');
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('Invalid QR code.'); }
  if (u.protocol !== 'payment:') throw new Error('Invalid QR code.');
  const keys = [...u.searchParams.keys()];
  if (u.hostname === 'receive') {
    const r = u.searchParams.get('request');
    if (r && REQ.test(r) && keys.length === 1) return { type: 'REQUEST', requestId: r };
  }
  if (u.hostname === 'pay') {
    const to = u.searchParams.get('to'), amount = u.searchParams.get('amount') ?? undefined;
    if (to && PAY.test(to) && (!amount || AMT.test(amount)) && keys.every((k) => k === 'to' || k === 'amount')) {
      return { type: 'USER', paymentId: to, amount };
    }
  }
  throw new Error('Invalid QR code.');
}
