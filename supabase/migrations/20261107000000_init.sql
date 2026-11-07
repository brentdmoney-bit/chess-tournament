-- Chess Tournament Manager: initial schema.
-- One row in `tournaments` is the active event; every other table hangs off it.
-- All writes that need business rules (cutoff, locking, school scoping) go through
-- security-definer RPCs; plain table writes are limited to TD/Admin by RLS.

create extension if not exists pgcrypto;

-- ── Types ──────────────────────────────────────────────────────────────
create type app_role as enum ('TD', 'Admin', 'Coach', 'Scorer', 'SA');
-- white/black = that side won; *_ff = that side won by forfeit; double_ff = both absent; bye = unpaired, 1 pt
create type game_result as enum ('white', 'black', 'draw', 'white_ff', 'black_ff', 'double_ff', 'bye');
create type player_status as enum ('registered', 'present', 'absent', 'withdrawn');
create type round_phase as enum ('setup', 'draft', 'published', 'locked', 'complete');

-- ── Tables ─────────────────────────────────────────────────────────────
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  location text,
  total_rounds int not null default 5 check (total_rounds between 1 and 12),
  current_round int not null default 1 check (current_round >= 1),
  round_phase round_phase not null default 'setup',
  checkin_cutoff timestamptz,
  active_grades int[] not null default '{9,10,11,12}',
  award_tiers jsonb not null default '[{"name":"Gold","min":4,"max":5},{"name":"Silver","min":2,"max":3.5},{"name":"Bronze","min":1,"max":1.5}]',
  team_top_n int not null default 4,
  reg_doc_url text,
  sheet_url text,
  ended boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_active_tournament on tournaments (is_active) where is_active;

-- TD-only secrets (scorer join code). Kept apart so every signed-in user can read `tournaments`.
create table tournament_secrets (
  tournament_id uuid primary key references tournaments on delete cascade,
  scorer_code text not null
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text,
  role app_role,
  school text,
  created_at timestamptz not null default now()
);

-- Pre-authorised staff: whoever signs in with this email gets this role.
create table staff_invites (
  email text primary key check (email = lower(email)),
  role app_role not null check (role in ('TD', 'Admin', 'SA')),
  created_at timestamptz not null default now()
);

create table coaches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  name text not null,
  email text check (email = lower(email)),
  phone text,
  school text not null,
  checked_in_at timestamptz,
  registered_count int check (registered_count >= 0),
  approved boolean not null default true, -- false = walk-in waiting on the TD
  created_at timestamptz not null default now(),
  unique (tournament_id, email)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  student_id text,
  first_name text not null,
  last_name text not null,
  grade int not null check (grade between 1 and 12),
  school text not null,
  coach_name text,
  status player_status not null default 'registered',
  is_sub boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tournament_id, student_id)
);
create index on players (tournament_id, school);

create table games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  round int not null,
  board int not null,
  grade int not null,
  white_id uuid not null references players on delete restrict,
  black_id uuid references players on delete restrict, -- null = bye; withdraw players instead of deleting them
  result game_result,
  photo_path text,
  scored_by uuid references auth.users,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tournament_id, round, board),
  check ((black_id is null) = (result is not distinct from 'bye')),
  check (white_id is distinct from black_id)
);
create index on games (tournament_id, round);

-- Every result or pairing change, for the audit trail the old app only claimed to have.
create table game_log (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);

create table help_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  round int not null,
  board int not null,
  note text,
  requested_by uuid references auth.users,
  requested_name text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  user_id uuid not null references auth.users default auth.uid(),
  sender_name text not null,
  role app_role not null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table notices (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  school text not null,
  body text not null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create table access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  email text,
  name text not null,
  phone text,
  requested_role text not null check (requested_role in ('Coach', 'Sub Coach', 'Admin', 'SA')),
  school text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by uuid references auth.users,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_pending_request on access_requests (user_id) where status = 'pending';

create table scorer_sessions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments on delete cascade,
  user_id uuid references auth.users on delete set null,
  real_name text not null,
  started_at timestamptz not null default now()
);

