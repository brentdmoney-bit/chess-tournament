import { useEffect, useMemo, useRef, useState } from 'react';
import { RESULT_LABEL, awardFor, fmtScore, fullName, ordinal, points, standings, teamStandings, type Result, type AwardTier } from './lib/chess.ts';
import { supabase, rpc, must, time, SHIRT_SIZES, type DbGame, type DbPlayer, type Role, type Profile } from './lib/supabase.ts';
import type { TournamentState } from './lib/useTournament.ts';
import { Badge, Btn, Card, Empty, Field, H1, Select, Stat, Table, Td, cx, useAction } from './ui.tsx';

type Toast = (m: string, bad?: boolean) => void;

export const nameOf = (s: TournamentState, id: string | null) => (id ? (s.byId.get(id) ? fullName(s.byId.get(id)!) : '?') : 'BYE');

/** Rounds whose every board has a result (drives tiebreak math). */
export function completedRounds(s: TournamentState) {
  let n = 0;
  for (let r = 1; r <= (s.t?.current_round ?? 0); r++) {
    const g = s.games.filter((x) => x.round === r);
    if (g.length && g.every((x) => x.result)) n = r; else break;
  }
  return n;
}

export function useStandings(s: TournamentState) {
  return useMemo(() => {
    const done = completedRounds(s);
    const grades = [...(s.t?.active_grades ?? [])].sort((a, b) => a - b);
    // Count anyone who has played, plus anyone checked in; registered no-shows stay off the table.
    const counts = (p: DbPlayer) => p.status !== 'registered' && p.status !== 'absent' || s.games.some((x) => x.white_id === p.id || x.black_id === p.id);
    const byGrade = new Map(grades.map((g) => [g, standings(s.players.filter((p) => p.grade === g && counts(p)), s.games.filter((x) => x.grade === g), done)]));
    const all = [...byGrade.values()].flat();
    return { done, grades, byGrade, all, score: new Map(all.map((r) => [r.player.id, r.score])), teams: teamStandings(all, s.t?.team_top_n ?? 4) };
  }, [s.players, s.games, s.t]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ResultBadge({ r }: { r: Result | null }) {
  if (!r) return <Badge>Pending</Badge>;
  return <Badge tone={r === 'draw' ? 'info' : r === 'bye' ? 'ghost' : r.endsWith('ff') ? 'warn' : 'good'}>{RESULT_LABEL[r]}</Badge>;
}

/* ── Pairings table (everyone), with board editing for TD/Admin ─────────── */
export function PairingsTable({ s, round, editable, toast, school }: { s: TournamentState; round: number; editable?: boolean; toast?: Toast; school?: string }) {
  const { score } = useStandings(s);
  const [edit, setEdit] = useState<{ id: string; white: string; black: string } | null>(null);
  const { busy, run } = useAction(toast ?? (() => {}));
  const mine = (g: DbGame) => s.byId.get(g.white_id)?.school === school || (!!g.black_id && s.byId.get(g.black_id)?.school === school);
  const games = s.games.filter((g) => g.round === round && (!school || mine(g)));
  if (!games.length) return <Empty>No pairings for round {round} yet.</Empty>;
  const grades = [...new Set(games.map((g) => g.grade))];
  const pts = (id: string | null) => (id ? fmtScore(score.get(id) ?? 0) : '');

  return (
    <div className="space-y-4">
      {grades.map((grade) => {
        const options = s.players.filter((p) => p.grade === grade && p.status !== 'withdrawn').sort((a, b) => a.last_name.localeCompare(b.last_name));
        return (
          <Card key={grade} title={`${ordinal(grade)} grade`}>
            <Table head={['Bd', 'White', '', 'Black', 'Result', ...(editable ? [''] : [])]}>
              {games.filter((g) => g.grade === grade).map((g) => {
                const w = s.byId.get(g.white_id), b = g.black_id ? s.byId.get(g.black_id) : null;
                const editing = edit?.id === g.id;
                return (
                  <tr key={g.id}>
                    <Td><span className="grid h-8 w-8 place-items-center rounded-full bg-gold/15 font-bold text-gold">{g.board}</span></Td>
                    <Td>
                      {editing ? (
                        <Select value={edit.white} onChange={(e) => setEdit({ ...edit, white: e.target.value })}>
                          {options.map((p) => <option key={p.id} value={p.id}>{fullName(p)} · {p.school}</option>)}
                        </Select>
                      ) : <PlayerCell p={w} pts={pts(g.white_id)} />}
                    </Td>
                    <Td className="text-mute">vs</Td>
                    <Td>
                      {editing ? (
                        <Select value={edit.black} onChange={(e) => setEdit({ ...edit, black: e.target.value })}>
                          <option value="">— Bye —</option>
                          {options.map((p) => <option key={p.id} value={p.id}>{fullName(p)} · {p.school}</option>)}
                        </Select>
                      ) : b ? <PlayerCell p={b} pts={pts(g.black_id)} /> : <span className="text-mute">Bye (1 pt)</span>}
                    </Td>
                    <Td><ResultBadge r={g.result} /></Td>
                    {editable && (
                      <Td>
                        {editing ? (
                          <div className="flex gap-2">
                            <Btn tone="gold" disabled={busy === g.id} onClick={() => run(g.id, async () => {
                              await rpc('edit_board', { p_game: g.id, p_white: edit.white, p_black: edit.black || null });
                              setEdit(null);
                            }, `Board ${g.board} updated`)}>Save</Btn>
                            <Btn onClick={() => setEdit(null)}>Cancel</Btn>
                          </div>
                        ) : (
                          <Btn disabled={!!g.result && g.result !== 'bye'} onClick={() => setEdit({ id: g.id, white: g.white_id, black: g.black_id ?? '' })}>Edit</Btn>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </Table>
          </Card>
        );
      })}
    </div>
  );
}

function PlayerCell({ p, pts }: { p?: DbPlayer | null; pts: string }) {
  if (!p) return <span className="text-mute">?</span>;
  return (
    <div>
      <div className="font-medium">{fullName(p)} <span className="text-xs text-mute">({pts})</span></div>
      <div className="text-xs text-mute">{p.school}</div>
    </div>
  );
}

/* ── Live scoring progress + help requests ──────────────────────────────── */
export function Progress({ s, toast, canResolve }: { s: TournamentState; toast: Toast; canResolve: boolean }) {
  const games = s.roundGames;
  const scored = games.filter((g) => g.result).length;
  const pct = games.length ? Math.round((scored / games.length) * 100) : 0;
  const open = s.help.filter((h) => !h.resolved_at);
  const { busy, run } = useAction(toast);
  const unscored = games.filter((g) => !g.result);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Round ${s.t?.current_round} scoring`}>
        {!games.length ? <p className="text-sm text-mute">Not paired yet.</p> : (
          <>
            <div className="flex items-baseline justify-between"><span className="text-3xl font-bold">{scored}<span className="text-lg text-mute">/{games.length}</span></span><span className="text-sm text-mute">{pct}%</span></div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-panel-2">
              <div className={cx('h-full rounded-full transition-all', pct === 100 ? 'bg-good' : pct >= 80 ? 'bg-warn' : 'bg-gold')} style={{ width: `${pct}%` }} />
            </div>
            {unscored.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {unscored.map((g) => (
                  <span key={g.id} className={cx('rounded-lg border px-2 py-1 text-xs', open.some((h) => h.board === g.board) ? 'border-warn text-warn' : 'border-line text-mute')}>Bd {g.board}</span>
                ))}
              </div>
            )}
            {pct === 100 && <p className="mt-3 text-sm font-semibold text-good">✓ Every board is scored.</p>}
          </>
        )}
      </Card>
      <Card title={`Help requests (${open.length})`}>
        {!open.length ? <p className="text-sm text-mute">No one needs help right now.</p> : (
          <ul className="space-y-2">
            {open.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warn font-bold text-black">{h.board}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold">Board {h.board}</div>
                  {h.note && <div className="italic text-mute">“{h.note}”</div>}
                  <div className="text-xs text-mute">{h.requested_name ?? 'Scorer'} · {time(h.created_at)}</div>
                </div>
                {canResolve && (
                  <Btn tone="good" disabled={busy === h.id} onClick={() => run(h.id, () =>
                    must(supabase.from('help_requests').update({ resolved_at: new Date().toISOString() }).eq('id', h.id)), 'Marked resolved')}>Resolved</Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function useScorecard(toast: Toast) {
  const [photo, setPhoto] = useState<string | null>(null);
  const open = async (path: string) => {
    const { data, error } = await supabase.storage.from('scorecards').createSignedUrl(path, 600);
    if (error) toast(error.message, true); else setPhoto(data.signedUrl);
  };
  const node = photo && (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setPhoto(null)}>
      <img src={photo} alt="Scorecard" className="max-h-full max-w-full rounded-lg" />
    </div>
  );
  return { open, node };
}

/* ── Results by round, with corrections for TD/Admin ────────────────────── */
export function Results({ s, canEdit, toast }: { s: TournamentState; canEdit: boolean; toast: Toast }) {
  const rounds = [...new Set(s.games.map((g) => g.round))].sort((a, b) => a - b);
  const [round, setRound] = useState<number | null>(null);
  const r = round ?? rounds.at(-1) ?? 1;
  const { busy, run } = useAction(toast);
  const card = useScorecard(toast);

  return (
    <>
      <H1 sub={canEdit ? 'Every board, every round. Corrections are logged with who made them.' : 'Every board, every round.'}>Results</H1>
      {!rounds.length ? <Empty>No rounds played yet.</Empty> : (
        <>
          <div className="scroll-x mb-4 flex gap-2">
            {rounds.map((x) => <Btn key={x} tone={x === r ? 'gold' : 'ghost'} onClick={() => setRound(x)}>Round {x}</Btn>)}
          </div>
          <Card>
            <Table head={['Bd', 'Gr', 'White', 'Black', 'Result', 'Card']}>
              {s.games.filter((g) => g.round === r).map((g) => (
                <tr key={g.id}>
                  <Td className="font-bold text-gold">{g.board}</Td>
                  <Td className="text-mute">{g.grade}</Td>
                  <Td>{nameOf(s, g.white_id)}<div className="text-xs text-mute">{s.byId.get(g.white_id)?.school}</div></Td>
                  <Td>{g.black_id ? <>{nameOf(s, g.black_id)}<div className="text-xs text-mute">{s.byId.get(g.black_id)?.school}</div></> : <span className="text-mute">Bye</span>}</Td>
                  <Td>
                    {canEdit && g.black_id ? (
                      <Select value={g.result ?? ''} disabled={busy === g.id} className="min-w-44"
                        onChange={(e) => e.target.value && run(g.id, () => rpc('record_result', { p_game: g.id, p_result: e.target.value }), `Board ${g.board} saved`)}>
                        <option value="">Pending</option>
                        {(['white', 'black', 'draw', 'white_ff', 'black_ff', 'double_ff'] as Result[]).map((x) => <option key={x} value={x}>{RESULT_LABEL[x]}</option>)}
                      </Select>
                    ) : <ResultBadge r={g.result} />}
                  </Td>
                  <Td>{g.photo_path ? <button className="text-info underline" onClick={() => card.open(g.photo_path!)}>View</button> : <span className="text-mute">—</span>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
      {card.node}
    </>
  );
}

/* ── Standings (individual by grade + team) ─────────────────────────────── */
export function StandingsView({ s, school }: { s: TournamentState; school?: string }) {
  const st = useStandings(s);
  const [grade, setGrade] = useState<number | 'team'>(st.grades[0] ?? 'team');
  const rows = grade === 'team' ? [] : (st.byGrade.get(grade) ?? []).filter((r) => !school || r.player.school === school);
  return (
    <>
      <H1 sub={`After ${st.done} completed round${st.done === 1 ? '' : 's'}. Ties broken by Modified Median, then Solkoff.`}>{school ? `${school} standings` : 'Standings'}</H1>
      <div className="scroll-x mb-4 flex gap-2">
        {st.grades.map((g) => <Btn key={g} tone={grade === g ? 'gold' : 'ghost'} onClick={() => setGrade(g)}>{ordinal(g)}</Btn>)}
        <Btn tone={grade === 'team' ? 'gold' : 'ghost'} onClick={() => setGrade('team')}>Teams</Btn>
      </div>
      <Card>
        {grade === 'team' ? (
          <Table head={['#', 'School', 'Score', 'Counted']}>
            {st.teams.map((tm, i) => (
              <tr key={tm.school} className={cx(tm.school === school && 'bg-info/10')}>
                <Td className={cx('font-bold', i < 3 && 'text-gold')}>{i + 1}</Td><Td className="font-medium">{tm.school}</Td>
                <Td className="font-bold">{fmtScore(tm.score)}</Td><Td className="text-mute">top {tm.counted}</Td>
              </tr>
            ))}
          </Table>
        ) : !rows.length ? <p className="text-sm text-mute">No players in this grade yet.</p> : (
          <Table head={['#', 'Player', 'School', 'Score', 'W-L-D', 'Mod Med', 'Solkoff']}>
            {rows.map((r) => (
              <tr key={r.player.id}>
                <Td className={cx('font-bold', r.place <= 3 && 'text-gold')}>{r.place}</Td>
                <Td className="font-medium">{fullName(r.player)}{r.player.status === 'withdrawn' && <span className="ml-2"><Badge tone="bad">Withdrawn</Badge></span>}</Td>
                <Td className="text-mute">{r.player.school}</Td>
                <Td className="font-bold">{fmtScore(r.score)}</Td>
                <Td className="text-mute">{r.wins}-{r.losses}-{r.draws}{r.hadBye && ' +bye'}</Td>
                <Td className="text-mute">{fmtScore(r.modMedian)}</Td>
                <Td className="text-mute">{fmtScore(r.solkoff)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

/* ── Awards ─────────────────────────────────────────────────────────────── */
const TIER_ICON: Record<string, string> = { Gold: '🥇', Silver: '🥈', Bronze: '🥉' };
export function Awards({ s, canEdit, toast }: { s: TournamentState; canEdit: boolean; toast: Toast }) {
  const st = useStandings(s);
  const t = s.t!;
  const [tiers, setTiers] = useState<AwardTier[] | null>(null);
  const { busy, run } = useAction(toast);
  const bad = tiers?.some((x) => x.min > x.max);

  return (
    <>
      <H1 sub={t.ended ? 'Final. The tournament is over.' : 'Provisional until the Tournament Director ends the tournament.'}
        action={canEdit && !tiers && <Btn onClick={() => setTiers(t.award_tiers.map((x) => ({ ...x })))}>Edit score ranges</Btn>}>Awards</H1>
      {tiers ? (
        <Card title="Award score ranges (per grade)" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {tiers.map((x, i) => (
              <div key={x.name} className="rounded-xl border border-line p-3">
                <div className="mb-2 font-semibold">{TIER_ICON[x.name]} {x.name}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Min" type="number" step="0.5" value={x.min} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, min: Number(e.target.value) } : y)))} />
                  <Field label="Max" type="number" step="0.5" value={x.max} onChange={(e) => setTiers(tiers.map((y, j) => (j === i ? { ...y, max: Number(e.target.value) } : y)))} />
                </div>
              </div>
            ))}
          </div>
          {bad && <p className="mt-2 text-sm text-bad">A minimum is higher than its maximum.</p>}
          <div className="mt-3 flex gap-2">
            <Btn tone="gold" disabled={bad || busy === 'tiers'} onClick={() => run('tiers', async () => {
              await must(supabase.from('tournaments').update({ award_tiers: tiers }).eq('id', t.id)); setTiers(null);
            }, 'Award ranges saved')}>Save</Btn>
            <Btn onClick={() => setTiers(null)}>Cancel</Btn>
          </div>
        </Card>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">{t.award_tiers.map((x) => <Badge key={x.name} tone="gold">{TIER_ICON[x.name]} {x.name}: {fmtScore(x.min)} to {fmtScore(x.max)} pts</Badge>)}</div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {st.grades.map((g) => {
          const winners = (st.byGrade.get(g) ?? []).map((r) => ({ r, tier: awardFor(r.score, t.award_tiers) })).filter((x) => x.tier);
          return (
            <Card key={g} title={`${ordinal(g)} grade`}>
              {!winners.length ? <p className="text-sm text-mute">No award winners yet.</p> : (
                <ul className="divide-y divide-line">
                  {winners.map(({ r, tier }) => (
                    <li key={r.player.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="text-xl">{TIER_ICON[tier!.name] ?? '🏅'}</span>
                      <span className="flex-1"><b>{fullName(r.player)}</b> <span className="text-mute">· {r.player.school}</span></span>
                      <span className="font-bold">{fmtScore(r.score)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
        <Card title={`Team awards · top ${t.team_top_n} per school`}>
          <ul className="divide-y divide-line">
            {st.teams.slice(0, 3).map((tm, i) => (
              <li key={tm.school} className="flex items-center gap-3 py-2 text-sm">
                <span className="text-xl">{['🥇', '🥈', '🥉'][i]}</span><span className="flex-1 font-semibold">{tm.school}</span><span className="font-bold">{fmtScore(tm.score)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/* ── Attendance by school (TD edits, SA views) ─────────────────────────── */
export function Attendance({ s, canEdit, toast }: { s: TournamentState; canEdit: boolean; toast: Toast }) {
  const { busy, run } = useAction(toast);
  const [regLink, setRegLink] = useState<string | null>(null);
  useEffect(() => { rpc<string | null>('reg_sheet_url').then(setRegLink).catch(() => setRegLink(null)); }, []);
  const fromSheet = s.t?.reg_counts ?? null; // set while the registration sheet sync is on
  const rows = s.schools.map((school) => {
    const roster = s.players.filter((p) => p.school === school);
    const coaches = s.coaches.filter((c) => c.school === school && c.approved);
    const reg = fromSheet ? fromSheet[school] ?? 0
      : coaches.reduce<number | null>((a, c) => (c.registered_count == null ? a : (a ?? 0) + c.registered_count), null);
    const present = roster.filter((p) => p.status === 'present').length;
    return { school, roster: roster.length, present, coaches, reg };
  });
  const tot = rows.reduce((a, r) => ({ roster: a.roster + r.roster, present: a.present + r.present, reg: a.reg + (r.reg ?? 0) }), { roster: 0, present: 0, reg: 0 });
  const coachesIn = s.coaches.filter((c) => c.checked_in_at).length;

  return (
    <>
      <H1 sub={`Registered = ${fromSheet ? `registration sheet, last read ${s.t?.reg_synced_at ? time(s.t.reg_synced_at) : '—'}` : 'typed in by the director'}. Competing = students their coach marked present.`}
        action={regLink && <a className="text-sm text-info underline" href={regLink} target="_blank" rel="noopener noreferrer">Registration sheet ↗</a>}>Attendance</H1>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Coaches here" value={`${coachesIn}/${s.coaches.filter((c) => c.approved).length}`} />
        <Stat label="On roster" value={tot.roster} />
        <Stat label="Competing" value={tot.present} tone="good" />
        <Stat label="Registered" value={tot.reg || '—'} tone={tot.reg && tot.reg !== tot.present ? 'warn' : undefined} />
      </div>
      <Card>
        <Table scroll head={['School', 'Coaches', 'Registered', 'Roster', 'Competing', 'Gap']}>
          {rows.map((r) => {
            const gap = r.reg == null ? null : r.reg - r.present;
            const first = r.coaches[0];
            return (
              <tr key={r.school}>
                <Td className="font-medium">{r.school}</Td>
                <Td>
                  {r.coaches.length === 0 ? <span className="text-mute">none listed</span> : r.coaches.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 py-0.5">
                      <span className={cx('h-2 w-2 rounded-full', c.checked_in_at ? 'bg-good' : 'bg-bad')} />
                      <span>{c.name}</span>
                      {c.phone && <a className="text-xs text-info" href={`tel:${c.phone}`}>{c.phone}</a>}
                      {canEdit && (
                        <button className="text-xs text-mute underline" disabled={busy === c.id} onClick={() => run(c.id, () =>
                          must(supabase.from('coaches').update({ checked_in_at: c.checked_in_at ? null : new Date().toISOString() }).eq('id', c.id)))}>
                          {c.checked_in_at ? `here ${time(c.checked_in_at)} · undo` : 'check in'}
                        </button>
                      )}
                    </div>
                  ))}
                </Td>
                <Td>
                  {canEdit && first && !fromSheet ? (
                    <input key={`${first.id}-${first.registered_count}`} type="number" min={0} inputMode="numeric" defaultValue={first.registered_count ?? ''} placeholder="—"
                      className="w-20 rounded-lg border border-line bg-panel-2 px-2 py-1"
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10));
                        if (v !== first.registered_count) void run('reg', () => must(supabase.from('coaches').update({ registered_count: v }).eq('id', first.id)), 'Saved');
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  ) : r.reg ?? '—'}
                </Td>
                <Td>{r.roster}</Td>
                <Td className="font-semibold text-good">{r.present}</Td>
                <Td>{gap == null ? '—' : gap === 0 ? <Badge tone="good">Match</Badge> : <Badge tone={gap > 0 ? 'bad' : 'info'}>{gap > 0 ? `+${gap}` : gap}</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

/* ── Staff chat (TD / Admin / SA) ──────────────────────────────────────── */
const ROLE_TINT: Partial<Record<Role, string>> = { TD: 'text-gold', Admin: 'text-admin', SA: 'text-sa' };
export function Chat({ s, profile }: { s: TournamentState; profile: Profile }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(s.messages.length);
  const end = useRef<HTMLDivElement>(null);
  const unread = open ? 0 : Math.max(0, s.messages.length - seen);
  useEffect(() => { if (open) { setSeen(s.messages.length); end.current?.scrollIntoView(); } }, [open, s.messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !s.t) return;
    setText('');
    const { error } = await supabase.from('messages').insert({ tournament_id: s.t.id, sender_name: profile.display_name ?? profile.role, role: profile.role, body });
    if (error) { setText(body); s.setError(error.message); }
  };

  return (
    <>
      <button onClick={() => setOpen(!open)} aria-label="Staff chat"
        className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gold text-2xl text-gold-ink shadow-2xl">
        {open ? '✕' : '💬'}
        {unread > 0 && <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-bad px-1 text-xs font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-3 bottom-24 z-40 flex h-[60dvh] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl sm:inset-x-auto sm:right-5 sm:w-96">
          <div className="border-b border-line px-4 py-3"><div className="font-semibold">Staff chat</div><div className="text-xs text-mute">Director · Admin · Student Activities</div></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {s.messages.map((m) => {
              const mine = m.user_id === profile.id;
              return (
                <div key={m.id} className={cx('max-w-[85%]', mine && 'ml-auto text-right')}>
                  <div className="text-xs text-mute"><span className={ROLE_TINT[m.role]}>{m.sender_name}</span> · {time(m.created_at)}</div>
                  <div className={cx('mt-0.5 inline-block rounded-2xl px-3 py-2 text-left text-sm', mine ? 'bg-gold text-gold-ink' : 'bg-panel-2')}>{m.body}</div>
                </div>
              );
            })}
            {!s.messages.length && <p className="text-center text-sm text-mute">No messages yet.</p>}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message staff…" className="min-h-11 flex-1 rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold" />
            <Btn tone="gold" disabled={!text.trim()}>Send</Btn>
          </form>
        </div>
      )}
    </>
  );
}

/** One side's outcome of a game, for "my player" views. */
export function outcomeFor(g: DbGame, playerId: string): { label: string; tone: 'good' | 'bad' | 'info' | 'ghost' } {
  if (!g.result) return { label: 'Pending', tone: 'ghost' };
  if (g.result === 'bye') return { label: 'Bye', tone: 'info' };
  const [w, b] = points(g.result);
  const mine = g.white_id === playerId ? w : b;
  const ff = g.result.endsWith('ff');
  if (mine === 1) return { label: ff ? 'Win (forfeit)' : 'Win', tone: 'good' };
  if (mine === 0.5) return { label: 'Draw', tone: 'info' };
  return { label: ff ? 'Loss (forfeit)' : 'Loss', tone: 'bad' };
}

/* ── T-shirt order totals (Student Activities, TD) ─────────────────────── */
export function Shirts({ s }: { s: TournamentState }) {
  const kids = s.players.filter((p) => p.status !== 'withdrawn');
  const coaches = s.coaches.filter((c) => c.approved);
  const tally = (rows: { shirt_size: string | null }[]) => SHIRT_SIZES.map(([c]) => rows.filter((r) => r.shirt_size === c).length);
  const kidT = tally(kids), coachT = tally(coaches);
  const bySchool = s.schools.map((school) => {
    const all = [...kids.filter((p) => p.school === school), ...coaches.filter((c) => c.school === school)];
    const t = tally(all);
    return { school, t, total: t.reduce((a, b) => a + b, 0), missing: all.filter((r) => !r.shirt_size).length };
  });
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const grand = kidT.map((n, i) => n + coachT[i]);

  const download = () => {
    const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [
      ['School', ...SHIRT_SIZES.map(([, l]) => l), 'Total', 'Not picked yet'],
      ...bySchool.map((r) => [r.school, ...r.t, r.total, r.missing]),
      ['ALL SCHOOLS', ...grand, sum(grand), sum(bySchool.map((r) => r.missing))],
    ];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `tshirt-order-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <H1 sub={`Coaches pick sizes for their students and themselves. Orders are ${s.t?.shirts_open ? 'open' : 'closed'}.`}
        action={<Btn tone="gold" onClick={download}>Download CSV</Btn>}>T-shirts</H1>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total shirts" value={sum(grand)} />
        <Stat label="Students" value={sum(kidT)} sub={`of ${kids.length} picked`} />
        <Stat label="Coaches" value={sum(coachT)} sub={`of ${coaches.length} picked`} />
        <Stat label="Not picked yet" value={kids.length + coaches.length - sum(grand)} tone={kids.length + coaches.length - sum(grand) ? 'warn' : 'good'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="By size">
          <Table head={['Size', 'Students', 'Coaches', 'Total']}>
            {SHIRT_SIZES.map(([c, l], i) => (
              <tr key={c}><Td>{l}</Td><Td>{kidT[i]}</Td><Td>{coachT[i]}</Td><Td className="font-semibold">{grand[i]}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="By school">
          <div className="overflow-x-auto">
            <Table head={['School', ...SHIRT_SIZES.map(([c]) => c), 'Total', 'Not picked']}>
              {bySchool.map((r) => (
                <tr key={r.school}>
                  <Td className="font-medium">{r.school}</Td>
                  {r.t.map((n, i) => <Td key={i} className={n ? '' : 'text-mute'}>{n || '·'}</Td>)}
                  <Td className="font-semibold">{r.total}</Td>
                  <Td>{r.missing ? <Badge tone="warn">{r.missing}</Badge> : <Badge tone="good">0</Badge>}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>
    </>
  );
}
