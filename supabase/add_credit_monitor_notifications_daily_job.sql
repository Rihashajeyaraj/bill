-- Backend daily credit-monitor refresh.
-- Creates/updates/resolves credit_monitor_notifications without UI polling.

create or replace function public.credit_monitor_alert_states(
  p_organization_id uuid,
  p_as_of_date date default current_date
)
returns table (
  organization_id uuid,
  party_id uuid,
  party_type public.party_type,
  alert_type text,
  limit_value numeric(14,2),
  current_value numeric(14,2),
  exceeded boolean
)
language sql
stable
set search_path = public
as $$
  with invoice_paid as (
    select
      p.invoice_id,
      sum(coalesce(p.amount, 0))::numeric as paid_amount
    from public.payments p
    where p.organization_id = p_organization_id
      and p.direction = 'in'
      and p.status = 'posted'
      and p.invoice_id is not null
    group by p.invoice_id
  ),
  invoice_credits as (
    select
      cn.related_invoice_id as invoice_id,
      sum(coalesce(cn.grand_total, 0))::numeric as credit_amount
    from public.credit_notes cn
    where cn.organization_id = p_organization_id
      and cn.status = 'applied'
      and cn.related_invoice_id is not null
    group by cn.related_invoice_id
  ),
  invoice_open as (
    select
      i.party_id,
      greatest(
        0::numeric,
        coalesce(i.grand_total, 0)
          - coalesce(ip.paid_amount, 0)
          - coalesce(ic.credit_amount, 0)
      ) as outstanding_amount,
      case
        when i.due_date is not null and i.due_date < p_as_of_date
          then (p_as_of_date - i.due_date)
        else 0
      end as overdue_days
    from public.invoices i
    left join invoice_paid ip on ip.invoice_id = i.id
    left join invoice_credits ic on ic.invoice_id = i.id
    where i.organization_id = p_organization_id
      and i.party_id is not null
      and i.status not in ('draft', 'cancelled', 'paid')
  ),
  bill_paid as (
    select
      p.bill_id,
      sum(coalesce(p.amount, 0))::numeric as paid_amount
    from public.payments p
    where p.organization_id = p_organization_id
      and p.direction = 'out'
      and p.status = 'posted'
      and p.bill_id is not null
    group by p.bill_id
  ),
  bill_debits as (
    select
      dn.related_bill_id as bill_id,
      sum(coalesce(dn.grand_total, 0))::numeric as debit_amount
    from public.debit_notes dn
    where dn.organization_id = p_organization_id
      and dn.status = 'applied'
      and dn.related_bill_id is not null
    group by dn.related_bill_id
  ),
  bill_open as (
    select
      b.supplier_id as party_id,
      greatest(
        0::numeric,
        coalesce(b.grand_total, 0)
          - coalesce(bp.paid_amount, 0)
          - coalesce(bd.debit_amount, 0)
      ) as outstanding_amount,
      case
        when b.due_date is not null and b.due_date < p_as_of_date
          then (p_as_of_date - b.due_date)
        else 0
      end as overdue_days
    from public.purchase_bills b
    left join bill_paid bp on bp.bill_id = b.id
    left join bill_debits bd on bd.bill_id = b.id
    where b.organization_id = p_organization_id
      and b.supplier_id is not null
      and b.status not in ('draft', 'cancelled', 'paid')
  ),
  customer_totals as (
    select
      o.party_id,
      sum(o.outstanding_amount)::numeric as outstanding_amount,
      max(o.overdue_days)::integer as max_overdue_days
    from invoice_open o
    where o.outstanding_amount > 0
    group by o.party_id
  ),
  supplier_totals as (
    select
      o.party_id,
      sum(o.outstanding_amount)::numeric as outstanding_amount,
      max(o.overdue_days)::integer as max_overdue_days
    from bill_open o
    where o.outstanding_amount > 0
    group by o.party_id
  ),
  party_metrics as (
    select
      p.organization_id,
      p.id as party_id,
      p.party_type,
      lower(coalesce(p.credit_limit_type, 'amount')) as credit_limit_type,
      greatest(0::numeric, coalesce(p.credit_limit, 0))::numeric(14,2) as amount_limit_value,
      greatest(0, coalesce(p.credit_limit_days, 0))::numeric(14,2) as days_limit_value,
      case
        when p.party_type = 'supplier'
          then greatest(0::numeric, coalesce(p.opening_balance, 0) + coalesce(st.outstanding_amount, 0))
        else
          greatest(0::numeric, coalesce(p.opening_balance, 0) + coalesce(ct.outstanding_amount, 0))
      end::numeric(14,2) as amount_current_value,
      case
        when p.party_type = 'supplier' then greatest(0, coalesce(st.max_overdue_days, 0))
        else greatest(0, coalesce(ct.max_overdue_days, 0))
      end::numeric(14,2) as days_current_value
    from public.parties p
    left join customer_totals ct on ct.party_id = p.id
    left join supplier_totals st on st.party_id = p.id
    where p.organization_id = p_organization_id
      and p.is_active = true
  )
  select
    pm.organization_id,
    pm.party_id,
    pm.party_type,
    case when pm.credit_limit_type = 'days' then 'days' else 'amount' end as alert_type,
    case when pm.credit_limit_type = 'days' then pm.days_limit_value else pm.amount_limit_value end as limit_value,
    case when pm.credit_limit_type = 'days' then pm.days_current_value else pm.amount_current_value end as current_value,
    case
      when pm.credit_limit_type = 'days'
        then pm.days_limit_value > 0 and pm.days_current_value > pm.days_limit_value
      else
        pm.amount_limit_value > 0 and pm.amount_current_value > pm.amount_limit_value
    end as exceeded
  from party_metrics pm
  where
    (pm.credit_limit_type = 'days' and pm.days_limit_value > 0)
    or (pm.credit_limit_type <> 'days' and pm.amount_limit_value > 0);
