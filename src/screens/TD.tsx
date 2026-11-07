import { useState } from 'react';
import { ordinal, pairRound } from '../lib/chess.ts';
import { supabase, rpc, must, type Profile } from '../lib/supabase.ts';
import { useTournament, type TournamentState } from '../lib/useTournament.ts';
import { Attendance, Awards, Chat, PairingsTable, Progress, Results, Shirts, StandingsView } from '../panels.tsx';
import { Overview } from './SA.tsx';
import { Access, CreateTournament, Players, Scorers, Settings, useRegSync } from './TDSetup.tsx';
import { Badge, Btn, Card, Empty, ErrorBar, H1, Shell, Stat, cx, useAction, useToast } from '../ui.tsx';

type Toast = (m: string, bad?: boolean) => void;

export default function TD({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const s = useTournament('TD');
  useRegSync(s); // keeps Attendance's Registered column in step with the registration sheet
  const { toast, node } = useToast();
  const [tab, setTab] = useState('show');
  const t = s.t;
  const pendingAccess = s.requests.filter((r) => r.status === 'pending').length;
  const help = s.help.filter((h) => !h.resolved_at).length;

  if (s.loaded && !t && !s.error) return <CreateTournament profile={profile} onSignOut={onSignOut} />;

  const tabs = [
    { id: 'show', label: 'Run of show' },
    { id: 'dashboard', label: 'Dashboard', badge: help },
    { id: 'round', label: 'Pairings' },
    { id: 'results', label: 'Results' },
    { id: 'standings', label: 'Standings' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'players', label: 'Players' },
    { id: 'access', label: 'Access', badge: pendingAccess },
    { id: 'scorers', label: 'Scorers' },
    { id: 'awards', label: 'Awards' },
    { id: 'shirts', label: 'T-shirts' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <Shell role="TD" who={profile.display_name ?? 'Director'} t={t} onSignOut={onSignOut} tabs={tabs} tab={tab} setTab={setTab}>
      <ErrorBar error={s.error} onClose={() => s.setError(null)} />
      {!s.loaded || !t ? null : (
        <>
          {tab === 'show' && <RunOfShow s={s} go={setTab} />}
          {tab === 'dashboard' && <Overview s={s} toast={toast} canResolve />}
          {tab === 'round' && <RoundControl s={s} toast={toast} />}
          {tab === 'results' && <Results s={s} canEdit toast={toast} />}
          {tab === 'standings' && <StandingsView s={s} />}
          {tab === 'attendance' && <Attendance s={s} canEdit toast={toast} />}
          {tab === 'players' && <Players s={s} toast={toast} />}
          {tab === 'access' && <Access s={s} toast={toast} />}
          {tab === 'scorers' && <Scorers s={s} toast={toast} />}
          {tab === 'awards' && <Awards s={s} canEdit toast={toast} />}
          {tab === 'shirts' && <Shirts s={s} />}
          {tab === 'settings' && <Settings s={s} toast={toast} />}
        </>
      )}
      <Chat s={s} profile={profile} />
      {node}
    </Shell>
  );
}

/* ── Run of show: every step checks itself off from the real data ─────── */
function RunOfShow({ s, go }: { s: TournamentState; go: (tab: string) => void }) {
  const t = s.t!;
  const r = t.current_round;
  const unmarkedSchools = s.schools.filter((sc) => s.players.some((p) => p.school === sc && p.status === 'registered'));
  const allScored = s.roundGames.length > 0 && s.roundGames.every((g) => g.result);
  const after = (phases: string[]) => phases.includes(t.round_phase);
  let texted = false; try { texted = localStorage.getItem(`texted-${t.id}-${r}`) === '1'; } catch { /* private mode */ }

  const phases: { title: string; steps: { label: string; done: boolean; tab: string; note?: string }[] }[] = [];
  if (r === 1) phases.push({
    title: 'Before round 1',
    steps: [
      { label: 'Load the student roster', done: s.players.length > 0, tab: 'players', note: `${s.players.length} students` },
      { label: 'Coach list with emails and cell numbers', done: s.coaches.length > 0, tab: 'access', note: `${s.coaches.length} coaches` },
      { label: 'Set the check-in cutoff time', done: !!t.checkin_cutoff, tab: 'settings' },
      { label: 'Clear access requests', done: !s.requests.some((x) => x.status === 'pending'), tab: 'access' },
      { label: 'Every school has marked attendance', done: unmarkedSchools.length === 0 && s.players.length > 0, tab: 'attendance', note: unmarkedSchools.length ? `${unmarkedSchools.length} schools still have unmarked students` : undefined },
    ],
  });
  phases.push({
    title: `Round ${r}`,
    steps: [
      { label: 'Generate pairings', done: after(['draft', 'published', 'locked', 'complete']), tab: 'round' },
      { label: 'Post pairings (coaches and scorers see them)', done: after(['published', 'locked', 'complete']), tab: 'round' },
      { label: 'Text coaches their boards', done: texted, tab: 'round' },
      { label: 'Lock the round', done: after(['locked', 'complete']), tab: 'round' },
      { label: 'Every board scored', done: allScored, tab: 'dashboard', note: `${s.roundGames.filter((g) => g.result).length}/${s.roundGames.length}` },
      { label: 'Help requests answered', done: !s.help.some((h) => !h.resolved_at), tab: 'dashboard' },
      { label: r < t.total_rounds ? `Finish round, start round ${r + 1}` : 'Finish the last round', done: t.round_phase === 'complete', tab: 'round' },
    ],
  });
  if (r === t.total_rounds) phases.push({
    title: 'Wrap up',
    steps: [
      { label: 'Check award score ranges', done: t.ended, tab: 'awards' },
      { label: 'End the tournament (makes awards final)', done: t.ended, tab: 'settings' },
    ],
  });

  const all = phases.flatMap((p) => p.steps);
  const done = all.filter((x) => x.done).length;
  return (
    <>
      <H1 sub="Steps tick themselves off from what's actually happened. Tap one to go do it.">Run of show</H1>
      <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(done / all.length) * 100}%` }} /></div>
      <div className="space-y-4">
        {phases.map((p) => (
          <Card key={p.title} title={`${p.title} · ${p.steps.filter((x) => x.done).length}/${p.steps.length}`}>
            <ul className="space-y-1">
              {p.steps.map((x, i) => {
                const next = !x.done && p.steps.slice(0, i).every((y) => y.done);
                return (
                  <li key={x.label}>
                    <button onClick={() => go(x.tab)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-panel-2', next && 'bg-gold/10 ring-1 ring-gold/40')}>
                      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold', x.done ? 'bg-good text-black' : 'border border-line text-mute')}>{x.done ? '✓' : i + 1}</span>
                      <span className={cx('flex-1 text-sm', x.done && 'text-mute line-through')}>{x.label}{x.note && <span className="block text-xs text-mute">{x.note}</span>}</span>
                      <span className="text-mute">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ── Round control: pair → post → text → lock → finish → next ───────────── */
function RoundControl({ s, toast }: { s: TournamentState; toast: Toast }) {
  const t = s.t!;
  const r = t.current_round;
  const { busy, run } = useAction(toast);
  const present = s.players.filter((p) => p.status === 'present');
  const unmarked = s.players.filter((p) => p.status === 'registered');
  const ph = t.round_phase;
  const scored = s.roundGames.filter((g) => g.result).length;

  const generate = () => {
    if (ph !== 'setup' && !confirm('Throw away these pairings and make new ones?')) return;
    void run('pair', async () => {
      const pairs = pairRound(s.players, s.games.filter((g) => g.round < r), r, t.active_grades);
      if (!pairs.length) throw new Error('Nobody is marked present in a grade that is playing.');
      await rpc('save_pairings', { p_round: r, p_games: pairs });
    }, 'Pairings ready. Check them, then post.');
  };

  const nudge = () => run('nudge', async () => {
    const schools = [...new Set(unmarked.map((p) => p.school))];
    await must(supabase.from('notices').insert(schools.map((school) => ({
      tournament_id: t.id, school, body: 'Please mark every student here or absent now. Pairings are about to be made.',
    }))));
  }, 'Reminder sent to those coaches');

  const text = (kind: 'pairings' | 'final') => run('text', async () => {
    const { data, error } = await supabase.functions.invoke('text-coaches', { body: { round: r, kind } });
    if (error) throw new Error(`Texts failed: ${error.message}`);
    if (kind === 'pairings') try { localStorage.setItem(`texted-${t.id}-${r}`, '1'); } catch { /* private mode */ }
    toast(data?.dryRun ? `Dry run: ${data.sent} texts composed (SMS isn't connected yet)` : `Texted ${data?.sent ?? 0} coaches`);
  });

  const phase = (p: string, msg: string) => run(p, () => rpc('set_round_phase', { p_phase: p }), msg);

  return (
    <>
      <H1 sub={`Round ${r} of ${t.total_rounds}`}
        action={<>
          {ph === 'setup' && <Btn tone="gold" disabled={busy === 'pair'} onClick={generate}>Generate pairings</Btn>}
          {ph === 'draft' && <>
            <Btn disabled={busy === 'pair'} onClick={generate}>Re-pair</Btn>
            <Btn tone="gold" disabled={!!busy} onClick={() => phase('published', 'Posted. Coaches and scorers can see the boards.')}>Post pairings</Btn>
          </>}
          {(ph === 'published' || ph === 'locked') && <Btn tone="info" disabled={busy === 'text'} onClick={() => text('pairings')}>{busy === 'text' ? 'Texting…' : 'Text coaches'}</Btn>}
          {ph === 'published' && <Btn tone="warn" disabled={!!busy} onClick={() => phase('locked', 'Round locked. Boards can no longer be changed.')}>Lock round</Btn>}
          {ph === 'locked' && <Btn disabled={!!busy} onClick={() => phase('published', 'Unlocked')}>Unlock</Btn>}
          {(ph === 'published' || ph === 'locked') && <Btn tone="good" disabled={!!busy || scored < s.roundGames.length} onClick={() => phase('complete', `Round ${r} complete`)}>Finish round</Btn>}
          {ph === 'complete' && r < t.total_rounds && <Btn tone="gold" disabled={!!busy} onClick={() => run('adv', () => rpc('advance_round'), `Round ${r + 1} started. Pair it when ready.`)}>Start round {r + 1}</Btn>}
          {ph === 'complete' && r === t.total_rounds && <Btn tone="info" disabled={busy === 'text'} onClick={() => text('final')}>Text final results</Btn>}
        </>}>
        Pairings
      </H1>

      {ph === 'setup' ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...t.active_grades].sort((a, b) => a - b).map((g) => (
              <Stat key={g} label={`${ordinal(g)} grade`} value={present.filter((p) => p.grade === g).length} sub="present" />
            ))}
          </div>
          {r === 1 && unmarked.length > 0 && (
            <Card className="mb-4">
              <p className="text-sm"><b className="text-warn">{unmarked.length} students</b> from {new Set(unmarked.map((p) => p.school)).size} schools aren't marked here or absent. Unmarked students won't be paired.</p>
              <Btn tone="warn" className="mt-3" disabled={busy === 'nudge'} onClick={nudge}>Remind those coaches</Btn>
            </Card>
          )}
          <Empty>
            Swiss pairing inside each grade: round 1 is a random draw that keeps schoolmates apart, later rounds match equal scores,
            nobody plays the same opponent twice, and an odd player out gets a 1-point bye (never twice).
          </Empty>
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={ph === 'draft' ? 'warn' : 'good'}>{ph === 'draft' ? 'Draft: only staff can see these' : ph === 'locked' ? 'Posted and locked' : ph === 'complete' ? 'Round complete' : 'Posted'}</Badge>
            <Badge>{scored}/{s.roundGames.length} scored</Badge>
          </div>
          {(ph === 'published' || ph === 'locked') && <div className="mb-4"><Progress s={s} toast={toast} canResolve /></div>}
          <PairingsTable s={s} round={r} editable={ph === 'draft' || ph === 'published'} toast={toast} />
        </>
      )}
    </>
  );
}
