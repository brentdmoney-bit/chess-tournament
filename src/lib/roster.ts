// Roster import: CSV text (file upload or a Google Sheet's CSV export) → players + coaches.
// Handles the district registration export shape: "Last, First" names, "123 - School" campus
// labels, "LAST, FIRST" coach names, plus plain First/Last columns.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
// Checked in this order, exact header match, each column used once.
const ALIASES: Record<string, string[]> = {
  coachEmail: ['coachemail', 'sponsoremail', 'teacheremail', 'email'],
  coachPhone: ['coachphone', 'coachcell', 'sponsorphone', 'phone', 'cell'],
  coach: ['coachname', 'coach', 'sponsor', 'teacher'],
  studentId: ['studentid', 'eid', 'id', 'studentnumber'],
  first: ['firstname', 'first'],
  last: ['lastname', 'last'],
  name: ['studentname', 'fullname', 'name', 'student'],
  grade: ['grade', 'gradelevel', 'gr'],
  school: ['school', 'campus', 'schoolname'],
};

/** Column picks: field key → column index (undefined = not in this file). */
export type ColMap = Record<string, number | undefined>;
export interface Field { key: string; label: string }

export const ROSTER_FIELDS: Field[] = [
  { key: 'studentId', label: 'Student ID' }, { key: 'name', label: 'Student name (one column)' },
  { key: 'first', label: 'First name' }, { key: 'last', label: 'Last name' },
  { key: 'grade', label: 'Grade' }, { key: 'school', label: 'School' },
  { key: 'coach', label: 'Coach name' }, { key: 'coachPhone', label: 'Coach cell' }, { key: 'coachEmail', label: 'Coach email' },
];

