// Pure tournament math: results, standings, tiebreaks, Swiss pairing, team scores, awards.
// No React, no Supabase, so it runs under `node --test`.

export type Result = 'white' | 'black' | 'draw' | 'white_ff' | 'black_ff' | 'double_ff' | 'bye';
export type PlayerStatus = 'registered' | 'present' | 'absent' | 'withdrawn';

export interface Player {
  id: string;
  first_name: string;
  last_name: string;
  grade: number;
  school: string;
  status: PlayerStatus;
  student_id?: string | null;
  coach_name?: string | null;
  is_sub?: boolean;
}

export interface Game {
  id?: string;
  round: number;
  board: number;
  grade: number;
  white_id: string;
  black_id: string | null;
  result: Result | null;
  photo_path?: string | null;
}

export interface AwardTier { name: string; min: number; max: number }

export const RESULT_LABEL: Record<Result, string> = {
  white: 'White wins',
  black: 'Black wins',
  draw: 'Draw',
  white_ff: 'White wins by forfeit',
  black_ff: 'Black wins by forfeit',
  double_ff: 'Double forfeit',
  bye: 'Bye',
};

/** Points [white, black] for a result. */
export function points(r: Result | null): [number, number] {
  switch (r) {
    case 'white': case 'white_ff': case 'bye': return [1, 0];
    case 'black': case 'black_ff': return [0, 1];
    case 'draw': return [0.5, 0.5];
    default: return [0, 0];
  }
}

/** Played over the board (forfeits and byes don't count as meeting for tiebreaks). */
const played = (g: Game) => g.black_id !== null && (g.result === 'white' || g.result === 'black' || g.result === 'draw');

export const fullName = (p: Pick<Player, 'first_name' | 'last_name'>) => `${p.first_name} ${p.last_name}`;
export const ordinal = (n: number) => `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n] ?? 'th'}`;
export const fmtScore = (n: number) => (n % 1 ? `${Math.floor(n) || ''}½` : String(n));

export interface Standing {
  player: Player;
  score: number;
  wins: number; losses: number; draws: number;
  modMedian: number;
  solkoff: number;
  opponents: string[];
  colors: ('W' | 'B')[];
  hadBye: boolean;
  place: number;
}

/**
 * Standings within whatever set of players you pass (usually one grade).
 * Tiebreak order: score, Modified Median, Solkoff, last name.
 * ponytail: unplayed rounds count as opponent score 0 in tiebreaks; switch to USCF "adjusted score" if a trophy is ever disputed.
 */
export function standings(players: Player[], games: Game[], completedRounds: number): Standing[] {
  const by = new Map<string, Standing>();
  for (const p of players) {
    by.set(p.id, { player: p, score: 0, wins: 0, losses: 0, draws: 0, modMedian: 0, solkoff: 0, opponents: [], colors: [], hadBye: false, place: 0 });
  }
  for (const g of games) {
    if (!g.result) continue;
    const [wp, bp] = points(g.result);
    const w = by.get(g.white_id);
    const b = g.black_id ? by.get(g.black_id) : undefined;
    if (w) {
      w.score += wp;
      if (g.result === 'bye') w.hadBye = true;
      else {
        w.colors.push('W');
        if (wp === 1) w.wins++; else if (wp === 0.5) w.draws++; else w.losses++;
        if (played(g) && g.black_id) w.opponents.push(g.black_id);
      }
    }
    if (b) {
      b.score += bp;
      b.colors.push('B');
      if (bp === 1) b.wins++; else if (bp === 0.5) b.draws++; else b.losses++;
      if (played(g)) b.opponents.push(g.white_id);
    }
  }
  const half = completedRounds / 2;
  for (const s of by.values()) {
    const opp = s.opponents.map((id) => by.get(id)?.score ?? 0);
    while (opp.length < completedRounds) opp.push(0);
    opp.sort((a, b) => a - b);
    s.solkoff = opp.reduce((a, b) => a + b, 0);
    let mm = opp;
    if (opp.length > 2) {
      if (s.score > half) mm = opp.slice(1);
      else if (s.score < half) mm = opp.slice(0, -1);
      else mm = opp.slice(1, -1);
    }
    s.modMedian = mm.reduce((a, b) => a + b, 0);
  }
  const list = [...by.values()].sort((a, b) =>
    b.score - a.score || b.modMedian - a.modMedian || b.solkoff - a.solkoff ||
    a.player.last_name.localeCompare(b.player.last_name));
  // Players tied on every tiebreak share a place.
  list.forEach((s, i) => {
    const prev = list[i - 1];
    s.place = prev && prev.score === s.score && prev.modMedian === s.modMedian && prev.solkoff === s.solkoff ? prev.place : i + 1;
  });
  return list;
}

