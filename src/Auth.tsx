import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase, rpc, type Profile } from './lib/supabase.ts';
import { Btn, Field, Select, Badge, cx } from './ui.tsx';

function Frame({ sub, children }: { sub: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,var(--panel-2),var(--bg)_60%)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-5xl text-gold">♚</div>
          <h1 className="mt-2 font-display text-2xl font-bold">Chess Tournament</h1>
          <p className="text-sm text-mute">{sub}</p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5 shadow-2xl">{children}</div>
      </div>
    </div>
  );
}

const Err = ({ msg }: { msg: string | null }) => (msg ? <p className="rounded-lg bg-bad/10 p-3 text-sm text-bad">{msg}</p> : null);

export function SignIn() {
  const [mode, setMode] = useState<'staff' | 'scorer'>('staff');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return setErr('Enter a valid email address.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) return setErr(error.message);
    setSent(true);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired. Send a new one.' : error.message);
  };

  const scorer = async () => {
    setErr(null); setBusy(true);
    const { error } = await supabase.auth.signInAnonymously(); // App then shows the station-code screen
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <Frame sub={mode === 'staff' ? 'Coaches and staff sign in' : 'Scoring station'}>
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1">
        {(['staff', 'scorer'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setErr(null); }}
            className={cx('rounded-lg py-2 text-sm font-semibold', mode === m ? 'bg-gold text-gold-ink' : 'text-mute')}>
            {m === 'staff' ? 'Coach / Staff' : 'Scorer'}
          </button>
        ))}
      </div>

      {mode === 'scorer' ? (
        <div className="space-y-4">
          <p className="text-sm text-mute">Volunteers scoring games: you'll need the station code from the Tournament Director. No email needed.</p>
          <Err msg={err} />
          <Btn tone="gold" big className="w-full" disabled={busy} onClick={scorer}>{busy ? 'Opening…' : 'Open scoring station'}</Btn>
        </div>
      ) : !sent ? (
        <form onSubmit={send} className="space-y-4">
          <Field label="Email" type="email" autoComplete="email" inputMode="email" placeholder="you@dallasisd.org"
            value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Err msg={err} />
          <Btn tone="gold" big className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in code'}</Btn>
          <p className="text-center text-xs text-mute">No password. Coaches on the registration list get in automatically; anyone else can request access.</p>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm">We emailed <b>{email}</b>. Tap the link in that email, or type the code from it here.</p>
          <Field label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="123456"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus className="text-center text-2xl tracking-[0.4em]" />
          <Err msg={err} />
          <Btn tone="gold" big className="w-full" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign in'}</Btn>
          <button type="button" className="w-full text-sm text-mute underline" onClick={() => { setSent(false); setCode(''); }}>Use a different email</button>
        </form>
      )}
    </Frame>
  );
}

/** Scorer joins with the station code the TD reads out, plus their real name (kept for the audit log). */
export function ScorerJoin({ onJoined, onSignOut }: { onJoined: (p: Profile) => void; onSignOut: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (name.trim().split(/\s+/).length < 2) return setErr('Enter your first and last name.');
    setBusy(true);
    try { onJoined(await rpc<Profile>('claim_scorer', { p_code: code, p_name: name })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Frame sub="Scoring station">
      <form onSubmit={join} className="space-y-4">
        <Field label="Station code" placeholder="From the Tournament Director" value={code} autoCapitalize="characters" autoFocus
          onChange={(e) => setCode(e.target.value.toUpperCase())} className="text-center text-xl tracking-widest" />
        <Field label="Your full name" placeholder="First Last" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
          hint="Recorded with every result you enter." />
        <Err msg={err} />
        <Btn tone="gold" big className="w-full" disabled={busy || !code || !name}>{busy ? 'Joining…' : 'Start scoring'}</Btn>
      </form>
      <button className="mt-4 w-full text-sm text-mute underline" onClick={onSignOut}>Cancel</button>
    </Frame>
  );
}

interface Pending { status: string; requested_role: string; school: string | null }

export function RequestAccess({ profile, onSignOut, onRecheck }: { profile: Profile; onSignOut: () => void; onRecheck: () => Promise<unknown> }) {
  const [pending, setPending] = useState<Pending | null | undefined>(undefined);
  const [f, setF] = useState({ name: profile.display_name ?? '', phone: '', requested_role: 'Coach', school: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('access_requests').select('status,requested_role,school')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setPending(data);
  };
  useEffect(() => {
    void load();
    // Flip to the app the moment the TD approves.
    const ch = supabase.channel('my-request')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'access_requests' }, () => { void onRecheck(); void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr('Enter your name.');
    if (f.requested_role.includes('Coach') && !f.school.trim()) return setErr('Enter your school.');
    setBusy(true);
    const { error } = await supabase.from('access_requests').insert({
      name: f.name.trim(), phone: f.phone.trim() || null, requested_role: f.requested_role,
      school: f.school.trim() || null, note: f.note.trim() || null, email: profile.email,
    });
    setBusy(false);
    if (error) return setErr(error.message.includes('one_pending') ? 'You already have a request waiting.' : error.message);
    void load();
  };

  if (pending === undefined) return <Frame sub="Checking…"><div className="h-24" /></Frame>;

  if (pending?.status === 'pending') {
    return (
      <Frame sub="Request sent">
        <div className="space-y-3 text-center">
          <Badge tone="warn">Waiting on the Tournament Director</Badge>
          <p className="text-sm">You asked for <b>{pending.requested_role}</b>{pending.school ? <> at <b>{pending.school}</b></> : null}. This page opens by itself once you're approved.</p>
          <Btn className="w-full" onClick={() => void onRecheck()}>Check again</Btn>
          <button className="text-sm text-mute underline" onClick={onSignOut}>Sign out</button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame sub="Request access">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-mute">Signed in as <b className="text-ink">{profile.email}</b>, which isn't on the coach list. Tell the Tournament Director who you are.</p>
        {pending?.status === 'denied' && <p className="rounded-lg bg-bad/10 p-3 text-sm text-bad">Your last request was denied. Talk to the Tournament Director before asking again.</p>}
        <Field label="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
        <Field label="Cell phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} hint="For pairing texts on tournament day." />
        <Select label="I am a" value={f.requested_role} onChange={(e) => setF({ ...f, requested_role: e.target.value })}>
          <option value="Coach">Coach</option>
          <option value="Sub Coach">Substitute coach</option>
          <option value="Admin">Tournament admin</option>
          <option value="SA">Student Activities</option>
        </Select>
        <Field label="School" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} placeholder="e.g. Bryan Adams High School" />
        <Field label="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Err msg={err} />
        <Btn tone="gold" big className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Btn>
        <button type="button" className="w-full text-sm text-mute underline" onClick={onSignOut}>Sign out</button>
      </form>
    </Frame>
  );
}
