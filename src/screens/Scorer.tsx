import { useEffect, useRef, useState } from 'react';
import { RESULT_LABEL, fullName, ordinal, points, type Result } from '../lib/chess.ts';
import { supabase, rpc, type DbGame, type Profile } from '../lib/supabase.ts';
import { useTournament } from '../lib/useTournament.ts';
import { Badge, Btn, Empty, ErrorBar, Shell, cx, useAction, useToast } from '../ui.tsx';

const KEYS: Record<string, Result> = { w: 'white', b: 'black', d: 'draw' };

/**
 * Scoring station built for speed: type the board number + Enter, click the kid who won (or Draw),
 * Enter saves and drops you back in the board box. W/B/D keys work too. Sized off the window height
 * so both steps fit without scrolling; 80% of the page width on a laptop, full width on a phone.
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

  const back = () => { setBoardId(null); setPick(null); setOverwrite(false); setNote(''); setLookup(''); setTimeout(() => boardInput.current?.focus(), 0); };
  const choose = (g: DbGame) => { setBoardId(g.id); setPick(null); setOverwrite(false); setErr(''); };
  const select = (r: Result) => { setPick(r); setOverwrite(false); };

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
      if (KEYS[k]) select(KEYS[k]);
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
  const wName = W ? fullName(W) : '?', bName = B ? fullName(B) : '?';
  const first = (n: string) => n.split(' ')[0];
  const noShows: [Result, string][] = [
    ['white_ff', `${first(wName)} wins: ${first(bName)} didn't show`],
    ['double_ff', 'Neither showed'],
    ['black_ff', `${first(bName)} wins: ${first(wName)} didn't show`],
  ];
  const pickText = !pick ? '' : pick === 'draw' ? 'Draw' : pick === 'double_ff' ? 'Neither showed' : `${points(pick)[0] ? wName : bName} wins`;

  return (
    <Shell role="Scorer" who={profile.display_name ?? 'Scorer'} t={t} onSignOut={onSignOut}>
      <ErrorBar error={s.error} onClose={() => s.setError(null)} />
      {!s.loaded ? null : !t ? <Empty>No tournament is running.</Empty> : !open ? (
        <Empty>Round {t.current_round} pairings aren't posted yet. This screen updates by itself.</Empty>
      ) : !game ? (
        <div className="mx-auto w-full lg:w-4/5">
          <h1 className="mb-[1.5vh] text-center font-display text-[clamp(1.25rem,3.5vh,2.25rem)] font-bold text-gold">Score a board</h1>
          <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); if (lookup) findBoard(); }}>
            <input ref={boardInput} autoFocus inputMode="numeric" enterKeyHint="go" aria-label="Board number" value={lookup}
              onChange={(e) => { setLookup(e.target.value.replace(/\D/g, '')); setErr(''); }} placeholder="Board #"
              className={cx('h-[clamp(4rem,13vh,9rem)] w-full rounded-2xl border-2 bg-panel-2 px-4 text-center text-[clamp(2rem,8vh,5.5rem)] font-bold outline-none focus:border-gold',
                err ? 'border-bad' : 'border-line')} />
            <Btn tone="gold" className="h-[clamp(4rem,13vh,9rem)] px-[4vh] text-[clamp(1.25rem,3.5vh,2rem)]" disabled={!lookup}>Go</Btn>
          </form>
          <p className={cx('my-[1vh] min-h-[2.5vh] text-center text-[clamp(0.9rem,2.2vh,1.25rem)]', err ? 'font-semibold text-bad' : 'text-mute')}>
            {err || 'Type a board number and press Enter'}
          </p>
          <ScoreBoard games={games} />
          <details className="mt-[1.5vh] text-sm">
            <summary className="cursor-pointer text-mute">Or tap a board</summary>
            <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
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
        <div className="mx-auto w-full space-y-[1.5vh] lg:w-4/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={back} className="text-[clamp(0.85rem,2vh,1.1rem)] text-mute">← Board number (Esc)</button>
            <span className="font-display text-[clamp(1.1rem,3.2vh,2rem)] font-bold text-gold">Board {game.board}</span>
            {game.result ? <Badge tone="warn">Already scored: {RESULT_LABEL[game.result]}</Badge> : <span className="text-[clamp(0.85rem,2vh,1.1rem)] text-mute">Click the winner</span>}
          </div>

          <div className="grid grid-cols-2 items-stretch gap-[1.5vh] sm:grid-cols-[1fr_auto_1fr]">
            <WinnerCard color="White" name={wName} school={W?.school} on={pick === 'white'} dim={!!pick && pick !== 'white'} onClick={() => select('white')} />
            <button onClick={() => select('draw')}
              className={cx('order-last col-span-2 flex min-h-[clamp(3rem,8vh,5rem)] flex-col items-center justify-center rounded-2xl border-2 font-bold transition sm:order-none sm:col-span-1 sm:w-[clamp(5rem,14vw,11rem)]',
                pick === 'draw' ? 'border-gold bg-gold text-gold-ink' : 'border-line bg-panel-2 hover:border-mute')}>
              <span className="text-[clamp(1.25rem,4vh,2.5rem)]">Draw</span>
              <span className="text-[clamp(0.7rem,1.6vh,0.9rem)] font-normal opacity-70">½ – ½ · key D</span>
            </button>
            <WinnerCard color="Black" name={bName} school={B?.school} on={pick === 'black'} dim={!!pick && pick !== 'black'} onClick={() => select('black')} />
          </div>

          <div className="grid grid-cols-3 gap-[1vh]">
            {noShows.map(([r, label]) => (
              <button key={r} onClick={() => select(r)}
                className={cx('min-h-[clamp(2.75rem,7vh,4.5rem)] rounded-xl border px-2 text-[clamp(0.75rem,1.8vh,1rem)] font-semibold transition',
                  pick === r ? 'border-gold bg-gold text-gold-ink' : 'border-line bg-panel-2 hover:border-mute')}>
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-panel p-[1.5vh]">
            {overwrite && <p className="mb-2 text-center text-[clamp(0.9rem,2.2vh,1.2rem)] font-semibold text-warn">This replaces {RESULT_LABEL[game.result!]}. Press Enter again to confirm.</p>}
            <Btn tone="gold" className="h-[clamp(3.5rem,10vh,6.5rem)] w-full text-[clamp(1.1rem,3.4vh,2rem)]" disabled={!pick || busy === 'save'} onClick={save}>
              {busy === 'save' ? 'Saving…' : !pick ? 'Click the winner, or Draw' : `${overwrite ? 'Replace with' : 'Save'}: ${pickText} (Enter)`}
            </Btn>
          </div>

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

/** One player as a big button: click it if this kid won. */
function WinnerCard({ color, name, school, on, dim, onClick }: { color: 'White' | 'Black'; name: string; school?: string; on: boolean; dim: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cx('flex min-h-[clamp(10rem,30vh,22rem)] flex-col items-center justify-center rounded-2xl border-2 p-[2vh] text-center transition',
        on ? 'border-gold bg-gold text-gold-ink' : 'border-line bg-panel hover:border-gold', dim && 'opacity-50')}>
      <span className={cx('text-[clamp(0.75rem,1.8vh,1rem)] font-semibold uppercase tracking-wider', on ? '' : 'text-mute')}>{color === 'White' ? '♔ White' : '♚ Black'} · key {color[0]}</span>
      <span className="mt-[1vh] text-[clamp(1.25rem,4.2vh,3rem)] font-bold leading-tight">{name}</span>
      <span className={cx('text-[clamp(0.8rem,2vh,1.2rem)]', on ? '' : 'text-mute')}>{school}</span>
      <span className={cx('mt-[1.5vh] rounded-full px-4 py-1 text-[clamp(0.85rem,2.2vh,1.3rem)] font-bold', on ? 'bg-gold-ink/15' : 'invisible')}>Wins</span>
    </button>
  );
}

