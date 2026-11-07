import { useState } from 'react';
import { fmtScore, fullName, ordinal } from '../lib/chess.ts';
import type { Profile } from '../lib/supabase.ts';
import { useTournament, type TournamentState } from '../lib/useTournament.ts';
import { Attendance, Awards, Chat, PairingsTable, Progress, Results, Shirts, StandingsView, useStandings } from '../panels.tsx';
import { Badge, Card, Empty, ErrorBar, H1, Shell, Stat, Table, Td, useToast } from '../ui.tsx';

/** Student Activities: read-only view of everything, plus staff chat. */
export default function SA({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const s = useTournament('SA');
  const { toast, node } = useToast();
  const [tab, setTab] = useState('overview');
  const t = s.t;
  const tabs = ['overview', 'attendance', 'rosters', 'pairings', 'results', 'standings', 'awards', 'shirts'];

  return (
    <Shell role="SA" who={profile.display_name ?? 'Student Activities'} t={t} onSignOut={onSignOut} tab={tab} setTab={setTab}
      tabs={tabs.map((id) => ({ id, label: id === 'shirts' ? 'T-shirts' : id[0].toUpperCase() + id.slice(1) }))}>
      <ErrorBar error={s.error} onClose={() => s.setError(null)} />
      <div className="mb-4 rounded-xl border border-sa/40 bg-sa/10 px-3 py-2 text-center text-xs font-semibold text-sa">View only</div>
      {!s.loaded ? null : !t ? <Empty>No tournament is running.</Empty> : (
        <>
          {tab === 'overview' && <Overview s={s} toast={toast} />}
          {tab === 'attendance' && <Attendance s={s} canEdit={false} toast={toast} />}
          {tab === 'rosters' && <Rosters s={s} />}
          {tab === 'pairings' && <><H1>Round {t.current_round} pairings</H1><PairingsTable s={s} round={t.current_round} /></>}
          {tab === 'results' && <Results s={s} canEdit={false} toast={toast} />}
          {tab === 'standings' && <StandingsView s={s} />}
          {tab === 'awards' && <Awards s={s} canEdit={false} toast={toast} />}
          {tab === 'shirts' && <Shirts s={s} />}
        </>
      )}
      <Chat s={s} profile={profile} />
      {node}
    </Shell>
  );
}

export function Overview({ s, toast, canResolve = false }: { s: TournamentState; toast: (m: string, bad?: boolean) => void; canResolve?: boolean }) {
  const st = useStandings(s);
  const competing = s.players.filter((p) => p.status === 'present').length;
  const leaders = st.grades.map((g) => ({ g, top: st.byGrade.get(g)?.[0] })).filter((x) => x.top && x.top.score > 0);
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Schools" value={s.schools.length} />
        <Stat label="Players" value={competing} sub={`competing of ${s.players.length} registered`} />
        <Stat label="Round" value={`${s.t!.current_round}/${s.t!.total_rounds}`} />
        <Stat label="Coaches here" value={`${s.coaches.filter((c) => c.checked_in_at).length}/${s.coaches.filter((c) => c.approved).length}`} />
      </div>
      <Progress s={s} toast={toast} canResolve={canResolve} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Leader in each grade">
          {!leaders.length ? <p className="text-sm text-mute">No games finished yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {leaders.map(({ g, top }) => (
                <li key={g} className="flex items-center gap-3 py-2">
                  <Badge tone="gold">{ordinal(g)}</Badge><span className="flex-1"><b>{fullName(top!.player)}</b> <span className="text-mute">· {top!.player.school}</span></span>
                  <b>{fmtScore(top!.score)}</b>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Top schools">
          <ul className="divide-y divide-line text-sm">
            {st.teams.slice(0, 5).map((tm, i) => (
              <li key={tm.school} className="flex items-center gap-3 py-2"><span className="w-5 font-bold text-gold">{i + 1}</span><span className="flex-1">{tm.school}</span><b>{fmtScore(tm.score)}</b></li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

export function Rosters({ s }: { s: TournamentState }) {
  const grades = [...(s.t?.active_grades ?? [])].sort((a, b) => a - b);
  const tone = { present: 'good', absent: 'bad', withdrawn: 'bad', registered: 'ghost' } as const;
  return (
    <>
      <H1 sub="Status comes straight from each coach's check-in.">Rosters</H1>
      <div className="space-y-4">
        {grades.map((g) => {
          const list = s.players.filter((p) => p.grade === g);
          if (!list.length) return null;
          return (
            <Card key={g} title={`${ordinal(g)} grade · ${list.length}`}>
              <Table head={['Name', 'School', 'Coach', 'Status']}>
                {list.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{fullName(p)}</Td><Td className="text-mute">{p.school}</Td><Td className="text-mute">{p.coach_name ?? '—'}</Td>
                    <Td><Badge tone={tone[p.status]}>{p.status === 'registered' ? 'Not checked in' : p.status[0].toUpperCase() + p.status.slice(1)}</Badge></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          );
        })}
      </div>
    </>
  );
}
