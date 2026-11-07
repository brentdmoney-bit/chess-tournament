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
