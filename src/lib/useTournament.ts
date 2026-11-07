import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, rpc, type Tournament, type Coach, type DbPlayer, type DbGame, type HelpRequest, type Message, type Notice, type AccessRequest, type Role } from './supabase.ts';

const PLAYER_COLS = 'id,tournament_id,first_name,last_name,grade,school,coach_name,status,is_sub,created_at,shirt_size';
type Table = 'tournaments' | 'players' | 'coaches' | 'games' | 'help_requests' | 'messages' | 'notices' | 'access_requests';

/**
 * Everything one screen needs about the active tournament, kept live with Supabase Realtime.
 * Any change on a table refetches that table: the data is a few hundred rows, so simple wins.
 */
export function useTournament(role: Role) {
  const [t, setT] = useState<Tournament | null>(null);
  const [players, setPlayers] = useState<DbPlayer[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [games, setGames] = useState<DbGame[]>([]);
  const [help, setHelp] = useState<HelpRequest[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = role === 'TD' || role === 'Admin' || role === 'SA';

  const load = useCallback(async (table: Table, tid: string) => {
    const q = (name: string) => supabase.from(name).select('*').eq('tournament_id', tid);
    const run = async () => {
      switch (table) {
        case 'tournaments': {
          const { data, error } = await supabase.from('tournaments').select('*').eq('id', tid).single();
          if (error) throw error; setT(data); return;
        }
        case 'players': {
          // student_id isn't readable from the table (FERPA); the TD and a student's own coach get it from student_ids().
          const { data, error } = await supabase.from('players').select(PLAYER_COLS).eq('tournament_id', tid).order('last_name');
          if (error) throw error;
          if (role === 'TD' || role === 'Coach') {
            const ids = new Map((await rpc<{ id: string; student_id: string }[]>('student_ids')).map((x) => [x.id, x.student_id]));
            setPlayers(data.map((p) => ({ ...p, student_id: ids.get(p.id) ?? null })) as DbPlayer[]);
          } else setPlayers(data as DbPlayer[]);
          return;
        }
        case 'coaches': { const { data, error } = await q('coaches').order('school'); if (error) throw error; setCoaches(data); return; }
        case 'games': { const { data, error } = await q('games').order('round').order('board'); if (error) throw error; setGames(data); return; }
        case 'help_requests': {
          if (role === 'Coach') return;
          const { data, error } = await q('help_requests').order('created_at', { ascending: false }); if (error) throw error; setHelp(data); return;
        }
        case 'messages': {
          if (!staff) return;
          const { data, error } = await q('messages').order('created_at').limit(500); if (error) throw error; setMessages(data); return;
        }
        case 'notices': {
          if (role === 'Scorer') return;
          const { data, error } = await q('notices').order('created_at', { ascending: false }); if (error) throw error; setNotices(data); return;
        }
        case 'access_requests': {
          if (role !== 'TD') return;
          const { data, error } = await supabase.from('access_requests').select('*').order('created_at', { ascending: false }); if (error) throw error; setRequests(data); return;
        }
      }
    };
    try { await run(); } catch (e) { setError(`Couldn't load ${table}: ${(e as Error).message}`); }
  }, [role, staff]);

  useEffect(() => {
    let tid: string | null = null;
    const tables: Table[] = ['tournaments', 'players', 'coaches', 'games', 'help_requests', 'messages', 'notices', 'access_requests'];
    const channel = supabase.channel('tournament-live');
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { if (tid) void load(table, tid); });
    }
    (async () => {
      const { data, error } = await supabase.from('tournaments').select('id').eq('is_active', true).maybeSingle();
      if (error) { setError(error.message); setLoaded(true); return; }
      if (!data) { setLoaded(true); return; }
      tid = data.id;
      await Promise.all(tables.map((x) => load(x, data.id)));
      setLoaded(true);
      channel.subscribe((status) => {
        // Refetch everything after a reconnect so a phone that slept catches up.
        if (status === 'SUBSCRIBED' && tid) tables.forEach((x) => void load(x, tid!));
      });
    })();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const roundGames = useMemo(() => (t ? games.filter((g) => g.round === t.current_round) : []), [games, t]);
  const schools = useMemo(() => [...new Set(players.map((p) => p.school))].sort(), [players]);

  return { t, players, coaches, games, help, messages, notices, requests, loaded, error, setError, byId, roundGames, schools };
}

export type TournamentState = ReturnType<typeof useTournament>;
