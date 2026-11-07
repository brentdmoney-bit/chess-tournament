-- Registration sheet sync. Sheet links are shared "anyone with the link", so the links
-- themselves are secrets: they move out of `tournaments` (every role reads it) into
-- `tournament_secrets` (TD only). Only the per-school counts are visible to everyone.

alter table tournament_secrets
  add column roster_sheet_url text,
  add column reg_sheet jsonb; -- {url, map: {school, count?}, fix: {sheet name: roster school}}

update tournament_secrets s
   set roster_sheet_url = t.sheet_url,
       reg_sheet = case when t.reg_doc_url is not null then jsonb_build_object('url', t.reg_doc_url) end
  from tournaments t
 where t.id = s.tournament_id;

alter table tournaments
  drop column sheet_url,
  drop column reg_doc_url,
  add column reg_counts jsonb,        -- {roster school: registered count}, written by the TD's sync
  add column reg_synced_at timestamptz;

-- Attendance header link for staff who can't read tournament_secrets.
create function reg_sheet_url() returns text
language sql stable security definer set search_path = public as $$
  select reg_sheet ->> 'url' from tournament_secrets
   where tournament_id = active_tournament() and has_role('{TD,Admin,SA}')
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