function guess(headers: string[], aliases: Record<string, string[]>): ColMap {
  const head = headers.map(norm);
  const col: ColMap = {};
  const used = new Set<number>();
  // Exact header first, then "header contains it" ("Cell Phone Number" → cell). The TD confirms either way.
  for (const exact of [true, false]) {
    for (const [key, names] of Object.entries(aliases)) {
      if (col[key] !== undefined) continue;
      for (const n of names) {
        if (!exact && n.length < 4) continue;
        const i = head.findIndex((h, idx) => !used.has(idx) && (exact ? h === n : h.includes(n)));
        if (i >= 0) { col[key] = i; used.add(i); break; }
      }
    }
  }
  return col;
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();
/** "Last, First Middle" → [First Middle, Last]; "First Last" → [First, Last]. */
export function splitName(s: string): [string, string] {
  if (s.includes(',')) { const [l, f] = s.split(',', 2); return [title(f), title(l)]; }
  const parts = s.trim().split(/\s+/);
  return parts.length === 1 ? [title(parts[0]), ''] : [title(parts.slice(0, -1).join(' ')), title(parts.at(-1)!)];
}

export interface RosterRow {
  student_id: string | null; first_name: string; last_name: string; grade: number; school: string;
  coach_name: string | null; coach_email: string | null; coach_phone: string | null;
}

export interface Parsed<R> { headers: string[]; sample: string[]; map: ColMap; rows: R[]; problems: string[]; missing: string[] }

/** Pass `map` to use the TD's column picks; leave it out to guess from the headers. */
export function readRoster(text: string, map?: ColMap): Parsed<RosterRow> {
  const grid = parseCsv(text);
  const headers = grid[0] ?? [];
  const col = map ?? guess(headers, ALIASES);
  if (grid.length < 2) return { headers, sample: grid[1] ?? [], map: col, rows: [], problems: [], missing: ['a header row and at least one student'] };
  const has = (k: string) => col[k] !== undefined;
  const missing = [
    !has('name') && !(has('first') && has('last')) && 'student name',
    !has('grade') && 'grade',
    !has('school') && 'school',
  ].filter(Boolean) as string[];
  if (missing.length) return { headers, sample: grid[1] ?? [], map: col, rows: [], problems: [], missing };

  const rows: RosterRow[] = [];
  const problems: string[] = [];
  grid.slice(1).forEach((r, i) => {
    const get = (k: string) => (col[k] === undefined ? '' : r[col[k]] ?? '');
    const [first, last] = has('first') && has('last') ? [title(get('first')), title(get('last'))] : splitName(get('name'));
    const grade = parseInt(get('grade'), 10);
    const school = get('school').replace(/^\d+\s*-\s*/, '').trim();
    const line = i + 2;
    if (!first || !last) return problems.push(`Line ${line}: no full student name`);
    if (!(grade >= 1 && grade <= 12)) return problems.push(`Line ${line}: grade "${get('grade')}" isn't 1 to 12`);
    if (!school) return problems.push(`Line ${line}: no school`);
    const coach = get('coach');
    const email = get('coachEmail').toLowerCase();
    rows.push({
      student_id: get('studentId') || null, first_name: first, last_name: last, grade, school,
      coach_name: coach ? splitName(coach).join(' ').trim() : null,
      coach_email: /@/.test(email) ? email : null,
      coach_phone: get('coachPhone') || null,
    });
  });
  const ids = new Set<string>();
  for (const r of rows) if (r.student_id) { if (ids.has(r.student_id)) problems.push(`Student ID ${r.student_id} appears twice`); ids.add(r.student_id); }
  return { headers, sample: grid[1] ?? [], map: col, rows, problems, missing };
}

export interface CoachRow { name: string; email: string; phone: string | null; school: string }

const COACH_ALIASES: Record<string, string[]> = {
  email: ['coachemail', 'sponsoremail', 'teacheremail', 'email', 'emailaddress'],
  phone: ['coachcell', 'coachphone', 'cell', 'cellphone', 'mobile', 'phone', 'phonenumber', 'sponsorphone'],
  name: ['coachname', 'coach', 'sponsor', 'teacher', 'name', 'fullname'],
  school: ['school', 'campus', 'schoolname'],
};

export const COACH_FIELDS: Field[] = [
  { key: 'name', label: 'Coach name' }, { key: 'phone', label: 'Cell' }, { key: 'email', label: 'Email' }, { key: 'school', label: 'School' },
];

/** Coach list CSV: name, cell, email, school. One row per coach; email is how they sign in. */
export function readCoaches(text: string, map?: ColMap): Parsed<CoachRow> {
  const grid = parseCsv(text);
  const headers = grid[0] ?? [];
  const col = map ?? guess(headers, COACH_ALIASES);
  if (grid.length < 2) return { headers, sample: grid[1] ?? [], map: col, rows: [], problems: [], missing: ['a header row and at least one coach'] };
  const missing = ['name', 'email', 'school'].filter((k) => col[k] === undefined).map((k) => (k === 'name' ? 'coach name' : k));
  if (missing.length) return { headers, sample: grid[1] ?? [], map: col, rows: [], problems: [], missing };

  const rows: CoachRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  grid.slice(1).forEach((r, i) => {
    const get = (k: string) => (col[k] === undefined ? '' : r[col[k]] ?? '').trim();
    const line = i + 2;
    const name = get('name') ? splitName(get('name')).join(' ').trim() : '';
    const email = get('email').toLowerCase();
    const school = get('school').replace(/^\d+\s*-\s*/, '').trim();
    if (!name) return problems.push(`Line ${line}: no coach name`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problems.push(`Line ${line}: ${name} has no valid email, so they couldn't sign in`);
    if (!school) return problems.push(`Line ${line}: ${name} has no school`);
    if (seen.has(email)) return problems.push(`Line ${line}: ${email} appears twice`);
    seen.add(email);
    rows.push({ name, email, phone: get('phone') || null, school });
  });
  return { headers, sample: grid[1] ?? [], map: col, rows, problems, missing };
}

/** One coach per email (falls back to name+school when the sheet has no email). */
export function coachesFrom(rows: RosterRow[]) {
  const m = new Map<string, { name: string; email: string | null; phone: string | null; school: string }>();
  for (const r of rows) {
    if (!r.coach_name && !r.coach_email) continue;
    const key = r.coach_email ?? `${r.coach_name}|${r.school}`;
    if (!m.has(key)) m.set(key, { name: r.coach_name ?? r.coach_email!, email: r.coach_email, phone: r.coach_phone, school: r.school });
  }
  return [...m.values()];
}

const schoolKey = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `
  .replace(/ (high school|elementary school|middle school|high|school|elementary|elem|es|middle|ms|hs|h s|sr|senior|the|academy|campus|magnet) /g, ' ').replace(/\s+/g, '');
const bigrams = (s: string) => { const b = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); b.set(g, (b.get(g) ?? 0) + 1); } return b; };
/** Closest roster school to a typed name ("Skyline HS" → "Skyline High School"), or null when nothing is close. */
export function closestSchool(name: string, schools: string[]): string | null {
  const k = schoolKey(name);
  let best: string | null = null, top = 0;
  for (const s of schools) {
    const sk = schoolKey(s);
    if (sk === k) return s;
    const a = bigrams(k), b = bigrams(sk);
    let both = 0; for (const [g, n] of a) both += Math.min(n, b.get(g) ?? 0);
    const score = (2 * both) / Math.max(1, k.length - 1 + sk.length - 1);
    if (score > top) { top = score; best = s; }
  }
  return top >= 0.6 ? best : null;
}
