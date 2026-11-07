import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured, rpc, type Profile } from './lib/supabase.ts';
import { SignIn, ScorerJoin, RequestAccess } from './Auth.tsx';
import { useTheme } from './ui.tsx';
import TD from './screens/TD.tsx';
import Admin from './screens/Admin.tsx';
import Coach from './screens/Coach.tsx';
import Scorer from './screens/Scorer.tsx';
import SA from './screens/SA.tsx';

export default function App() {
  return <><UpdateBanner /><Routes /></>;
}

declare const __BUILD_ID__: string;
/** Shows a bar with a hard-refresh button once a newer build is live. Checks every minute and when the tab wakes. */
function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const check = () => fetch('/version.json', { cache: 'no-store' })
      .then((r) => r.json()).then((v) => { if (v.id && v.id !== __BUILD_ID__) setStale(true); }).catch(() => {});
    const onWake = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onWake);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onWake); };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-gold px-4 py-2 text-sm font-semibold text-gold-ink">
      A new version is ready.
      <button onClick={() => window.location.reload()} className="min-h-9 rounded-lg bg-neutral-900 px-3 font-bold text-white">Refresh now</button>
    </div>
  );
}

function Routes() {
  useTheme(); // applies the saved theme before any screen renders
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const recheck = () => rpc<Profile>('ensure_profile').then(setProfile);
  useEffect(() => {
    if (!uid) { setProfile(null); return; }
    setErr(null);
    recheck().catch((e) => setErr(e.message));
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); };

  if (!configured) return <Center>This copy isn't connected to its database yet (missing Supabase settings).</Center>;
  if (session === undefined) return <Center><span className="animate-pulse text-4xl text-gold">♚</span></Center>;
  if (!session) return <SignIn />;
  if (err) return <Center>{err}<button className="mt-4 block w-full text-gold underline" onClick={signOut}>Sign out</button></Center>;
  if (!profile) return <Center><span className="animate-pulse text-4xl text-gold">♚</span></Center>;

  const props = { profile, onSignOut: signOut };
  switch (profile.role) {
    case 'TD': return <TD {...props} />;
    case 'Admin': return <Admin {...props} />;
    case 'Coach': return <Coach {...props} />;
    case 'Scorer': return <Scorer {...props} />;
    case 'SA': return <SA {...props} />;
    default:
      return session.user.is_anonymous
        ? <ScorerJoin onJoined={setProfile} onSignOut={signOut} />
        : <RequestAccess profile={profile} onSignOut={signOut} onRecheck={recheck} />;
  }
}

export function Center({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-mute"><div className="max-w-sm">{children}</div></div>;
}
