-- Additive migration. Run once in the existing project's SQL Editor, before deploying v2.
-- Existing sessions and owner keys are never rewritten.
begin;
alter table public.sessions add column if not exists owner_id uuid references auth.users(id) on delete set null;
create index if not exists sessions_owner_id_idx on public.sessions(owner_id);
grant select, insert, update, delete on public.sessions to service_role;

create table if not exists public.ms_couples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  invite uuid unique default gen_random_uuid(),
  inviter uuid not null references auth.users(id) on delete cascade
);
create table if not exists public.ms_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  couple_id uuid not null references public.ms_couples(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists ms_members_couple_idx on public.ms_members(couple_id);
create table if not exists public.ms_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  couple_id uuid references public.ms_couples(id) on delete cascade,
  kind text not null check (kind in ('text','voice','video','photo')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body)<=10000),
  media_path text unique,
  created_at timestamptz not null default now(),
  check ((kind='text' and media_path is null) or (kind<>'text' and media_path is not null)),
  check (media_path is null or split_part(media_path,'/',1)=author_id::text)
);
create index if not exists ms_notes_author_idx on public.ms_notes(author_id);
create index if not exists ms_notes_couple_idx on public.ms_notes(couple_id);
create table if not exists public.ms_checkins (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  couple_id uuid not null references public.ms_couples(id) on delete cascade,
  day date not null default ((now() at time zone 'UTC')::date),
  primary key (user_id,couple_id,day)
);
create or replace function public.ms_my_couple() returns uuid language sql stable security definer set search_path='' as $$
 select couple_id from public.ms_members where user_id=auth.uid()
$$;
revoke all on function public.ms_my_couple() from public;
grant execute on function public.ms_my_couple() to authenticated;

alter table public.ms_couples enable row level security;
alter table public.ms_members enable row level security;
alter table public.ms_notes enable row level security;
alter table public.ms_checkins enable row level security;
revoke all on public.ms_couples,public.ms_members,public.ms_notes,public.ms_checkins from anon,authenticated;
grant select on public.ms_couples,public.ms_members,public.ms_checkins to authenticated;
grant select,insert,delete on public.ms_notes to authenticated;
grant update(title,body) on public.ms_notes to authenticated;

drop policy if exists ms_couple_read on public.ms_couples;
create policy ms_couple_read on public.ms_couples for select to authenticated using (id=public.ms_my_couple());
drop policy if exists ms_member_read on public.ms_members;
create policy ms_member_read on public.ms_members for select to authenticated using (couple_id=public.ms_my_couple());
drop policy if exists ms_note_read on public.ms_notes;
create policy ms_note_read on public.ms_notes for select to authenticated using (author_id=auth.uid() or (couple_id is not null and couple_id=public.ms_my_couple()));
drop policy if exists ms_note_insert on public.ms_notes;
create policy ms_note_insert on public.ms_notes for insert to authenticated with check (author_id=auth.uid() and (couple_id is null or couple_id=public.ms_my_couple()));
drop policy if exists ms_note_update on public.ms_notes;
create policy ms_note_update on public.ms_notes for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
drop policy if exists ms_note_delete on public.ms_notes;
create policy ms_note_delete on public.ms_notes for delete to authenticated using (author_id=auth.uid());
drop policy if exists ms_checkin_read on public.ms_checkins;
create policy ms_checkin_read on public.ms_checkins for select to authenticated using (couple_id=public.ms_my_couple());

-- RPCs enforce one membership per account and a maximum of two members.
create or replace function public.ms_create_couple() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c uuid;
begin
 if u is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select couple_id into c from public.ms_members where user_id=u;
 if c is not null then return c; end if;
 insert into public.ms_couples(inviter) values(u) returning id into c;
 insert into public.ms_members(user_id,couple_id) values(u,c);
 return c;
end $$;
create or replace function public.ms_join_couple(code uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c uuid;
begin
 if u is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if exists(select 1 from public.ms_members where user_id=u) then raise exception 'Already connected'; end if;
 select id into c from public.ms_couples where invite=code for update;
 if c is null then raise exception 'Invalid or already used invitation'; end if;
 if (select count(*) from public.ms_members where couple_id=c)<>1 then raise exception 'Space unavailable'; end if;
 insert into public.ms_members(user_id,couple_id) values(u,c);
 update public.ms_couples set invite=null where id=c;
 return c;
end $$;
create or replace function public.ms_check_in() returns void language plpgsql security definer set search_path='' as $$
declare c uuid:=public.ms_my_couple();
begin
 if c is null then raise exception 'Connect your private space first'; end if;
 insert into public.ms_checkins(user_id,couple_id) values(auth.uid(),c) on conflict do nothing;
end $$;
-- Compute on the server without truncating old history. A streak requires both members.
create or replace function public.ms_streak() returns jsonb language sql stable security definer set search_path='' as $$
 with paired as (select day from public.ms_checkins where couple_id=public.ms_my_couple() group by day having count(distinct user_id)=2),
 runs as (select day,day-(row_number() over(order by day))::int as grp from paired),
 spans as (select max(day) as last_day,count(*) as n from runs group by grp),
 today as (select (now() at time zone 'UTC')::date as d)
 select jsonb_build_object('current',coalesce((select n from spans,today where last_day in (d,d-1) order by last_day desc limit 1),0),'best',coalesce((select max(n) from spans),0),'today',coalesce((select count(*) from public.ms_checkins,today where couple_id=public.ms_my_couple() and day=d),0),'checked',exists(select 1 from public.ms_checkins,today where couple_id=public.ms_my_couple() and user_id=auth.uid() and day=d))
$$;
revoke all on function public.ms_create_couple(),public.ms_join_couple(uuid),public.ms_check_in(),public.ms_streak() from public;
grant execute on function public.ms_create_couple(),public.ms_join_couple(uuid),public.ms_check_in(),public.ms_streak() to authenticated;

-- Private files; direct uploads do not pass through Vercel's request size limit.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mindsync-memories','mindsync-memories',false,20971520,array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/aac','audio/3gpp','video/webm','video/mp4','video/quicktime','video/3gpp','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists ms_media_insert on storage.objects;
create policy ms_media_insert on storage.objects for insert to authenticated with check (bucket_id='mindsync-memories' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists ms_media_read on storage.objects;
create policy ms_media_read on storage.objects for select to authenticated using (bucket_id='mindsync-memories' and ((storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.ms_notes n where n.media_path=name and n.couple_id=public.ms_my_couple())));
drop policy if exists ms_media_delete on storage.objects;
create policy ms_media_delete on storage.objects for delete to authenticated using (bucket_id='mindsync-memories' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
