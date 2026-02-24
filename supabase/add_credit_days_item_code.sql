-- Adds party credit mode/days and item item_code support for existing projects.

alter table if exists public.parties
  add column if not exists credit_limit_type text not null default 'amount';

alter table if exists public.parties
  add column if not exists credit_limit_days integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'parties_credit_limit_type_check'
  ) then
    alter table public.parties
      add constraint parties_credit_limit_type_check
      check (credit_limit_type in ('amount', 'days'));
  end if;
end;
$$;

alter table if exists public.parties
  drop constraint if exists parties_credit_limit_days_check;

alter table if exists public.parties
  add constraint parties_credit_limit_days_check
  check (credit_limit_days is null or credit_limit_days >= 0);

alter table if exists public.items
  add column if not exists item_code text;

create index if not exists idx_items_item_code on public.items(item_code);

create unique index if not exists idx_items_org_item_code_unique
  on public.items(organization_id, item_code)
  where item_code is not null;

alter table if exists public.purchase_bill_items
  add column if not exists item_code text;
