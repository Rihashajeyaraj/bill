-- Supabase schema for BillJoy (India-first billing + multi-country tax)
-- Run this SQL in Supabase SQL Editor (single run).

create extension if not exists pgcrypto;

-- =========================
-- Enums
-- =========================
create type public.organization_role as enum ('owner', 'accounter', 'staff');
create type public.member_status as enum ('active', 'inactive');
create type public.tax_regime as enum ('gst', 'vat', 'sales_tax', 'none');
create type public.party_type as enum ('customer', 'supplier', 'both');
create type public.item_type as enum ('product', 'service');
create type public.document_status as enum ('draft', 'issued', 'partial', 'paid', 'cancelled');
create type public.note_status as enum ('draft', 'issued', 'applied', 'cancelled');
create type public.payment_direction as enum ('in', 'out');
create type public.entry_status as enum ('draft', 'posted', 'cancelled');

-- =========================
-- Utility function + trigger
-- =========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- Identity + Organization
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  company_name text not null,
  logo_base64 text,
  country_code text not null default 'IN',
  state_name text,
  city text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  phone text,
  email text,
  gstin text,
  pan text,
  cin text,
  tax_regime public.tax_regime not null default 'gst',
  base_currency text not null default 'INR',
  financial_year_start_month smallint not null default 4 check (financial_year_start_month between 1 and 12),
  is_setup_completed boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_organizations_owner_user_id on public.organizations(owner_user_id);
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null,
  status public.member_status not null default 'active',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists idx_org_members_user_id on public.organization_members(user_id);
create index if not exists idx_org_members_organization_id on public.organization_members(organization_id);
create trigger trg_organization_members_updated_at
before update on public.organization_members
for each row execute procedure public.set_updated_at();

create table if not exists public.organization_invite_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null unique,
  target_role public.organization_role not null,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  max_uses integer not null default 10 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_invite_codes_org_id on public.organization_invite_codes(organization_id);
create index if not exists idx_invite_codes_code on public.organization_invite_codes(code);
create trigger trg_organization_invite_codes_updated_at
before update on public.organization_invite_codes
for each row execute procedure public.set_updated_at();

create table if not exists public.organization_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  country_code text not null default 'IN',
  tax_regime public.tax_regime not null default 'gst',
  is_gst_registered boolean not null default false,
  gstin text,
  pan text,
  tan text,
  lut_number text,
  tds_enabled boolean not null default false,
  tcs_enabled boolean not null default false,
  vat_number text,
  sales_tax_number text,
  tax_id text,
  default_output_tax_rate numeric(6,3) not null default 0,
  default_input_tax_rate numeric(6,3) not null default 0,
  gst_split_mode text not null default 'cgst_sgst_or_igst',
  hsn_sac_required boolean not null default true,
  place_of_supply_rule text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_organization_tax_profiles_updated_at
before update on public.organization_tax_profiles
for each row execute procedure public.set_updated_at();

create table if not exists public.organization_document_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  invoice_prefix text not null default 'INV',
  invoice_next_no bigint not null default 1,
  purchase_prefix text not null default 'BILL',
  purchase_next_no bigint not null default 1,
  credit_note_prefix text not null default 'CN',
  credit_note_next_no bigint not null default 1,
  debit_note_prefix text not null default 'DN',
  debit_note_next_no bigint not null default 1,
  payment_in_prefix text not null default 'RCPT',
  payment_in_next_no bigint not null default 1,
  payment_out_prefix text not null default 'PAY',
  payment_out_next_no bigint not null default 1,
  reset_yearly boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger trg_organization_document_sequences_updated_at
before update on public.organization_document_sequences
for each row execute procedure public.set_updated_at();

create table if not exists public.company_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_company_settings_updated_at
before update on public.company_settings
for each row execute procedure public.set_updated_at();

