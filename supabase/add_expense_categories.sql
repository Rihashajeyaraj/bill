-- Add expense_categories table for searchable/create-on-type expense categories.
-- Run this script in Supabase SQL editor.

begin;

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expense_categories_org_id on public.expense_categories(organization_id);
create unique index if not exists idx_expense_categories_org_name_unique
  on public.expense_categories(organization_id, normalized_name);

drop trigger if exists trg_expense_categories_updated_at on public.expense_categories;
create trigger trg_expense_categories_updated_at
before update on public.expense_categories
for each row execute procedure public.set_updated_at();

alter table public.expense_categories enable row level security;

drop policy if exists "expense_categories_member_access" on public.expense_categories;
create policy "expense_categories_member_access"
on public.expense_categories
for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

grant select, insert, update, delete on public.expense_categories to authenticated;

commit;

notify pgrst, 'reload schema';
