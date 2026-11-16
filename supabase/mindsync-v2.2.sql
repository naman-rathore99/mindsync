-- Additive account aliases for MindSync 2.2. Run after v2 and v2.1.
-- Never rewrites an existing auth user ID or any note, streak, session or storage path.
begin;
create table if not exists public.ms_usernames (
  username text primary key check (username ~ '^[a-z0-9_]{3,24}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  recovery_hash text not null check (recovery_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.ms_usernames enable row level security;
revoke all on public.ms_usernames from public, anon, authenticated;
grant select, insert, update, delete on public.ms_usernames to service_role;
commit;
