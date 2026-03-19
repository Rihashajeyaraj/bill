-- Fix duplicate key error on financial_years when saving settings.
-- Error:
-- financial_years_organization_id_year_code_key
--
-- Run this file in Supabase SQL Editor.

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

  return v_financial_year_id;
end;
$$;
