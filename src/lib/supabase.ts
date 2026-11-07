import { createClient } from '@supabase/supabase-js';
import type { Game, Player, AwardTier } from './chess.ts';

const env = import.meta.env;
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const configured = Boolean(url && key);
export const supabase = createClient(url || 'http://localhost', key || 'missing');

export type Role = 'TD' | 'Admin' | 'Coach' | 'Scorer' | 'SA';
export type Phase = 'setup' | 'draft' | 'published' | 'locked' | 'complete';

export interface Profile { id: string; email: string | null; display_name: string | null; role: Role | null; school: string | null }
export interface Tournament {
  id: string; name: string; event_date: string | null; location: string | null;
  total_rounds: number; current_round: number; round_phase: Phase;
  checkin_cutoff: string | null; active_grades: number[]; award_tiers: AwardTier[];
  team_top_n: number; ended: boolean;
  reg_counts: Record<string, number> | null; reg_synced_at: string | null; // from the registration sheet sync
  shirts_open: boolean;
}
export interface Coach {
  id: string; name: string; email: string | null; phone: string | null; school: string;
  checked_in_at: string | null; registered_count: number | null; approved: boolean; shirt_size: string | null;
}
export interface DbPlayer extends Player { tournament_id: string; shirt_size: string | null }

/** T-shirt sizes, smallest first. Codes match the database check constraint. */
export const SHIRT_SIZES: [code: string, label: string][] = [
  ['YS', 'Youth S'], ['YM', 'Youth M'], ['YL', 'Youth L'], ['S', 'Adult S'], ['M', 'Adult M'],
  ['L', 'Adult L'], ['XL', 'Adult XL'], ['2XL', 'Adult 2XL'], ['3XL', 'Adult 3XL'],
];
export interface DbGame extends Game { id: string; scored_at: string | null; scored_by: string | null }
export interface HelpRequest { id: string; round: number; board: number; note: string | null; requested_name: string | null; resolved_at: string | null; created_at: string }
export interface Message { id: string; user_id: string; sender_name: string; role: Role; body: string; created_at: string }
export interface Notice { id: string; school: string; body: string; dismissed_at: string | null; created_at: string }
export interface AccessRequest {
  id: string; user_id: string; email: string | null; name: string; phone: string | null;
  requested_role: string; school: string | null; note: string | null; status: string; created_at: string;
}

/** Throws the Postgres error message (our RPCs raise human-readable ones). */
export async function rpc<T = void>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
