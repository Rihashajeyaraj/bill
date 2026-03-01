-- Customer return management workflow support.
-- Tracks reusable/non-reusable item returns linked to original invoices.

create extension if not exists pgcrypto;

create table if not exists public.customer_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_no text not null,
  return_date date not null default current_date,
  party_id uuid references public.parties(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  credit_note_id uuid references public.credit_notes(id) on delete set null,
  refund_mode text not null default 'FULL'
    check (refund_mode in ('FULL', 'PARTIAL', 'NONE')),
  refund_amount numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, return_no)
);

create table if not exists public.customer_return_items (
  id uuid primary key default gen_random_uuid(),
  customer_return_id uuid not null references public.customer_returns(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  source_invoice_item_id uuid references public.invoice_items(id) on delete set null,
  source_batch_id uuid references public.stock_batches(id) on delete set null,
  item_name text not null,
  purchase_rate numeric(14,6) not null default 0,
  selling_rate numeric(14,6) not null default 0,
  returned_qty numeric(14,3) not null check (returned_qty > 0),
  return_condition text not null
    check (return_condition in ('REUSABLE', 'NOT_REUSABLE')),
  disposition text not null default 'PENDING'
    check (disposition in ('PENDING', 'RETURN_TO_SUPPLIER', 'RESELL', 'LOSS')),
  disposition_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_returns_org_date
  on public.customer_returns(organization_id, return_date desc, created_at desc);
create index if not exists idx_customer_return_items_return_id
  on public.customer_return_items(customer_return_id);
create index if not exists idx_customer_return_items_item_id
  on public.customer_return_items(item_id);

drop trigger if exists trg_customer_returns_updated_at on public.customer_returns;
create trigger trg_customer_returns_updated_at
before update on public.customer_returns
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_customer_return_items_updated_at on public.customer_return_items;
create trigger trg_customer_return_items_updated_at
before update on public.customer_return_items
for each row execute procedure public.set_updated_at();

alter table public.customer_returns enable row level security;
alter table public.customer_return_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_returns'
      and policyname = 'customer_returns_member_access'
  ) then
    create policy "customer_returns_member_access"
    on public.customer_returns for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_return_items'
      and policyname = 'customer_return_items_member_access'
  ) then
    create policy "customer_return_items_member_access"
    on public.customer_return_items for all
    to authenticated
    using (
      exists (
        select 1
        from public.customer_returns r
        where r.id = customer_return_items.customer_return_id
          and public.current_user_is_org_member(r.organization_id)
      )
    )
    with check (
      exists (
        select 1
        from public.customer_returns r
        where r.id = customer_return_items.customer_return_id
          and public.current_user_is_org_member(r.organization_id)
      )
    );
  end if;
end $$;

grant select, insert, update, delete on public.customer_returns to authenticated;
grant select, insert, update, delete on public.customer_return_items to authenticated;
