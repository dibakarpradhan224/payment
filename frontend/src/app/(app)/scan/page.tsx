'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { Button, Card, ErrorBox, Field, PageTitle } from '@/components/ui';
import { Scanner } from '@/components/QR';
import { PayRequest } from '@/components/PayRequest';

export default function Scan() {
  const router = useRouter();
  const [req, setReq] = useState<any>(null); const [err, setErr] = useState(''); const [manual, setManual] = useState(''); const [busy, setBusy] = useState(false);
  async function handle(payload: string) {
    setErr(''); setBusy(true);
    try {
      const r = await api<any>(`${W}/qr/resolve`, { body: { payload } });
      if (r.type === 'REQUEST') setReq(r.request);
      else router.push(`/send?to=${encodeURIComponent(r.recipient.paymentId)}${r.amount ? `&amount=${r.amount}` : ''}`);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  if (req) return <div className="mx-auto max-w-md"><PageTitle>Confirm payment</PageTitle><PayRequest request={req} /><Button variant="ghost" className="mt-3 w-full" onClick={() => setReq(null)}>Scan another</Button></div>;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageTitle sub="Point your camera at a payment QR code.">Scan QR</PageTitle>
      <Scanner onResult={handle} />
      {err && <ErrorBox message={err} />}
      <Card><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void handle(manual.trim()); }}>
        <Field label="Or paste a payment code" placeholder="payment://receive?request=REQ-…" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button variant="ghost" className="w-full" loading={busy} disabled={!manual}>Continue</Button>
      </form></Card>
    </div>
  );
}
