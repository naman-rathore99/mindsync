-- MindSync v2.1: text-note edit/delete window. Run AFTER v2 migration.
-- No rows removed or existing session IDs changed. Old text notes are locked
-- according to their existing created_at timestamp.
begin;

alter table public.ms_notes add column if not exists edited_at timestamptz;

-- Assign the send time on the database, not on a device. Restrict client
-- insert privileges to the fields the app actually needs.
revoke insert on public.ms_notes from authenticated;
grant insert (author_id, couple_id, kind, title, body, media_path)
  on public.ms_notes to authenticated;

create or replace function public.ms_note_timestamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Check again at the actual write (including after a row-lock wait).
  -- Administrator/account-deletion operations are not restricted by this app rule.
  if TG_OP in ('UPDATE', 'DELETE') then
    if current_user = 'authenticated' and old.kind = 'text'
      and clock_timestamp() >= old.created_at + interval '2 minutes' then
      raise exception 'The two-minute message window has ended' using errcode = '42501';
    end if;
    if TG_OP = 'DELETE' then return old; end if;
  end if;
  if TG_OP = 'INSERT' then
    new.created_at := clock_timestamp();
    new.edited_at := null;
  elsif new.title is distinct from old.title or new.body is distinct from old.body then
    new.edited_at := clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists ms_note_timestamps on public.ms_notes;
create trigger ms_note_timestamps before insert or update or delete on public.ms_notes
for each row execute function public.ms_note_timestamps();

-- Text is mutable only for its author, strictly before the 120s deadline.
-- Media is immediately saved and retains the previous owner-only controls.
-- Reading rules and storage policies are unchanged.
drop policy if exists ms_note_update on public.ms_notes;
create policy ms_note_update on public.ms_notes for update to authenticated
using (author_id = auth.uid() and
  (kind <> 'text' or clock_timestamp() < created_at + interval '2 minutes'))
with check (author_id = auth.uid() and
  (kind <> 'text' or clock_timestamp() < created_at + interval '2 minutes'));

drop policy if exists ms_note_delete on public.ms_notes;
create policy ms_note_delete on public.ms_notes for delete to authenticated
using (author_id = auth.uid() and
  (kind <> 'text' or clock_timestamp() < created_at + interval '2 minutes'));

-- A simple server clock for the visual countdown. RLS remains authoritative.
create or replace function public.ms_note_clock() returns timestamptz
language sql volatile set search_path = '' as $$ select clock_timestamp() $$;
revoke all on function public.ms_note_clock() from public;
grant execute on function public.ms_note_clock() to authenticated;
commit;
