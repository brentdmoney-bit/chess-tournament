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

export function readRoster(text: string): { rows: RosterRow[]; problems: string[]; missing: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], problems: [], missing: ['a header row and at least one student'] };
  const head = grid[0].map(norm);
  const col: Record<string, number> = {};
  const used = new Set<number>();
  for (const [key, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      const i = head.findIndex((h, idx) => !used.has(idx) && h === n);
      if (i >= 0) { col[key] = i; used.add(i); break; }
    }
  }
  const missing = [
    !('name' in col) && !('first' in col && 'last' in col) && 'student name',
    !('grade' in col) && 'grade',
    !('school' in col) && 'school',
  ].filter(Boolean) as string[];
  if (missing.length) return { rows: [], problems: [], missing };

  const rows: RosterRow[] = [];
  const problems: string[] = [];
  grid.slice(1).forEach((r, i) => {
    const get = (k: string) => (col[k] === undefined ? '' : r[col[k]] ?? '');
    const [first, last] = 'first' in col ? [title(get('first')), title(get('last'))] : splitName(get('name'));
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
  return { rows, problems, missing };
}

export interface CoachRow { name: string; email: string; phone: string | null; school: string }

const COACH_ALIASES: Record<string, string[]> = {
  email: ['coachemail', 'sponsoremail', 'teacheremail', 'email', 'emailaddress'],
  phone: ['coachcell', 'coachphone', 'cell', 'cellphone', 'mobile', 'phone', 'phonenumber', 'sponsorphone'],
  name: ['coachname', 'coach', 'sponsor', 'teacher', 'name', 'fullname'],
  school: ['school', 'campus', 'schoolname'],
};

/** Coach list CSV: name, cell, email, school. One row per coach; email is how they sign in. */
export function readCoaches(text: string): { rows: CoachRow[]; problems: string[]; missing: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], problems: [], missing: ['a header row and at least one coach'] };
  const head = grid[0].map(norm);
  const col: Record<string, number> = {};
  const used = new Set<number>();
  for (const [key, names] of Object.entries(COACH_ALIASES)) {
    for (const n of names) {
      const i = head.findIndex((h, idx) => !used.has(idx) && h === n);
      if (i >= 0) { col[key] = i; used.add(i); break; }
    }
  }
  const missing = ['name', 'email', 'school'].filter((k) => !(k in col)).map((k) => (k === 'name' ? 'coach name' : k));
  if (missing.length) return { rows: [], problems: [], missing };

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
  return { rows, problems, missing };
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
