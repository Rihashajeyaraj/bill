create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'proforma_status'
  ) then
    create type public.proforma_status as enum (
      'DRAFT',
      'SENT',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'CONVERTED'
    );
  end if;
end
$$;

alter table if exists public.organization_document_sequences
  add column if not exists sales_proforma_prefix text not null default 'PI',
  add column if not exists sales_proforma_next_no bigint not null default 1,
  add column if not exists purchase_proforma_prefix text not null default 'PPI',
  add column if not exists purchase_proforma_next_no bigint not null default 1;

create table if not exists public.proforma_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proforma_no text not null,
  proforma_date date not null,
  valid_till date,
  due_date date,
  party_id uuid references public.parties(id) on delete set null,
  place_of_supply_state text,
  currency_code text not null default 'INR',
  exchange_rate numeric(14,6) not null default 1,
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  taxable_total numeric(14,2) not null default 0,
  cgst_total numeric(14,2) not null default 0,
  sgst_total numeric(14,2) not null default 0,
  igst_total numeric(14,2) not null default 0,
  cess_total numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  round_off numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  status public.proforma_status not null default 'DRAFT',
  notes text,
  terms text,
  metadata jsonb not null default '{}'::jsonb,
  converted_document_id uuid references public.invoices(id) on delete set null,
  converted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, proforma_no)
);

alter table if exists public.proforma_invoices
  add column if not exists status public.proforma_status not null default 'DRAFT';

create index if not exists idx_proforma_invoices_org_id
  on public.proforma_invoices(organization_id);
create index if not exists idx_proforma_invoices_party_id
  on public.proforma_invoices(party_id);
create index if not exists idx_proforma_invoices_date
  on public.proforma_invoices(proforma_date);
create index if not exists idx_proforma_invoices_status
  on public.proforma_invoices(organization_id, status);

drop trigger if exists trg_proforma_invoices_updated_at on public.proforma_invoices;
create trigger trg_proforma_invoices_updated_at
before update on public.proforma_invoices
for each row execute procedure public.set_updated_at();

create table if not exists public.proforma_invoice_items (
  id uuid primary key default gen_random_uuid(),
  proforma_id uuid not null references public.proforma_invoices(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  line_no integer not null default 1,
  description text not null,
  hsn_sac text,
  qty numeric(14,3) not null default 0,
  unit text,
  unit_price numeric(14,2) not null default 0,
  discount_percent numeric(6,3) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  cgst_amount numeric(14,2) not null default 0,
  sgst_amount numeric(14,2) not null default 0,
  igst_amount numeric(14,2) not null default 0,
  cess_amount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0
);

create index if not exists idx_proforma_invoice_items_proforma_id
  on public.proforma_invoice_items(proforma_id);

create table if not exists public.purchase_proformas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proforma_no text not null,
  proforma_date date not null,
  valid_till date,
  due_date date,
  supplier_id uuid references public.parties(id) on delete set null,
  subtotal numeric(14,2) not null default 0,
  taxable_total numeric(14,2) not null default 0,
  cgst_total numeric(14,2) not null default 0,
  sgst_total numeric(14,2) not null default 0,
  igst_total numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  status public.proforma_status not null default 'DRAFT',
  metadata jsonb not null default '{}'::jsonb,
  converted_document_id uuid references public.purchase_bills(id) on delete set null,
  converted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, proforma_no)
);

alter table if exists public.purchase_proformas
  add column if not exists status public.proforma_status not null default 'DRAFT';

create index if not exists idx_purchase_proformas_org_id
  on public.purchase_proformas(organization_id);
create index if not exists idx_purchase_proformas_supplier_id
  on public.purchase_proformas(supplier_id);
create index if not exists idx_purchase_proformas_date
  on public.purchase_proformas(proforma_date);
create index if not exists idx_purchase_proformas_status
  on public.purchase_proformas(organization_id, status);

drop trigger if exists trg_purchase_proformas_updated_at on public.purchase_proformas;
create trigger trg_purchase_proformas_updated_at
before update on public.purchase_proformas
for each row execute procedure public.set_updated_at();

