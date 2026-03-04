-- Owner backup + immutable audit hardening
-- Run after core schema and feature migrations.

create extension if not exists pgcrypto;

-- =====================================================
-- Immutable audit table
-- =====================================================
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid references auth.users(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  happened_at timestamptz not null default now()
);

create index if not exists idx_audit_events_org_happened_at
  on public.audit_events(organization_id, happened_at desc);
create index if not exists idx_audit_events_table_record
  on public.audit_events(table_name, record_id);

alter table public.audit_events enable row level security;

drop policy if exists "audit_events_select_member" on public.audit_events;
create policy "audit_events_select_member"
on public.audit_events for select
to authenticated
using (public.current_user_is_org_member(organization_id));

-- No insert/update/delete policy for authenticated users.
-- Rows are written only via SECURITY DEFINER trigger function.

-- =====================================================
-- Backup snapshot store (owner only)
-- =====================================================
create table if not exists public.organization_backup_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  reason text not null default 'manual',
  schema_version integer not null default 1,
  checksum_sha256 text not null,
  snapshot jsonb not null,
  generated_at timestamptz not null default now()
);

create index if not exists idx_org_backup_runs_org_generated_at
  on public.organization_backup_runs(organization_id, generated_at desc);

alter table public.organization_backup_runs enable row level security;

drop policy if exists "org_backup_runs_owner_select" on public.organization_backup_runs;
create policy "org_backup_runs_owner_select"
on public.organization_backup_runs for select
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "org_backup_runs_owner_insert" on public.organization_backup_runs;
create policy "org_backup_runs_owner_insert"
on public.organization_backup_runs for insert
to authenticated
with check (public.current_user_is_org_owner(organization_id));

-- =====================================================
-- Backup helpers
-- =====================================================
create or replace function public.backup_fetch_org_rows(
  p_table_name text,
  p_org_id uuid,
  p_org_column text default 'organization_id'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if coalesce(trim(p_table_name), '') = '' then
    return '[]'::jsonb;
  end if;

  if to_regclass(format('public.%I', p_table_name)) is null then
    return '[]'::jsonb;
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb)
     from public.%I t
     where t.%I = $1',
    p_table_name,
    p_org_column
  )
  into v_rows
  using p_org_id;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

create or replace function public.backup_fetch_child_rows(
  p_child_table text,
  p_child_fk_column text,
  p_parent_table text,
  p_org_id uuid,
  p_parent_org_column text default 'organization_id'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if coalesce(trim(p_child_table), '') = ''
     or coalesce(trim(p_parent_table), '') = ''
     or coalesce(trim(p_child_fk_column), '') = '' then
    return '[]'::jsonb;
  end if;

  if to_regclass(format('public.%I', p_child_table)) is null
     or to_regclass(format('public.%I', p_parent_table)) is null then
    return '[]'::jsonb;
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(c)), ''[]''::jsonb)
     from public.%I c
     where c.%I in (
       select p.id
       from public.%I p
       where p.%I = $1
     )',
    p_child_table,
    p_child_fk_column,
    p_parent_table,
    p_parent_org_column
  )
  into v_rows
  using p_org_id;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

