create or replace function public.organization_financial_year_anchor_date(
  p_organization_id uuid
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_start_month smallint;
  v_anchor_text text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  select
    o.settings,
    o.financial_year_start_month
    into v_settings, v_start_month
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'Organization % not found', p_organization_id;
  end if;

  v_anchor_text := coalesce(
    v_settings ->> 'financialYearDate',
    v_settings ->> 'financial_year_date',
    v_settings ->> 'financialYearStartDate',
    v_settings ->> 'financial_year_start'
  );

  if v_anchor_text ~ '^\d{4}-\d{2}-\d{2}$' then
    return v_anchor_text::date;
  end if;

  return make_date(2000, greatest(1, least(12, coalesce(v_start_month, 4))), 1);
end;
$$;

grant execute on function public.organization_financial_year_anchor_date(uuid) to authenticated;

create or replace function public.financial_year_start_for_date(
  p_anchor_date date,
  p_entry_date date
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_anchor_month integer;
  v_anchor_day integer;
  v_candidate_year integer;
  v_last_day integer;
  v_candidate date;
begin
  if p_anchor_date is null then
    raise exception 'anchor date is required';
  end if;

  if p_entry_date is null then
    raise exception 'entry date is required';
  end if;

  v_anchor_month := extract(month from p_anchor_date);
  v_anchor_day := extract(day from p_anchor_date);
  v_candidate_year := extract(year from p_entry_date);
  v_last_day := extract(day from (date_trunc('month', make_date(v_candidate_year, v_anchor_month, 1)) + interval '1 month - 1 day')::date);
  v_candidate := make_date(v_candidate_year, v_anchor_month, least(v_anchor_day, v_last_day));

  if p_entry_date < v_candidate then
    v_candidate_year := v_candidate_year - 1;
    v_last_day := extract(day from (date_trunc('month', make_date(v_candidate_year, v_anchor_month, 1)) + interval '1 month - 1 day')::date);
    v_candidate := make_date(v_candidate_year, v_anchor_month, least(v_anchor_day, v_last_day));
  end if;

  return v_candidate;
end;
$$;

grant execute on function public.financial_year_start_for_date(date, date) to authenticated;

create or replace function public.ensure_financial_year_for_date(
  p_organization_id uuid,
  p_entry_date date,
  p_auto_created boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor_date date;
  v_start_date date;
  v_end_date date;
  v_year_code text;
  v_label text;
  v_financial_year_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if p_entry_date is null then
    raise exception 'entry date is required';
  end if;

  select fy.id
    into v_financial_year_id
  from public.financial_years fy
  where fy.organization_id = p_organization_id
    and p_entry_date between fy.start_date and fy.end_date
  order by fy.start_date desc
  limit 1;

  if v_financial_year_id is not null then
    return v_financial_year_id;
  end if;

  v_anchor_date := public.organization_financial_year_anchor_date(p_organization_id);
  v_start_date := public.financial_year_start_for_date(v_anchor_date, p_entry_date);
  v_end_date := ((v_start_date + interval '1 year')::date - 1);
  v_year_code := to_char(v_start_date, 'YYYY') || to_char(v_end_date, 'YYYY');
  v_label := to_char(v_start_date, 'YYYY') || '-' || to_char(v_end_date, 'YYYY');

  insert into public.financial_years (
    organization_id,
    start_date,
    end_date,
    year_code,
    label,
    is_current,
    auto_created,
    created_by
  )
  values (
    p_organization_id,
    v_start_date,
    v_end_date,
    v_year_code,
    v_label,
    current_date between v_start_date and v_end_date,
    coalesce(p_auto_created, true),
    auth.uid()
  )
  on conflict (organization_id, year_code)
  do update
    set start_date = excluded.start_date,
        end_date = excluded.end_date,
        year_code = excluded.year_code,
        label = excluded.label,
        is_current = case
          when current_date between excluded.start_date and excluded.end_date then true
          else public.financial_years.is_current
        end,
        auto_created = public.financial_years.auto_created or excluded.auto_created,
        updated_at = now()
  returning id into v_financial_year_id;

  if current_date between v_start_date and v_end_date then
    update public.financial_years
    set is_current = (id = v_financial_year_id),
        updated_at = now()
    where organization_id = p_organization_id;
  end if;

  return v_financial_year_id;
end;
$$;

grant execute on function public.ensure_financial_year_for_date(uuid, date, boolean) to authenticated;

create or replace function public.financial_year_for_date(
  p_organization_id uuid,
  p_entry_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  return public.ensure_financial_year_for_date(p_organization_id, p_entry_date, true);
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

  new.financial_year_id := public.ensure_financial_year_for_date(new.organization_id, v_entry_date, true);
  return new;
end;
$$;

do $$
declare
  v_row record;
begin
  for v_row in
    select distinct organization_id, entry_date
    from (
      select organization_id, invoice_date as entry_date from public.invoices
      union
      select organization_id, bill_date as entry_date from public.purchase_bills
      union
      select organization_id, payment_date as entry_date from public.payments
      union
      select organization_id, expense_date as entry_date from public.expenses
      union
      select organization_id, credit_note_date as entry_date from public.credit_notes
      union
      select organization_id, debit_note_date as entry_date from public.debit_notes
    ) as source_dates
    where organization_id is not null
      and entry_date is not null
  loop
    perform public.ensure_financial_year_for_date(v_row.organization_id, v_row.entry_date, true);
  end loop;
end;
$$;

update public.invoices
set financial_year_id = public.ensure_financial_year_for_date(organization_id, invoice_date, true)
where organization_id is not null
  and invoice_date is not null;

update public.purchase_bills
set financial_year_id = public.ensure_financial_year_for_date(organization_id, bill_date, true)
where organization_id is not null
  and bill_date is not null;

update public.payments
set financial_year_id = public.ensure_financial_year_for_date(organization_id, payment_date, true)
where organization_id is not null
  and payment_date is not null;

update public.expenses
set financial_year_id = public.ensure_financial_year_for_date(organization_id, expense_date, true)
where organization_id is not null
  and expense_date is not null;

update public.credit_notes
set financial_year_id = public.ensure_financial_year_for_date(organization_id, credit_note_date, true)
where organization_id is not null
  and credit_note_date is not null;

update public.debit_notes
set financial_year_id = public.ensure_financial_year_for_date(organization_id, debit_note_date, true)
where organization_id is not null
  and debit_note_date is not null;
