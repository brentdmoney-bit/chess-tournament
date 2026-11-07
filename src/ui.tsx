import { useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import type { Role, Tournament } from './lib/supabase.ts';

export const ROLE_META: Record<Role, { label: string; color: string; icon: string }> = {
  TD: { label: 'Tournament Director', color: 'text-gold', icon: '♚' },
  Admin: { label: 'Tournament Admin', color: 'text-admin', icon: '♜' },
  Coach: { label: 'Coach', color: 'text-info', icon: '♞' },
  Scorer: { label: 'Scorer', color: 'text-good', icon: '♝' },
  SA: { label: 'Student Activities', color: 'text-sa', icon: '♛' },
};

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function useTheme() {
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')] as const;
}

export function Shell({ role, who, t, tabs, tab, setTab, onSignOut, children }: {
  role: Role; who: string; t: Tournament | null;
  tabs?: { id: string; label: string; badge?: number }[]; tab?: string; setTab?: (id: string) => void;
  onSignOut: () => void; children: ReactNode;
}) {
  const [theme, toggle] = useTheme();
  const meta = ROLE_META[role];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="text-2xl text-gold">♚</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm font-bold tracking-wide sm:text-base">{t?.name ?? 'Chess Tournament'}</div>
            <div className="truncate text-xs text-mute">
              <span className={meta.color}>{meta.icon} {meta.label}</span> · {who}
            </div>
          </div>
          {t && (
            <div className="hidden rounded-full border border-line px-3 py-1 text-xs sm:block">
              Round <b>{t.current_round}</b> of {t.total_rounds} · <PhaseLabel t={t} />
            </div>
          )}
          <button onClick={toggle} className="rounded-lg p-2 text-mute hover:bg-panel-2" aria-label="Toggle light or dark mode">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button onClick={onSignOut} className="rounded-lg px-2 py-2 text-sm text-mute hover:bg-panel-2">Sign out</button>
        </div>
        {tabs && (
          <nav className="scroll-x mx-auto flex max-w-6xl gap-1 px-3 pb-2">
            {tabs.map((x) => (
              <button key={x.id} onClick={() => setTab?.(x.id)}
                className={cx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
                  tab === x.id ? 'bg-gold text-gold-ink' : 'text-mute hover:bg-panel-2 hover:text-ink')}>
                {x.label}
                {!!x.badge && <span className={cx('rounded-full px-1.5 text-xs font-bold', tab === x.id ? 'bg-gold-ink/20' : 'bg-bad text-white')}>{x.badge}</span>}
              </button>
            ))}
          </nav>
        )}
      </header>
      {t && <div className="border-b border-line px-4 py-1.5 text-center text-xs text-mute sm:hidden">Round <b className="text-ink">{t.current_round}</b> of {t.total_rounds} · <PhaseLabel t={t} /></div>}
      <main className="mx-auto max-w-6xl px-4 py-5 pb-24">{children}</main>
    </div>
  );
}

export const PHASE_LABEL = { setup: 'Check-in', draft: 'Pairing (draft)', published: 'Playing', locked: 'Playing · locked', complete: 'Round complete' } as const;
export function PhaseLabel({ t }: { t: Tournament }) {
  if (t.ended) return <span className="text-gold">Final</span>;
  const c = t.round_phase === 'published' || t.round_phase === 'locked' ? 'text-good' : t.round_phase === 'complete' ? 'text-info' : 'text-warn';
  return <span className={c}>{PHASE_LABEL[t.round_phase]}</span>;
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-panel p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h3 className="text-xs font-semibold uppercase tracking-wider text-mute">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function H1({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-bold sm:text-2xl">{children}</h2>
        {sub && <p className="mt-1 text-sm text-mute">{sub}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

type Tone = 'gold' | 'ghost' | 'good' | 'bad' | 'info' | 'warn';
const TONE: Record<Tone, string> = {
  gold: 'bg-gold text-gold-ink hover:brightness-110',
  ghost: 'border border-line bg-panel-2 hover:border-mute',
  good: 'bg-good/15 text-good border border-good/40 hover:bg-good/25',
  bad: 'bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25',
  info: 'bg-info/15 text-info border border-info/40 hover:bg-info/25',
  warn: 'bg-warn/15 text-warn border border-warn/40 hover:bg-warn/25',
};
export function Btn({ tone = 'ghost', big, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; big?: boolean }) {
  return <button {...p} className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-40', big && 'min-h-14 px-6 text-base', TONE[tone], className)} />;
}

/** Runs an async action with a busy flag and routes errors to the toast. */
export function useAction(toast: (m: string, bad?: boolean) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  };
  return { busy, run };
}

export function Badge({ tone = 'ghost', children }: { tone?: Tone; children: ReactNode }) {
  const t = { gold: 'bg-gold/15 text-gold', ghost: 'bg-panel-2 text-mute', good: 'bg-good/15 text-good', bad: 'bg-bad/15 text-bad', info: 'bg-info/15 text-info', warn: 'bg-warn/15 text-warn' }[tone];
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', t)}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-mute">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-mute">{label}</span>
      <input {...p} className={cx('min-h-11 w-full rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold', p.className)} />
      {hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const el = <select {...p} className={cx('min-h-11 w-full rounded-xl border border-line bg-panel-2 px-3 outline-none focus:border-gold', p.className)}>{children}</select>;
  return label ? <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-mute">{label}</span>{el}</label> : el;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-mute">{children}</div>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-max text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wider text-mute">{head.map((h, i) => <th key={i} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) =>
  <td colSpan={colSpan} className={cx('px-3 py-2.5', className)}>{children}</td>;

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; id: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const h = setTimeout(() => setMsg(null), msg.bad ? 6000 : 3000);
    return () => clearTimeout(h);
  }, [msg]);
  const toast = (text: string, bad?: boolean) => setMsg({ text, bad, id: Date.now() });
  const node = msg && (
    <div role="status" className={cx('fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl',
      msg.bad ? 'border-bad/50 bg-panel text-bad' : 'border-good/50 bg-panel text-good')}>{msg.text}</div>
  );
  return { toast, node };
}

export function ErrorBar({ error, onClose }: { error: string | null; onClose: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
      <span className="flex-1">{error}</span><button onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  );
}
