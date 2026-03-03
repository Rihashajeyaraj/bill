-- Add item categories and link items.category_id -> categories.id
-- Safe to run multiple times.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_categories_org_id on public.categories(organization_id);
create index if not exists idx_categories_name on public.categories(name);
create unique index if not exists idx_categories_org_name_unique
  on public.categories(organization_id, lower(trim(name)));

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
before update on public.categories
for each row execute procedure public.set_updated_at();

alter table public.categories enable row level security;
drop policy if exists "categories_member_access" on public.categories;
create policy "categories_member_access"
on public.categories for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

do $$
declare
  v_category_id_type text;
  v_items_category_type text;
  v_non_null_count bigint := 0;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_category_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'categories'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_category_id_type is null then
    raise exception 'categories.id column not found';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
      and column_name = 'category_id'
  ) then
    execute format('alter table public.items add column category_id %s', v_category_id_type);
  else
    select format_type(a.atttypid, a.atttypmod)
      into v_items_category_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'items'
      and a.attname = 'category_id'
      and a.attnum > 0
      and not a.attisdropped;

    if v_items_category_type is distinct from v_category_id_type then
      select count(*)
        into v_non_null_count
      from public.items
      where category_id is not null;

      if v_non_null_count = 0 then
        execute format(
          'alter table public.items alter column category_id type %s using null',
          v_category_id_type
        );
      else
        raise notice
          'items.category_id type (%) does not match categories.id type (%) and contains data. Skipping type change.',
          v_items_category_type, v_category_id_type;
      end if;
    end if;
  end if;

  alter table public.items drop constraint if exists items_category_id_fkey;
  alter table public.items
    add constraint items_category_id_fkey
    foreign key (category_id)
    references public.categories(id)
    on delete set null;
end;
$$;

create index if not exists idx_items_category_id on public.items(category_id);

-- Refresh PostgREST schema cache so the new column is recognized immediately.
select pg_notify('pgrst', 'reload schema');
select pg_notify('pgrst', 'reload config');
