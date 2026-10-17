'use client';
import { useState } from 'react';
import { api, ApiError, W } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { copy, when } from '@/lib/format';
import { Badge, Button, Card, Field, PageTitle, Skeleton, Tabs, useToast } from '@/components/ui';
import { PinReset } from '@/components/PinReset';
import { applyTheme, getTheme, saveTheme, THEMES, type Theme } from '@/lib/theme';
import { useEffect } from 'react';

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);

function PinSettings() {
  const toast = useToast();
  const [mode, setMode] = useState<'change' | 'reset'>('change');
  const [c, setC] = useState({ oldPin: '', pin: '', confirmPin: '' }); const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-4"><Tabs tabs={[{ id: 'change', label: 'Change PIN' }, { id: 'reset', label: 'Forgot PIN' }]} value={mode} onChange={(m) => setMode(m as any)} />
      {mode === 'change' ? (<>
        <Field label="Current PIN" type="password" inputMode="numeric" value={c.oldPin} onChange={(e) => setC({ ...c, oldPin: digits(e.target.value) })} />
        <Field label="New PIN" type="password" inputMode="numeric" value={c.pin} onChange={(e) => setC({ ...c, pin: digits(e.target.value) })} />
        <Field label="Confirm new PIN" type="password" inputMode="numeric" value={c.confirmPin} onChange={(e) => setC({ ...c, confirmPin: digits(e.target.value) })} />
        <Button loading={busy} onClick={async () => { setBusy(true); try { await api(`${W}/auth/pin/change`, { body: c }); setC({ oldPin: '', pin: '', confirmPin: '' }); toast('PIN updated'); } catch (e) { toast((e as ApiError).message, 'err'); } finally { setBusy(false); } }}>Update PIN</Button></>
      ) : <PinReset />}
    </Card>
  );
}

function ProfileName() {
  const p = useApi<any>(`${W}/profile`); const toast = useToast();
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (p.data) setName(p.data.profile.name ?? ''); }, [p.data]);
  async function save() {
    setBusy(true); setErr('');
    try { await api(`${W}/profile`, { method: 'PATCH', body: { name: name.trim() } }); toast('Name saved'); p.reload(); window.dispatchEvent(new Event('pg:profile')); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <Card className="space-y-4">
      {p.loading ? <Skeleton className="h-24" /> : (<>
        <div><h2 className="font-semibold">Your name</h2><p className="text-sm text-zinc-400">This is the name people see when they search for you to send money. It is never your email address.</p></div>
        <Field label="Display name" maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={err} hint="2 to 60 characters: letters, numbers, spaces and . ' - only" />
        <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm"><span className="text-zinc-500">Your Payment ID</span><span className="font-mono text-gold-300">{p.data.profile.paymentId}</span></div>
        <Button loading={busy} disabled={name.trim().length < 2 || name.trim() === (p.data.profile.name ?? '')} onClick={save}>Save name</Button>
      </>)}
    </Card>
  );
}

function Appearance() {
  const [theme, setTheme] = useState<Theme>('gold'); const toast = useToast();
  useEffect(() => setTheme(getTheme()), []);
  const pick = (t: Theme) => { setTheme(t); saveTheme(t); toast(`${THEMES.find((x) => x.id === t)!.name} theme on`); };
  return (
    <Card className="space-y-4">
      <div><h2 className="font-semibold">Theme</h2><p className="text-sm text-zinc-400">Changes the colours and the button effects everywhere. Tap any button to see it.</p></div>
      <div className="grid gap-3">{THEMES.map((t) => (
        <button key={t.id} data-theme={t.id === 'gold' ? undefined : t.id} onClick={() => pick(t.id)} className={`btn-ff flex items-center justify-between gap-4 border px-5 py-4 text-left ${theme === t.id ? 'border-gold-500 bg-gold-500/15' : 'border-ink-600 bg-ink-900'}`}>
          <span><span className="block text-base font-extrabold">{t.name}</span><span className="text-xs text-zinc-400">{t.tag}</span></span>
          <span className="flex items-center gap-1.5">{t.colors.map((c) => <span key={c} className="h-5 w-5 rounded-full border border-white/20" style={{ background: c }} />)}{theme === t.id && <span className="ml-2 text-xs font-bold text-gold-300">ACTIVE</span>}</span>
        </button>))}
      </div>
      <p className="text-xs text-zinc-500">The API documentation page switches by itself: Payout API uses Sukuna, Merchant API uses Gojo. It returns to your theme when you leave.</p>
    </Card>
  );
}