create or replace function public.export_organization_backup(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org jsonb := '{}'::jsonb;
  v_member_ids uuid[] := '{}'::uuid[];
  v_profiles jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.owner_user_id = v_uid
  ) then
    raise exception 'Only organization owner can export backup';
  end if;

  select coalesce(to_jsonb(o), '{}'::jsonb)
    into v_org
  from public.organizations o
  where o.id = p_organization_id;

  select coalesce(array_agg(m.user_id), '{}'::uuid[])
    into v_member_ids
  from public.organization_members m
  where m.organization_id = p_organization_id;

  if to_regclass('public.profiles') is not null and coalesce(array_length(v_member_ids, 1), 0) > 0 then
    select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
      into v_profiles
    from public.profiles p
    where p.id = any(v_member_ids);
  end if;

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'app', 'BillJoy',
      'schemaVersion', 2,
      'generatedAt', now(),
      'organizationId', p_organization_id,
      'generatedBy', v_uid
    ),
    'organization', v_org,
    'organizationMembers', public.backup_fetch_org_rows('organization_members', p_organization_id),
    'profiles', v_profiles,
    'organizationInviteCodes', public.backup_fetch_org_rows('organization_invite_codes', p_organization_id),
    'organizationTaxProfiles', public.backup_fetch_org_rows('organization_tax_profiles', p_organization_id),
    'organizationDocumentSequences', public.backup_fetch_org_rows('organization_document_sequences', p_organization_id),
    'companySettings', public.backup_fetch_org_rows('company_settings', p_organization_id),
    'parties', public.backup_fetch_org_rows('parties', p_organization_id),
    'categories', public.backup_fetch_org_rows('categories', p_organization_id),
    'items', public.backup_fetch_org_rows('items', p_organization_id),
    'itemBarcodes', public.backup_fetch_org_rows('item_barcodes', p_organization_id),
    'invoices', public.backup_fetch_org_rows('invoices', p_organization_id),
    'invoiceItems', public.backup_fetch_child_rows('invoice_items', 'invoice_id', 'invoices', p_organization_id),
    'creditNotes', public.backup_fetch_org_rows('credit_notes', p_organization_id),
    'creditNoteItems', public.backup_fetch_child_rows('credit_note_items', 'credit_note_id', 'credit_notes', p_organization_id),
    'purchaseBills', public.backup_fetch_org_rows('purchase_bills', p_organization_id),
    'purchaseBillItems', public.backup_fetch_child_rows('purchase_bill_items', 'bill_id', 'purchase_bills', p_organization_id),
    'debitNotes', public.backup_fetch_org_rows('debit_notes', p_organization_id),
    'debitNoteItems', public.backup_fetch_child_rows('debit_note_items', 'debit_note_id', 'debit_notes', p_organization_id),
    'payments', public.backup_fetch_org_rows('payments', p_organization_id),
    'expenses', public.backup_fetch_org_rows('expenses', p_organization_id),
    'expenseCategories', public.backup_fetch_org_rows('expense_categories', p_organization_id),
    'activityLogs', public.backup_fetch_org_rows('activity_logs', p_organization_id),
    'creditMonitorNotifications', public.backup_fetch_org_rows('credit_monitor_notifications', p_organization_id),
    'inventoryNotifications', public.backup_fetch_org_rows('inventory_notifications', p_organization_id),
    'stockBatches', public.backup_fetch_org_rows('stock_batches', p_organization_id),
    'stockBatchAllocations', public.backup_fetch_org_rows('stock_batch_allocations', p_organization_id),
    'stockMovements', public.backup_fetch_org_rows('stock_movements', p_organization_id),
    'taxLedgerEntries', public.backup_fetch_org_rows('tax_ledger_entries', p_organization_id),
    'invoiceProfitSummaries', public.backup_fetch_org_rows('invoice_profit_summaries', p_organization_id),
    'proformaInvoices', public.backup_fetch_org_rows('proforma_invoices', p_organization_id),
    'proformaInvoiceItems', public.backup_fetch_child_rows('proforma_invoice_items', 'proforma_id', 'proforma_invoices', p_organization_id),
    'purchaseProformas', public.backup_fetch_org_rows('purchase_proformas', p_organization_id),
    'purchaseProformaItems', public.backup_fetch_child_rows('purchase_proforma_items', 'proforma_id', 'purchase_proformas', p_organization_id),
    'customerReturns', public.backup_fetch_org_rows('customer_returns', p_organization_id),
    'customerReturnItems', public.backup_fetch_child_rows('customer_return_items', 'customer_return_id', 'customer_returns', p_organization_id),
    'auditEvents', public.backup_fetch_org_rows('audit_events', p_organization_id)
  );
