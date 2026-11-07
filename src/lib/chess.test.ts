import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairRound, standings, teamStandings, awardFor, points, type Player, type Game, type Result } from './chess.ts';

// Seeded RNG so failures reproduce.
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const schools = ['Adams', 'Bryan', 'Carter', 'Douglass'];
const mk = (n: number, grade: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${grade}p${i}`, first_name: `P${i}`, last_name: `L${grade}-${i}`, grade,
    school: schools[i % schools.length], status: 'present',
  }));

test('5-round Swiss: everyone paired once per round, no rematches, byes not repeated', () => {
  const rand = rng(7);
  const players = [...mk(15, 9), ...mk(8, 10)];
  const history: Game[] = [];
  for (let round = 1; round <= 5; round++) {
    const pairs = pairRound(players, history, round, [9, 10], rand);
    const seen = new Set<string>();
    for (const p of pairs) {
      for (const id of [p.white_id, p.black_id]) if (id) { assert.ok(!seen.has(id), `round ${round}: ${id} twice`); seen.add(id); }
      const w = players.find((x) => x.id === p.white_id)!;
      if (p.black_id) assert.equal(players.find((x) => x.id === p.black_id)!.grade, w.grade, 'cross-grade game');
    }
    assert.equal(seen.size, players.length, `round ${round}: someone unpaired`);
    assert.deepEqual(pairs.map((p) => p.board), pairs.map((_, i) => i + 1), 'boards not 1..n');
    for (const p of pairs) {
      const result: Result = p.black_id ? (['white', 'black', 'draw'] as const)[Math.floor(rand() * 3)] : 'bye';
      history.push({ round, board: p.board, grade: p.grade, white_id: p.white_id, black_id: p.black_id, result });
    }
  }
  const meetings = new Set<string>();
  for (const g of history) if (g.black_id) {
    const key = [g.white_id, g.black_id].sort().join('|');
    assert.ok(!meetings.has(key), `rematch ${key}`);
    meetings.add(key);
  }
  const byes = history.filter((g) => g.result === 'bye').map((g) => g.white_id);
  assert.equal(new Set(byes).size, byes.length, 'someone got two byes');

  const st = standings(players.filter((p) => p.grade === 9), history, 5);
  const total = st.reduce((a, s) => a + s.score, 0);
  const expected = history.filter((g) => g.grade === 9).reduce((a, g) => a + points(g.result)[0] + points(g.result)[1], 0);
  assert.equal(total, expected);
  assert.ok(st.every((s, i) => i === 0 || st[i - 1].score >= s.score), 'standings not sorted');
});

test('round 1 avoids same-school games when it can', () => {
  const players = mk(8, 11); // 2 per school
  for (const p of pairRound(players, [], 1, [11], rng(3))) {
    const a = players.find((x) => x.id === p.white_id)!, b = players.find((x) => x.id === p.black_id)!;
    assert.notEqual(a.school, b.school);
  }
});

test('only present players get paired', () => {
  const players = mk(6, 12);
  players[0].status = 'absent'; players[1].status = 'registered'; players[2].status = 'withdrawn';
  const ids = pairRound(players, [], 1, [12], rng(1)).flatMap((p) => [p.white_id, p.black_id]).filter(Boolean);
  assert.deepEqual(ids.sort(), ['g12p3', 'g12p4', 'g12p5']); // 1 game + 1 bye
});

test('modified median and solkoff', () => {
  const [a, b, c, d] = mk(4, 9);
  const g: Game[] = [
    { round: 1, board: 1, grade: 9, white_id: a.id, black_id: b.id, result: 'white' },
    { round: 1, board: 2, grade: 9, white_id: c.id, black_id: d.id, result: 'draw' },
    { round: 2, board: 1, grade: 9, white_id: c.id, black_id: a.id, result: 'black' },
    { round: 2, board: 2, grade: 9, white_id: b.id, black_id: d.id, result: 'white' },
  ];
  const st = standings([a, b, c, d], g, 2);
  assert.equal(st[0].player.id, a.id);
  assert.equal(st[0].score, 2);
  assert.equal(st[0].solkoff, 1 + 0.5); // opponents b (1) + c (0.5)
});

test('team score = top 4 and award tiers', () => {
  const rows = [5, 4, 3, 2, 1].map((score, i) => ({ player: { id: `x${i}`, school: 'Adams' }, score })) as never;
  assert.deepEqual(teamStandings(rows, 4)[0], { school: 'Adams', score: 14, counted: 4 });
  const tiers = [{ name: 'Gold', min: 4, max: 5 }, { name: 'Silver', min: 2, max: 3.5 }];
  assert.equal(awardFor(4.5, tiers)?.name, 'Gold');
  assert.equal(awardFor(3.5, tiers)?.name, 'Silver');
  assert.equal(awardFor(1, tiers), null);
});