-- =========================
-- Masters
-- =========================
create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  party_type public.party_type not null,
  display_name text not null,
  legal_name text,
  contact_person text,
  phone text,
  email text,
  billing_address_line1 text,
  billing_address_line2 text,
  city text,
  state_name text,
  state_code text,
  country_code text not null default 'IN',
  postal_code text,
  gstin text,
  pan text,
  vat_number text,
  tax_id text,
  opening_balance numeric(14,2) not null default 0,
  credit_limit numeric(14,2),
  credit_limit_type text not null default 'amount' check (credit_limit_type in ('amount', 'days')),
  credit_limit_days integer check (credit_limit_days is null or credit_limit_days >= 0),
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_parties_org_id on public.parties(organization_id);
create index if not exists idx_parties_name on public.parties(display_name);
create trigger trg_parties_updated_at
before update on public.parties
for each row execute procedure public.set_updated_at();

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_categories_org_id on public.categories(organization_id);
create index if not exists idx_categories_name on public.categories(name);
create unique index if not exists idx_categories_org_name_unique
on public.categories(organization_id, lower(trim(name)));
create trigger trg_categories_updated_at
before update on public.categories
for each row execute procedure public.set_updated_at();

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_type public.item_type not null,
  item_name text not null,
  item_code text,
  sku text,
  hsn_sac text,
  unit text,
  sale_price numeric(14,2) not null default 0,
  purchase_price numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_inclusive boolean not null default false,
  opening_stock numeric(14,3) not null default 0,
  current_stock numeric(14,3) not null default 0,
  reorder_level numeric(14,3),
  category_id uuid references public.categories(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_items_org_id on public.items(organization_id);
create index if not exists idx_items_name on public.items(item_name);
create index if not exists idx_items_item_code on public.items(item_code);
create index if not exists idx_items_category_id on public.items(category_id);
create unique index if not exists idx_items_org_item_code_unique
on public.items(organization_id, item_code)
where item_code is not null;
create trigger trg_items_updated_at
before update on public.items
for each row execute procedure public.set_updated_at();

-- =========================
-- Sales
-- =========================
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_no text not null,
  invoice_date date not null,
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
  status public.document_status not null default 'draft',
  notes text,
  terms text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_no)
);
create index if not exists idx_invoices_org_id on public.invoices(organization_id);
create index if not exists idx_invoices_party_id on public.invoices(party_id);
create index if not exists idx_invoices_date on public.invoices(invoice_date);
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute procedure public.set_updated_at();

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
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
create index if not exists idx_invoice_items_invoice_id on public.invoice_items(invoice_id);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  credit_note_no text not null,
  credit_note_date date not null,
  party_id uuid references public.parties(id) on delete set null,
  related_invoice_id uuid references public.invoices(id) on delete set null,
  reason text,
  taxable_total numeric(14,2) not null default 0,
  cgst_total numeric(14,2) not null default 0,
  sgst_total numeric(14,2) not null default 0,
  igst_total numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  status public.note_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, credit_note_no)
);
create trigger trg_credit_notes_updated_at
before update on public.credit_notes
for each row execute procedure public.set_updated_at();

create table if not exists public.credit_note_items (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  description text not null,
  qty numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  line_total numeric(14,2) not null default 0
);

-- =========================
-- Purchases
-- =========================
create table if not exists public.purchase_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bill_no text not null,
  bill_date date not null,
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
  status public.document_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, bill_no)
);
create trigger trg_purchase_bills_updated_at
before update on public.purchase_bills
for each row execute procedure public.set_updated_at();

create table if not exists public.purchase_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.purchase_bills(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  item_code text,
  description text not null,
  qty numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  cgst_amount numeric(14,2) not null default 0,
  sgst_amount numeric(14,2) not null default 0,
  igst_amount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0
);

create table if not exists public.debit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  debit_note_no text not null,
  debit_note_date date not null,
  supplier_id uuid references public.parties(id) on delete set null,
  related_bill_id uuid references public.purchase_bills(id) on delete set null,
  reason text,
  taxable_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  status public.note_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, debit_note_no)
);
create trigger trg_debit_notes_updated_at
before update on public.debit_notes
for each row execute procedure public.set_updated_at();