$$;

create or replace function public.refresh_credit_monitor_notifications_for_org(
  p_organization_id uuid,
  p_as_of_date date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.credit_monitor_notifications (
    organization_id,
    party_id,
    party_type,
    alert_type,
    limit_value,
    current_value,
    is_read,
    is_active
  )
  select
    s.organization_id,
    s.party_id,
    s.party_type,
    s.alert_type,
    s.limit_value,
    s.current_value,
    false,
    true
  from public.credit_monitor_alert_states(p_organization_id, p_as_of_date) s
  where s.exceeded = true
  on conflict (organization_id, party_id, alert_type) where is_active = true
  do update
    set
      party_type = excluded.party_type,
      limit_value = excluded.limit_value,
      current_value = excluded.current_value,
      is_active = true;

  update public.credit_monitor_notifications n
  set
    is_active = false,
    is_read = true
  from public.credit_monitor_alert_states(p_organization_id, p_as_of_date) s
  where n.organization_id = s.organization_id
    and n.party_id = s.party_id
    and n.alert_type = s.alert_type
    and n.is_active = true
    and s.exceeded = false;

  -- Resolve stale active rows for parties that are no longer monitored.
  update public.credit_monitor_notifications n
  set
    is_active = false,
    is_read = true
  where n.organization_id = p_organization_id
    and n.is_active = true
    and not exists (
      select 1
      from public.credit_monitor_alert_states(p_organization_id, p_as_of_date) s
      where s.party_id = n.party_id
        and s.alert_type = n.alert_type
    );
end;
$$;

create or replace function public.refresh_credit_monitor_notifications_for_all_orgs(
  p_as_of_date date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  for v_org_id in
    select o.id
    from public.organizations o
  loop
    perform public.refresh_credit_monitor_notifications_for_org(v_org_id, p_as_of_date);
  end loop;
end;
$$;

grant execute on function public.credit_monitor_alert_states(uuid, date) to authenticated;
grant execute on function public.refresh_credit_monitor_notifications_for_org(uuid, date) to authenticated;
grant execute on function public.refresh_credit_monitor_notifications_for_all_orgs(date) to authenticated;

do $$
declare
  v_job_id bigint;
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise notice 'pg_cron extension is unavailable; skipping credit notification schedule setup (%).', sqlerrm;
      return;
  end;

  if to_regnamespace('cron') is null then
    raise notice 'cron schema is not available; skipping credit notification schedule setup.';
    return;
  end if;

  for v_job_id in
    select j.jobid
    from cron.job j
    where j.jobname = 'refresh_credit_monitor_notifications_daily'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'refresh_credit_monitor_notifications_daily',
    '5 0 * * *',
    $job$select public.refresh_credit_monitor_notifications_for_all_orgs(current_date);$job$
  );
exception
  when others then
    raise notice 'Failed to configure credit notification schedule (%).', sqlerrm;
end;
$$;
