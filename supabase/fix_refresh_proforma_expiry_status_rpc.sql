begin;

create or replace function public.refresh_proforma_expiry_status(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_updated integer := 0;
  v_purchase_updated integer := 0;
begin
  if p_organization_id is null then
    return jsonb_build_object(
      'sales_updated', 0,
      'purchase_updated', 0
    );
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    return jsonb_build_object(
      'sales_updated', 0,
      'purchase_updated', 0
    );
  end if;

  update public.proforma_invoices
  set status = 'EXPIRED',
      updated_at = now()
  where organization_id = p_organization_id
    and valid_till is not null
    and valid_till < current_date
    and status in ('DRAFT', 'SENT', 'APPROVED');
  get diagnostics v_sales_updated = row_count;

  update public.purchase_proformas
  set status = 'EXPIRED',
      updated_at = now()
  where organization_id = p_organization_id
    and valid_till is not null
    and valid_till < current_date
    and status in ('DRAFT', 'SENT', 'APPROVED');
  get diagnostics v_purchase_updated = row_count;

  return jsonb_build_object(
    'sales_updated', coalesce(v_sales_updated, 0),
    'purchase_updated', coalesce(v_purchase_updated, 0)
  );
exception
  when others then
    return jsonb_build_object(
      'sales_updated', 0,
      'purchase_updated', 0
    );
end;
$$;

create or replace function public.refresh_proforma_expiry_status()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_updated integer := 0;
begin
  update public.proforma_invoices
  set status = 'EXPIRED',
      updated_at = now()
  where valid_till is not null
    and valid_till < current_date
    and status in ('DRAFT', 'SENT', 'APPROVED');
  get diagnostics v_sales_updated = row_count;

  return coalesce(v_sales_updated, 0);
exception
  when others then
    return 0;
end;
$$;

grant execute on function public.refresh_proforma_expiry_status(uuid) to authenticated;
grant execute on function public.refresh_proforma_expiry_status() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
