-- Company settings persistence table for settings module.
-- Run this script in Supabase SQL Editor.

begin;

create table if not exists public.company_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_company_settings_updated_at on public.company_settings;
create trigger trg_company_settings_updated_at
before update on public.company_settings
for each row execute procedure public.set_updated_at();

alter table public.company_settings enable row level security;

drop policy if exists "company_settings_member_access" on public.company_settings;
create policy "company_settings_member_access"
on public.company_settings
for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

grant select, insert, update, delete on public.company_settings to authenticated;

commit;

notify pgrst, 'reload schema';
