import { useState } from 'react';
import { fullName, ordinal } from '../lib/chess.ts';
import { rpc, time, SHIRT_SIZES, type Profile, type DbPlayer } from '../lib/supabase.ts';
import { useTournament } from '../lib/useTournament.ts';
import { PairingsTable, StandingsView, outcomeFor, nameOf, useScorecard } from '../panels.tsx';
import { Badge, Btn, Card, Empty, ErrorBar, Field, H1, Select, Shell, cx, useAction, useToast } from '../ui.tsx';

export default function Coach({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const s = useTournament('Coach');
  const { toast, node } = useToast();
  const { busy, run } = useAction(toast);
  const [tab, setTab] = useState('checkin');
  const [sub, setSub] = useState({ first: '', last: '', grade: '', sid: '' });
  const card = useScorecard(toast);
  const school = profile.school ?? '';
  const t = s.t;
  const mine = s.players.filter((p) => p.school === school).sort((a, b) => a.grade - b.grade || a.last_name.localeCompare(b.last_name));
  const me = s.coaches.find((c) => c.email === profile.email);
  const cutoffPassed = !!t?.checkin_cutoff && new Date(t.checkin_cutoff) < new Date();
  const checkinOpen = !!t && t.current_round === 1 && t.round_phase === 'setup' && !cutoffPassed;
  const posted = !!t && ['published', 'locked', 'complete'].includes(t.round_phase);
  const notices = s.notices.filter((n) => !n.dismissed_at);
  const present = mine.filter((p) => p.status === 'present').length;
  const unmarked = mine.filter((p) => p.status === 'registered').length;
  const shirtKids = mine.filter((p) => p.status !== 'withdrawn');
  const noShirt = shirtKids.filter((p) => !p.shirt_size).length + (me && !me.shirt_size ? 1 : 0);

  const setStatus = (p: DbPlayer, status: string) => run(p.id, () => rpc('coach_set_status', { p_player: p.id, p_status: status }));
  const withdraw = (p: DbPlayer) => {
    if (confirm(`Withdraw ${fullName(p)} from the rest of the tournament? They won't be paired again.`)) void setStatus(p, 'withdrawn');
  };

  return (
    <Shell role="Coach" who={`${profile.display_name ?? 'Coach'} · ${school}`} t={t} onSignOut={onSignOut} tab={tab} setTab={setTab}
      tabs={[{ id: 'checkin', label: 'My players', badge: checkinOpen ? unmarked : 0 }, { id: 'pairings', label: 'Pairings' }, { id: 'history', label: 'Results' }, { id: 'standings', label: 'Standings' }, { id: 'shirts', label: 'T-shirts', badge: t?.shirts_open ? noShirt : 0 }]}>
      <ErrorBar error={s.error} onClose={() => s.setError(null)} />
      {notices.map((n) => (
        <div key={n.id} className="mb-3 flex items-start gap-3 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">
          <div className="flex-1"><div className="text-xs font-semibold uppercase tracking-wider text-bad">From the Tournament Director · {time(n.created_at)}</div>{n.body}</div>
          <button onClick={() => run(n.id, () => rpc('dismiss_notice', { p_id: n.id }))} aria-label="Dismiss">✕</button>
        </div>
      ))}

      {!s.loaded ? null : !t ? <Empty>No tournament is running.</Empty> : tab === 'checkin' ? (
        <>
          <H1 sub={checkinOpen
            ? `Mark each student here or absent.${t.checkin_cutoff ? ` Check-in closes at ${time(t.checkin_cutoff)}.` : ''} Only students marked here get paired.`
            : 'Check-in is closed. You can still withdraw a student who has to leave.'}
            action={me && (me.checked_in_at
              ? <Badge tone="good">You checked in at {time(me.checked_in_at)}</Badge>
              : <Btn tone="gold" disabled={busy === 'me'} onClick={() => run('me', () => rpc('coach_check_in'), 'Checked in. The director can see you are here.')}>I'm here</Btn>)}>
            {school}
          </H1>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="good">{present} here</Badge>
            {unmarked > 0 && <Badge tone="warn">{unmarked} not marked</Badge>}
            <Badge>{mine.length} on roster</Badge>
          </div>
          {!mine.length ? <Empty>No students from {school} on the roster. Tell the Tournament Director.</Empty> : (
            <div className="space-y-2">
              {mine.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{fullName(p)} {p.is_sub && <Badge tone="info">Sub</Badge>}</div>
                    <div className="text-xs text-mute">{ordinal(p.grade)} grade{p.student_id ? ` · ID ${p.student_id}` : ''}</div>
                  </div>
                  {p.status === 'withdrawn' ? <Badge tone="bad">Withdrawn</Badge> : checkinOpen ? (
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1">
                      {(['present', 'absent'] as const).map((st) => (
                        <button key={st} disabled={busy === p.id} onClick={() => setStatus(p, st)}
                          className={cx('min-h-10 rounded-lg px-3 text-sm font-semibold', p.status === st ? (st === 'present' ? 'bg-good text-black' : 'bg-bad text-white') : 'text-mute')}>
                          {st === 'present' ? 'Here' : 'Absent'}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <Badge tone={p.status === 'present' ? 'good' : 'ghost'}>{p.status === 'present' ? 'Playing' : 'Not playing'}</Badge>
                      {p.status === 'present' && <Btn tone="bad" disabled={busy === p.id} onClick={() => withdraw(p)}>Withdraw</Btn>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {checkinOpen && (
            <Card title="Add a substitute" className="mt-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="First name" value={sub.first} onChange={(e) => setSub({ ...sub, first: e.target.value })} />
                <Field label="Last name" value={sub.last} onChange={(e) => setSub({ ...sub, last: e.target.value })} />
                <Select label="Grade" value={sub.grade} onChange={(e) => setSub({ ...sub, grade: e.target.value })}>
                  <option value="">Pick</option>
                  {t.active_grades.map((g) => <option key={g} value={g}>{ordinal(g)}</option>)}
                </Select>
                <Field label="Student ID (optional)" value={sub.sid} onChange={(e) => setSub({ ...sub, sid: e.target.value })} />
              </div>
              <Btn tone="gold" className="mt-3" disabled={!sub.first.trim() || !sub.last.trim() || !sub.grade || busy === 'sub'}
                onClick={() => run('sub', async () => {
                  await rpc('coach_add_sub', { p_first: sub.first, p_last: sub.last, p_grade: Number(sub.grade), p_student_id: sub.sid || null });
                  setSub({ first: '', last: '', grade: '', sid: '' });
                }, 'Substitute added and marked here')}>Add substitute</Btn>
            </Card>
          )}
        </>
      ) : tab === 'pairings' ? (
        <>
          <H1 sub="Your students' boards this round. Updates live.">Round {t.current_round} pairings</H1>
          {posted ? <PairingsTable s={s} round={t.current_round} school={school} /> : <Empty>Pairings aren't posted yet. They'll show here the moment the director posts them.</Empty>}
        </>
      ) : tab === 'history' ? (
        <>
          <H1 sub="Every game your students have played.">Results</H1>
          {!mine.length ? <Empty>No students.</Empty> : (
            <div className="grid gap-3 md:grid-cols-2">
              {mine.filter((p) => s.games.some((g) => g.white_id === p.id || g.black_id === p.id)).map((p) => (
                <Card key={p.id} title={`${fullName(p)} · ${ordinal(p.grade)}`}>
                  <ul className="space-y-1.5 text-sm">
                    {s.games.filter((g) => (g.white_id === p.id || g.black_id === p.id) && (g.round < t.current_round || posted)).map((g) => {
                      const o = outcomeFor(g, p.id);
                      const opp = g.white_id === p.id ? g.black_id : g.white_id;
                      return (
                        <li key={g.id} className="flex items-center gap-2">
                          <span className="w-8 text-mute">R{g.round}</span>
                          <span className="flex-1 truncate">{g.black_id ? <>vs {nameOf(s, opp)} <span className="text-mute">· Bd {g.board} · {g.white_id === p.id ? 'W' : 'B'}</span></> : 'Bye'}</span>
                          {g.photo_path && <button className="text-xs text-info underline" onClick={() => card.open(g.photo_path!)}>card</button>}
                          <Badge tone={o.tone}>{o.label}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : tab === 'shirts' ? (
        <>
          <H1 sub={t.shirts_open ? 'Pick a T-shirt size for each student and for yourself. Each pick saves right away.' : 'T-shirt orders are closed. Ask the Tournament Director to change a size.'}>T-shirts</H1>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={noShirt ? 'warn' : 'good'}>{noShirt ? `${noShirt} still need a size` : 'Everyone has a size'}</Badge>
          </div>
          <div className="space-y-2">
            {me && <ShirtRow label={`You (${me.name})`} sub="Coach" value={me.shirt_size} disabled={!t.shirts_open || busy === 'myshirt'}
              onPick={(v) => run('myshirt', () => rpc('set_my_shirt', { p_size: v || null }))} />}
            {shirtKids.map((p) => <ShirtRow key={p.id} label={fullName(p)} sub={`${ordinal(p.grade)} grade`} value={p.shirt_size} disabled={!t.shirts_open || busy === `shirt-${p.id}`}
              onPick={(v) => run(`shirt-${p.id}`, () => rpc('set_shirt', { p_player: p.id, p_size: v || null }))} />)}
          </div>
        </>
      ) : <StandingsView s={s} school={school} />}
      {card.node}
      {node}
    </Shell>
  );
}

function ShirtRow({ label, sub, value, disabled, onPick }: { label: string; sub: string; value: string | null; disabled: boolean; onPick: (size: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3">
      <div className="min-w-0 flex-1"><div className="font-medium">{label}</div><div className="text-xs text-mute">{sub}</div></div>
      <Select value={value ?? ''} disabled={disabled} className={cx('w-36', !value && 'border-warn')} onChange={(e) => onPick(e.target.value)}>
        <option value="">Pick size</option>
        {SHIRT_SIZES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
      </Select>
    </div>
  );
}