/** School team score = sum of each school's top N individual scores. */
export function teamStandings(rows: Standing[], topN: number) {
  const bySchool = new Map<string, number[]>();
  for (const r of rows) {
    const list = bySchool.get(r.player.school) ?? [];
    list.push(r.score);
    bySchool.set(r.player.school, list);
  }
  return [...bySchool.entries()]
    .map(([school, scores]) => {
      const top = scores.sort((a, b) => b - a).slice(0, topN);
      return { school, score: top.reduce((a, b) => a + b, 0), counted: top.length };
    })
    .sort((a, b) => b.score - a.score || a.school.localeCompare(b.school));
}

export function awardFor(score: number, tiers: AwardTier[]): AwardTier | null {
  return tiers.find((t) => score >= t.min && score <= t.max) ?? null;
}

// ── Pairing ────────────────────────────────────────────────────────────

export interface Pairing { grade: number; white_id: string; black_id: string | null }

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Swiss pairing for one section (grade). Hard rule: no rematches. Soft rule: avoid
 * same-school games (dropped only if pairing is otherwise impossible).
 * Round 1 is a random draw. Odd count: lowest-ranked player without a bye gets it (1 pt).
 */
export function pairSection(players: Player[], history: Game[], round: number, rand: () => number = Math.random): Pairing[] {
  if (players.length === 0) return [];
  const grade = players[0].grade;
  const st = new Map(standings(players, history, round - 1).map((s) => [s.player.id, s]));
  const met = new Set<string>();
  for (const g of history) if (g.black_id) { met.add(g.white_id + '|' + g.black_id); met.add(g.black_id + '|' + g.white_id); }

  const randKey = new Map(players.map((p) => [p.id, rand()]));
  let order = round === 1
    ? shuffle(players, rand)
    : [...players].sort((a, b) => st.get(b.id)!.score - st.get(a.id)!.score || randKey.get(a.id)! - randKey.get(b.id)!);

  let bye: Pairing | null = null;
  if (order.length % 2 === 1) {
    let idx = -1;
    for (let i = order.length - 1; i >= 0; i--) if (!st.get(order[i].id)!.hadBye) { idx = i; break; }
    if (idx === -1) idx = order.length - 1;
    bye = { grade, white_id: order[idx].id, black_id: null };
    order = order.filter((_, i) => i !== idx);
  }

  let budget = 200_000; // stop runaway backtracking on a pathological section
  const solve = (pool: Player[], strictSchool: boolean): [Player, Player][] | null => {
    if (pool.length === 0) return [];
    if (--budget < 0) return null;
    const [top, ...rest] = pool;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (met.has(top.id + '|' + c.id)) continue;
      if (strictSchool && top.school === c.school) continue;
      const sub = solve(rest.filter((_, j) => j !== i), strictSchool);
      if (sub) return [[top, c], ...sub];
    }
    return null;
  };
  // ponytail: plain backtracking; fine for a few dozen per grade, swap for blossom matching at hundreds.
  const pairs = solve(order, true) ?? ((budget = 200_000), solve(order, false)) ?? adjacent(order);

  const out: Pairing[] = pairs.map(([a, b]) => {
    const bal = (c: ('W' | 'B')[]) => c.filter((x) => x === 'W').length - c.filter((x) => x === 'B').length;
    const ca = st.get(a.id)!.colors, cb = st.get(b.id)!.colors;
    // Fewer Whites gets White; tie → whoever had Black last; tie → coin flip.
    const aWhite = bal(ca) !== bal(cb) ? bal(ca) < bal(cb)
      : ca.at(-1) !== cb.at(-1) ? ca.at(-1) === 'B'
      : rand() < 0.5;
    return aWhite ? { grade, white_id: a.id, black_id: b.id } : { grade, white_id: b.id, black_id: a.id };
  });
  return bye ? [...out, bye] : out;
}

function adjacent(order: Player[]): [Player, Player][] {
  const pairs: [Player, Player][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  return pairs;
}

/** Pair every active grade among players marked present; boards numbered globally, lowest grade first. */
export function pairRound(players: Player[], history: Game[], round: number, grades: number[], rand: () => number = Math.random) {
  const games: (Pairing & { board: number })[] = [];
  let board = 1;
  for (const grade of [...grades].sort((a, b) => a - b)) {
    const section = players.filter((p) => p.grade === grade && p.status === 'present');
    const hist = history.filter((g) => g.grade === grade && g.round < round);
    for (const p of pairSection(section, hist, round, rand)) games.push({ ...p, board: board++ });
  }
  return games;
}