function Telegram() {
  const t = useApi<any>(`${W}/telegram`); const toast = useToast(); const [code, setCode] = useState<string | null>(null);
  return (
    <Card className="space-y-3">{t.loading ? <Skeleton className="h-16" /> : t.data.linked ? (<>
      <div className="flex items-center justify-between"><p>Linked{t.data.username ? ` as @${t.data.username}` : ''}</p><Badge status="LINKED" /></div>
      <Button variant="danger" onClick={async () => { await api(`${W}/telegram`, { method: 'DELETE' }); t.reload(); toast('Unlinked'); }}>Unlink Telegram</Button></>) : (<>
      <p className="text-sm text-zinc-400">Link your Telegram so the bot and Mini App use this same wallet.</p>
      {code ? <div className="rounded-xl bg-ink-900 p-4 text-center"><p className="text-xs text-zinc-500">Send this to {t.data.botUsername ? `@${t.data.botUsername}` : 'the bot'} within 10 minutes</p><p className="mt-1 font-mono text-xl text-gold-300">/link {code}</p>
        <Button variant="ghost" className="mt-2" onClick={async () => toast((await copy(`/link ${code}`)) ? 'Copied' : 'Copy failed')}>Copy</Button></div>
        : <Button onClick={async () => setCode((await api<any>(`${W}/telegram/link-code`, { method: 'POST', body: {} })).code)}>Get link code</Button>}</>)}</Card>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('profile');
  const p = useApi<any>(`${W}/profile`); const n = useApi<any>(`${W}/notifications`); const toast = useToast();
  const pref = async (k: 'notifyEmail' | 'notifyTelegram', v: boolean) => { await api(`${W}/profile`, { method: 'PATCH', body: { [k]: v } }); p.reload(); toast('Saved'); };
  return (
    <>
      <PageTitle>Settings</PageTitle>
      <Tabs tabs={[{ id: 'profile', label: 'Profile' }, { id: 'appearance', label: 'Theme' }, { id: 'security', label: 'Security' }, { id: 'notifications', label: 'Notifications' }, { id: 'telegram', label: 'Telegram' }]} value={tab} onChange={setTab} />
      <div className="mt-4 space-y-4">
        {tab === 'profile' && <ProfileName />}
        {tab === 'appearance' && <Appearance />}
        {tab === 'security' && <PinSettings />}
        {tab === 'notifications' && (<>
          <Card className="space-y-3">{p.data && [['notifyEmail', 'Email notifications'], ['notifyTelegram', 'Telegram notifications']].map(([k, l]) => (
            <label key={k} className="flex items-center justify-between text-sm"><span>{l}</span><input type="checkbox" className="h-5 w-5 accent-orange-500" checked={p.data.profile[k!]} onChange={(e) => pref(k as any, e.target.checked)} /></label>))}</Card>
          <Card><div className="mb-2 flex justify-between"><h2 className="font-semibold">Recent</h2><button className="text-xs text-gold-400" onClick={async () => { await api(`${W}/notifications/read-all`, { method: 'POST', body: {} }); n.reload(); }}>Mark all read</button></div>
            {n.data?.notifications.length ? <ul className="divide-y divide-ink-700">{n.data.notifications.map((x: any) => <li key={x.id} className="py-2.5 text-sm"><p className={x.read ? 'text-zinc-400' : 'font-semibold'}>{x.title}</p><p className="text-xs text-zinc-500">{x.body} · {when(x.createdAt)}</p></li>)}</ul> : <p className="text-sm text-zinc-500">Nothing yet.</p>}</Card></>)}
        {tab === 'telegram' && <Telegram />}
      </div>
    </>
  );
}
