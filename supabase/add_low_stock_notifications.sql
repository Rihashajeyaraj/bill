create table if not exists public.inventory_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  alert_type text not null check (alert_type in ('low_stock')),
  limit_value numeric(14,3) not null check (limit_value >= 0),
  current_value numeric(14,3) not null check (current_value >= 0),
  snapshot jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_notifications_org_id
  on public.inventory_notifications(organization_id);
create index if not exists idx_inventory_notifications_item_id
  on public.inventory_notifications(item_id);
create index if not exists idx_inventory_notifications_created_at
  on public.inventory_notifications(created_at desc);
create unique index if not exists idx_inventory_notifications_active_unique
  on public.inventory_notifications(organization_id, item_id, alert_type)
  where is_active = true and item_id is not null;

drop trigger if exists trg_inventory_notifications_updated_at on public.inventory_notifications;
create trigger trg_inventory_notifications_updated_at
before update on public.inventory_notifications
for each row execute procedure public.set_updated_at();

alter table public.inventory_notifications enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_notifications'
      and policyname = 'inventory_notifications_member_access'
  ) then
    create policy "inventory_notifications_member_access"
    on public.inventory_notifications for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;
end;
$$;