create table if not exists public.debit_note_items (
  id uuid primary key default gen_random_uuid(),
  debit_note_id uuid not null references public.debit_notes(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  description text not null,
  qty numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  line_total numeric(14,2) not null default 0
);

-- =========================
-- Payments + Expenses
-- =========================
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_no text,
  payment_date date not null,
  direction public.payment_direction not null,
  party_id uuid references public.parties(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  bill_id uuid references public.purchase_bills(id) on delete set null,
  amount numeric(14,2) not null,
  amount_received numeric(14,2) not null default 0,
  tds_amount numeric(14,2) not null default 0,
  tds_rate numeric(7,3) not null default 0,
  is_manual boolean not null default false,
  payment_mode text,
  reference_no text,
  notes text,
  status public.entry_status not null default 'posted',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_payments_org_id on public.payments(organization_id);
create trigger trg_payments_updated_at
before update on public.payments
for each row execute procedure public.set_updated_at();

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_no text,
  expense_date date not null,
  category text,
  party_id uuid references public.parties(id) on delete set null,
  amount numeric(14,2) not null,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  payment_mode text,
  notes text,
  status public.entry_status not null default 'posted',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_expenses_org_id on public.expenses(organization_id);
create trigger trg_expenses_updated_at
before update on public.expenses
for each row execute procedure public.set_updated_at();

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_expense_categories_org_id on public.expense_categories(organization_id);
create unique index if not exists idx_expense_categories_org_name_unique
  on public.expense_categories(organization_id, normalized_name);
create trigger trg_expense_categories_updated_at
before update on public.expense_categories
for each row execute procedure public.set_updated_at();

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_name text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_logs_org_id on public.activity_logs(organization_id);

create table if not exists public.credit_monitor_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  party_type public.party_type not null,
  alert_type text not null check (alert_type in ('amount', 'days')),
  limit_value numeric(14,2) not null check (limit_value >= 0),
  current_value numeric(14,2) not null check (current_value >= 0),
  is_read boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_notifications_org_id
  on public.credit_monitor_notifications(organization_id);
create index if not exists idx_credit_notifications_party_id
  on public.credit_monitor_notifications(party_id);
create index if not exists idx_credit_notifications_created_at
  on public.credit_monitor_notifications(created_at desc);
create unique index if not exists idx_credit_notifications_active_unique
  on public.credit_monitor_notifications(organization_id, party_id, alert_type)
  where is_active = true;

-- =========================
-- RLS helper functions
-- =========================
create or replace function public.current_user_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.current_user_org_role(p_org_id uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = p_org_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.current_user_is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_org_role(p_org_id) = 'owner'::public.organization_role;
$$;

-- =========================
-- Invite code join RPC
-- =========================
create or replace function public.consume_invite_code(
  p_code text,
  p_user_id uuid,
  p_role public.organization_role
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.organization_invite_codes%rowtype;
  v_org_id uuid;
  v_next_used integer;
begin
  select *
    into v_code
  from public.organization_invite_codes c
  where c.code = upper(trim(p_code))
    and c.target_role = p_role
    and c.is_active = true
    and c.expires_at > now()
  for update;

  if not found then
    raise exception 'Invalid or expired register code';
  end if;

  if v_code.used_count >= v_code.max_uses then
    raise exception 'Register code usage limit reached';
  end if;

  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (v_code.organization_id, p_user_id, p_role, 'active', now())
  on conflict (organization_id, user_id)
  do update
    set role = excluded.role,
        status = 'active',
        joined_at = now(),
        updated_at = now();

  v_next_used := v_code.used_count + 1;

  update public.organization_invite_codes
  set used_count = v_next_used,
      is_active = case when v_next_used >= max_uses then false else true end,
      updated_at = now()
  where id = v_code.id;

  v_org_id := v_code.organization_id;
  return v_org_id;
end;
$$;

grant execute on function public.consume_invite_code(text, uuid, public.organization_role) to authenticated;

create or replace function public.dashboard_expense_summary(p_organization_id uuid)
returns table(category text, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(e.category), ''), 'Uncategorized') as category,
    coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total
  from public.expenses e
  where e.organization_id = p_organization_id
    and public.current_user_is_org_member(p_organization_id)
  group by 1
  order by total desc;
$$;

grant execute on function public.dashboard_expense_summary(uuid) to authenticated;

create or replace function public.ensure_owner_membership(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select o.owner_user_id
    into v_owner
  from public.organizations o
  where o.id = p_organization_id;

  if v_owner is null then
    raise exception 'Organization not found';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'Only organization owner can create owner membership';
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    p_organization_id,
    auth.uid(),
    'owner',
    'active',
    now()
  )
  on conflict (organization_id, user_id)
  do update
    set role = 'owner',
        status = 'active',
        joined_at = now(),
        updated_at = now();
end;
$$;

grant execute on function public.ensure_owner_membership(uuid) to authenticated;

create or replace function public.get_my_membership_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_member record;
  v_org public.organizations%rowtype;
  v_tax public.organization_tax_profiles%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return null;
  end if;

  select m.organization_id, m.role
    into v_member
  from public.organization_members m
  where m.user_id = v_user_id
    and m.status = 'active'
  order by m.created_at asc
  limit 1;

  if v_member.organization_id is null then
    return null;
  end if;

  select *
    into v_org
  from public.organizations o
  where o.id = v_member.organization_id;

  select *
    into v_tax
  from public.organization_tax_profiles t
  where t.organization_id = v_member.organization_id;

  return jsonb_build_object(
    'organization_id', v_member.organization_id,
    'role', v_member.role,
    'organization', to_jsonb(v_org),
    'tax_profile', to_jsonb(v_tax)
  );
end;
$$;

grant execute on function public.get_my_membership_snapshot() to authenticated;

-- =========================
-- Enable RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invite_codes enable row level security;
alter table public.organization_tax_profiles enable row level security;
alter table public.organization_document_sequences enable row level security;
alter table public.company_settings enable row level security;
alter table public.parties enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_note_items enable row level security;
alter table public.purchase_bills enable row level security;
alter table public.purchase_bill_items enable row level security;
alter table public.debit_notes enable row level security;
alter table public.debit_note_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_categories enable row level security;
alter table public.activity_logs enable row level security;
alter table public.credit_monitor_notifications enable row level security;

-- Profiles
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles_upsert_own"
on public.profiles for all
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Organizations
create policy "organizations_select_member"
on public.organizations for select
to authenticated
using (owner_user_id = auth.uid() or public.current_user_is_org_member(id));

create policy "organizations_insert_owner"
on public.organizations for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy "organizations_update_owner"
on public.organizations for update
to authenticated
using (owner_user_id = auth.uid() or public.current_user_is_org_owner(id))
with check (owner_user_id = auth.uid() or public.current_user_is_org_owner(id));

-- Organization members
create policy "org_members_select_member"
on public.organization_members for select
to authenticated
using (
  organization_members.user_id = auth.uid()
  or exists (
    select 1
    from public.organizations o
    where o.id = organization_members.organization_id
      and o.owner_user_id = auth.uid()
  )
);

create policy "org_members_insert_owner"
on public.organization_members for insert
to authenticated
with check (
  exists (
    select 1
    from public.organizations o
    where o.id = organization_members.organization_id
      and o.owner_user_id = auth.uid()
  )
);

create policy "org_members_update_owner"
on public.organization_members for update
to authenticated
using (
  exists (
    select 1
    from public.organizations o
    where o.id = organization_members.organization_id
      and o.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.organizations o
    where o.id = organization_members.organization_id
      and o.owner_user_id = auth.uid()
  )
);

-- Invite codes (owner only)
create policy "invite_codes_select_member"
on public.organization_invite_codes for select
to authenticated
using (public.current_user_is_org_member(organization_id));

create policy "invite_codes_manage_owner"
on public.organization_invite_codes for all
to authenticated
using (public.current_user_is_org_owner(organization_id))
with check (public.current_user_is_org_owner(organization_id));

-- Tax and numbering (owner/accounter)
create policy "org_tax_select_member"
on public.organization_tax_profiles for select
to authenticated
using (public.current_user_is_org_member(organization_id));

create policy "org_tax_manage_owner_accounter"
on public.organization_tax_profiles for all
to authenticated
using (public.current_user_org_role(organization_id) in ('owner', 'accounter'))
with check (public.current_user_org_role(organization_id) in ('owner', 'accounter'));

create policy "org_seq_select_member"
on public.organization_document_sequences for select
to authenticated
using (public.current_user_is_org_member(organization_id));

create policy "org_seq_manage_owner_accounter"
on public.organization_document_sequences for all
to authenticated
using (public.current_user_org_role(organization_id) in ('owner', 'accounter'))
with check (public.current_user_org_role(organization_id) in ('owner', 'accounter'));

create policy "company_settings_member_access"
on public.company_settings for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

-- Generic org member access
create policy "parties_member_access"
on public.parties for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "categories_member_access"
on public.categories for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "items_member_access"
on public.items for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "invoices_member_access"
on public.invoices for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "credit_notes_member_access"
on public.credit_notes for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "purchase_bills_member_access"
on public.purchase_bills for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "debit_notes_member_access"
on public.debit_notes for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "payments_member_access"
on public.payments for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "expenses_member_access"
on public.expenses for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "expense_categories_member_access"
on public.expense_categories for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "activity_logs_member_access"
on public.activity_logs for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

create policy "credit_notifications_member_access"
on public.credit_monitor_notifications for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

-- Child-line table policies (inherit via parent)
create policy "invoice_items_member_access"
on public.invoice_items for all
to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.current_user_is_org_member(i.organization_id)
  )
)
with check (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.current_user_is_org_member(i.organization_id)
  )
);