-- ── Helpers ────────────────────────────────────────────────────────────
create function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create function my_school() returns text
language sql stable security definer set search_path = public as $$
  select school from profiles where id = auth.uid()
$$;

create function active_tournament() returns uuid
language sql stable security definer set search_path = public as $$
  select id from tournaments where is_active
$$;

create function has_role(roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = any(roles), false)
$$;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table tournaments enable row level security;
alter table tournament_secrets enable row level security;
alter table profiles enable row level security;
alter table staff_invites enable row level security;
alter table coaches enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table game_log enable row level security;
alter table help_requests enable row level security;
alter table messages enable row level security;
alter table notices enable row level security;
alter table access_requests enable row level security;
alter table scorer_sessions enable row level security;

-- tournaments: anyone with a role reads; TD writes.
create policy t_read on tournaments for select using (my_role() is not null);
create policy t_write on tournaments for all using (has_role('{TD}')) with check (has_role('{TD}'));

create policy ts_td on tournament_secrets for all using (has_role('{TD}')) with check (has_role('{TD}'));

create policy p_self on profiles for select using (id = auth.uid() or has_role('{TD,Admin,SA}'));
create policy p_td on profiles for update using (has_role('{TD}')) with check (has_role('{TD}'));

create policy si_td on staff_invites for all using (has_role('{TD}')) with check (has_role('{TD}'));

-- coaches: staff see all; a coach sees their own school's coaches (no other schools' phones).
create policy c_read on coaches for select
  using (has_role('{TD,Admin,SA}') or (has_role('{Coach}') and school = my_school()));
create policy c_td on coaches for all using (has_role('{TD}')) with check (has_role('{TD}'));

-- players: everyone with a role reads (rosters and pairings are public at the venue).
create policy pl_read on players for select using (my_role() is not null);
create policy pl_td on players for all using (has_role('{TD}')) with check (has_role('{TD}'));

create policy g_read on games for select using (my_role() is not null);
create policy g_run on games for all using (has_role('{TD,Admin}')) with check (has_role('{TD,Admin}'));

create policy gl_read on game_log for select using (has_role('{TD,Admin}'));

create policy hr_read on help_requests for select using (has_role('{TD,Admin,SA,Scorer}'));
create policy hr_run on help_requests for update using (has_role('{TD,Admin}')) with check (has_role('{TD,Admin}'));

create policy m_read on messages for select using (has_role('{TD,Admin,SA}'));
create policy m_send on messages for insert
  with check (has_role('{TD,Admin,SA}') and user_id = auth.uid() and role = my_role());

create policy n_read on notices for select
  using (has_role('{TD,Admin,SA}') or (has_role('{Coach}') and school = my_school()));
create policy n_td on notices for all using (has_role('{TD}')) with check (has_role('{TD}'));

create policy ar_own on access_requests for select using (user_id = auth.uid() or has_role('{TD}'));
create policy ar_insert on access_requests for insert with check (user_id = auth.uid() and status = 'pending');

create policy ss_read on scorer_sessions for select using (has_role('{TD,Admin}'));

-- ── Audit trigger on games ─────────────────────────────────────────────
create function log_game_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into game_log (game_id, changed_by, old_row, new_row)
  values (coalesce(new.id, old.id), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger games_audit after update or delete on games
  for each row execute function log_game_change();

-- ── RPCs ───────────────────────────────────────────────────────────────

-- Called by the client after every sign-in. Creates the profile row and grants a role
-- when the email is a pre-authorised staff member or a coach on the active tournament.
create function ensure_profile() returns profiles
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(auth.jwt() ->> 'email'), '');
  v_prof profiles;
  v_invite staff_invites;
  v_coach coaches;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into profiles (id, email, display_name)
  values (auth.uid(), v_email, coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(v_email, '@', 1)))
  on conflict (id) do nothing;
  select * into v_prof from profiles where id = auth.uid();
  if v_prof.role is null and v_email is not null then
    select * into v_invite from staff_invites where email = v_email;
    if found then
      update profiles set role = v_invite.role where id = auth.uid() returning * into v_prof;
    else
      select * into v_coach from coaches
        where email = v_email and tournament_id = active_tournament() and approved;
      if found then
        update profiles set role = 'Coach', school = v_coach.school, display_name = v_coach.name
          where id = auth.uid() returning * into v_prof;
      end if;
    end if;
  end if;
  return v_prof;