/** Live progress for the round: totals, per grade, and which boards are still out. */
function ScoreBoard({ games }: { games: DbGame[] }) {
  const left = games.filter((g) => !g.result);
  const grades = [...new Set(games.map((g) => g.grade))].sort((a, b) => a - b);
  return (
    <div className="space-y-[1.2vh]">
      <div className="grid grid-cols-3 gap-[1.2vh] text-center">
        {([['Boards', games.length, ''], ['Scored', games.length - left.length, 'text-good'], ['Left', left.length, left.length ? 'text-warn' : 'text-good']] as const).map(([label, n, tone]) => (
          <div key={label} className="rounded-2xl border border-line bg-panel p-[1.2vh]">
            <div className="text-[clamp(0.7rem,1.7vh,1rem)] font-semibold uppercase tracking-wider text-mute">{label}</div>
            <div className={cx('text-[clamp(1.5rem,5vh,3.25rem)] font-bold leading-tight', tone)}>{n}</div>
          </div>
        ))}
      </div>
      <div className="space-y-[1vh] rounded-2xl border border-line bg-panel p-[1.5vh]">
        {grades.map((gr) => {
          const all = games.filter((g) => g.grade === gr), out = all.filter((g) => !g.result);
          return (
            <div key={gr} className="flex items-center gap-3 text-[clamp(0.85rem,2.1vh,1.25rem)]">
              <span className="w-[4.5em] font-semibold">{ordinal(gr)}</span>
              <div className="h-[clamp(0.5rem,1.4vh,0.9rem)] flex-1 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-good" style={{ width: `${all.length ? ((all.length - out.length) / all.length) * 100 : 0}%` }} />
              </div>
              <span className={cx('w-[8.5em] text-right', out.length ? 'text-warn' : 'text-good')}>{out.length ? `${out.length} of ${all.length} left` : 'all done'}</span>
            </div>
          );
        })}
      </div>
      {left.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-mute">Unscored boards ({left.length})</summary>
          <div className="mt-2 space-y-1">
            {grades.map((gr) => {
              const out = left.filter((g) => g.grade === gr);
              return out.length ? <div key={gr}><span className="font-semibold">{ordinal(gr)}:</span> <span className="text-mute">{out.map((g) => g.board).join(', ')}</span></div> : null;
            })}
          </div>
        </details>
      )}
    </div>
  );
}
