// Texts each coach their school's boards (kind "pairings") or their students' final scores (kind "final").
// Sends through Twilio when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are set; otherwise a dry run.
import { cors, json, requireRole } from '../_shared/auth.ts';

type P = { id: string; first_name: string; last_name: string; school: string; grade: number };
type G = { board: number; white_id: string; black_id: string | null; result: string | null; round: number };

const e164 = (raw: string | null) => {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
};
const PTS: Record<string, [number, number]> = { white: [1, 0], white_ff: [1, 0], bye: [1, 0], black: [0, 1], black_ff: [0, 1], draw: [0.5, 0.5] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = await requireRole(req, ['TD', 'Admin']);
  if (db instanceof Response) return db;
  const { round, kind = 'pairings' } = await req.json().catch(() => ({}));

  const { data: t } = await db.from('tournaments').select('id,name,current_round,round_phase').eq('is_active', true).single();
  if (!t) return json({ error: 'No active tournament.' }, 400);
  const r = Number(round) || t.current_round;
  if (kind === 'pairings' && !['published', 'locked'].includes(t.round_phase)) return json({ error: 'Post the pairings first.' }, 400);

  const [{ data: players }, { data: games }, { data: coaches }] = await Promise.all([
    db.from('players').select('id,first_name,last_name,school,grade').eq('tournament_id', t.id),
    db.from('games').select('board,white_id,black_id,result,round').eq('tournament_id', t.id),
    db.from('coaches').select('name,phone,school').eq('tournament_id', t.id).eq('approved', true),
  ]);
  const byId = new Map((players as P[]).map((p) => [p.id, p]));
  const nm = (id: string | null) => (id && byId.get(id) ? `${byId.get(id)!.first_name} ${byId.get(id)!.last_name}` : 'BYE');

  const bodyFor = (school: string) => {
    if (kind === 'final') {
      const score = new Map<string, number>();
      for (const g of games as G[]) {
        const [w, b] = PTS[g.result ?? ''] ?? [0, 0];
        score.set(g.white_id, (score.get(g.white_id) ?? 0) + w);
        if (g.black_id) score.set(g.black_id, (score.get(g.black_id) ?? 0) + b);
      }
      const mine = (players as P[]).filter((p) => p.school === school && score.has(p.id))
        .sort((a, b) => score.get(b.id)! - score.get(a.id)!);
      if (!mine.length) return null;
      return `${t.name}: final scores for ${school}\n` + mine.map((p) => `${p.first_name} ${p.last_name}: ${score.get(p.id)}`).join('\n');
    }
    const mine = (games as G[]).filter((g) => g.round === r &&
      (byId.get(g.white_id)?.school === school || (g.black_id && byId.get(g.black_id)?.school === school)));
    if (!mine.length) return null;
    const lines = mine.map((g) => g.black_id ? `Bd ${g.board}: ${nm(g.white_id)} (W) vs ${nm(g.black_id)} (B)` : `${nm(g.white_id)}: bye (1 pt)`);
    return `${t.name} round ${r} pairings for ${school}\n${lines.join('\n')}`;
  };

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), token = Deno.env.get('TWILIO_AUTH_TOKEN'), from = Deno.env.get('TWILIO_FROM');
  const dryRun = !(sid && token && from);
  let sent = 0;
  const failed: string[] = [];
  for (const c of coaches as { name: string; phone: string | null; school: string }[]) {
    const to = e164(c.phone);
    const body = bodyFor(c.school);
    if (!to || !body) continue;
    if (dryRun) { sent++; continue; }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from!, Body: body }),
    });
    if (res.ok) sent++; else failed.push(c.name);
  }
  return json({ sent, dryRun, failed });
});
