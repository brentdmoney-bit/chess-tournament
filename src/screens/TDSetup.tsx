import { useEffect, useState, type FormEvent } from 'react';
import { fullName, ordinal } from '../lib/chess.ts';
import { COACH_FIELDS, ROSTER_FIELDS, closestSchool, coachesFrom, readCoaches, readRoster, type ColMap, type Field as CsvField } from '../lib/roster.ts';
import { supabase, rpc, must, time, type Profile, type Role } from '../lib/supabase.ts';
import type { TournamentState } from '../lib/useTournament.ts';
import { Badge, Btn, Card, Empty, Field, H1, Select, Shell, Table, Td, cx, useAction, useToast } from '../ui.tsx';

type Toast = (m: string, bad?: boolean) => void;
const GRADES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/* ── First run: no tournament yet ───────────────────────────────────────── */
export function CreateTournament({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const { toast, node } = useToast();
  const { busy, run } = useAction(toast);
  const [f, setF] = useState({ name: 'Dallas ISD High School Chess Tournament', event_date: '', location: 'Dallas, TX', total_rounds: 5 });
  const create = (e: FormEvent) => {
    e.preventDefault();
    void run('create', async () => {
      const t = await must(supabase.from('tournaments').insert({ ...f, event_date: f.event_date || null }).select('id').single());
      await must(supabase.from('tournament_secrets').insert({ tournament_id: t!.id, scorer_code: newCode() }));
      window.location.reload();
    });
  };
  return (
    <Shell role="TD" who={profile.display_name ?? 'Director'} t={null} onSignOut={onSignOut}>
      <div className="mx-auto max-w-lg">
        <H1 sub="Nothing is running yet. Set up the event; you can change any of this later.">New tournament</H1>
        <Card>
          <form onSubmit={create} className="space-y-4">
            <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} />
              <Field label="Rounds" type="number" min={1} max={12} value={f.total_rounds} onChange={(e) => setF({ ...f, total_rounds: Number(e.target.value) })} />
            </div>
            <Field label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
            <Btn tone="gold" big className="w-full" disabled={busy === 'create'}>Create tournament</Btn>
          </form>
        </Card>
      </div>
      {node}
    </Shell>
  );
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

/* ── Upload helpers: match the file's columns, match near-miss school names ─ */
type Upload = { text: string; source: string; map: ColMap; fix: Record<string, string>; ok: boolean };

/** One dropdown per website field, with the first row's value so the TD can see what lands where. Nothing saves until they confirm. */
function ColumnMatcher({ fields, headers, sample, map, onChange, ok, onConfirm, blocked }: {
  fields: CsvField[]; headers: string[]; sample: string[]; map: ColMap; onChange: (m: ColMap) => void; ok: boolean; onConfirm: () => void; blocked: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-semibold">Match columns <span className="font-normal text-mute">(check each one against the sample from your first row)</span></p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          const i = map[f.key];
          return (
            <div key={f.key}>
              <Select label={f.label} value={i ?? ''} className="min-h-9 text-sm"
                onChange={(e) => onChange({ ...map, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">Not in this file</option>
                {headers.map((h, j) => <option key={j} value={j}>{h || `Column ${j + 1}`}</option>)}
              </Select>
              <p className="mt-1 truncate text-xs text-mute">{i === undefined ? '—' : <>e.g. <span className="text-ink">{sample[i] || '(blank)'}</span></>}</p>
            </div>
          );
        })}
      </div>
      {ok
        ? <p className="mt-3 text-sm text-good">✓ Columns confirmed. Change any dropdown to re-check.</p>
        : <Btn tone="info" className="mt-3" disabled={blocked} onClick={onConfirm}>Columns look right</Btn>}
    </div>
  );
}

/** Each school in the file that isn't spelled exactly like a roster school → which roster school it is ('' = keep as typed). */
const schoolFix = (u: Upload, schools: string[]) => (name: string) =>
  schools.includes(name) ? name : (u.fix[name] ?? closestSchool(name, schools) ?? '') || name;

function SchoolMatcher({ names, schools, u, onChange, keepLabel }: { names: string[]; schools: string[]; u: Upload; onChange: (fix: Record<string, string>) => void; keepLabel: string }) {
  const odd = [...new Set(names)].filter((n) => !schools.includes(n)).sort();
  if (!schools.length || !odd.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-semibold">Match schools <span className="font-normal text-mute">({odd.length} don't match the roster exactly; best guess is picked)</span></p>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {odd.map((n) => (
          <div key={n} className="grid items-center gap-2 sm:grid-cols-2">
            <span className="text-sm">{n}</span>
            <Select value={u.fix[n] ?? closestSchool(n, schools) ?? ''} className="min-h-9 text-sm"
              onChange={(e) => onChange({ ...u.fix, [n]: e.target.value })}>
              <option value="">{keepLabel}</option>
              {schools.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Players: roster table, manual add, CSV / Google Sheet import ───────── */
export function Players({ s, toast }: { s: TournamentState; toast: Toast }) {
  const t = s.t!;
  const { busy, run } = useAction(toast);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [preview, setPreview] = useState<Upload | null>(null);
  const [sheet, setSheet] = useState(t.sheet_url ?? '');
  const [add, setAdd] = useState<null | { first: string; last: string; grade: string; school: string; sid: string }>(null);

  const load = (text: string, source: string) => setPreview({ text, source, map: readRoster(text).map, fix: {}, ok: false });
  const parsed = preview ? readRoster(preview.text, preview.map) : null;
  const fixSchool = preview ? schoolFix(preview, s.schools) : (x: string) => x;
  const rowsOut = parsed ? parsed.rows.map((r) => ({ ...r, school: fixSchool(r.school) })) : [];

  const fromSheet = () => run('sheet', async () => {
    const { data, error } = await supabase.functions.invoke('fetch-sheet', { body: { url: sheet } });
    if (error) throw new Error(`Couldn't read the sheet: ${error.message}`);
    if (data?.error) throw new Error(data.error);
    await must(supabase.from('tournaments').update({ sheet_url: sheet }).eq('id', t.id));
    load(data.csv, 'Google Sheet');
  });

  const commit = () => preview && run('import', async () => {
    const rows = rowsOut.map((r) => ({
      student_id: r.student_id, first_name: r.first_name, last_name: r.last_name,
      grade: r.grade, school: r.school, coach_name: r.coach_name,
    }));
    // Server upserts on student ID so re-importing never duplicates or wipes check-in status.
    await rpc('import_players', { p_rows: rows });
    const withEmail = coachesFrom(rowsOut).filter((c) => c.email).map((c) => ({ ...c, tournament_id: t.id }));
    if (withEmail.length) await must(supabase.from('coaches').upsert(withEmail, { onConflict: 'tournament_id,email' }));
    const grades = [...new Set([...t.active_grades, ...rows.map((r) => r.grade)])].sort((a, b) => a - b);
    await must(supabase.from('tournaments').update({ active_grades: grades }).eq('id', t.id));
    setPreview(null);
  }, `Imported ${rowsOut.length} students`);

  const list = s.players.filter((p) => (!grade || p.grade === Number(grade)) &&
    (!q || `${fullName(p)} ${p.school} ${p.student_id ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <H1 sub={`${s.players.length} students · ${s.schools.length} schools · ${s.coaches.length} coaches`}
        action={<Btn onClick={() => setAdd({ first: '', last: '', grade: '', school: '', sid: '' })}>Add student</Btn>}>Players</H1>

      <Card title="Import roster" className="mb-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm text-mute">Google Sheet: set sharing to “Anyone with the link can view”, then paste the link.</p>
            <div className="flex gap-2">
              <input value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold" />
              <Btn tone="gold" disabled={!sheet || busy === 'sheet'} onClick={fromSheet}>{busy === 'sheet' ? 'Reading…' : 'Read'}</Btn>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-mute">Or upload a CSV (columns: student ID, name, grade, school, coach, coach phone, coach email).</p>
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-sm font-semibold text-mute hover:border-gold">
              Choose CSV file
              <input type="file" accept=".csv,.txt,text/csv" className="hidden"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text(), f.name); e.target.value = ''; }} />
            </label>
          </div>
        </div>
        {preview && parsed && (
          <div className="mt-4 rounded-xl border border-gold/40 p-3">
            <p className="text-sm">{preview.source}: {parsed.missing.length
              ? <span className="text-warn">match these before importing: {parsed.missing.join(', ')}.</span>
              : <><b>{rowsOut.length}</b> students and <b>{coachesFrom(rowsOut).length}</b> coaches. Students already here (same ID) get updated, not duplicated.</>}</p>
            <ColumnMatcher fields={ROSTER_FIELDS} headers={parsed.headers} sample={parsed.sample} map={preview.map}
              onChange={(map) => setPreview({ ...preview, map, ok: false })} ok={preview.ok} blocked={parsed.missing.length > 0}
              onConfirm={() => setPreview({ ...preview, ok: true })} />
            {preview.map.coach !== undefined && preview.map.coachPhone === undefined && <p className="mt-2 text-sm text-warn">No coach cell column matched: coaches from this file won't get texts.</p>}
            <SchoolMatcher names={parsed.rows.map((r) => r.school)} schools={s.schools} u={preview} keepLabel="New school (keep as typed)"
              onChange={(fix) => setPreview({ ...preview, fix })} />
            {parsed.problems.length > 0 && (
              <details className="mt-2 text-sm text-warn"><summary>{parsed.problems.length} rows skipped</summary><ul className="mt-1 list-disc pl-5">{parsed.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul></details>
            )}
            <div className="mt-2 max-h-56 overflow-y-auto text-xs text-mute">
              {rowsOut.slice(0, 8).map((r, i) => <div key={i}>{r.first_name} {r.last_name} · {ordinal(r.grade)} · {r.school} · {r.coach_name ?? 'no coach'}</div>)}
              {rowsOut.length > 8 && <div>…and {rowsOut.length - 8} more</div>}
            </div>
            <div className="mt-3 flex gap-2">
              <Btn tone="gold" disabled={busy === 'import' || !rowsOut.length || !preview.ok} onClick={commit}>{busy === 'import' ? 'Importing…' : 'Import'}</Btn>
              <Btn onClick={() => setPreview(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Card>

      {add && (
        <Card title="Add a student" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="First" value={add.first} onChange={(e) => setAdd({ ...add, first: e.target.value })} />
            <Field label="Last" value={add.last} onChange={(e) => setAdd({ ...add, last: e.target.value })} />
            <Select label="Grade" value={add.grade} onChange={(e) => setAdd({ ...add, grade: e.target.value })}>
              <option value="">Pick</option>{GRADES.map((g) => <option key={g} value={g}>{ordinal(g)}</option>)}
            </Select>
            <Field label="School" list="schools" value={add.school} onChange={(e) => setAdd({ ...add, school: e.target.value })} />
            <Field label="Student ID" value={add.sid} onChange={(e) => setAdd({ ...add, sid: e.target.value })} />
          </div>
          <datalist id="schools">{s.schools.map((x) => <option key={x} value={x} />)}</datalist>
          <div className="mt-3 flex gap-2">
            <Btn tone="gold" disabled={!add.first.trim() || !add.last.trim() || !add.grade || !add.school.trim() || busy === 'add'}
              onClick={() => run('add', async () => {
                await must(supabase.from('players').insert({ tournament_id: t.id, first_name: add.first.trim(), last_name: add.last.trim(), grade: Number(add.grade), school: add.school.trim(), student_id: add.sid.trim() || null }));
                setAdd(null);
              }, 'Student added')}>Add</Btn>
            <Btn onClick={() => setAdd(null)}>Cancel</Btn>
          </div>
        </Card>
      )}

      <div className="mb-3 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, school or ID"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold" />
        <Select value={grade} onChange={(e) => setGrade(e.target.value)} className="w-32">
          <option value="">All grades</option>{GRADES.map((g) => <option key={g} value={g}>{ordinal(g)}</option>)}
        </Select>
      </div>
      {!s.players.length ? <Empty>No students yet. Import the roster above.</Empty> : (
        <Card>
          <Table head={['Name', 'Gr', 'School', 'ID', 'Status']}>
            {list.slice(0, 400).map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{fullName(p)}{p.is_sub && <span className="ml-2"><Badge tone="info">Sub</Badge></span>}</Td>
                <Td>{p.grade}</Td>
                <Td className="text-mute">{p.school}</Td>
                <Td className="text-mute">{p.student_id ?? '—'}</Td>
                <Td>
                  <Select value={p.status} disabled={busy === p.id} className="min-h-9 w-40 text-sm"
                    onChange={(e) => run(p.id, () => rpc('coach_set_status', { p_player: p.id, p_status: e.target.value }))}>
                    <option value="registered">Not checked in</option><option value="present">Present</option>
                    <option value="absent">Absent</option><option value="withdrawn">Withdrawn</option>
                  </Select>
                </Td>
              </tr>
            ))}
          </Table>
          {list.length > 400 && <p className="mt-2 text-xs text-mute">Showing 400 of {list.length}. Search to narrow it down.</p>}
        </Card>
      )}
    </>
  );
}

/* ── Access: requests, staff, coaches ───────────────────────────────────── */
interface StaffRow { id: string; email: string | null; display_name: string | null; role: Role | null }
export function Access({ s, toast }: { s: TournamentState; toast: Toast }) {
  const t = s.t!;
  const { busy, run } = useAction(toast);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [invites, setInvites] = useState<{ email: string; role: Role }[]>([]);
  const [inv, setInv] = useState({ email: '', role: 'Admin' as Role });
  const [coach, setCoach] = useState({ name: '', email: '', phone: '', school: '' });
  const [schoolFor, setSchoolFor] = useState<Record<string, string>>({});
  const [coachCsv, setCoachCsv] = useState<Upload | null>(null);
  const cParsed = coachCsv ? readCoaches(coachCsv.text, coachCsv.map) : null;
  const cFix = coachCsv ? schoolFix(coachCsv, s.schools) : (x: string) => x;
  const cRows = cParsed ? cParsed.rows.map((c) => ({ ...c, school: cFix(c.school) })) : [];

  const reload = async () => {
    const [p, i] = await Promise.all([
      supabase.from('profiles').select('id,email,display_name,role').in('role', ['TD', 'Admin', 'SA']).order('role'),
      supabase.from('staff_invites').select('email,role').order('email'),
    ]);
    setStaff(p.data ?? []); setInvites(i.data ?? []);
  };
  useEffect(() => { void reload(); }, []);

  const pending = s.requests.filter((r) => r.status === 'pending');
  const decided = s.requests.filter((r) => r.status !== 'pending').slice(0, 20);

  return (
    <>
      <H1 sub="Coaches on the roster sign in on their own. Everyone else lands here.">Access</H1>
      <Card title={`Waiting for you (${pending.length})`} className="mb-4">
        {!pending.length ? <p className="text-sm text-mute">No requests.</p> : (
          <ul className="space-y-3">
            {pending.map((r) => {
              const isCoach = r.requested_role.includes('Coach');
              const school = schoolFor[r.id] ?? (s.schools.includes(r.school ?? '') ? r.school! : '');
              return (
                <li key={r.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{r.name}</b><Badge tone="info">{r.requested_role}</Badge>
                    <span className="text-sm text-mute">{r.email}{r.phone && <> · <a className="text-info" href={`tel:${r.phone}`}>{r.phone}</a></>} · {time(r.created_at)}</span>
                  </div>
                  {r.note && <p className="mt-1 text-sm italic text-mute">“{r.note}”</p>}
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    {isCoach && (
                      <div className="w-72">
                        <Select label={`School (they typed “${r.school ?? ''}”)`} value={school} onChange={(e) => setSchoolFor({ ...schoolFor, [r.id]: e.target.value })}>
                          <option value="">Pick the school</option>{s.schools.map((x) => <option key={x}>{x}</option>)}
                        </Select>
                      </div>
                    )}
                    <Btn tone="good" disabled={busy === r.id || (isCoach && !school)} onClick={() => run(r.id, () =>
                      rpc('decide_access', { p_id: r.id, p_approve: true, p_school: isCoach ? school : null }), `${r.name} approved`)}>Approve</Btn>
                    <Btn tone="bad" disabled={busy === r.id} onClick={() => run(r.id, () => rpc('decide_access', { p_id: r.id, p_approve: false }), 'Denied')}>Deny</Btn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {decided.length > 0 && (
          <details className="mt-4 text-sm"><summary className="text-mute">Recent decisions</summary>
            <ul className="mt-2 space-y-1">{decided.map((r) => <li key={r.id}><Badge tone={r.status === 'approved' ? 'good' : 'bad'}>{r.status}</Badge> {r.name} · {r.requested_role}{r.school ? ` · ${r.school}` : ''}</li>)}</ul>
          </details>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Staff">
          <ul className="mb-3 space-y-1 text-sm">
            {staff.map((x) => <li key={x.id} className="flex items-center gap-2"><Badge tone="gold">{x.role}</Badge>{x.display_name} <span className="text-mute">{x.email}</span></li>)}
            {invites.filter((i) => !staff.some((x) => x.email === i.email)).map((i) => (
              <li key={i.email} className="flex items-center gap-2">
                <Badge>{i.role}</Badge><span className="text-mute">{i.email} (hasn't signed in yet)</span>
                <button className="ml-auto text-xs text-bad underline" onClick={() => run('inv', async () => { await must(supabase.from('staff_invites').delete().eq('email', i.email)); await reload(); })}>remove</button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <input type="email" placeholder="Email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold" />
            <Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Role })} className="w-40">
              <option value="Admin">Admin</option><option value="SA">Student Activities</option><option value="TD">Director</option>
            </Select>
            <Btn tone="gold" disabled={!/@/.test(inv.email) || busy === 'inv'} onClick={() => run('inv', async () => {
              await must(supabase.from('staff_invites').upsert({ email: inv.email.trim().toLowerCase(), role: inv.role }));
              setInv({ email: '', role: 'Admin' }); await reload();
            }, 'Added. They get in the first time they sign in with that email.')}>Add staff</Btn>
          </div>
        </Card>

        <Card title={`Coaches (${s.coaches.length})`}>
          <div className="mb-3 max-h-64 space-y-1 overflow-y-auto text-sm">
            {s.coaches.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="flex-1">{c.name} <span className="text-mute">· {c.school}</span></span>
                <span className="text-xs text-mute">{c.email ?? 'no email, cannot sign in'}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name" value={coach.name} onChange={(e) => setCoach({ ...coach, name: e.target.value })} />
            <Field label="Email" type="email" value={coach.email} onChange={(e) => setCoach({ ...coach, email: e.target.value })} />
            <Field label="Cell" type="tel" value={coach.phone} onChange={(e) => setCoach({ ...coach, phone: e.target.value })} />
            <Field label="School" list="schools2" value={coach.school} onChange={(e) => setCoach({ ...coach, school: e.target.value })} />
            <datalist id="schools2">{s.schools.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          <Btn tone="gold" className="mt-3" disabled={!coach.name.trim() || !/@/.test(coach.email) || !coach.school.trim() || busy === 'coach'}
            onClick={() => run('coach', async () => {
              await must(supabase.from('coaches').upsert({ tournament_id: t.id, name: coach.name.trim(), email: coach.email.trim().toLowerCase(), phone: coach.phone.trim() || null, school: coach.school.trim() }, { onConflict: 'tournament_id,email' }));
              setCoach({ name: '', email: '', phone: '', school: '' });
            }, 'Coach added')}>Add coach</Btn>

          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm text-mute">Or upload the coach list as a CSV: name, cell, email, school. Re-uploading updates coaches by email.</p>
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-sm font-semibold text-mute hover:border-gold">
              Choose coach CSV
              <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                const text = await f.text();
                setCoachCsv({ text, source: f.name, map: readCoaches(text).map, fix: {}, ok: false });
              }} />
            </label>
            {coachCsv && cParsed && (() => {
              const kept = s.schools.length ? [...new Set(cRows.map((c) => c.school))].filter((x) => !s.schools.includes(x)) : [];
              return (
                <div className="mt-3 rounded-xl border border-gold/40 p-3 text-sm">
                  <p>{coachCsv.source}: {cParsed.missing.length
                    ? <span className="text-warn">match these before saving: {cParsed.missing.join(', ')}.</span>
                    : <><b>{cRows.length}</b> coaches.</>}</p>
                  <ColumnMatcher fields={COACH_FIELDS} headers={cParsed.headers} sample={cParsed.sample} map={coachCsv.map}
                    onChange={(map) => setCoachCsv({ ...coachCsv, map, ok: false })} ok={coachCsv.ok} blocked={cParsed.missing.length > 0}
                    onConfirm={() => setCoachCsv({ ...coachCsv, ok: true })} />
                  {coachCsv.map.phone === undefined && <p className="mt-2 text-warn">No cell column matched: these coaches won't get pairing texts.</p>}
                  <SchoolMatcher names={cParsed.rows.map((c) => c.school)} schools={s.schools} u={coachCsv} keepLabel="No match (coach won't see any students)"
                    onChange={(fix) => setCoachCsv({ ...coachCsv, fix })} />
                  {kept.length > 0 && <p className="mt-2 text-warn">No students at: {kept.join(', ')}. Those coaches won't see any kids until the school matches.</p>}
                  {cParsed.problems.length > 0 && (
                    <details className="mt-1 text-warn"><summary>{cParsed.problems.length} rows skipped</summary><ul className="mt-1 list-disc pl-5">{cParsed.problems.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul></details>
                  )}
                  <div className="mt-2 max-h-40 overflow-y-auto text-xs text-mute">
                    {cRows.slice(0, 8).map((c) => <div key={c.email}>{c.name} · {c.school} · {c.phone ?? 'no cell'}</div>)}
                    {cRows.length > 8 && <div>…and {cRows.length - 8} more</div>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Btn tone="gold" disabled={busy === 'coachcsv' || !cRows.length || !coachCsv.ok} onClick={() => run('coachcsv', async () => {
                      await must(supabase.from('coaches').upsert(cRows.map((c) => ({ ...c, tournament_id: t.id })), { onConflict: 'tournament_id,email' }));
                      setCoachCsv(null);
                    }, `Saved ${cRows.length} coaches`)}>{busy === 'coachcsv' ? 'Saving…' : 'Save coaches'}</Btn>
                    <Btn onClick={() => setCoachCsv(null)}>Cancel</Btn>
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ── Scorers: station code + who has scored ─────────────────────────────── */
export function Scorers({ s, toast }: { s: TournamentState; toast: Toast }) {
  const t = s.t!;
  const { busy, run } = useAction(toast);
  const [code, setCode] = useState<string | null>(null);
  const [sessions, setSessions] = useState<{ id: string; real_name: string; started_at: string }[]>([]);
  const load = async () => {
    const [c, ss] = await Promise.all([
      supabase.from('tournament_secrets').select('scorer_code').eq('tournament_id', t.id).maybeSingle(),
      supabase.from('scorer_sessions').select('id,real_name,started_at').eq('tournament_id', t.id).order('started_at', { ascending: false }).limit(200),
    ]);
    setCode(c.data?.scorer_code ?? null); setSessions(ss.data ?? []);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <H1 sub="Volunteers open the site, tap Scorer, and type this code plus their name. No accounts to create.">Scorers</H1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Station code">
          <div className="rounded-xl bg-panel-2 py-6 text-center font-mono text-4xl font-bold tracking-[0.3em] text-gold">{code ?? '—'}</div>
          <Btn className="mt-3 w-full" disabled={busy === 'code'} onClick={() => {
            if (code && !confirm('Make a new code? Scorers already signed in stay signed in; new ones need the new code.')) return;
            void run('code', async () => {
              await must(supabase.from('tournament_secrets').upsert({ tournament_id: t.id, scorer_code: newCode() }));
              await load();
            }, 'New code ready');
          }}>{code ? 'Make a new code' : 'Create code'}</Btn>
          <p className="mt-2 text-xs text-mute">Scorers can only enter results for the current round while it's posted. Every result records who entered it.</p>
        </Card>
        <Card title={`Scorer sign-ins (${sessions.length})`} action={<Btn onClick={load}>Refresh</Btn>}>
          {!sessions.length ? <p className="text-sm text-mute">No one yet.</p> : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
              {sessions.map((x) => <li key={x.id} className="flex justify-between py-1.5"><span>{x.real_name}</span><span className="text-mute">{new Date(x.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/* ── Settings ───────────────────────────────────────────────────────────── */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
export function Settings({ s, toast }: { s: TournamentState; toast: Toast }) {
  const t = s.t!;
  const { busy, run } = useAction(toast);
  const [f, setF] = useState({
    name: t.name, event_date: t.event_date ?? '', location: t.location ?? '', total_rounds: t.total_rounds,
    team_top_n: t.team_top_n, checkin_cutoff: toLocal(t.checkin_cutoff), reg_doc_url: t.reg_doc_url ?? '', active_grades: t.active_grades,
  });
  const save = () => run('save', () => must(supabase.from('tournaments').update({
    ...f, event_date: f.event_date || null, reg_doc_url: f.reg_doc_url || null,
    checkin_cutoff: f.checkin_cutoff ? new Date(f.checkin_cutoff).toISOString() : null,
    total_rounds: Math.max(f.total_rounds, t.current_round),
  }).eq('id', t.id)), 'Settings saved');

  return (
    <>
      <H1 action={<Btn tone="gold" disabled={busy === 'save'} onClick={save}>Save settings</Btn>}>Settings</H1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Event">
          <div className="space-y-3">
            <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} />
              <Field label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
              <Field label="Rounds" type="number" min={t.current_round} max={12} value={f.total_rounds} onChange={(e) => setF({ ...f, total_rounds: Number(e.target.value) })} />
              <Field label="Team score counts top" type="number" min={1} max={10} value={f.team_top_n} onChange={(e) => setF({ ...f, team_top_n: Number(e.target.value) })} />
            </div>
          </div>
        </Card>
        <Card title="Check-in">
          <div className="space-y-3">
            <Field label="Check-in cutoff" type="datetime-local" value={f.checkin_cutoff} onChange={(e) => setF({ ...f, checkin_cutoff: e.target.value })}
              hint="After this, coaches can't mark attendance or add subs (they can still withdraw). The server enforces it." />
            <Field label="Registration document link" value={f.reg_doc_url} onChange={(e) => setF({ ...f, reg_doc_url: e.target.value })} placeholder="https://docs.google.com/…" />
          </div>
        </Card>
        <Card title="Grades playing">
          <div className="flex flex-wrap gap-2">
            {GRADES.map((g) => {
              const on = f.active_grades.includes(g);
              return <button key={g} onClick={() => setF({ ...f, active_grades: on ? f.active_grades.filter((x) => x !== g) : [...f.active_grades, g].sort((a, b) => a - b) })}
                className={cx('min-h-11 rounded-xl border px-4 text-sm font-semibold', on ? 'border-gold bg-gold text-gold-ink' : 'border-line text-mute')}>{ordinal(g)}</button>;
            })}
          </div>
          <p className="mt-2 text-xs text-mute">Each grade is its own section: pairings, standings and awards stay inside the grade.</p>
        </Card>
        <Card title="Tournament status">
          <p className="mb-3 text-sm text-mute">{t.ended ? 'Ended. Awards are final.' : 'Running. Ending it marks awards final for everyone.'}</p>
          <Btn tone={t.ended ? 'ghost' : 'bad'} disabled={busy === 'end'} onClick={() => {
            if (!t.ended && !confirm('End the tournament? Awards become final.')) return;
            void run('end', () => must(supabase.from('tournaments').update({ ended: !t.ended }).eq('id', t.id)), t.ended ? 'Reopened' : 'Tournament ended');
          }}>{t.ended ? 'Reopen tournament' : 'End tournament'}</Btn>
          {t.ended && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-sm text-mute">Next event: archive this one (it stays in the database) and start fresh.</p>
              <Btn onClick={() => {
                if (prompt('Type ARCHIVE to archive this tournament and start a new one.') !== 'ARCHIVE') return;
                void run('arch', async () => { await must(supabase.from('tournaments').update({ is_active: false }).eq('id', t.id)); window.location.reload(); });
              }}>Archive and start new</Btn>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
