'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { when } from '@/lib/format';
import { Badge, Button, Card, Field, PageTitle, Skeleton, useToast } from '@/components/ui';

export default function Profile() {
  const p = useApi<any>(`${W}/profile`); const s = useApi<any>(`${W}/auth/sessions`); const router = useRouter(); const toast = useToast();
  const [name, setName] = useState(''); const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' }); const [busy, setBusy] = useState(false);
  useEffect(() => { if (p.data) setName(p.data.profile.name ?? ''); }, [p.data]);
  const pr = p.data?.profile;
  const act = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { await fn(); toast(ok); } catch (e) { toast((e as ApiError).message, 'err'); } finally { setBusy(false); } };

  return (
    <>
      <PageTitle>Profile</PageTitle>
      <Card>{p.loading ? <Skeleton className="h-32" /> : (<>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[['Email', pr.email], ['Mobile', pr.mobile], ['Payment ID', pr.paymentId], ['Registered', when(pr.createdAt)]].map(([k, v]) => <div key={k}><dt className="text-xs text-zinc-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          <div><dt className="text-xs text-zinc-500">Verification</dt><dd><Badge status={pr.emailVerified ? 'VERIFIED' : 'PENDING'} /></dd></div>
          <div><dt className="text-xs text-zinc-500">Transaction PIN</dt><dd><Badge status={pr.pinSet ? 'ACTIVE' : 'PENDING'} /></dd></div>
        </dl>
        <div className="mt-4 flex gap-2"><div className="flex-1"><Field placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} /></div><Button variant="ghost" loading={busy} disabled={!name.trim()} onClick={() => act(async () => { await api(`${W}/profile`, { method: 'PATCH', body: { name } }); p.reload(); window.dispatchEvent(new Event('pg:profile')); }, 'Profile updated')}>Save</Button></div>
      </>)}</Card>

      <Card className="mt-5"><h2 className="mb-3 font-semibold">Change password</h2>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api(`${W}/profile/password`, { body: pw }); setPw({ currentPassword: '', newPassword: '', confirmPassword: '' }); }, 'Password changed. Other devices were signed out.'); }}>
          <Field label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          <Field label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <Field label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
          <Button loading={busy}>Update password</Button></form></Card>

      <Card className="mt-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Active sessions</h2>
        <Button variant="danger" onClick={async () => { await api(`${W}/auth/logout-all`, { method: 'POST', body: {} }); router.replace('/login'); }}>Log out everywhere</Button></div>
        {s.loading ? <Skeleton className="h-12" /> : <ul className="divide-y divide-ink-700 text-sm">{s.data.sessions.map((x: any) => (
          <li key={x.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate">{x.userAgent || 'Unknown device'} {x.current && <Badge status="ACTIVE" />}</p><p className="text-xs text-zinc-500">{x.ip} · last active {when(x.lastSeenAt)}</p></div>
            {!x.current && <button className="text-xs text-red-300" onClick={async () => { await api(`${W}/auth/sessions/${x.id}`, { method: 'DELETE' }); s.reload(); }}>Revoke</button>}</li>))}</ul>}</Card>
    </>
  );
}
