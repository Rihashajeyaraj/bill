create table if not exists public.credit_monitor_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  party_type public.party_type not null,
  alert_type text not null check (alert_type in ('amount', 'days')),
  limit_value numeric(14,2) not null check (limit_value >= 0),
  current_value numeric(14,2) not null check (current_value >= 0),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_notifications_org_id
  on public.credit_monitor_notifications(organization_id);
create index if not exists idx_credit_notifications_party_id
  on public.credit_monitor_notifications(party_id);
create index if not exists idx_credit_notifications_created_at
  on public.credit_monitor_notifications(created_at desc);
drop index if exists public.idx_credit_notifications_dedupe;
create unique index if not exists idx_credit_notifications_unread_unique
  on public.credit_monitor_notifications(organization_id, party_id, alert_type)
  where is_read = false;

alter table public.credit_monitor_notifications enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'credit_monitor_notifications'
      and policyname = 'credit_notifications_member_access'
  ) then
    create policy "credit_notifications_member_access"
    on public.credit_monitor_notifications for all
    to authenticated
    using (public.current_user_is_org_member(organization_id))
    with check (public.current_user_is_org_member(organization_id));
  end if;
end;
$$;
