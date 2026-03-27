create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists password_reset_tokens_user_id_idx
  on public.password_reset_tokens(user_id);

create index if not exists password_reset_tokens_email_idx
  on public.password_reset_tokens(lower(email));

create index if not exists password_reset_tokens_expires_at_idx
  on public.password_reset_tokens(expires_at);

alter table public.password_reset_tokens disable row level security;
