import { useState, type ReactNode } from 'react';
import { RESULT_LABEL, fullName, points, type Result } from '../lib/chess.ts';
import { supabase, rpc, type DbGame, type Profile } from '../lib/supabase.ts';
import { useTournament } from '../lib/useTournament.ts';
import { Badge, Btn, Card, Empty, ErrorBar, H1, Shell, cx, useAction, useToast } from '../ui.tsx';

/** Phone-first scoring station: tap a board, tap the result, confirm, optional scorecard photo. */
export default function Scorer({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const s = useTournament('Scorer');
  const { toast, node } = useToast();
  const { busy, run } = useAction(toast);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [pick, setPick] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const [lookup, setLookup] = useState('');
  const [note, setNote] = useState('');

  const t = s.t;
  const open = t && (t.round_phase === 'published' || t.round_phase === 'locked');
  const games = s.roundGames.filter((g) => g.black_id);
  const game = games.find((g) => g.id === boardId) ?? null;
  const done = games.filter((g) => g.result).length;

  const reset = () => { setBoardId(null); setPick(null); setSaved(false); setNote(''); setLookup(''); };
  const choose = (g: DbGame) => { setBoardId(g.id); setPick(g.result); setSaved(false); };

  const findBoard = () => {
    const g = games.find((x) => x.board === parseInt(lookup, 10));
    if (g) choose(g); else toast(`No board ${lookup} this round.`, true);
  };

  const save = () => game && pick && run('save', async () => {
    await rpc('record_result', { p_game: game.id, p_result: pick });
    setSaved(true);
  }, `Board ${game.board} saved`);

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
        <>
          <H1 sub={`${done} of ${games.length} boards scored`}>Pick a board</H1>
          <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); findBoard(); }}>
            <input inputMode="numeric" value={lookup} onChange={(e) => setLookup(e.target.value.replace(/\D/g, ''))} placeholder="Board #"
              className="min-h-14 w-full rounded-xl border border-line bg-panel-2 px-4 text-center text-2xl font-bold outline-none focus:border-gold" />
            <Btn tone="gold" big disabled={!lookup}>Go</Btn>
          </form>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {games.map((g) => (
              <button key={g.id} onClick={() => choose(g)}
                className={cx('aspect-square rounded-xl border text-lg font-bold', g.result ? 'border-good/40 bg-good/10 text-good' : 'border-line bg-panel hover:border-gold')}>
                {g.board}{g.result && <div className="text-xs">✓</div>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="mx-auto max-w-lg space-y-4">
          <button onClick={reset} className="text-sm text-mute">← All boards</button>
          <div className="text-center">
            <Badge tone="gold">Board {game.board} · Round {game.round}</Badge>
            {game.result && !saved && <div className="mt-2"><Badge tone="warn">Already scored: {RESULT_LABEL[game.result]}. Saving changes it.</Badge></div>}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <Side color="White" name={W ? fullName(W) : '?'} school={W?.school} />
            <span className="text-mute">vs</span>
            <Side color="Black" name={B ? fullName(B) : '?'} school={B?.school} />
          </div>

          {!saved ? (
            <>
              <Card title="Who won?">
                <div className="grid grid-cols-3 gap-2">
                  {(['white', 'draw', 'black'] as Result[]).map((r) => (
                    <ResultBtn key={r} on={pick === r} onClick={() => setPick(r)}>{r === 'draw' ? 'Draw' : r === 'white' ? 'White' : 'Black'}</ResultBtn>
                  ))}
                </div>
                <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-mute">Someone didn't show</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(['white_ff', 'double_ff', 'black_ff'] as Result[]).map((r) => (
                    <ResultBtn key={r} small on={pick === r} onClick={() => setPick(r)}>
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
                  <Btn tone="gold" big className="w-full" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : `Save: ${RESULT_LABEL[pick]}`}</Btn>
                </Card>
              )}
              <Card title="Players disagree?">
                <div className="flex gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold" />
                  <Btn tone="warn" disabled={busy === 'help'} onClick={help}>Call a director</Btn>
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <div className="text-center">
                <div className="text-5xl text-good">✓</div>
                <div className="mt-1 font-semibold">{RESULT_LABEL[pick!]}</div>
              </div>
              <label className={cx('mt-4 flex min-h-14 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed text-sm font-semibold',
                game.photo_path ? 'border-good text-good' : 'border-line text-mute')}>
                {busy === 'photo' ? 'Uploading…' : game.photo_path ? '✓ Scorecard photo saved · retake' : '📷 Photo of the scorecard (optional)'}
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Btn onClick={() => setSaved(false)}>Change result</Btn>
                <Btn tone="gold" onClick={reset}>Next board →</Btn>
              </div>
            </Card>
          )}
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
