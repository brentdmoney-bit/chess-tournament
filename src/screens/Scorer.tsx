import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RESULT_LABEL, fullName, points, type Result } from '../lib/chess.ts';
import { supabase, rpc, type DbGame, type Profile } from '../lib/supabase.ts';
import { useTournament } from '../lib/useTournament.ts';
import { Badge, Btn, Card, Empty, ErrorBar, H1, Shell, cx, useAction, useToast } from '../ui.tsx';

const KEYS: Record<string, Result> = { w: 'white', b: 'black', d: 'draw' };

/**
 * Scoring station built for speed: type the board number + Enter, pick the result (click or W/B/D),
 * Enter saves and drops you back in the board box. Works by tapping on a phone too.
 */
export default function Scorer({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const s = useTournament('Scorer');
  const { toast, node } = useToast();
  const { busy, run } = useAction(toast);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [pick, setPick] = useState<Result | null>(null);
  const [overwrite, setOverwrite] = useState(false); // second Enter needed to replace an existing result
  const [lookup, setLookup] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const boardInput = useRef<HTMLInputElement>(null);

  const t = s.t;
  const open = t && (t.round_phase === 'published' || t.round_phase === 'locked');
  const games = s.roundGames.filter((g) => g.black_id);
  const game = games.find((g) => g.id === boardId) ?? null;
  const done = games.filter((g) => g.result).length;

  const back = () => { setBoardId(null); setPick(null); setOverwrite(false); setNote(''); setLookup(''); setTimeout(() => boardInput.current?.focus(), 0); };
  const choose = (g: DbGame) => { setBoardId(g.id); setPick(null); setOverwrite(false); setErr(''); };

  const findBoard = () => {
    const n = parseInt(lookup, 10);
    const any = s.roundGames.find((x) => x.board === n);
    if (!any) return setErr(`There's no board ${lookup} this round.`);
    if (!any.black_id) return setErr(`Board ${lookup} is a bye. Nothing to score.`);
    choose(any);
  };

  const save = () => {
    if (!game || !pick || busy === 'save') return;
    if (game.result && game.result !== pick && !overwrite) { setOverwrite(true); return; }
    void run('save', async () => {
      await rpc('record_result', { p_game: game.id, p_result: pick });
      back();
    }, `Board ${game.board}: ${RESULT_LABEL[pick]}`);
  };

  // Keyboard on the result step: W / B / D pick, Enter saves, Esc goes back. Ignored while typing a note.
  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (KEYS[k]) { setPick(KEYS[k]); setOverwrite(false); }
      else if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const upload = (file: File) => game && run('photo', async () => {
    const path = `round-${game.round}/board-${game.board}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('scorecards').upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    await rpc('attach_scorecard', { p_game: game.id, p_path: path });
  }, 'Scorecard photo saved');

  const help = () => game && run('help', async () => { await rpc('request_help', { p_board: game.board, p_note: note }); setNote(''); }, 'A director is on the way');

  const W = game ? s.byId.get(game.white_id) : null, B = game?.black_id ? s.byId.get(game.black_id) : null;

  return (
    <Shell role="Scorer" who={profile.display_name ?? 'Scorer'} t={t} onSignOut={onSignOut}>
      <ErrorBar error={s.error} onClose={() => s.setError(null)} />
      {!s.loaded ? null : !t ? <Empty>No tournament is running.</Empty> : !open ? (
        <Empty>Round {t.current_round} pairings aren't posted yet. This screen updates by itself.</Empty>
      ) : !game ? (
        <div className="mx-auto max-w-lg">
          <H1 sub={`${done} of ${games.length} boards scored · type a board number and press Enter`}>Score a board</H1>
          <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (lookup) findBoard(); }}>
            <input ref={boardInput} autoFocus inputMode="numeric" enterKeyHint="go" aria-label="Board number" value={lookup}
              onChange={(e) => { setLookup(e.target.value.replace(/\D/g, '')); setErr(''); }} placeholder="Board #"
              className={cx('min-h-16 w-full rounded-xl border bg-panel-2 px-4 text-center text-3xl font-bold outline-none focus:border-gold', err ? 'border-bad' : 'border-line')} />
            <Btn tone="gold" big disabled={!lookup}>Go</Btn>
          </form>
          <p className={cx('mb-4 min-h-5 text-center text-sm', err ? 'text-bad' : 'text-mute')}>{err || ' '}</p>
          <details className="text-sm">
            <summary className="cursor-pointer text-mute">Or tap a board</summary>
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {games.map((g) => (
                <button key={g.id} onClick={() => choose(g)}
                  className={cx('aspect-square rounded-xl border text-sm font-bold', g.result ? 'border-good/40 bg-good/10 text-good' : 'border-line bg-panel hover:border-gold')}>
                  {g.board}{g.result && <div className="text-xs">✓</div>}
                </button>
              ))}
            </div>
          </details>
        </div>
      ) : (
        <div className="mx-auto max-w-lg space-y-4">
          <button onClick={back} className="text-sm text-mute">← Back to board number (Esc)</button>
          <div className="text-center">
            <Badge tone="gold">Board {game.board} · Round {game.round}</Badge>
            {game.result && <div className="mt-2"><Badge tone="warn">Already scored: {RESULT_LABEL[game.result]}</Badge></div>}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <Side color="White" name={W ? fullName(W) : '?'} school={W?.school} />
            <span className="text-mute">vs</span>
            <Side color="Black" name={B ? fullName(B) : '?'} school={B?.school} />
          </div>

          <Card title="Who won?">
            <div className="grid grid-cols-3 gap-2">
              {(['white', 'draw', 'black'] as Result[]).map((r) => (
                <ResultBtn key={r} on={pick === r} onClick={() => { setPick(r); setOverwrite(false); }}>
                  {r === 'draw' ? 'Draw' : r === 'white' ? 'White' : 'Black'}
                  <span className="block text-xs font-normal opacity-70">key {r === 'draw' ? 'D' : r === 'white' ? 'W' : 'B'}</span>
                </ResultBtn>
              ))}
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-mute">Someone didn't show</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['white_ff', 'double_ff', 'black_ff'] as Result[]).map((r) => (
                <ResultBtn key={r} small on={pick === r} onClick={() => { setPick(r); setOverwrite(false); }}>
                  {r === 'white_ff' ? 'Black no-show' : r === 'black_ff' ? 'White no-show' : 'Both no-show'}
                </ResultBtn>
              ))}
            </div>
          </Card>

          {pick && (
            <Card>
              <div className="mb-3 grid grid-cols-2 text-center">
                {points(pick).map((p, i) => <div key={i}><div className="text-xs text-mute">{i ? 'Black' : 'White'}</div><div className="text-4xl font-bold">{p === 0.5 ? '½' : p}</div></div>)}
              </div>
              {overwrite && <p className="mb-2 text-center text-sm font-semibold text-warn">This replaces {RESULT_LABEL[game.result!]}. Press Enter again to confirm.</p>}
              <Btn tone="gold" big className="w-full" disabled={busy === 'save'} onClick={save}>
                {busy === 'save' ? 'Saving…' : overwrite ? `Replace with: ${RESULT_LABEL[pick]}` : `Save: ${RESULT_LABEL[pick]} (Enter)`}
              </Btn>
            </Card>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-mute">Scorecard photo or call a director</summary>
            <div className="mt-2 space-y-2">
              <label className={cx('flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed text-sm font-semibold',
                game.photo_path ? 'border-good text-good' : 'border-line text-mute')}>
                {busy === 'photo' ? 'Uploading…' : game.photo_path ? '✓ Scorecard photo saved · retake' : '📷 Photo of the scorecard (optional)'}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
              </label>
              <div className="flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Players disagree? Optional note"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold" />
                <Btn tone="warn" disabled={busy === 'help'} onClick={help}>Call a director</Btn>
              </div>
            </div>
          </details>
        </div>
      )}
      {node}
    </Shell>
  );
}

function Side({ color, name, school }: { color: string; name: string; school?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-mute">{color === 'White' ? '♔' : '♚'} {color}</div>
      <div className="mt-1 font-semibold leading-tight">{name}</div>
      <div className="text-xs text-mute">{school}</div>
    </div>
  );
}

function ResultBtn({ on, small, onClick, children }: { on: boolean; small?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={cx('rounded-xl border font-semibold transition', small ? 'min-h-12 text-xs' : 'min-h-16 text-base',
      on ? 'border-gold bg-gold text-gold-ink' : 'border-line bg-panel-2 hover:border-mute')}>{children}</button>
  );
}