create table if not exists public.purchase_proforma_items (
  id uuid primary key default gen_random_uuid(),
  proforma_id uuid not null references public.purchase_proformas(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  line_no integer not null default 1,
  item_code text,
  description text not null,
  qty numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  tax_inclusive boolean not null default false,
  cgst_amount numeric(14,2) not null default 0,
  sgst_amount numeric(14,2) not null default 0,
  igst_amount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0
);

alter table if exists public.purchase_proforma_items
  add column if not exists line_no integer not null default 1;

create index if not exists idx_purchase_proforma_items_proforma_id
  on public.purchase_proforma_items(proforma_id);

create or replace function public.apply_proforma_expiry_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'CONVERTED' and new.converted_document_id is null then
    raise exception 'converted_document_id is required when status is CONVERTED';
  end if;

  if new.status in ('DRAFT', 'SENT', 'APPROVED')
     and new.valid_till is not null
     and new.valid_till < current_date then
    new.status := 'EXPIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proforma_invoices_expiry_status on public.proforma_invoices;
create trigger trg_proforma_invoices_expiry_status
before insert or update of valid_till, status, converted_document_id
on public.proforma_invoices
for each row execute procedure public.apply_proforma_expiry_status();

drop trigger if exists trg_purchase_proformas_expiry_status on public.purchase_proformas;
create trigger trg_purchase_proformas_expiry_status
before insert or update of valid_till, status, converted_document_id
on public.purchase_proformas
for each row execute procedure public.apply_proforma_expiry_status();

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
    and status in ('DRAFT', 'SENT', 'APPROVED')
    and valid_till is not null
    and valid_till < current_date;
  get diagnostics v_sales_updated = row_count;

  update public.purchase_proformas
  set status = 'EXPIRED',
      updated_at = now()
  where organization_id = p_organization_id
    and status in ('DRAFT', 'SENT', 'APPROVED')
    and valid_till is not null
    and valid_till < current_date;
  get diagnostics v_purchase_updated = row_count;

  return jsonb_build_object(
    'sales_updated', v_sales_updated,
    'purchase_updated', v_purchase_updated
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

create or replace function public.format_org_document_number(
  p_prefix text,
  p_counter bigint,
  p_document_date date default current_date,
  p_padding integer default 4
)
returns text
language plpgsql
stable
as $$
declare
  v_prefix text := trim(coalesce(p_prefix, 'DOC'));
  v_counter bigint := greatest(coalesce(p_counter, 1), 1);
  v_date date := coalesce(p_document_date, current_date);
  v_padding integer := greatest(coalesce(p_padding, 4), 1);
begin
  if v_prefix = '' then
    v_prefix := 'DOC';
  end if;

  return format(
    '%s-%s-%s',
    v_prefix,
    extract(year from v_date)::integer,
    lpad(v_counter::text, v_padding, '0')
  );
end;
$$;

create or replace function public.peek_sales_proforma_no(
  p_organization_id uuid,
  p_proforma_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := 'PI';
  v_next bigint := 1;
begin
  if p_organization_id is null then
    return public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    return public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.sales_proforma_prefix, s.sales_proforma_next_no
    into v_prefix, v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id;

  return public.format_org_document_number(coalesce(nullif(trim(v_prefix), ''), 'PI'), coalesce(v_next, 1), p_proforma_date, 4);
exception
  when others then
    return public.format_org_document_number('PI', 1, p_proforma_date, 4);
end;
$$;

create or replace function public.peek_purchase_proforma_no(
  p_organization_id uuid,
  p_proforma_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next bigint;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.purchase_proforma_prefix, s.purchase_proforma_next_no
    into v_prefix, v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id;

  return public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);
end;
$$;

create or replace function public.allocate_sales_proforma_no(
  p_organization_id uuid,
  p_proforma_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next bigint;
  v_doc_no text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.sales_proforma_prefix, s.sales_proforma_next_no
    into v_prefix, v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id
  for update;

  v_doc_no := public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);

  update public.organization_document_sequences
  set sales_proforma_next_no = greatest(coalesce(v_next, 1) + 1, 1),
      updated_at = now()
  where organization_id = p_organization_id;

  return v_doc_no;
end;
$$;

create or replace function public.allocate_purchase_proforma_no(
  p_organization_id uuid,
  p_proforma_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next bigint;
  v_doc_no text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.purchase_proforma_prefix, s.purchase_proforma_next_no
    into v_prefix, v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id
  for update;

  v_doc_no := public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);

  update public.organization_document_sequences
  set purchase_proforma_next_no = greatest(coalesce(v_next, 1) + 1, 1),
      updated_at = now()
  where organization_id = p_organization_id;

  return v_doc_no;
end;
$$;

create or replace function public.allocate_invoice_no_for_conversion(
  p_organization_id uuid,
  p_invoice_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_doc_no text;
  v_year text := extract(year from coalesce(p_invoice_date, current_date))::integer::text;
  v_last_used bigint := 0;
  v_effective_next bigint := 1;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.invoice_next_no
    into v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id
  for update;

  select coalesce(
    max(
      case
        when substring(i.invoice_no from '([0-9]+)$') ~ '^[0-9]+$'
          then substring(i.invoice_no from '([0-9]+)$')::bigint
        else null
      end
    ),
    0
  )
    into v_last_used
  from public.invoices i
  where i.organization_id = p_organization_id
    and i.invoice_no ~ ('^INV-' || v_year || '-[0-9]+$');

  v_effective_next := greatest(coalesce(v_next, 1), v_last_used + 1, 1);
  v_doc_no := public.format_org_document_number('INV', v_effective_next, p_invoice_date, 4);

  update public.organization_document_sequences
  set invoice_prefix = 'INV',
      invoice_next_no = v_effective_next + 1,
      updated_at = now()
  where organization_id = p_organization_id;

  return v_doc_no;
end;
$$;

create or replace function public.allocate_purchase_bill_no_for_conversion(
  p_organization_id uuid,
  p_bill_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next bigint;
  v_doc_no text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    raise exception 'Access denied for organization %', p_organization_id;
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.purchase_prefix, s.purchase_next_no
    into v_prefix, v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id
  for update;

  v_doc_no := public.format_org_document_number(v_prefix, v_next, p_bill_date, 4);

  update public.organization_document_sequences
  set purchase_next_no = greatest(coalesce(v_next, 1) + 1, 1),
      updated_at = now()
  where organization_id = p_organization_id;

  return v_doc_no;
end;
$$;

create or replace function public.convert_sales_proforma_to_invoice(
  p_proforma_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_header public.proforma_invoices%rowtype;
  v_payload jsonb;
  v_lines jsonb;
  v_result jsonb;
  v_invoice_id uuid;
  v_invoice_no text;
begin
  if p_proforma_id is null then
    raise exception 'proforma_id is required';
  end if;

  select *
    into v_header
  from public.proforma_invoices
  where id = p_proforma_id
  for update;

  if not found then
    raise exception 'Sales proforma not found: %', p_proforma_id;
  end if;

  if not public.current_user_is_org_member(v_header.organization_id) then
    raise exception 'Access denied for organization %', v_header.organization_id;
  end if;

  perform public.refresh_proforma_expiry_status(v_header.organization_id);

  select *
    into v_header
  from public.proforma_invoices
  where id = p_proforma_id
  for update;

  if v_header.status = 'CONVERTED' then
    raise exception 'Sales proforma already converted';
  end if;

  if v_header.status = 'EXPIRED'
     or (v_header.valid_till is not null and v_header.valid_till < current_date) then
    raise exception 'Cannot convert expired sales proforma';
  end if;

  v_invoice_no := public.allocate_invoice_no_for_conversion(v_header.organization_id, v_header.proforma_date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_no', i.line_no,
        'item_id', i.item_id,
        'manual_batch_id', null,
        'taxInclusive', false,
        'priceTaxMode', 'WITHOUT_TAX',
        'description', i.description,
        'hsn', i.hsn_sac,
        'qty', i.qty,
        'unit', i.unit,
        'rate', i.unit_price,
        'discount', i.discount_amount,
        'discountPercent', i.discount_percent,
        'tax', i.tax_rate,
        'taxableAmount', i.taxable_amount,
        'cgstAmount', i.cgst_amount,
        'sgstAmount', i.sgst_amount,
        'igstAmount', i.igst_amount,
        'vatAmount', i.vat_amount,
        'cessAmount', i.cess_amount
      )
      order by i.line_no, i.id
    ),
    '[]'::jsonb
  )
    into v_lines
  from public.proforma_invoice_items i
  where i.proforma_id = v_header.id;

  v_payload := jsonb_build_object(
    'organization_id', v_header.organization_id,
    'invoice_no', v_invoice_no,
    'invoice_date', v_header.proforma_date,
    'due_date', coalesce(v_header.due_date, v_header.valid_till, v_header.proforma_date),
    'party_id', v_header.party_id,
    'place_of_supply_state', v_header.place_of_supply_state,
    'currency_code', v_header.currency_code,
    'country', coalesce(v_header.metadata->>'country', ''),
    'tax_mode', coalesce(v_header.metadata->>'taxMode', ''),
    'supply_type', coalesce(v_header.metadata->>'supplyType', ''),
    'party_name', coalesce(v_header.metadata->>'partyName', ''),
    'created_by_name', coalesce(v_header.metadata->>'createdByName', ''),
    'round_off', coalesce(v_header.round_off, 0),
    'lines', v_lines
  );

  execute 'select public.post_invoice_fifo($1)'
    into v_result
    using v_payload;

  v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
  if v_invoice_id is null then
    raise exception 'Invoice conversion failed for proforma %', p_proforma_id;
  end if;

  update public.proforma_invoices
  set status = 'CONVERTED',
      converted_document_id = v_invoice_id,
      converted_at = now(),
      updated_at = now()
  where id = v_header.id;

  return jsonb_build_object(
    'proforma_id', v_header.id,
    'invoice_id', v_invoice_id,
    'invoice_no', coalesce(v_result->>'invoice_no', v_invoice_no)
  );
end;
$$;

create or replace function public.convert_purchase_proforma_to_bill(
  p_proforma_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_header public.purchase_proformas%rowtype;
  v_payload jsonb;
  v_lines jsonb;
  v_result jsonb;
  v_bill_id uuid;
  v_bill_no text;
begin
  if p_proforma_id is null then
    raise exception 'proforma_id is required';
  end if;

  select *
    into v_header
  from public.purchase_proformas
  where id = p_proforma_id
  for update;

  if not found then
    raise exception 'Purchase proforma not found: %', p_proforma_id;
  end if;

  if not public.current_user_is_org_member(v_header.organization_id) then
    raise exception 'Access denied for organization %', v_header.organization_id;
  end if;

  perform public.refresh_proforma_expiry_status(v_header.organization_id);

  select *
    into v_header
  from public.purchase_proformas
  where id = p_proforma_id
  for update;

  if v_header.status = 'CONVERTED' then
    raise exception 'Purchase proforma already converted';
  end if;

  if v_header.status = 'EXPIRED'
     or (v_header.valid_till is not null and v_header.valid_till < current_date) then
    raise exception 'Cannot convert expired purchase proforma';
  end if;

  v_bill_no := public.allocate_purchase_bill_no_for_conversion(v_header.organization_id, v_header.proforma_date);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_no', i.line_no,
        'item_id', i.item_id,
        'item_code', i.item_code,
        'item_name', i.description,
        'description', i.description,
        'qty', i.qty,
        'rate', i.unit_price,
        'tax', i.tax_rate,
        'taxInclusive', i.tax_inclusive,
        'priceTaxMode', case when i.tax_inclusive then 'WITH_TAX' else 'WITHOUT_TAX' end,
        'suggested_sale_rate', 0
      )
      order by i.line_no, i.id
    ),
    '[]'::jsonb
  )
    into v_lines
  from public.purchase_proforma_items i
  where i.proforma_id = v_header.id;

  v_payload := jsonb_build_object(
    'organization_id', v_header.organization_id,
    'bill_no', v_bill_no,
    'bill_date', v_header.proforma_date,
    'due_date', coalesce(v_header.due_date, v_header.valid_till, v_header.proforma_date),
    'supplier_id', v_header.supplier_id,
    'country', coalesce(v_header.metadata->>'country', ''),
    'party_name', coalesce(v_header.metadata->>'partyName', ''),
    'party_address', coalesce(v_header.metadata->>'partyAddress', ''),
    'phone', coalesce(v_header.metadata->>'phone', ''),
    'payment_type', coalesce(v_header.metadata->>'paymentType', ''),
    'tax_mode', coalesce(v_header.metadata->>'taxMode', ''),
    'supply_type', coalesce(v_header.metadata->>'supplyType', ''),
    'created_by_name', coalesce(v_header.metadata->>'createdByName', ''),
    'lines', v_lines
  );

  execute 'select public.post_purchase_bill_fifo($1)'
    into v_result
    using v_payload;

  v_bill_id := nullif(v_result->>'bill_id', '')::uuid;
  if v_bill_id is null then
    raise exception 'Purchase conversion failed for proforma %', p_proforma_id;
  end if;

  update public.purchase_proformas
  set status = 'CONVERTED',
      converted_document_id = v_bill_id,
      converted_at = now(),
      updated_at = now()
  where id = v_header.id;

  return jsonb_build_object(
    'proforma_id', v_header.id,
    'bill_id', v_bill_id,
    'bill_no', coalesce(v_result->>'bill_no', v_bill_no)
  );
end;
$$;

alter table public.proforma_invoices enable row level security;
alter table public.proforma_invoice_items enable row level security;
alter table public.purchase_proformas enable row level security;
alter table public.purchase_proforma_items enable row level security;

drop policy if exists "proforma_invoices_member_access" on public.proforma_invoices;
create policy "proforma_invoices_member_access"
on public.proforma_invoices for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

drop policy if exists "proforma_invoice_items_member_access" on public.proforma_invoice_items;
create policy "proforma_invoice_items_member_access"
on public.proforma_invoice_items for all
to authenticated
using (
  exists (
    select 1
    from public.proforma_invoices p
    where p.id = proforma_invoice_items.proforma_id
      and public.current_user_is_org_member(p.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.proforma_invoices p
    where p.id = proforma_invoice_items.proforma_id
      and public.current_user_is_org_member(p.organization_id)
  )
);

drop policy if exists "purchase_proformas_member_access" on public.purchase_proformas;
create policy "purchase_proformas_member_access"
on public.purchase_proformas for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

drop policy if exists "purchase_proforma_items_member_access" on public.purchase_proforma_items;
create policy "purchase_proforma_items_member_access"
on public.purchase_proforma_items for all
to authenticated
using (
  exists (
    select 1
    from public.purchase_proformas p
    where p.id = purchase_proforma_items.proforma_id
      and public.current_user_is_org_member(p.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.purchase_proformas p
    where p.id = purchase_proforma_items.proforma_id
      and public.current_user_is_org_member(p.organization_id)
  )
);

grant execute on function public.refresh_proforma_expiry_status(uuid) to authenticated;
grant execute on function public.refresh_proforma_expiry_status() to anon, authenticated;
grant execute on function public.peek_sales_proforma_no(uuid, date) to anon, authenticated;
grant execute on function public.peek_purchase_proforma_no(uuid, date) to authenticated;
grant execute on function public.allocate_sales_proforma_no(uuid, date) to authenticated;
grant execute on function public.allocate_purchase_proforma_no(uuid, date) to authenticated;
grant execute on function public.allocate_invoice_no_for_conversion(uuid, date) to authenticated;
grant execute on function public.allocate_purchase_bill_no_for_conversion(uuid, date) to authenticated;
grant execute on function public.convert_sales_proforma_to_invoice(uuid) to authenticated;
grant execute on function public.convert_purchase_proforma_to_bill(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
select pg_notify('pgrst', 'reload config');
