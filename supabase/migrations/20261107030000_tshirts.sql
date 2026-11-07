-- T-shirt orders: coaches pick a size for each student on their roster and for
-- themselves; Student Activities sees the totals. The TD opens and closes ordering.

alter table players add column shirt_size text;
alter table coaches add column shirt_size text;
alter table tournaments add column shirts_open boolean not null default true;

alter table players add constraint players_shirt_size check (shirt_size in ('YS', 'YM', 'YL', 'S', 'M', 'L', 'XL', '2XL', '3XL'));
alter table coaches add constraint coaches_shirt_size check (shirt_size in ('YS', 'YM', 'YL', 'S', 'M', 'L', 'XL', '2XL', '3XL'));

-- players uses column privileges (student_id hidden); new columns need an explicit grant.
grant select (shirt_size) on players to authenticated;

-- Coach sets a size for one of their own students (TD: anyone). p_size null clears it.
create function set_shirt(p_player uuid, p_size text) returns void
language plpgsql security definer set search_path = public as $$
declare v_p players; v_t tournaments;
begin
  select * into v_p from players where id = p_player;
  if not found then raise exception 'Player not found.'; end if;
  select * into v_t from tournaments where id = v_p.tournament_id;
  if not has_role('{TD}') then
    if not has_role('{Coach}') or v_p.school is distinct from my_school() then raise exception 'Not your student.'; end if;
    if not v_t.shirts_open then raise exception 'T-shirt orders are closed. Ask the Tournament Director.'; end if;
  end if;
  update players set shirt_size = p_size where id = p_player;
end $$;

-- Coach sets their own size.
create function set_my_shirt(p_size text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('{Coach}') then raise exception 'Only coaches order here.'; end if;
  if not (select shirts_open from tournaments where id = active_tournament()) then
    raise exception 'T-shirt orders are closed. Ask the Tournament Director.';
  end if;
  update coaches set shirt_size = p_size
   where tournament_id = active_tournament() and email = lower(auth.jwt() ->> 'email');
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