end;
$$;

create or replace function public.create_organization_backup(
  p_organization_id uuid,
  p_reason text default 'manual',
  p_store_snapshot boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_snapshot jsonb;
  v_checksum text;
  v_backup_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_snapshot := public.export_organization_backup(p_organization_id);
  v_checksum := encode(
    extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.organization_backup_runs (
    organization_id,
    created_by,
    reason,
    schema_version,
    checksum_sha256,
    snapshot
  )
  values (
    p_organization_id,
    v_uid,
    coalesce(nullif(trim(p_reason), ''), 'manual'),
    2,
    v_checksum,
    case when p_store_snapshot then v_snapshot else '{}'::jsonb end
  )
  returning id into v_backup_id;

  return jsonb_build_object(
    'backupId', v_backup_id,
    'organizationId', p_organization_id,
    'checksumSha256', v_checksum,
    'generatedAt', now(),
    'snapshot', v_snapshot
  );
end;
$$;

grant execute on function public.export_organization_backup(uuid) to authenticated;
grant execute on function public.create_organization_backup(uuid, text, boolean) to authenticated;

-- =====================================================
-- Audit trigger function + trigger installation
-- =====================================================
create or replace function public.capture_org_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_actor uuid := auth.uid();
  v_record_id text;
begin
  if TG_TABLE_NAME in ('audit_events', 'organization_backup_runs') then
    return coalesce(new, old);
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    begin
      v_org_id := nullif(to_jsonb(new)->>'organization_id', '')::uuid;
    exception when others then
      v_org_id := null;
    end;
  end if;

  if v_org_id is null and TG_OP in ('UPDATE', 'DELETE') then
    begin
      v_org_id := nullif(to_jsonb(old)->>'organization_id', '')::uuid;
    exception when others then
      v_org_id := null;
    end;
  end if;

  if v_org_id is null and TG_TABLE_NAME = 'invoice_items' then
    select i.organization_id
      into v_org_id
    from public.invoices i
    where i.id = coalesce(new.invoice_id, old.invoice_id);
  elsif v_org_id is null and TG_TABLE_NAME = 'organizations' then
    v_org_id := coalesce(new.id, old.id);
  elsif v_org_id is null and TG_TABLE_NAME = 'credit_note_items' then
    select n.organization_id
      into v_org_id
    from public.credit_notes n
    where n.id = coalesce(new.credit_note_id, old.credit_note_id);
  elsif v_org_id is null and TG_TABLE_NAME = 'purchase_bill_items' then
    select b.organization_id
      into v_org_id
    from public.purchase_bills b
    where b.id = coalesce(new.bill_id, old.bill_id);
  elsif v_org_id is null and TG_TABLE_NAME = 'debit_note_items' then
    select n.organization_id
      into v_org_id
    from public.debit_notes n
    where n.id = coalesce(new.debit_note_id, old.debit_note_id);
  elsif v_org_id is null and TG_TABLE_NAME = 'proforma_invoice_items' then
    select p.organization_id
      into v_org_id
    from public.proforma_invoices p
    where p.id = coalesce(new.proforma_id, old.proforma_id);
  elsif v_org_id is null and TG_TABLE_NAME = 'purchase_proforma_items' then
    select p.organization_id
      into v_org_id
    from public.purchase_proformas p
    where p.id = coalesce(new.proforma_id, old.proforma_id);
  elsif v_org_id is null and TG_TABLE_NAME = 'customer_return_items' then
    select r.organization_id
      into v_org_id
    from public.customer_returns r
    where r.id = coalesce(new.customer_return_id, old.customer_return_id);
  end if;

  if v_org_id is null then
    return coalesce(new, old);
  end if;

  if TG_OP = 'INSERT' then
    v_record_id := coalesce(nullif(to_jsonb(new)->>'id', ''), '');
  elsif TG_OP = 'DELETE' then
    v_record_id := coalesce(nullif(to_jsonb(old)->>'id', ''), '');
  else
    v_record_id := coalesce(
      nullif(to_jsonb(new)->>'id', ''),
      nullif(to_jsonb(old)->>'id', ''),
      ''
    );
  end if;

  insert into public.audit_events (
    organization_id,
    table_name,
    record_id,
    action,
    actor_user_id,
    before_data,
    after_data
  )
  values (
    v_org_id,
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_actor,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'organizations',
    'organization_members',
    'organization_invite_codes',
    'organization_tax_profiles',
    'organization_document_sequences',
    'company_settings',
    'parties',
    'categories',
    'items',
    'item_barcodes',
    'invoices',
    'invoice_items',
    'credit_notes',
    'credit_note_items',
    'purchase_bills',
    'purchase_bill_items',
    'debit_notes',
    'debit_note_items',
    'payments',
    'expenses',
    'expense_categories',
    'activity_logs',
    'credit_monitor_notifications',
    'inventory_notifications',
    'stock_batches',
    'stock_batch_allocations',
    'stock_movements',
    'tax_ledger_entries',
    'invoice_profit_summaries',
    'proforma_invoices',
    'proforma_invoice_items',
    'purchase_proformas',
    'purchase_proforma_items',
    'customer_returns',
    'customer_return_items'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    execute format('drop trigger if exists trg_audit_%I on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_audit_%I
       after insert or update or delete on public.%I
       for each row execute function public.capture_org_audit_event()',
      v_table,
      v_table
    );
  end loop;
end $$;

-- =====================================================
-- RLS delete hardening (owner only on critical tables)
-- =====================================================
drop policy if exists "parties_member_access" on public.parties;
create policy "parties_select_member"
on public.parties for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "parties_insert_member"
on public.parties for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "parties_update_member"
on public.parties for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "parties_delete_owner"
on public.parties for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "items_member_access" on public.items;
create policy "items_select_member"
on public.items for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "items_insert_member"
on public.items for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "items_update_member"
on public.items for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "items_delete_owner"
on public.items for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "invoices_member_access" on public.invoices;
create policy "invoices_select_member"
on public.invoices for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "invoices_insert_member"
on public.invoices for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "invoices_update_member"
on public.invoices for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "invoices_delete_owner"
on public.invoices for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "credit_notes_member_access" on public.credit_notes;
create policy "credit_notes_select_member"
on public.credit_notes for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "credit_notes_insert_member"
on public.credit_notes for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "credit_notes_update_member"
on public.credit_notes for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "credit_notes_delete_owner"
on public.credit_notes for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "purchase_bills_member_access" on public.purchase_bills;
create policy "purchase_bills_select_member"
on public.purchase_bills for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "purchase_bills_insert_member"
on public.purchase_bills for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "purchase_bills_update_member"
on public.purchase_bills for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "purchase_bills_delete_owner"
on public.purchase_bills for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "debit_notes_member_access" on public.debit_notes;
create policy "debit_notes_select_member"
on public.debit_notes for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "debit_notes_insert_member"
on public.debit_notes for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "debit_notes_update_member"
on public.debit_notes for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "debit_notes_delete_owner"
on public.debit_notes for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "payments_member_access" on public.payments;
create policy "payments_select_member"
on public.payments for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "payments_insert_member"
on public.payments for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "payments_update_member"
on public.payments for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "payments_delete_owner"
on public.payments for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));

drop policy if exists "expenses_member_access" on public.expenses;
create policy "expenses_select_member"
on public.expenses for select
to authenticated
using (public.current_user_is_org_member(organization_id));
create policy "expenses_insert_member"
on public.expenses for insert
to authenticated
with check (public.current_user_is_org_member(organization_id));
create policy "expenses_update_member"
on public.expenses for update
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));
create policy "expenses_delete_owner"
on public.expenses for delete
to authenticated
using (public.current_user_is_org_owner(organization_id));
