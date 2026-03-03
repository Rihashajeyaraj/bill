-- Add item barcode registry linked to purchased inventory.
-- Safe to run multiple times.

create table if not exists public.item_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  purchase_id uuid not null references public.purchase_bills(id) on delete cascade,
  barcode_value text not null,
  qr_value text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_item_barcodes_org_id on public.item_barcodes(organization_id);
create index if not exists idx_item_barcodes_item_id on public.item_barcodes(item_id);
create index if not exists idx_item_barcodes_purchase_id on public.item_barcodes(purchase_id);
create unique index if not exists idx_item_barcodes_org_barcode_unique
  on public.item_barcodes(organization_id, barcode_value);

alter table public.item_barcodes enable row level security;

drop policy if exists "item_barcodes_member_access" on public.item_barcodes;
create policy "item_barcodes_member_access"
on public.item_barcodes for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

-- Refresh PostgREST schema cache so new table/columns are available immediately.
select pg_notify('pgrst', 'reload schema');
select pg_notify('pgrst', 'reload config');
