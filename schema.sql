create table if not exists public.sessions (
 id uuid primary key default gen_random_uuid(), owner_key uuid not null default gen_random_uuid(),
 payload jsonb not null, response jsonb, created_at timestamptz default now()
);
alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;
