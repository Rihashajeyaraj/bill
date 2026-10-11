-- Supabase Migration: Idempotent Lossless Sales Proforma to Tax Invoice Conversion
begin;

-- 1. Counter table for sequential Tax Invoice numbers per organization and Indian FY
create table if not exists public.tax_invoice_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_year text not null,
  next_val bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, financial_year)
);

-- Unique index on invoices to guarantee tenant isolation and sequential integrity
create unique index if not exists idx_invoices_org_invoice_no
  on public.invoices (organization_id, invoice_no);

-- 2. Sequential Tax Invoice Number Allocator
create or replace function public.allocate_tax_invoice_no(
  p_organization_id uuid,
  p_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_date date := coalesce(p_date, current_date);
  v_year int;
  v_month int;
  v_start_yr int;
  v_end_yr int;
  v_fy text;
  v_counter bigint;
  v_max_existing bigint;
begin
  v_year := extract(year from v_effective_date)::int;
  v_month := extract(month from v_effective_date)::int;

  -- Indian Financial Year runs from April 1 to March 31
  if v_month >= 4 then
    v_start_yr := v_year;
    v_end_yr := v_year + 1;
  else
    v_start_yr := v_year - 1;
    v_end_yr := v_year;
  end if;

  v_fy := lpad((v_start_yr % 100)::text, 2, '0') || lpad((v_end_yr % 100)::text, 2, '0');

  -- Ensure counter exists, safely seeded from existing invoices to prevent collisions
  if not exists (
    select 1 from public.tax_invoice_counters
    where organization_id = p_organization_id and financial_year = v_fy
  ) then
    select coalesce(max(
      substring(invoice_no from 'INV-' || v_fy || '-([0-9]+)')::bigint
    ), 0)
    into v_max_existing
    from public.invoices
    where organization_id = p_organization_id
      and invoice_no ~ ('^INV-' || v_fy || '-[0-9]+$');

    insert into public.tax_invoice_counters (organization_id, financial_year, next_val)
    values (p_organization_id, v_fy, v_max_existing + 1)
    on conflict (organization_id, financial_year) do nothing;
  end if;

  -- Atomic increment with SELECT FOR UPDATE inside the caller's transaction
  select next_val
  into v_counter
  from public.tax_invoice_counters
  where organization_id = p_organization_id and financial_year = v_fy
  for update;

  update public.tax_invoice_counters
  set next_val = v_counter + 1,
      updated_at = now()
  where organization_id = p_organization_id and financial_year = v_fy;

  return 'INV-' || v_fy || '-' || lpad(v_counter::text, 4, '0');
end;
$$;

-- 3. Lossless Generic Conversion Procedure
create or replace function public.convert_sales_proforma_to_invoice(
  p_proforma_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- DATE RULE: Define date copying rule in ONE variable at the top
  c_copy_proforma_dates constant boolean := true;

  v_caller uuid := auth.uid();
  v_proforma public.proforma_invoices%rowtype;
  v_new_invoice_id uuid := gen_random_uuid();
  v_tax_invoice_no text;
  v_target_invoice_date date;
  v_target_due_date date;

  v_shared_header_cols text[];
  v_shared_item_cols text[];
  v_cols_str text;
  v_item_cols_str text;
  v_sql text;
  v_item_sql text;

  -- Verification variables
  v_pf_count bigint;
  v_inv_count bigint;
  v_pf_json jsonb;
  v_inv_json jsonb;
  v_col text;
  v_inv_items_sum numeric;
  v_inv_grand_total numeric;
begin
  -- 1. Fetch & lock proforma row FOR UPDATE
  select *
  into v_proforma
  from public.proforma_invoices
  where id = p_proforma_id
  for update;

  if not found then
    raise exception 'Sales proforma % not found', p_proforma_id
      using errcode = 'P0404';
  end if;

  -- 2. Authorization check: caller must be an active member of the proforma organization
  if v_caller is not null then
    if not exists (
      select 1 from public.organization_members om
      where om.organization_id = v_proforma.organization_id
        and om.user_id = v_caller
        and om.status = 'active'
    ) then
      raise exception 'User % is forbidden from converting proforma for organization %', v_caller, v_proforma.organization_id
        using errcode = 'P0403';
    end if;
  end if;

  -- 3. Check conversion & cancellation states
  if v_proforma.converted_document_id is not null or lower(coalesce(v_proforma.status::text, '')) = 'converted' then
    raise exception 'Proforma % is already converted', v_proforma.proforma_no
      using errcode = 'P0409';
  end if;

  if lower(coalesce(v_proforma.status::text, '')) in ('cancelled', 'rejected') then
    raise exception 'Cannot convert cancelled or rejected proforma %', v_proforma.proforma_no
      using errcode = 'P0410';
  end if;

  -- 4. Apply Date Rule
  if c_copy_proforma_dates then
    v_target_invoice_date := v_proforma.proforma_date;
    v_target_due_date := v_proforma.due_date;
  else
    v_target_invoice_date := current_date;
    v_target_due_date := current_date + interval '30 days';
  end if;

  -- 5. Allocate Sequential Tax Invoice Number
  v_tax_invoice_no := public.allocate_tax_invoice_no(v_proforma.organization_id, v_target_invoice_date);

  -- 6. Generic Dynamic Header Insert from information_schema.columns
  select array_agg(quote_ident(c1.column_name::text) order by c1.column_name)
  into v_shared_header_cols
  from information_schema.columns c1
  join information_schema.columns c2
    on c1.column_name = c2.column_name
    and c1.table_schema = 'public' and c1.table_name = 'invoices'
    and c2.table_schema = 'public' and c2.table_name = 'proforma_invoices'
  where c1.column_name not in (
    'id', 'proforma_no', 'invoice_no', 'status', 'created_at', 'updated_at',
    'converted_document_id', 'converted_at', 'created_by', 'document_type',
    'source_proforma_id', 'source_proforma_no', 'source_proforma_date',
    'invoice_date', 'due_date'
  );

  v_cols_str := array_to_string(v_shared_header_cols, ', ');

  v_sql := format(
    'insert into public.invoices (' ||
    '  id, invoice_no, invoice_date, due_date, status, document_type, ' ||
    '  source_proforma_id, source_proforma_no, source_proforma_date, created_by, created_at, updated_at, %s' ||
    ') select ' ||
    '  $1, $2, $3, $4, ''issued'', ''TAX_INVOICE'', ' ||
    '  $5, $6, $7, $8, now(), now(), %s ' ||
    'from public.proforma_invoices where id = $5',
    v_cols_str,
    v_cols_str
  );

  execute v_sql using
    v_new_invoice_id,
    v_tax_invoice_no,
    v_target_invoice_date,
    v_target_due_date,
    v_proforma.id,
    v_proforma.proforma_no,
    v_proforma.proforma_date,
    coalesce(v_caller, v_proforma.created_by);

  -- 7. Generic Dynamic Line Items Insert from information_schema.columns
  select array_agg(quote_ident(c1.column_name::text) order by c1.column_name)
  into v_shared_item_cols
  from information_schema.columns c1
  join information_schema.columns c2
    on c1.column_name = c2.column_name
    and c1.table_schema = 'public' and c1.table_name = 'invoice_items'
    and c2.table_schema = 'public' and c2.table_name = 'proforma_invoice_items'
  where c1.column_name not in ('id', 'invoice_id', 'proforma_id', 'created_at', 'updated_at');

  v_item_cols_str := array_to_string(v_shared_item_cols, ', ');

  v_item_sql := format(
    'insert into public.invoice_items (id, invoice_id, %s) ' ||
    'select gen_random_uuid(), $1, %s ' ||
    'from public.proforma_invoice_items where proforma_id = $2 order by line_no asc',
    v_item_cols_str,
    v_item_cols_str
  );

  execute v_item_sql using v_new_invoice_id, v_proforma.id;

  -- 8. Stored Rows Verification (from stored rows, not memory variables)
  -- A. Item counts must match exactly
  select count(*) into v_pf_count from public.proforma_invoice_items where proforma_id = v_proforma.id;
  select count(*) into v_inv_count from public.invoice_items where invoice_id = v_new_invoice_id;
  if v_pf_count <> v_inv_count then
    raise exception 'Verification failure: item count mismatch (expected %, created %)', v_pf_count, v_inv_count;
  end if;

  -- B. Header shared columns must match exactly
  select to_jsonb(p) into v_pf_json from public.proforma_invoices p where p.id = v_proforma.id;
  select to_jsonb(i) into v_inv_json from public.invoices i where i.id = v_new_invoice_id;

  foreach v_col in array v_shared_header_cols loop
    -- Trim quotes if added by quote_ident
    v_col := trim(both '"' from v_col);
    if (v_pf_json->v_col) is distinct from (v_inv_json->v_col) then
      raise exception 'Verification failure: column % mismatch between proforma and invoice (% vs %)',
        v_col, v_pf_json->v_col, v_inv_json->v_col;
    end if;
  end loop;

  -- C. Line totals sum must match stored grand_total within 0.005
  select coalesce(sum(line_total), 0) into v_inv_items_sum
  from public.invoice_items
  where invoice_id = v_new_invoice_id;

  select grand_total into v_inv_grand_total
  from public.invoices
  where id = v_new_invoice_id;

  if abs(v_inv_items_sum - coalesce(v_inv_grand_total, 0)) > 0.005 then
    raise exception 'Verification failure: items sum (%) differs from invoice grand_total (%) by > 0.005',
      v_inv_items_sum, v_inv_grand_total;
  end if;

  -- 9. Update Proforma Status & Audit Logs
  update public.proforma_invoices
  set status = 'CONVERTED',
      converted_document_id = v_new_invoice_id,
      converted_at = now(),
      updated_at = now()
  where id = v_proforma.id;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'audit_logs'
  ) then
    insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, details, created_at)
    values (
      v_proforma.organization_id,
      v_caller,
      'CONVERT_PROFORMA',
      'proforma_invoices',
      v_proforma.id,
      jsonb_build_object(
        'invoice_id', v_new_invoice_id,
        'invoice_no', v_tax_invoice_no,
        'proforma_id', v_proforma.id,
        'proforma_no', v_proforma.proforma_no
      ),
      now()
    );
  end if;

  return jsonb_build_object(
    'invoice_id', v_new_invoice_id,
    'invoice_no', v_tax_invoice_no,
    'proforma_id', v_proforma.id,
    'proforma_no', v_proforma.proforma_no
  );
end;
$$;

-- Permissions
grant execute on function public.allocate_tax_invoice_no(uuid, date) to authenticated, service_role;
grant execute on function public.convert_sales_proforma_to_invoice(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
