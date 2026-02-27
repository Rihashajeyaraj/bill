-- FIFO inventory, stock audit, tax ledgers, and invoice profit support
-- Safe/idempotent migration for existing BillJoy schema.

create extension if not exists pgcrypto;

-- =========================
-- Table extensions
-- =========================
alter table public.purchase_bill_items
  add column if not exists tax_inclusive boolean not null default false,
  add column if not exists taxable_amount numeric(14,2) not null default 0,
  add column if not exists tax_amount numeric(14,2) not null default 0;

alter table public.invoice_items
  add column if not exists cogs_unit_cost numeric(14,6) not null default 0,
  add column if not exists cogs_amount numeric(14,2) not null default 0,
  add column if not exists gross_profit_amount numeric(14,2) not null default 0;

-- =========================
-- Core inventory/tax/profit tables
-- =========================
create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  purchase_bill_id uuid references public.purchase_bills(id) on delete set null,
  purchase_bill_item_id uuid references public.purchase_bill_items(id) on delete set null,
  batch_date date not null,
  source_document_no text,
  qty_purchased numeric(14,3) not null default 0 check (qty_purchased >= 0),
  qty_remaining numeric(14,3) not null default 0 check (qty_remaining >= 0),
  unit_cost_excl_tax numeric(14,6) not null default 0,
  unit_cost_incl_tax numeric(14,6) not null default 0,
  suggested_sale_rate numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  tax_inclusive boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stock_batches
  add column if not exists suggested_sale_rate numeric(14,2) not null default 0;

create table if not exists public.stock_batch_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  invoice_item_id uuid not null references public.invoice_items(id) on delete cascade,
  stock_batch_id uuid references public.stock_batches(id) on delete set null,
  item_id uuid not null references public.items(id) on delete cascade,
  allocation_order integer not null default 1 check (allocation_order > 0),
  allocated_qty numeric(14,3) not null default 0 check (allocated_qty >= 0),
  unit_cost_excl_tax numeric(14,6) not null default 0,
  unit_cost_incl_tax numeric(14,6) not null default 0,
  cogs_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  stock_batch_id uuid references public.stock_batches(id) on delete set null,
  movement_type text not null check (movement_type in ('IN', 'OUT', 'RETURN_IN', 'RETURN_OUT', 'ADJUST')),
  movement_date date not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost_excl_tax numeric(14,6) not null default 0,
  unit_cost_incl_tax numeric(14,6) not null default 0,
  source_table text,
  source_id uuid,
  source_item_id uuid,
  source_document_no text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tax_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null,
  entry_type text not null check (entry_type in ('INPUT', 'OUTPUT')),
  source_table text not null,
  source_id uuid not null,
  source_item_id uuid,
  item_id uuid references public.items(id) on delete set null,
  tax_regime text not null default 'none',
  tax_rate numeric(6,3) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  cgst_amount numeric(14,2) not null default 0,
  sgst_amount numeric(14,2) not null default 0,
  igst_amount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  cess_amount numeric(14,2) not null default 0,
  total_tax_amount numeric(14,2) not null default 0,
  tax_inclusive boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_profit_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null unique references public.invoices(id) on delete cascade,
  invoice_date date not null,
  revenue_excl_tax numeric(14,2) not null default 0,
  cogs_amount numeric(14,2) not null default 0,
  gross_profit numeric(14,2) not null default 0,
  margin_percent numeric(8,3) not null default 0,
  total_qty numeric(14,3) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================
-- Indexes
-- =========================
create index if not exists idx_stock_batches_org_item_created_at
  on public.stock_batches(organization_id, item_id, created_at);
create index if not exists idx_stock_batches_org_item_batch_date
  on public.stock_batches(organization_id, item_id, batch_date, id);
create index if not exists idx_stock_batches_remaining
  on public.stock_batches(organization_id, item_id, qty_remaining)
  where qty_remaining > 0;

create index if not exists idx_stock_alloc_org_item_created_at
  on public.stock_batch_allocations(organization_id, item_id, created_at);
create index if not exists idx_stock_alloc_invoice
  on public.stock_batch_allocations(invoice_id, invoice_item_id);

create index if not exists idx_stock_moves_org_item_created_at
  on public.stock_movements(organization_id, item_id, created_at);
create index if not exists idx_stock_moves_source
  on public.stock_movements(source_table, source_id);

create index if not exists idx_tax_ledger_org_item_created_at
  on public.tax_ledger_entries(organization_id, item_id, created_at);
create index if not exists idx_tax_ledger_org_date_type
  on public.tax_ledger_entries(organization_id, entry_date, entry_type);

create index if not exists idx_invoice_profit_org_date
  on public.invoice_profit_summaries(organization_id, invoice_date, created_at);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_payments_org_payment_no_unique'
  ) then
    if not exists (
      select 1
      from public.payments
      where payment_no is not null and length(trim(payment_no)) > 0
      group by organization_id, payment_no
      having count(*) > 1
    ) then
      execute '
        create unique index idx_payments_org_payment_no_unique
          on public.payments(organization_id, payment_no)
          where payment_no is not null and length(trim(payment_no)) > 0
      ';
    end if;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_expenses_org_expense_no_unique'
  ) then
    if not exists (
      select 1
      from public.expenses
      where expense_no is not null and length(trim(expense_no)) > 0
      group by organization_id, expense_no
      having count(*) > 1
    ) then
      execute '
        create unique index idx_expenses_org_expense_no_unique
          on public.expenses(organization_id, expense_no)
          where expense_no is not null and length(trim(expense_no)) > 0
      ';
    end if;
  end if;
end $$;

-- =========================
-- Triggers
-- =========================
drop trigger if exists trg_stock_batches_updated_at on public.stock_batches;
create trigger trg_stock_batches_updated_at
before update on public.stock_batches
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_invoice_profit_summaries_updated_at on public.invoice_profit_summaries;
create trigger trg_invoice_profit_summaries_updated_at
before update on public.invoice_profit_summaries
for each row execute procedure public.set_updated_at();