end $$;

-- Scorers join anonymously with the station code the TD reads out.
create function claim_scorer(p_code text, p_name text) returns profiles
language plpgsql security definer set search_path = public as $$
declare v_prof profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(trim(p_name)) < 3 or position(' ' in trim(p_name)) = 0 then
    raise exception 'Enter your first and last name.';
  end if;
  if not exists (select 1 from tournament_secrets
                 where tournament_id = active_tournament() and upper(scorer_code) = upper(trim(p_code))) then
    raise exception 'That station code is not right. Check it with the Tournament Director.';
  end if;
  insert into profiles (id, display_name, role) values (auth.uid(), trim(p_name), 'Scorer')
  on conflict (id) do update set display_name = excluded.display_name, role = 'Scorer'
    where profiles.role is null or profiles.role = 'Scorer'
  returning * into v_prof;
  if v_prof.id is null then raise exception 'This account already has a different role.'; end if;
  insert into scorer_sessions (tournament_id, user_id, real_name)
  values (active_tournament(), auth.uid(), trim(p_name));
  return v_prof;
end $$;

-- Scorer / TD / Admin records a result. Scorers only for the live round; TD/Admin may correct any round.
create function record_result(p_game uuid, p_result game_result, p_photo text default null) returns games
language plpgsql security definer set search_path = public as $$
declare v_game games; v_t tournaments;
begin
  if not has_role('{TD,Admin,Scorer}') then raise exception 'Not allowed.'; end if;
  select * into v_game from games where id = p_game for update;
  if not found then raise exception 'Game not found.'; end if;
  select * into v_t from tournaments where id = v_game.tournament_id;
  if v_game.black_id is null then raise exception 'A bye has no result to enter.'; end if;
  if p_result = 'bye' then raise exception 'Invalid result.'; end if;
  if has_role('{Scorer}') and (v_game.round <> v_t.current_round or v_t.round_phase not in ('published', 'locked')) then
    raise exception 'Scoring is closed for this round.';
  end if;
  update games set result = p_result,
                   photo_path = coalesce(p_photo, photo_path),
                   scored_by = auth.uid(), scored_at = now()
   where id = p_game returning * into v_game;
  return v_game;
end $$;

