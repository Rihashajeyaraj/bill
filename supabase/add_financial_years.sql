create extension if not exists btree_gist;

create table if not exists public.financial_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  year_code text not null,
  label text not null,
  is_current boolean not null default false,
  auto_created boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_years_exact_year_chk
    check (end_date = ((start_date + interval '1 year')::date - 1)),
  unique (organization_id, start_date),
  unique (organization_id, year_code)
);

create index if not exists idx_financial_years_org_start
  on public.financial_years(organization_id, start_date desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'financial_years_no_overlap'
  ) then
    alter table public.financial_years
      add constraint financial_years_no_overlap
      exclude using gist (
        organization_id with =,
        daterange(start_date, end_date + 1, '[)') with &&
      );
  end if;
end $$;

drop trigger if exists trg_financial_years_updated_at on public.financial_years;
create trigger trg_financial_years_updated_at
before update on public.financial_years
for each row execute procedure public.set_updated_at();

alter table public.financial_years enable row level security;

drop policy if exists "financial_years_member_access" on public.financial_years;
create policy "financial_years_member_access"
on public.financial_years
for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

grant select, insert, update, delete on public.financial_years to authenticated;

create or replace function public.financial_year_for_date(
  p_organization_id uuid,
  p_entry_date date
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_financial_year_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if p_entry_date is null then
    raise exception 'entry date is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  select fy.id
    into v_financial_year_id
  from public.financial_years fy
  where fy.organization_id = p_organization_id
    and p_entry_date between fy.start_date and fy.end_date
  order by fy.start_date desc
  limit 1;

  if v_financial_year_id is null then
    raise exception 'No financial year found for % on %', p_organization_id, p_entry_date;
  end if;

  return v_financial_year_id;
end;
$$;

grant execute on function public.financial_year_for_date(uuid, date) to authenticated;

create or replace function public.assign_transaction_financial_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_date_column text := tg_argv[0];
  v_entry_date date;
begin
  if new.organization_id is null then
    raise exception 'organization_id is required';
  end if;

  execute format('select ($1).%I::date', v_date_column)
    into v_entry_date
    using new;

  if v_entry_date is null then
    raise exception '% is required', v_date_column;
  end if;

  select fy.id
    into new.financial_year_id
  from public.financial_years fy
  where fy.organization_id = new.organization_id
    and v_entry_date between fy.start_date and fy.end_date
  order by fy.start_date desc
  limit 1;

  if new.financial_year_id is null then
    raise exception 'No financial year found for organization % on %', new.organization_id, v_entry_date;
  end if;

  return new;
end;
$$;

alter table public.invoices
  add column if not exists financial_year_id uuid references public.financial_years(id) on delete restrict;
create index if not exists idx_invoices_financial_year_id
  on public.invoices(financial_year_id);

alter table public.purchase_bills
  add column if not exists financial_year_id uuid references public.financial_years(id) on delete restrict;
create index if not exists idx_purchase_bills_financial_year_id
  on public.purchase_bills(financial_year_id);

alter table public.payments
  add column if not exists financial_year_id uuid references public.financial_years(id) on delete restrict;
create index if not exists idx_payments_financial_year_id
  on public.payments(financial_year_id);

alter table public.expenses
  add column if not exists financial_year_id uuid references public.financial_years(id) on delete restrict;
create index if not exists idx_expenses_financial_year_id
  on public.expenses(financial_year_id);

alter table public.credit_notes
  add column if not exists financial_year_id uuid references public.financial_years(id) on delete restrict;
create index if not exists idx_credit_notes_financial_year_id
  on public.credit_notes(financial_year_id);

alter table public.debit_notes
  add column if not exists financial_year_id uuid references public.financial_years(id) on delete restrict;
create index if not exists idx_debit_notes_financial_year_id
  on public.debit_notes(financial_year_id);

drop trigger if exists trg_invoices_assign_financial_year on public.invoices;
create trigger trg_invoices_assign_financial_year
before insert or update of organization_id, invoice_date
on public.invoices
for each row execute procedure public.assign_transaction_financial_year('invoice_date');

drop trigger if exists trg_purchase_bills_assign_financial_year on public.purchase_bills;
create trigger trg_purchase_bills_assign_financial_year
before insert or update of organization_id, bill_date
on public.purchase_bills
for each row execute procedure public.assign_transaction_financial_year('bill_date');

drop trigger if exists trg_payments_assign_financial_year on public.payments;
create trigger trg_payments_assign_financial_year
before insert or update of organization_id, payment_date
on public.payments
for each row execute procedure public.assign_transaction_financial_year('payment_date');

drop trigger if exists trg_expenses_assign_financial_year on public.expenses;
create trigger trg_expenses_assign_financial_year
before insert or update of organization_id, expense_date
on public.expenses
for each row execute procedure public.assign_transaction_financial_year('expense_date');

drop trigger if exists trg_credit_notes_assign_financial_year on public.credit_notes;
create trigger trg_credit_notes_assign_financial_year
before insert or update of organization_id, credit_note_date
on public.credit_notes
for each row execute procedure public.assign_transaction_financial_year('credit_note_date');

drop trigger if exists trg_debit_notes_assign_financial_year on public.debit_notes;
create trigger trg_debit_notes_assign_financial_year
before insert or update of organization_id, debit_note_date
on public.debit_notes
for each row execute procedure public.assign_transaction_financial_year('debit_note_date');
