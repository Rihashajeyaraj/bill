-- Credit/Debit note hardening and stock return helper fixes
-- Safe to run multiple times.

alter table if exists public.credit_note_items
  add column if not exists source_invoice_item_id uuid;

alter table if exists public.debit_note_items
  add column if not exists source_purchase_bill_item_id uuid;

create index if not exists idx_credit_notes_org_related_status_created
  on public.credit_notes(organization_id, related_invoice_id, status, created_at);

create index if not exists idx_credit_note_items_credit_source_item
  on public.credit_note_items(credit_note_id, source_invoice_item_id, item_id);

create index if not exists idx_debit_notes_org_related_status_created
  on public.debit_notes(organization_id, related_bill_id, status, created_at);

create index if not exists idx_debit_note_items_debit_source_item
  on public.debit_note_items(debit_note_id, source_purchase_bill_item_id, item_id);

create or replace function public.record_stock_adjustment(
  p_organization_id uuid,
  p_item_id uuid,
  p_adjustment_qty numeric,
  p_adjustment_date date default current_date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_batch_id uuid;
begin
  if p_organization_id is null or p_item_id is null then
    raise exception 'organization_id and item_id are required';
  end if;
  if p_adjustment_qty = 0 then
    raise exception 'adjustment quantity cannot be zero';
  end if;
  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  v_batch_id := null;

  if p_adjustment_qty > 0 then
    insert into public.stock_batches (
      organization_id,
      item_id,
      purchase_bill_id,
      purchase_bill_item_id,
      batch_date,
      source_document_no,
      qty_purchased,
      qty_remaining,
      unit_cost_excl_tax,
      unit_cost_incl_tax,
      tax_rate,
      tax_amount,
      tax_inclusive,
      metadata,
      created_by
    )
    values (
      p_organization_id,
      p_item_id,
      null,
      null,
      coalesce(p_adjustment_date, current_date),
      'STOCK_ADJUSTMENT',
      p_adjustment_qty,
      p_adjustment_qty,
      0,
      0,
      0,
      0,
      false,
      jsonb_build_object('source', 'stock_adjustment'),
      auth.uid()
    )
    returning id into v_batch_id;
  end if;

  insert into public.stock_movements (
    organization_id,
    item_id,
    stock_batch_id,
    movement_type,
    movement_date,
    quantity_delta,
    source_table,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_item_id,
    v_batch_id,
    'ADJUST',
    coalesce(p_adjustment_date, current_date),
    p_adjustment_qty,
    'stock_adjustment',
    p_notes,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_credit_note_return_in(
  p_organization_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_unit_cost_excl_tax numeric default 0,
  p_unit_cost_incl_tax numeric default 0,
  p_credit_note_id uuid default null,
  p_credit_note_item_id uuid default null,
  p_credit_note_no text default null,
  p_return_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_batch_id uuid;
  v_unit_cost_excl numeric := coalesce(p_unit_cost_excl_tax, 0);
  v_unit_cost_incl numeric := coalesce(p_unit_cost_incl_tax, coalesce(p_unit_cost_excl_tax, 0));
begin
  if p_organization_id is null or p_item_id is null then
    raise exception 'organization_id and item_id are required';
  end if;
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'qty must be > 0';
  end if;
  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  insert into public.stock_batches (
    organization_id,
    item_id,
    purchase_bill_id,
    purchase_bill_item_id,
    batch_date,
    source_document_no,
    qty_purchased,
    qty_remaining,
    unit_cost_excl_tax,
    unit_cost_incl_tax,
    tax_rate,
    tax_amount,
    tax_inclusive,
    metadata,
    created_by
  )
  values (
    p_organization_id,
    p_item_id,
    null,
    null,
    coalesce(p_return_date, current_date),
    coalesce(nullif(trim(p_credit_note_no), ''), 'CREDIT_RETURN'),
    p_qty,
    p_qty,
    v_unit_cost_excl,
    v_unit_cost_incl,
    0,
    0,
    false,
    jsonb_build_object('source', 'credit_note_return', 'optionalRule', true),
    auth.uid()
  )
  returning id into v_batch_id;

  insert into public.stock_movements (
    organization_id,
    item_id,
    stock_batch_id,
    movement_type,
    movement_date,
    quantity_delta,
    unit_cost_excl_tax,
    unit_cost_incl_tax,
    source_table,
    source_id,
    source_item_id,
    source_document_no,
    notes,
    metadata,
    created_by
  )
  values (
    p_organization_id,
    p_item_id,
    v_batch_id,
    'IN',
    coalesce(p_return_date, current_date),
    p_qty,
    v_unit_cost_excl,
    v_unit_cost_incl,
    'credit_notes',
    p_credit_note_id,
    p_credit_note_item_id,
    p_credit_note_no,
    'Credit note stock return',
    jsonb_build_object('optionalRule', true),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_stock_adjustment(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.record_credit_note_return_in(uuid, uuid, numeric, numeric, numeric, uuid, uuid, text, date) to authenticated;