create function attach_scorecard(p_game uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{TD,Admin,Scorer}') then raise exception 'Not allowed.'; end if;
  update games set photo_path = p_path where id = p_game;
end $$;

create function request_help(p_board int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_t tournaments;
begin
  if not has_role('{TD,Admin,Scorer}') then raise exception 'Not allowed.'; end if;
  select * into v_t from tournaments where is_active;
  insert into help_requests (tournament_id, round, board, note, requested_by, requested_name)
  select v_t.id, v_t.current_round, p_board, nullif(trim(p_note), ''), auth.uid(), display_name
    from profiles where id = auth.uid();
end $$;

-- Coach marks one of their own students present/absent before the cutoff; withdraw any time.
create function coach_set_status(p_player uuid, p_status player_status) returns void
language plpgsql security definer set search_path = public as $$
declare v_t tournaments; v_p players;
begin
  select * into v_p from players where id = p_player;
  if not found then raise exception 'Player not found.'; end if;
  select * into v_t from tournaments where id = v_p.tournament_id;
  if has_role('{TD}') then
    update players set status = p_status where id = p_player; return;
  end if;
  if not has_role('{Coach}') or v_p.school is distinct from my_school() then raise exception 'Not your student.'; end if;
  if p_status not in ('present', 'absent', 'withdrawn') then raise exception 'Invalid status.'; end if;
  if p_status <> 'withdrawn' and (v_t.round_phase <> 'setup' or v_t.current_round > 1
       or (v_t.checkin_cutoff is not null and now() > v_t.checkin_cutoff)) then
    raise exception 'Check-in is closed. Ask the Tournament Director.';
  end if;
  update players set status = p_status where id = p_player;
end $$;

-- Coach adds a substitute before the cutoff (round 1 only).
create function coach_add_sub(p_first text, p_last text, p_grade int, p_student_id text default null) returns players
language plpgsql security definer set search_path = public as $$
declare v_t tournaments; v_p players;
begin
  if not has_role('{Coach}') then raise exception 'Only coaches can add substitutes.'; end if;
  select * into v_t from tournaments where is_active;
  if v_t.round_phase <> 'setup' or v_t.current_round > 1
     or (v_t.checkin_cutoff is not null and now() > v_t.checkin_cutoff) then
    raise exception 'Substitutions are closed.';
  end if;
  if length(trim(p_first)) = 0 or length(trim(p_last)) = 0 then raise exception 'Enter the full name.'; end if;
  insert into players (tournament_id, student_id, first_name, last_name, grade, school, coach_name, status, is_sub)
  select v_t.id, nullif(trim(p_student_id), ''), trim(p_first), trim(p_last), p_grade, my_school(),
         display_name, 'present', true
    from profiles where id = auth.uid()
  returning * into v_p;
  return v_p;
end $$;

create function coach_check_in() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{Coach}') then raise exception 'Not a coach.'; end if;
  update coaches set checked_in_at = coalesce(checked_in_at, now())
   where tournament_id = active_tournament() and email = lower(auth.jwt() ->> 'email');
end $$;

create function dismiss_notice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update notices set dismissed_at = now()
   where id = p_id and (has_role('{TD}') or school = my_school());
end $$;

-- TD approves or denies an access request. Approving a coach also adds them to the coach list.
create function decide_access(p_id uuid, p_approve boolean, p_role app_role default null, p_school text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_r access_requests; v_role app_role;
begin
  if not has_role('{TD}') then raise exception 'Only the Tournament Director can approve access.'; end if;
  select * into v_r from access_requests where id = p_id and status = 'pending' for update;
  if not found then raise exception 'Request already handled.'; end if;
  update access_requests set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.uid(), decided_at = now() where id = p_id;
  if not p_approve then return; end if;
  v_role := coalesce(p_role, case when v_r.requested_role in ('Coach', 'Sub Coach') then 'Coach'::app_role
                                  else v_r.requested_role::app_role end);
  update profiles set role = v_role, school = coalesce(p_school, v_r.school), display_name = v_r.name
   where id = v_r.user_id;
  if v_role = 'Coach' then
    insert into coaches (tournament_id, name, email, phone, school, checked_in_at)
    values (active_tournament(), v_r.name, lower(v_r.email), v_r.phone, coalesce(p_school, v_r.school), now())
    on conflict (tournament_id, email) do update set approved = true;
  end if;
end $$;

-- Replace a round's pairings in one transaction (TD/Admin). p_games: [{board, grade, white_id, black_id|null}]
create function save_pairings(p_round int, p_games jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_t tournaments;
begin
  if not has_role('{TD,Admin}') then raise exception 'Not allowed.'; end if;
  select * into v_t from tournaments where is_active for update;
  if p_round <> v_t.current_round then raise exception 'Only the current round can be paired.'; end if;
  if v_t.round_phase in ('locked', 'complete') then raise exception 'Round is locked. Unlock it first.'; end if;
  if exists (select 1 from games where tournament_id = v_t.id and round = p_round
               and result is not null and result <> 'bye') then
    raise exception 'Results are already in for this round; edit single boards instead.';
  end if;
  delete from games where tournament_id = v_t.id and round = p_round;
  insert into games (tournament_id, round, board, grade, white_id, black_id, result)
  select v_t.id, p_round, (g ->> 'board')::int, (g ->> 'grade')::int,
         (g ->> 'white_id')::uuid, nullif(g ->> 'black_id', '')::uuid,
         case when nullif(g ->> 'black_id', '') is null then 'bye'::game_result end
    from jsonb_array_elements(p_games) g;
  if exists (select p from (select white_id p from games where tournament_id = v_t.id and round = p_round
                            union all
                            select black_id from games where tournament_id = v_t.id and round = p_round and black_id is not null) x
             group by p having count(*) > 1) then
    raise exception 'A player is on two boards.';
  end if;
  update tournaments set round_phase = 'draft' where id = v_t.id;
end $$;

-- Change who plays on a board (pairing editor). Blocked once the round is locked or scored.
create function edit_board(p_game uuid, p_white uuid, p_black uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g games; v_t tournaments;
begin
  if not has_role('{TD,Admin}') then raise exception 'Not allowed.'; end if;
  select * into v_g from games where id = p_game for update;
  if not found then raise exception 'Board not found.'; end if;
  select * into v_t from tournaments where id = v_g.tournament_id;
  if v_t.round_phase in ('locked', 'complete') then raise exception 'Round is locked.'; end if;
  if v_g.result is not null and v_g.result <> 'bye' then raise exception 'This board already has a result.'; end if;
  if p_white is null or p_white = p_black then raise exception 'Pick two different players.'; end if;
  if exists (select 1 from games where tournament_id = v_g.tournament_id and round = v_g.round and id <> p_game
               and (white_id in (p_white, p_black) or black_id in (p_white, p_black))) then
    raise exception 'That player is already on another board this round.';
  end if;
  update games set white_id = p_white, black_id = p_black,
                   result = case when p_black is null then 'bye'::game_result end
   where id = p_game;
end $$;

create function set_round_phase(p_phase round_phase) returns void
language plpgsql security definer set search_path = public as $$
declare v_t tournaments;
begin
  if not has_role('{TD}') then raise exception 'Only the Tournament Director can do that.'; end if;
  select * into v_t from tournaments where is_active for update;
  if p_phase in ('published', 'locked') and not exists
       (select 1 from games where tournament_id = v_t.id and round = v_t.current_round) then
    raise exception 'Pair the round first.';
  end if;
  if p_phase = 'complete' and exists
       (select 1 from games where tournament_id = v_t.id and round = v_t.current_round and result is null) then
    raise exception 'Some boards still have no result.';
  end if;
  update tournaments set round_phase = p_phase where id = v_t.id;
end $$;

create function advance_round() returns void
language plpgsql security definer set search_path = public as $$
declare v_t tournaments;
begin
  if not has_role('{TD}') then raise exception 'Only the Tournament Director can do that.'; end if;
  select * into v_t from tournaments where is_active for update;
  if not exists (select 1 from games where tournament_id = v_t.id and round = v_t.current_round) then
    raise exception 'This round was never paired.';
  end if;
  if exists (select 1 from games where tournament_id = v_t.id and round = v_t.current_round and result is null) then
    raise exception 'Some boards still have no result.';
  end if;
  if v_t.current_round >= v_t.total_rounds then raise exception 'That was the last round. End the tournament instead.'; end if;
  update tournaments set current_round = current_round + 1, round_phase = 'setup' where id = v_t.id;
  update help_requests set resolved_at = now(), resolved_by = auth.uid()
   where tournament_id = v_t.id and resolved_at is null;
end $$;

-- ── Storage: private scorecard photos ──────────────────────────────────
insert into storage.buckets (id, name, public) values ('scorecards', 'scorecards', false)
on conflict (id) do nothing;
create policy sc_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'scorecards' and public.has_role('{TD,Admin,Scorer}'));
create policy sc_read on storage.objects for select to authenticated
  using (bucket_id = 'scorecards' and public.my_role() is not null);

-- ── Realtime ───────────────────────────────────────────────────────────
alter publication supabase_realtime add table tournaments, players, coaches, games, help_requests, messages, notices, access_requests;

-- ── Lock down function execution ───────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