create policy "credit_note_items_member_access"
on public.credit_note_items for all
to authenticated
using (
  exists (
    select 1 from public.credit_notes n
    where n.id = credit_note_items.credit_note_id
      and public.current_user_is_org_member(n.organization_id)
  )
)
with check (
  exists (
    select 1 from public.credit_notes n
    where n.id = credit_note_items.credit_note_id
      and public.current_user_is_org_member(n.organization_id)
  )
);

create policy "purchase_bill_items_member_access"
on public.purchase_bill_items for all
to authenticated
using (
  exists (
    select 1 from public.purchase_bills b
    where b.id = purchase_bill_items.bill_id
      and public.current_user_is_org_member(b.organization_id)
  )
)
with check (
  exists (
    select 1 from public.purchase_bills b
    where b.id = purchase_bill_items.bill_id
      and public.current_user_is_org_member(b.organization_id)
  )
);

create policy "debit_note_items_member_access"
on public.debit_note_items for all
to authenticated
using (
  exists (
    select 1 from public.debit_notes n
    where n.id = debit_note_items.debit_note_id
      and public.current_user_is_org_member(n.organization_id)
  )
)
with check (
  exists (
    select 1 from public.debit_notes n
    where n.id = debit_note_items.debit_note_id
      and public.current_user_is_org_member(n.organization_id)
  )
);
