import { useState } from 'react';
import type { Profile } from '../lib/supabase.ts';
import { useTournament } from '../lib/useTournament.ts';
import { Awards, Chat, PairingsTable, Results, StandingsView } from '../panels.tsx';
import { Overview } from './SA.tsx';
import { Empty, ErrorBar, H1, Shell, useToast } from '../ui.tsx';

/** Tournament Admin: floor manager. Fixes boards before the round locks, corrects results, answers scorers. */
export default function Admin({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const s = useTournament('Admin');
  const { toast, node } = useToast();
  const [tab, setTab] = useState('dashboard');
  const t = s.t;
  const helpCount = s.help.filter((h) => !h.resolved_at).length;
  const locked = t?.round_phase === 'locked' || t?.round_phase === 'complete';

  return (
    <Shell role="Admin" who={profile.display_name ?? 'Admin'} t={t} onSignOut={onSignOut} tab={tab} setTab={setTab}
      tabs={[{ id: 'dashboard', label: 'Dashboard', badge: helpCount }, { id: 'pairings', label: 'Pairings' }, { id: 'results', label: 'Results' }, { id: 'standings', label: 'Standings' }, { id: 'awards', label: 'Awards' }]}>
      <ErrorBar error={s.error} onClose={() => s.setError(null)} />
      {!s.loaded ? null : !t ? <Empty>No tournament is running.</Empty> : (
        <>
          {tab === 'dashboard' && <Overview s={s} toast={toast} canResolve />}
          {tab === 'pairings' && (
            <>
              <H1 sub={locked ? 'The director locked this round. Board changes are closed; correct results under Results.' : 'Swap players on a board before results come in. Every change is logged.'}>Round {t.current_round} pairings</H1>
              <PairingsTable s={s} round={t.current_round} editable={!locked} toast={toast} />
            </>
          )}
          {tab === 'results' && <Results s={s} canEdit toast={toast} />}
          {tab === 'standings' && <StandingsView s={s} />}
          {tab === 'awards' && <Awards s={s} canEdit={false} toast={toast} />}
        </>
      )}
      <Chat s={s} profile={profile} />
      {node}
    </Shell>
  );
}
