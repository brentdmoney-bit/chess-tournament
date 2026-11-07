-- Security pass (FERPA): roles only for verified emails, student IDs hidden from
-- everyone but the TD and the student's own coach, tighter scorecard uploads.

-- ── 1. Grant a role only when the email address has been verified ────────
-- Without this, anyone could sign up as a roster coach's (or invited staff member's)
-- email and inherit their access.
create or replace function ensure_profile() returns profiles
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(auth.jwt() ->> 'email'), '');
  v_verified boolean;
  v_prof profiles;
  v_invite staff_invites;
  v_coach coaches;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select email_confirmed_at is not null into v_verified from auth.users where id = auth.uid();
  insert into profiles (id, email, display_name)
  values (auth.uid(), v_email, coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', split_part(v_email, '@', 1)))
  on conflict (id) do nothing;
  select * into v_prof from profiles where id = auth.uid();
  if v_prof.role is null and v_email is not null and v_verified then
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

-- ── 2. Student ID numbers: TD and the student's own coach only ───────────
-- Column privileges hide student_id from table reads and from Realtime payloads.
revoke select on players from anon, authenticated;
grant select (id, tournament_id, first_name, last_name, grade, school, coach_name, status, is_sub, created_at)
  on players to authenticated;

create function student_ids() returns table (id uuid, student_id text)
language sql stable security definer set search_path = public as $$
  select p.id, p.student_id from players p
   where p.tournament_id = active_tournament() and p.student_id is not null
     and (has_role('{TD}') or (has_role('{Coach}') and p.school = my_school()))
$$;

-- Roster import (TD). Upserts on student ID so a re-import never duplicates or wipes check-in status.
-- p_rows: [{student_id|null, first_name, last_name, grade, school, coach_name|null}]
create function import_players(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not has_role('{TD}') then raise exception 'Only the Tournament Director can import the roster.'; end if;
  insert into players (tournament_id, student_id, first_name, last_name, grade, school, coach_name)
  select active_tournament(), nullif(trim(r ->> 'student_id'), ''), trim(r ->> 'first_name'), trim(r ->> 'last_name'),
         (r ->> 'grade')::int, trim(r ->> 'school'), nullif(trim(r ->> 'coach_name'), '')
    from jsonb_array_elements(p_rows) r
  on conflict (tournament_id, student_id) do update
    set first_name = excluded.first_name, last_name = excluded.last_name, grade = excluded.grade,
        school = excluded.school, coach_name = excluded.coach_name;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 3. Scorecard photos: images only, 10 MB, current round only for scorers ─
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = '{image/*}' where id = 'scorecards';

create or replace function attach_scorecard(p_game uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{TD,Admin,Scorer}') then raise exception 'Not allowed.'; end if;
  if has_role('{Scorer}') and not exists (
       select 1 from games g join tournaments t on t.id = g.tournament_id
        where g.id = p_game and g.round = t.current_round and t.round_phase in ('published', 'locked')) then
    raise exception 'Scoring is closed for this round.';
  end if;
  update games set photo_path = p_path where id = p_game;
end $$;

-- New functions default to PUBLIC execute; keep everything signed-in only.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
