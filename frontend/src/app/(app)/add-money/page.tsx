'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { inr, when } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, PageTitle, Skeleton, Spinner, SuccessMark, useToast } from '@/components/ui';
import { QR } from '@/components/QR';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const LINK_DELAY_MS = 2500; // the "Pay With UPI" link appears this long after the user stops typing

function Quote({ amount }: { amount: string }) {
  const q = useApi<any>(AMOUNT_RE.test(amount) && Number(amount) > 0 ? `${W}/deposits/quote?amount=${amount}` : null, [amount]);
  if (!q.data) return q.error ? <p className="text-sm text-red-400">{q.error.message}</p> : null;
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900 p-3 text-sm">
      <div className="flex justify-between"><span className="text-zinc-400">You pay</span><span>{inr(q.data.gross.rupees)}</span></div>
      <div className="flex justify-between"><span className="text-zinc-400">Tax ({q.data.taxRatePercent}%)</span><span>− {inr(q.data.tax.rupees)}</span></div>
      <div className="mt-1 flex justify-between border-t border-ink-700 pt-1 font-semibold"><span>Wallet credit</span><span className="text-gold-300">{inr(q.data.net.rupees)}</span></div>
    </div>
  );
}

export default function AddMoney() {
  const cfg = useApi<any>(`${W}/deposits/config`);
  const hist = useApi<any>(`${W}/deposits/history`);
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const settled = useDebounced(amount, LINK_DELAY_MS);
  const [order, setOrder] = useState<any>(null);
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState('');
  const [paid, setPaid] = useState<any>(null);
  const [txId, setTxId] = useState(''); const [txBusy, setTxBusy] = useState(false); const [txMsg, setTxMsg] = useState<{ tone: 'ok' | 'wait' | 'err'; text: string } | null>(null);
  const [mobile, setMobile] = useState(true);
  const seq = useRef(0);

  useEffect(() => { setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)); }, []);

  const lim = cfg.data?.limits;
  const valid = AMOUNT_RE.test(amount) && Number(amount) > 0 && (!lim || (Number(amount) >= Number(lim.min.rupees) && Number(amount) <= Number(lim.max.rupees)));

  // Typing again throws the old link away; 2.5 seconds after the last keystroke a fresh one is made.
  useEffect(() => { seq.current++; setOrder(null); setPaid(null); setErr(''); }, [amount]);
  useEffect(() => {
    if (!cfg.data?.upi?.enabled || !AMOUNT_RE.test(settled) || settled !== amount || !valid) return;
    const mine = ++seq.current; setMaking(true);
    api<any>(`${W}/deposits/upi/order`, { body: { amount: settled } })
      .then((r) => { if (seq.current === mine) setOrder(r.order); })
      .catch((e: ApiError) => { if (seq.current === mine) setErr(e.message); })
      .finally(() => { if (seq.current === mine) setMaking(false); });
  }, [settled, amount, cfg.data?.upi?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for the payment: every 4 s, and straight away when the user comes back from the UPI app.
  useEffect(() => {
    if (!order || paid) return;
    const id = order.id; let stop = false;
    const check = async () => {
      try {
        const o = await api<any>(`${W}/deposits/upi/order/${id}`);
        if (stop) return;
        if (o.status === 'PAID') { setPaid(o); hist.reload(); }
        else if (o.status === 'EXPIRED' || o.status === 'CANCELLED') { setOrder(null); setErr('This payment link expired. Change the amount or retype it to get a new one.'); }
      } catch { /* try again on the next tick */ }
    };
    const t = setInterval(check, 4000);
    const vis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [order?.id, paid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitTx(e: React.FormEvent) {
    e.preventDefault(); setTxBusy(true); setTxMsg(null);
    try {
      const r = await api<any>(`${W}/deposits/utr`, { body: { amount, transactionId: txId } });
      setTxMsg({ tone: r.status === 'VERIFIED' ? 'ok' : 'wait', text: r.message }); setTxId(''); hist.reload();
    } catch (x) { setTxMsg({ tone: 'err', text: (x as ApiError).message }); toast((x as ApiError).message, 'err'); } finally { setTxBusy(false); }
  }

  const upi = cfg.data?.upi;
  return (
    <>
      <PageTitle sub="Enter an amount, then pay with any UPI app. Tax is shown before you pay.">Add Money</PageTitle>
      <Card className="space-y-4">
        {cfg.loading ? <Skeleton className="h-32" /> : !upi?.enabled ? <p className="text-sm text-zinc-400">Adding money is not available right now.</p> : (
          <>
            <Field label="Amount (₹)" inputMode="decimal" placeholder="500" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              hint={lim ? `Min ${inr(lim.min.rupees)} · Max ${inr(lim.max.rupees)}` : undefined} />
            <Quote amount={amount} />

            {paid ? (
              <div className="text-center"><SuccessMark /><p className="mt-3 font-semibold text-emerald-300">{inr(paid.amount.rupees)} received. Your wallet has been credited.</p>
                <Button className="mt-4 w-full" onClick={() => { setAmount(''); setPaid(null); setOrder(null); }}>Done</Button></div>
            ) : order ? (
              <div className="space-y-3 text-center">
                {mobile ? (
                  <a href={order.uri} className="block w-full rounded-xl bg-gradient-to-r from-gold-400 to-orange-500 px-4 py-3.5 text-center text-base font-bold text-black shadow-lg">Pay With UPI · {inr(order.amount.rupees)}</a>
                ) : (
                  <div className="flex flex-col items-center gap-2 rounded-2xl bg-ink-900 p-4"><QR value={order.uri} size={176} name="upi-pay" /><p className="text-xs text-zinc-400">Scan with any UPI app to pay {inr(order.amount.rupees)}</p>
                    <a href={order.uri} className="text-xs text-gold-400 underline">Pay With UPI</a></div>
                )}
                <p className="text-xs text-zinc-400">Pick PhonePe, Paytm, Amazon Pay, FamPay or any UPI app. The amount is already filled in, so just confirm and pay. Keep the note <span className="font-mono">{order.id}</span> unchanged.</p>
                <p className="flex items-center justify-center gap-2 text-xs text-amber-200"><Spinner /> Waiting for your payment. Your balance updates by itself once it arrives.</p>
              </div>
            ) : making ? <p className="flex items-center justify-center gap-2 py-2 text-sm text-zinc-400"><Spinner /> Creating your payment link…</p>
              : valid && amount === settled ? null
              : valid ? <p className="py-2 text-center text-sm text-zinc-500">Your Pay With UPI link will appear in a moment…</p> : null}
            {err && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{err}</p>}
          </>
        )}
      </Card>

      {upi?.enabled && (
        <Card className="mt-5">
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Paid but the balance did not change?</summary>
            <form onSubmit={submitTx} className="mt-3 space-y-3">
              <p className="text-xs text-zinc-400">Enter the amount above and the transaction ID (12 digits, shown in your UPI app under the payment). We check it against the bank record and credit it.</p>
              <Field label="Transaction ID" placeholder="123456789012" value={txId} onChange={(e) => setTxId(e.target.value.toUpperCase())} />
              <Button className="w-full" loading={txBusy} disabled={!AMOUNT_RE.test(amount) || txId.length < 12}>Submit for verification</Button>
              {txMsg && <p className={txMsg.tone === 'ok' ? 'rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200' : txMsg.tone === 'wait' ? 'rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200' : 'rounded-xl bg-red-500/10 p-3 text-sm text-red-200'}>{txMsg.text}</p>}
            </form>
          </details>
        </Card>
      )}

      <Card className="mt-5">
        <h2 className="mb-3 font-semibold">Payment history</h2>
        {hist.loading ? <Skeleton className="h-16" /> : !hist.data?.upi.length && !hist.data?.utr.length ? <Empty title="No deposits yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="py-2">Method</th><th>Reference</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody className="divide-y divide-ink-700">
              {[...hist.data.upi.map((r: any) => ({ k: r.id, m: 'Pay With UPI', ref: r.id, a: r.amount, s: r.status, d: r.createdAt })), ...hist.data.utr.map((r: any) => ({ k: r.id, m: 'Transaction ID', ref: r.utr, a: r.amount, s: r.status, d: r.createdAt }))]
                .sort((a, b) => +new Date(b.d) - +new Date(a.d)).map((r) => <tr key={r.k}><td className="py-2.5">{r.m}</td><td className="max-w-[10rem] truncate font-mono text-xs">{r.ref}</td><td>{inr(r.a.rupees)}</td><td><Badge status={r.s} /></td><td className="whitespace-nowrap text-xs text-zinc-500">{when(r.d)}</td></tr>)}
            </tbody></table></div>)}
      </Card>
    </>
  );
}