-- =========================
-- Utility helpers
-- =========================
create or replace function public.to_num(value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v numeric;
begin
  v := nullif(trim(coalesce(value, '')), '')::numeric;
  return coalesce(v, 0);
exception
  when others then
    return 0;
end;
$$;

create or replace function public.to_bool(value text, default_value boolean default false)
returns boolean
language sql
immutable
as $$
  select
    case lower(trim(coalesce(value, '')))
      when 'true' then true
      when 't' then true
      when '1' then true
      when 'yes' then true
      when 'y' then true
      when 'false' then false
      when 'f' then false
      when '0' then false
      when 'no' then false
      when 'n' then false
      else default_value
    end;
$$;

create or replace function public.organization_allow_negative_stock(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with company_cfg as (
    select c.settings
    from public.company_settings c
    where c.organization_id = p_org_id
  ),
  org_cfg as (
    select o.settings
    from public.organizations o
    where o.id = p_org_id
  )
  select public.to_bool(
    coalesce(
      (select settings #>> '{inventory,allowNegativeStock}' from company_cfg),
      (select settings #>> '{preferences,allowNegativeStock}' from company_cfg),
      (select settings ->> 'allowNegativeStock' from company_cfg),
      (select settings ->> 'allow_negative_stock' from company_cfg),
      (select settings #>> '{inventory,allowNegativeStock}' from org_cfg),
      (select settings #>> '{preferences,allowNegativeStock}' from org_cfg),
      (select settings ->> 'allowNegativeStock' from org_cfg),
      (select settings ->> 'allow_negative_stock' from org_cfg),
      'false'
    ),
    false
  );
$$;

create or replace function public.refresh_item_current_stock(
  p_organization_id uuid,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_qty numeric := 0;
  v_adjust_qty numeric := 0;
begin
  if p_organization_id is null or p_item_id is null then
    return;
  end if;

  select coalesce(sum(b.qty_remaining), 0)
    into v_batch_qty
  from public.stock_batches b
  where b.organization_id = p_organization_id
    and b.item_id = p_item_id;

  select coalesce(sum(m.quantity_delta), 0)
    into v_adjust_qty
  from public.stock_movements m
  where m.organization_id = p_organization_id
    and m.item_id = p_item_id
    and m.stock_batch_id is null
    and m.movement_type in ('ADJUST', 'RETURN_IN', 'RETURN_OUT');

  update public.items i
  set current_stock = round((v_batch_qty + v_adjust_qty)::numeric, 3),
      updated_at = now()
  where i.organization_id = p_organization_id
    and i.id = p_item_id;
end;
$$;

create or replace function public.trg_refresh_item_stock_from_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_item_current_stock(old.organization_id, old.item_id);
    return old;
  end if;
  perform public.refresh_item_current_stock(new.organization_id, new.item_id);
  return new;
end;
$$;

create or replace function public.trg_refresh_item_stock_from_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.movement_type in ('ADJUST', 'RETURN_IN', 'RETURN_OUT') and old.stock_batch_id is null then
      perform public.refresh_item_current_stock(old.organization_id, old.item_id);
    end if;
    return old;
  end if;
  if new.movement_type in ('ADJUST', 'RETURN_IN', 'RETURN_OUT') and new.stock_batch_id is null then
    perform public.refresh_item_current_stock(new.organization_id, new.item_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stock_batches_refresh_item_stock on public.stock_batches;
create trigger trg_stock_batches_refresh_item_stock
after insert or update or delete on public.stock_batches
for each row execute procedure public.trg_refresh_item_stock_from_batch();

drop trigger if exists trg_stock_movements_refresh_item_stock on public.stock_movements;
create trigger trg_stock_movements_refresh_item_stock
after insert or update or delete on public.stock_movements
for each row execute procedure public.trg_refresh_item_stock_from_movement();

-- =========================
-- Posting helpers
-- =========================
create or replace function public.post_purchase_bill_fifo(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := nullif(p_payload->>'organization_id', '')::uuid;
  v_actor uuid := auth.uid();
  v_bill_id uuid;
  v_bill_no text := coalesce(nullif(trim(p_payload->>'bill_no'), ''), 'BILL-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_bill_date date := coalesce((p_payload->>'bill_date')::date, current_date);
  v_due_date date := coalesce((p_payload->>'due_date')::date, v_bill_date);
  v_supplier_id uuid := nullif(p_payload->>'supplier_id', '')::uuid;
  v_country text := coalesce(p_payload->>'country', '');
  v_tax_mode text := coalesce(p_payload->>'tax_mode', '');
  v_supply_type text := coalesce(p_payload->>'supply_type', '');
  v_line jsonb;
  v_item_id uuid;
  v_item_type text;
  v_item_name text;
  v_item_code text;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_tax_rate numeric;
  v_tax_inclusive boolean;
  v_taxable numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_unit_cost_excl numeric;
  v_unit_cost_incl numeric;
  v_suggested_sale_rate numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_vat numeric;
  v_cess numeric;
  v_line_id uuid;
  v_batch_id uuid;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_grand_total numeric := 0;
  v_total_qty numeric := 0;
  v_tax_regime text := 'none';
begin
  if v_org_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(v_org_id) then
    raise exception 'Access denied for organization %', v_org_id;
  end if;

  select lower(o.tax_regime::text)
    into v_tax_regime
  from public.organizations o
  where o.id = v_org_id;
  v_tax_regime := coalesce(v_tax_regime, 'none');

  insert into public.purchase_bills (
    organization_id,
    bill_no,
    bill_date,
    due_date,
    supplier_id,
    subtotal,
    taxable_total,
    cgst_total,
    sgst_total,
    igst_total,
    vat_total,
    tax_total,
    grand_total,
    status,
    metadata,
    created_by
  )
  values (
    v_org_id,
    v_bill_no,
    v_bill_date,
    v_due_date,
    v_supplier_id,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    'issued',
    jsonb_build_object(
      'country', v_country,
      'taxMode', v_tax_mode,
      'supplyType', v_supply_type,
      'partyName', coalesce(p_payload->>'party_name', ''),
      'partyAddress', coalesce(p_payload->>'party_address', ''),
      'phone', coalesce(p_payload->>'phone', ''),
      'paymentType', coalesce(p_payload->>'payment_type', ''),
      'createdByName', coalesce(p_payload->>'created_by_name', '')
    ),
    v_actor
  )
  returning id into v_bill_id;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_item_id := nullif(v_line->>'item_id', '')::uuid;
    v_item_code := coalesce(nullif(trim(v_line->>'item_code'), ''), nullif(trim(v_line->>'itemCode'), ''));
    v_item_name := coalesce(nullif(trim(v_line->>'item_name'), ''), nullif(trim(v_line->>'itemName'), ''), 'Item');
    v_description := coalesce(nullif(trim(v_line->>'description'), ''), v_item_name);
    v_qty := greatest(public.to_num(v_line->>'qty'), 0);
    v_unit_price := greatest(public.to_num(v_line->>'rate'), 0);
    v_suggested_sale_rate := greatest(public.to_num(coalesce(v_line->>'suggested_sale_rate', v_line->>'saleRate', v_line->>'sellingRate')), 0);
    v_tax_rate := greatest(public.to_num(coalesce(v_line->>'tax', v_line->>'taxRate')), 0);
    v_tax_inclusive := public.to_bool(
      coalesce(
        v_line->>'tax_inclusive',
        v_line->>'taxInclusive',
        case when upper(coalesce(v_line->>'priceTaxMode', '')) = 'WITH_TAX' then 'true' else 'false' end
      ),
      false
    );

    if v_qty <= 0 then
      continue;
    end if;

    if v_tax_inclusive and v_tax_rate > 0 then
      v_line_total := round((v_qty * v_unit_price)::numeric, 2);
      v_taxable := round((v_line_total / (1 + (v_tax_rate / 100)))::numeric, 2);
      v_tax_amount := round((v_line_total - v_taxable)::numeric, 2);
    else
      v_taxable := round((v_qty * v_unit_price)::numeric, 2);
      v_tax_amount := round(((v_taxable * v_tax_rate) / 100)::numeric, 2);
      v_line_total := round((v_taxable + v_tax_amount)::numeric, 2);
    end if;

    v_unit_cost_excl := case when v_qty > 0 then round((v_taxable / v_qty)::numeric, 6) else 0 end;
    v_unit_cost_incl := case when v_qty > 0 then round((v_line_total / v_qty)::numeric, 6) else 0 end;

    v_cgst := 0; v_sgst := 0; v_igst := 0; v_vat := 0; v_cess := 0;
    if v_tax_amount > 0 then
      if v_tax_regime = 'gst' then
        if upper(v_supply_type) = 'INTER' then
          v_igst := v_tax_amount;
        else
          v_cgst := round((v_tax_amount / 2)::numeric, 2);
          v_sgst := round((v_tax_amount - v_cgst)::numeric, 2);
        end if;
      else
        v_vat := v_tax_amount;
      end if;
    end if;

    insert into public.purchase_bill_items (
      bill_id,
      item_id,
      item_code,
      description,
      qty,
      unit_price,
      tax_rate,
      taxable_amount,
      tax_amount,
      tax_inclusive,
      cgst_amount,
      sgst_amount,
      igst_amount,
      vat_amount,
      line_total
    )
    values (
      v_bill_id,
      v_item_id,
      v_item_code,
      v_description,
      v_qty,
      v_unit_price,
      v_tax_rate,
      v_taxable,
      v_tax_amount,
      v_tax_inclusive,
      v_cgst,
      v_sgst,
      v_igst,
      v_vat,
      v_line_total
    )
    returning id into v_line_id;

    v_total_qty := v_total_qty + v_qty;
    v_subtotal := v_subtotal + v_taxable;
    v_tax_total := v_tax_total + v_tax_amount;
    v_grand_total := v_grand_total + v_line_total;

    if v_item_id is not null then
      select i.item_type::text
        into v_item_type
      from public.items i
      where i.organization_id = v_org_id
        and i.id = v_item_id;

      if lower(coalesce(v_item_type, '')) = 'product' then
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
          suggested_sale_rate,
          tax_rate,
          tax_amount,
          tax_inclusive,
          metadata,
          created_by
        )
        values (
          v_org_id,
          v_item_id,
          v_bill_id,
          v_line_id,
          v_bill_date,
          v_bill_no,
          v_qty,
          v_qty,
          v_unit_cost_excl,
          v_unit_cost_incl,
          v_suggested_sale_rate,
          v_tax_rate,
          v_tax_amount,
          v_tax_inclusive,
          jsonb_build_object(
            'itemName', v_item_name,
            'itemCode', v_item_code,
            'suggestedSaleRate', v_suggested_sale_rate
          ),
          v_actor
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
          v_org_id,
          v_item_id,
          v_batch_id,
          'IN',
          v_bill_date,
          v_qty,
          v_unit_cost_excl,
          v_unit_cost_incl,
          'purchase_bills',
          v_bill_id,
          v_line_id,
          v_bill_no,
          'Purchase receipt',
          jsonb_build_object(
            'taxInclusive', v_tax_inclusive,
            'taxRate', v_tax_rate
          ),
          v_actor
        );

        update public.items i
        set purchase_price = v_unit_cost_excl,
            sale_price = case when v_suggested_sale_rate > 0 then v_suggested_sale_rate else i.sale_price end,
            updated_at = now()
        where i.organization_id = v_org_id
          and i.id = v_item_id;
      end if;
    end if;

    insert into public.tax_ledger_entries (
      organization_id,
      entry_date,
      entry_type,
      source_table,
      source_id,
      source_item_id,
      item_id,
      tax_regime,
      tax_rate,
      taxable_amount,
      cgst_amount,
      sgst_amount,
      igst_amount,
      vat_amount,
      cess_amount,
      total_tax_amount,
      tax_inclusive,
      metadata,
      created_by
    )
    values (
      v_org_id,
      v_bill_date,
      'INPUT',
      'purchase_bills',
      v_bill_id,
      v_line_id,
      v_item_id,
      v_tax_regime,
      v_tax_rate,
      v_taxable,
      v_cgst,
      v_sgst,
      v_igst,
      v_vat,
      v_cess,
      v_tax_amount,
      v_tax_inclusive,
      jsonb_build_object(
        'billNo', v_bill_no,
        'supplyType', upper(v_supply_type),
        'country', v_country
      ),
      v_actor
    );
  end loop;

  update public.purchase_bills b
  set subtotal = round(v_subtotal::numeric, 2),
      taxable_total = round(v_subtotal::numeric, 2),
      cgst_total = coalesce((select round(sum(i.cgst_amount)::numeric, 2) from public.purchase_bill_items i where i.bill_id = b.id), 0),
      sgst_total = coalesce((select round(sum(i.sgst_amount)::numeric, 2) from public.purchase_bill_items i where i.bill_id = b.id), 0),
      igst_total = coalesce((select round(sum(i.igst_amount)::numeric, 2) from public.purchase_bill_items i where i.bill_id = b.id), 0),
      vat_total = coalesce((select round(sum(i.vat_amount)::numeric, 2) from public.purchase_bill_items i where i.bill_id = b.id), 0),
      tax_total = round(v_tax_total::numeric, 2),
      grand_total = round(v_grand_total::numeric, 2),
      metadata = coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object(
        'totalQty', round(v_total_qty::numeric, 3),
        'taxRate', case when v_subtotal > 0 then round(((v_tax_total / v_subtotal) * 100)::numeric, 3) else 0 end
      ),
      updated_at = now()
  where b.id = v_bill_id;

  return jsonb_build_object(
    'bill_id', v_bill_id,
    'bill_no', v_bill_no,
    'subtotal', round(v_subtotal::numeric, 2),
    'tax_total', round(v_tax_total::numeric, 2),
    'grand_total', round(v_grand_total::numeric, 2),
    'total_qty', round(v_total_qty::numeric, 3)
  );
end;
$$;

create or replace function public.post_invoice_fifo(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := nullif(p_payload->>'organization_id', '')::uuid;
  v_actor uuid := auth.uid();
  v_invoice_id uuid;
  v_invoice_no text := coalesce(nullif(trim(p_payload->>'invoice_no'), ''), 'INV-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_invoice_date date := coalesce((p_payload->>'invoice_date')::date, current_date);
  v_due_date date := coalesce((p_payload->>'due_date')::date, v_invoice_date);
  v_party_id uuid := nullif(p_payload->>'party_id', '')::uuid;
  v_place_of_supply text := coalesce(p_payload->>'place_of_supply_state', '');
  v_currency_code text := upper(coalesce(nullif(trim(p_payload->>'currency_code'), ''), 'INR'));
  v_country text := coalesce(p_payload->>'country', '');
  v_tax_mode text := coalesce(p_payload->>'tax_mode', '');
  v_supply_type text := coalesce(p_payload->>'supply_type', '');
  v_allow_negative_stock boolean;
  v_tax_regime text := 'none';
  v_line jsonb;
  v_item_id uuid;
  v_item_type text;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_tax_rate numeric;
  v_line_tax_inclusive boolean;
  v_taxable numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_vat numeric;
  v_cess numeric;
  v_line_total numeric;
  v_line_id uuid;
  v_manual_batch_id uuid;
  v_available numeric;
  v_remaining numeric;
  v_pick_qty numeric;
  v_alloc_order integer;
  v_batch record;
  v_fallback_cost numeric;
  v_line_cogs numeric;
  v_revenue numeric := 0;
  v_cogs numeric := 0;
  v_qty_total numeric := 0;
  v_cgst_total numeric := 0;
  v_sgst_total numeric := 0;
  v_igst_total numeric := 0;
  v_vat_total numeric := 0;
  v_cess_total numeric := 0;
  v_tax_total numeric := 0;
  v_subtotal numeric := 0;
  v_grand_total numeric := 0;
  v_line_profit numeric;
begin
  if v_org_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(v_org_id) then
    raise exception 'Access denied for organization %', v_org_id;
  end if;

  select lower(o.tax_regime::text)
    into v_tax_regime
  from public.organizations o
  where o.id = v_org_id;
  v_tax_regime := coalesce(v_tax_regime, 'none');

  v_allow_negative_stock := public.organization_allow_negative_stock(v_org_id);

  insert into public.invoices (
    organization_id,
    invoice_no,
    invoice_date,
    due_date,
    party_id,
    place_of_supply_state,
    currency_code,
    exchange_rate,
    subtotal,
    discount_total,
    taxable_total,
    cgst_total,
    sgst_total,
    igst_total,
    cess_total,
    vat_total,
    tax_total,
    round_off,
    grand_total,
    status,
    metadata,
    created_by
  )
  values (
    v_org_id,
    v_invoice_no,
    v_invoice_date,
    v_due_date,
    v_party_id,
    nullif(v_place_of_supply, ''),
    v_currency_code,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    'issued',
    jsonb_build_object(
      'country', v_country,
      'taxMode', v_tax_mode,
      'supplyType', v_supply_type,
      'partyName', coalesce(p_payload->>'party_name', ''),
      'createdByName', coalesce(p_payload->>'created_by_name', ''),
      'allowNegativeStock', v_allow_negative_stock
    ),
    v_actor
  )
  returning id into v_invoice_id;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  loop
    v_item_id := nullif(v_line->>'item_id', '')::uuid;
    v_manual_batch_id := nullif(coalesce(v_line->>'manual_batch_id', v_line->>'manualBatchId', ''), '')::uuid;
    v_description := coalesce(nullif(trim(v_line->>'description'), ''), nullif(trim(v_line->>'itemName'), ''), 'Item');
    v_qty := greatest(public.to_num(v_line->>'qty'), 0);
    v_unit_price := greatest(public.to_num(coalesce(v_line->>'rate', v_line->>'unit_price')), 0);
    v_discount := greatest(public.to_num(coalesce(v_line->>'discount', v_line->>'discountAmount')), 0);
    v_tax_rate := greatest(public.to_num(coalesce(v_line->>'tax', v_line->>'taxRate')), 0);
    v_line_tax_inclusive := public.to_bool(
      coalesce(
        v_line->>'tax_inclusive',
        v_line->>'taxInclusive',
        case when upper(coalesce(v_line->>'priceTaxMode', '')) = 'WITH_TAX' then 'true' else 'false' end
      ),
      false
    );
    v_taxable := greatest(public.to_num(coalesce(v_line->>'taxableAmount', v_line->>'net')), 0);

    if v_qty <= 0 then
      continue;
    end if;

    if v_taxable <= 0 then
      if v_line_tax_inclusive and v_tax_rate > 0 then
        v_line_total := round(greatest(0, (v_qty * v_unit_price) - v_discount), 2);
        v_taxable := round((v_line_total / (1 + (v_tax_rate / 100)))::numeric, 2);
      else
        v_taxable := round((v_qty * v_unit_price) - v_discount, 2);
        if v_taxable < 0 then v_taxable := 0; end if;
      end if;
    end if;

    v_cgst := round(public.to_num(v_line->>'cgstAmount'), 2);
    v_sgst := round(public.to_num(v_line->>'sgstAmount'), 2);
    v_igst := round(public.to_num(v_line->>'igstAmount'), 2);
    v_vat := round(public.to_num(v_line->>'vatAmount'), 2);
    v_cess := round(public.to_num(v_line->>'cessAmount'), 2);

    if v_cgst = 0 and v_sgst = 0 and v_igst = 0 and v_vat = 0 and v_tax_rate > 0 then
      if v_tax_regime = 'gst' then
        if upper(v_supply_type) = 'INTER' then
          v_igst := round((v_taxable * v_tax_rate / 100)::numeric, 2);
        else
          v_cgst := round((v_taxable * v_tax_rate / 200)::numeric, 2);
          v_sgst := round(((v_taxable * v_tax_rate / 100) - v_cgst)::numeric, 2);
        end if;
      else
        v_vat := round((v_taxable * v_tax_rate / 100)::numeric, 2);
      end if;
    end if;

    v_line_total := round((v_taxable + v_cgst + v_sgst + v_igst + v_vat + v_cess)::numeric, 2);

    insert into public.invoice_items (
      invoice_id,
      item_id,
      line_no,
      description,
      hsn_sac,
      qty,
      unit,
      unit_price,
      discount_percent,
      discount_amount,
      taxable_amount,
      tax_rate,
      cgst_amount,
      sgst_amount,
      igst_amount,
      cess_amount,
      vat_amount,
      line_total
    )
    values (
      v_invoice_id,
      v_item_id,
      coalesce((v_line->>'line_no')::integer, 1),
      v_description,
      nullif(v_line->>'hsn', ''),
      v_qty,
      nullif(v_line->>'unit', ''),
      v_unit_price,
      round(public.to_num(v_line->>'discountPercent'), 3),
      round(v_discount, 2),
      round(v_taxable, 2),
      round(v_tax_rate, 3),
      v_cgst,
      v_sgst,
      v_igst,
      v_cess,
      v_vat,
      v_line_total
    )
    returning id into v_line_id;

    v_line_cogs := 0;
    v_alloc_order := 0;

    if v_item_id is not null then
      select i.item_type::text, coalesce(i.purchase_price, 0)
        into v_item_type, v_fallback_cost
      from public.items i
      where i.organization_id = v_org_id
        and i.id = v_item_id;

      if lower(coalesce(v_item_type, '')) = 'product' then
        select coalesce(sum(b.qty_remaining), 0)
          into v_available
        from public.stock_batches b
        where b.organization_id = v_org_id
          and b.item_id = v_item_id
          and b.qty_remaining > 0;

        if (not v_allow_negative_stock) and v_available < v_qty then
          raise exception 'Insufficient stock for item %. Requested %, available %.',
            v_item_id, v_qty, v_available;
        end if;

        v_remaining := v_qty;

        if v_manual_batch_id is not null then
          select b.id, b.qty_remaining, b.unit_cost_excl_tax, b.unit_cost_incl_tax
            into v_batch
          from public.stock_batches b
          where b.organization_id = v_org_id
            and b.item_id = v_item_id
            and b.id = v_manual_batch_id
          for update;

          if not found then
            raise exception 'Selected batch % not found for item %', v_manual_batch_id, v_item_id;
          end if;

          if (not v_allow_negative_stock) and v_batch.qty_remaining < v_qty then
            raise exception 'Insufficient selected batch stock for item %. Requested %, selected batch available %.',
              v_item_id, v_qty, v_batch.qty_remaining;
          end if;

          v_pick_qty := least(v_remaining, coalesce(v_batch.qty_remaining, 0));
          if v_pick_qty > 0 then
            v_alloc_order := v_alloc_order + 1;

            update public.stock_batches
            set qty_remaining = round((qty_remaining - v_pick_qty)::numeric, 3),
                updated_at = now()
            where id = v_batch.id;

            insert into public.stock_batch_allocations (
              organization_id,
              invoice_id,
              invoice_item_id,
              stock_batch_id,
              item_id,
              allocation_order,
              allocated_qty,
              unit_cost_excl_tax,
              unit_cost_incl_tax,
              cogs_amount
            )
            values (
              v_org_id,
              v_invoice_id,
              v_line_id,
              v_batch.id,
              v_item_id,
              v_alloc_order,
              v_pick_qty,
              v_batch.unit_cost_excl_tax,
              v_batch.unit_cost_incl_tax,
              round((v_pick_qty * v_batch.unit_cost_excl_tax)::numeric, 2)
            );

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
              created_by
            )
            values (
              v_org_id,
              v_item_id,
              v_batch.id,
              'OUT',
              v_invoice_date,
              -v_pick_qty,
              v_batch.unit_cost_excl_tax,
              v_batch.unit_cost_incl_tax,
              'invoices',
              v_invoice_id,
              v_line_id,
              v_invoice_no,
              'Sale issue (manual batch)',
              v_actor
            );

            v_line_cogs := v_line_cogs + (v_pick_qty * v_batch.unit_cost_excl_tax);
            v_remaining := v_remaining - v_pick_qty;
          end if;
        else
          for v_batch in
            select b.id, b.qty_remaining, b.unit_cost_excl_tax, b.unit_cost_incl_tax
            from public.stock_batches b
            where b.organization_id = v_org_id
              and b.item_id = v_item_id
              and b.qty_remaining > 0
            order by b.batch_date asc, b.created_at asc, b.id asc
            for update
          loop
            exit when v_remaining <= 0;
            v_pick_qty := least(v_remaining, v_batch.qty_remaining);
            if v_pick_qty <= 0 then
              continue;
            end if;
            v_alloc_order := v_alloc_order + 1;

            update public.stock_batches
            set qty_remaining = round((qty_remaining - v_pick_qty)::numeric, 3),
                updated_at = now()
            where id = v_batch.id;

            insert into public.stock_batch_allocations (
              organization_id,
              invoice_id,
              invoice_item_id,
              stock_batch_id,
              item_id,
              allocation_order,
              allocated_qty,
              unit_cost_excl_tax,
              unit_cost_incl_tax,
              cogs_amount
            )
            values (
              v_org_id,
              v_invoice_id,
              v_line_id,
              v_batch.id,
              v_item_id,
              v_alloc_order,
              v_pick_qty,
              v_batch.unit_cost_excl_tax,
              v_batch.unit_cost_incl_tax,
              round((v_pick_qty * v_batch.unit_cost_excl_tax)::numeric, 2)
            );

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
              created_by
            )
            values (
              v_org_id,
              v_item_id,
              v_batch.id,
              'OUT',
              v_invoice_date,
              -v_pick_qty,
              v_batch.unit_cost_excl_tax,
              v_batch.unit_cost_incl_tax,
              'invoices',
              v_invoice_id,
              v_line_id,
              v_invoice_no,
              'Sale issue (FIFO)',
              v_actor
            );

            v_line_cogs := v_line_cogs + (v_pick_qty * v_batch.unit_cost_excl_tax);
            v_remaining := v_remaining - v_pick_qty;
          end loop;
        end if;

        if v_remaining > 0 and v_allow_negative_stock then
          v_alloc_order := v_alloc_order + 1;
          insert into public.stock_batch_allocations (
            organization_id,
            invoice_id,
            invoice_item_id,
            stock_batch_id,
            item_id,
            allocation_order,
            allocated_qty,
            unit_cost_excl_tax,
            unit_cost_incl_tax,
            cogs_amount
          )
          values (
            v_org_id,
            v_invoice_id,
            v_line_id,
            null,
            v_item_id,
            v_alloc_order,
            v_remaining,
            v_fallback_cost,
            v_fallback_cost,
            round((v_remaining * v_fallback_cost)::numeric, 2)
          );

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
            v_org_id,
            v_item_id,
            null,
            'OUT',
            v_invoice_date,
            -v_remaining,
            v_fallback_cost,
            v_fallback_cost,
            'invoices',
            v_invoice_id,
            v_line_id,
            v_invoice_no,
            case when v_manual_batch_id is not null then 'Sale issue (manual batch shortage, negative stock allowed)' else 'Sale issue (negative stock allowed)' end,
            jsonb_build_object('negativeStock', true),
            v_actor
          );

          v_line_cogs := v_line_cogs + (v_remaining * v_fallback_cost);
        end if;
      end if;
    end if;

    v_line_cogs := round(v_line_cogs::numeric, 2);
    v_line_profit := round((v_taxable - v_line_cogs)::numeric, 2);

    update public.invoice_items
    set cogs_unit_cost = case when v_qty > 0 then round((v_line_cogs / v_qty)::numeric, 6) else 0 end,
        cogs_amount = v_line_cogs,
        gross_profit_amount = v_line_profit
    where id = v_line_id;

    insert into public.tax_ledger_entries (
      organization_id,
      entry_date,
      entry_type,
      source_table,
      source_id,
      source_item_id,
      item_id,
      tax_regime,
      tax_rate,
      taxable_amount,
      cgst_amount,
      sgst_amount,
      igst_amount,
      vat_amount,
      cess_amount,
      total_tax_amount,
      tax_inclusive,
      metadata,
      created_by
    )
    values (
      v_org_id,
      v_invoice_date,
      'OUTPUT',
      'invoices',
      v_invoice_id,
      v_line_id,
      v_item_id,
      v_tax_regime,
      v_tax_rate,
      v_taxable,
      v_cgst,
      v_sgst,
      v_igst,
      v_vat,
      v_cess,
      round((v_cgst + v_sgst + v_igst + v_vat + v_cess)::numeric, 2),
      false,
      jsonb_build_object(
        'invoiceNo', v_invoice_no,
        'supplyType', upper(v_supply_type),
        'country', v_country
      ),
      v_actor
    );

    v_subtotal := v_subtotal + v_taxable;
    v_cgst_total := v_cgst_total + v_cgst;
    v_sgst_total := v_sgst_total + v_sgst;
    v_igst_total := v_igst_total + v_igst;
    v_vat_total := v_vat_total + v_vat;
    v_cess_total := v_cess_total + v_cess;
    v_tax_total := v_tax_total + v_cgst + v_sgst + v_igst + v_vat + v_cess;
    v_grand_total := v_grand_total + v_line_total;
    v_revenue := v_revenue + v_taxable;
    v_cogs := v_cogs + v_line_cogs;
    v_qty_total := v_qty_total + v_qty;
  end loop;

  update public.invoices i
  set subtotal = round(v_subtotal::numeric, 2),
      taxable_total = round(v_subtotal::numeric, 2),
      cgst_total = round(v_cgst_total::numeric, 2),
      sgst_total = round(v_sgst_total::numeric, 2),
      igst_total = round(v_igst_total::numeric, 2),
      vat_total = round(v_vat_total::numeric, 2),
      cess_total = round(v_cess_total::numeric, 2),
      tax_total = round(v_tax_total::numeric, 2),
      round_off = coalesce(public.to_num(p_payload->>'round_off'), 0),
      grand_total = round((v_grand_total + coalesce(public.to_num(p_payload->>'round_off'), 0))::numeric, 2),
      metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
        'fifo', jsonb_build_object(
          'cogs', round(v_cogs::numeric, 2),
          'grossProfit', round((v_revenue - v_cogs)::numeric, 2),
          'marginPercent', case when v_revenue > 0 then round(((v_revenue - v_cogs) / v_revenue * 100)::numeric, 3) else 0 end
        )
      ),
      updated_at = now()
  where i.id = v_invoice_id;

  insert into public.invoice_profit_summaries (
    organization_id,
    invoice_id,
    invoice_date,
    revenue_excl_tax,
    cogs_amount,
    gross_profit,
    margin_percent,
    total_qty,
    metadata
  )
  values (
    v_org_id,
    v_invoice_id,
    v_invoice_date,
    round(v_revenue::numeric, 2),
    round(v_cogs::numeric, 2),
    round((v_revenue - v_cogs)::numeric, 2),
    case when v_revenue > 0 then round(((v_revenue - v_cogs) / v_revenue * 100)::numeric, 3) else 0 end,
    round(v_qty_total::numeric, 3),
    jsonb_build_object(
      'allowNegativeStock', v_allow_negative_stock
    )
  )
  on conflict (invoice_id)
  do update
    set revenue_excl_tax = excluded.revenue_excl_tax,
        cogs_amount = excluded.cogs_amount,
        gross_profit = excluded.gross_profit,
        margin_percent = excluded.margin_percent,
        total_qty = excluded.total_qty,
        metadata = excluded.metadata,
        updated_at = now();

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_no', v_invoice_no,
    'revenue_excl_tax', round(v_revenue::numeric, 2),
    'cogs_amount', round(v_cogs::numeric, 2),
    'gross_profit', round((v_revenue - v_cogs)::numeric, 2),
    'allow_negative_stock', v_allow_negative_stock
  );
end;
$$;

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
    coalesce(p_unit_cost_excl_tax, 0),
    coalesce(p_unit_cost_incl_tax, coalesce(p_unit_cost_excl_tax, 0)),
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
    source_table,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_item_id,
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

-- =========================
-- Query/reporting APIs
-- =========================
create or replace function public.get_item_stock_history(
  p_organization_id uuid,
  p_item_id uuid
)
returns table (
  movement_id uuid,
  movement_date date,
  movement_type text,
  quantity_delta numeric,
  unit_cost_excl_tax numeric,
  unit_cost_incl_tax numeric,
  source_table text,
  source_id uuid,
  source_item_id uuid,
  source_document_no text,
  notes text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id as movement_id,
    m.movement_date,
    m.movement_type,
    m.quantity_delta,
    m.unit_cost_excl_tax,
    m.unit_cost_incl_tax,
    m.source_table,
    m.source_id,
    m.source_item_id,
    m.source_document_no,
    m.notes,
    m.created_at
  from public.stock_movements m
  where m.organization_id = p_organization_id
    and m.item_id = p_item_id
    and public.current_user_is_org_member(p_organization_id)
  order by m.movement_date desc, m.created_at desc, m.id desc;
$$;

create or replace function public.get_item_batch_summary(
  p_organization_id uuid,
  p_item_id uuid
)
returns table (
  batch_id uuid,
  batch_date date,
  source_document_no text,
  purchase_bill_id uuid,
  purchase_bill_item_id uuid,
  qty_purchased numeric,
  qty_remaining numeric,
  unit_cost_excl_tax numeric,
  unit_cost_incl_tax numeric,
  suggested_sale_rate numeric,
  tax_rate numeric,
  tax_inclusive boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id as batch_id,
    b.batch_date,
    b.source_document_no,
    b.purchase_bill_id,
    b.purchase_bill_item_id,
    b.qty_purchased,
    b.qty_remaining,
    b.unit_cost_excl_tax,
    b.unit_cost_incl_tax,
    b.suggested_sale_rate,
    b.tax_rate,
    b.tax_inclusive,
    b.created_at
  from public.stock_batches b
  where b.organization_id = p_organization_id
    and b.item_id = p_item_id
    and public.current_user_is_org_member(p_organization_id)
  order by b.batch_date asc, b.created_at asc, b.id asc;
$$;

create or replace function public.get_invoice_allocations(
  p_organization_id uuid,
  p_invoice_id uuid
)
returns table (
  allocation_id uuid,
  invoice_id uuid,
  invoice_item_id uuid,
  item_id uuid,
  item_name text,
  item_code text,
  allocation_order integer,
  allocated_qty numeric,
  unit_cost_excl_tax numeric,
  unit_cost_incl_tax numeric,
  cogs_amount numeric,
  batch_id uuid,
  batch_date date,
  batch_document_no text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id as allocation_id,
    a.invoice_id,
    a.invoice_item_id,
    a.item_id,
    i.item_name,
    i.item_code,
    a.allocation_order,
    a.allocated_qty,
    a.unit_cost_excl_tax,
    a.unit_cost_incl_tax,
    a.cogs_amount,
    b.id as batch_id,
    b.batch_date,
    b.source_document_no as batch_document_no
  from public.stock_batch_allocations a
  left join public.stock_batches b
    on b.id = a.stock_batch_id
  left join public.items i
    on i.id = a.item_id
  where a.organization_id = p_organization_id
    and a.invoice_id = p_invoice_id
    and public.current_user_is_org_member(p_organization_id)
  order by a.invoice_item_id, a.allocation_order;
$$;

create or replace function public.get_tax_summary(
  p_organization_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  input_tax numeric,
  output_tax numeric,
  net_payable numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with ledger as (
    select
      l.entry_type,
      coalesce(l.total_tax_amount, 0) as total_tax_amount
    from public.tax_ledger_entries l
    where l.organization_id = p_organization_id
      and l.entry_date >= coalesce(p_date_from, l.entry_date)
      and l.entry_date <= coalesce(p_date_to, l.entry_date)
      and public.current_user_is_org_member(p_organization_id)
  )
  select
    coalesce(sum(case when entry_type = 'INPUT' then total_tax_amount else 0 end), 0)::numeric as input_tax,
    coalesce(sum(case when entry_type = 'OUTPUT' then total_tax_amount else 0 end), 0)::numeric as output_tax,
    (
      coalesce(sum(case when entry_type = 'OUTPUT' then total_tax_amount else 0 end), 0)
      -
      coalesce(sum(case when entry_type = 'INPUT' then total_tax_amount else 0 end), 0)
    )::numeric as net_payable
  from ledger;
$$;

create or replace function public.get_invoice_profit_summary(
  p_organization_id uuid,
  p_invoice_id uuid
)
returns table (
  invoice_id uuid,
  invoice_date date,
  revenue_excl_tax numeric,
  cogs_amount numeric,
  gross_profit numeric,
  margin_percent numeric,
  total_qty numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.invoice_id,
    s.invoice_date,
    s.revenue_excl_tax,
    s.cogs_amount,
    s.gross_profit,
    s.margin_percent,
    s.total_qty
  from public.invoice_profit_summaries s
  where s.organization_id = p_organization_id
    and s.invoice_id = p_invoice_id
    and public.current_user_is_org_member(p_organization_id);
$$;

create or replace function public.get_invoice_item_profit(
  p_organization_id uuid,
  p_invoice_id uuid
)
returns table (
  invoice_item_id uuid,
  line_no integer,
  item_id uuid,
  item_name text,
  qty numeric,
  revenue_excl_tax numeric,
  cogs_amount numeric,
  gross_profit_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ii.id as invoice_item_id,
    ii.line_no,
    ii.item_id,
    coalesce(it.item_name, ii.description) as item_name,
    ii.qty,
    ii.taxable_amount as revenue_excl_tax,
    ii.cogs_amount,
    ii.gross_profit_amount
  from public.invoice_items ii
  join public.invoices inv
    on inv.id = ii.invoice_id
  left join public.items it
    on it.id = ii.item_id
  where inv.organization_id = p_organization_id
    and ii.invoice_id = p_invoice_id
    and public.current_user_is_org_member(p_organization_id)
  order by ii.line_no asc, ii.id asc;
$$;

-- =========================
-- Optional credit-note stock return helper
-- =========================
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

  insert into public.stock_movements (
    organization_id,
    item_id,
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
    'RETURN_IN',
    coalesce(p_return_date, current_date),
    p_qty,
    coalesce(p_unit_cost_excl_tax, 0),
    coalesce(p_unit_cost_incl_tax, 0),
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

-- =========================
-- Backfill opening batches once
-- =========================
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
  suggested_sale_rate,
  tax_rate,
  tax_amount,
  tax_inclusive,
  metadata,
  created_by
)
select
  i.organization_id,
  i.id,
  null,
  null,
  coalesce(i.created_at::date, current_date),
  'OPENING_BALANCE',
  round(greatest(coalesce(i.current_stock, 0), coalesce(i.opening_stock, 0))::numeric, 3),
  round(greatest(coalesce(i.current_stock, 0), coalesce(i.opening_stock, 0))::numeric, 3),
  coalesce(i.purchase_price, 0),
  case
    when coalesce(i.tax_inclusive, false)
      then coalesce(i.purchase_price, 0)
    else round((coalesce(i.purchase_price, 0) * (1 + (coalesce(i.tax_rate, 0) / 100)))::numeric, 6)
  end,
  coalesce(i.sale_price, 0),
  coalesce(i.tax_rate, 0),
  0,
  coalesce(i.tax_inclusive, false),
  jsonb_build_object('seeded', true, 'reason', 'initial_migration'),
  null
from public.items i
where lower(i.item_type::text) = 'product'
  and greatest(coalesce(i.current_stock, 0), coalesce(i.opening_stock, 0)) > 0
  and not exists (
    select 1 from public.stock_batches b
    where b.organization_id = i.organization_id
      and b.item_id = i.id
  );

do $$
declare
  r record;
begin
  for r in
    select distinct b.organization_id, b.item_id
    from public.stock_batches b
  loop
    perform public.refresh_item_current_stock(r.organization_id, r.item_id);
  end loop;
end $$;

-- =========================
-- RLS + policies
-- =========================
alter table public.stock_batches enable row level security;
alter table public.stock_batch_allocations enable row level security;
alter table public.stock_movements enable row level security;
alter table public.tax_ledger_entries enable row level security;
alter table public.invoice_profit_summaries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_batches' and policyname = 'stock_batches_member_access'
  ) then
    create policy "stock_batches_member_access"
    on public.stock_batches for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_batch_allocations' and policyname = 'stock_batch_alloc_member_access'
  ) then
    create policy "stock_batch_alloc_member_access"
    on public.stock_batch_allocations for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_movements' and policyname = 'stock_movements_member_access'
  ) then
    create policy "stock_movements_member_access"
    on public.stock_movements for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tax_ledger_entries' and policyname = 'tax_ledger_member_access'
  ) then
    create policy "tax_ledger_member_access"
    on public.tax_ledger_entries for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_profit_summaries' and policyname = 'invoice_profit_member_access'
  ) then
    create policy "invoice_profit_member_access"
    on public.invoice_profit_summaries for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;
end $$;

-- =========================
-- Permissions
-- =========================
grant execute on function public.post_purchase_bill_fifo(jsonb) to authenticated;
grant execute on function public.post_invoice_fifo(jsonb) to authenticated;
grant execute on function public.record_stock_adjustment(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.record_credit_note_return_in(uuid, uuid, numeric, numeric, numeric, uuid, uuid, text, date) to authenticated;
grant execute on function public.get_item_stock_history(uuid, uuid) to authenticated;
grant execute on function public.get_item_batch_summary(uuid, uuid) to authenticated;
grant execute on function public.get_invoice_allocations(uuid, uuid) to authenticated;
grant execute on function public.get_tax_summary(uuid, date, date) to authenticated;
grant execute on function public.get_invoice_profit_summary(uuid, uuid) to authenticated;
grant execute on function public.get_invoice_item_profit(uuid, uuid) to authenticated;
grant execute on function public.organization_allow_negative_stock(uuid) to authenticated;
