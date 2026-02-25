-- Fix for 401/42501 on credit_monitor_notifications inserts
-- Run this full script in Supabase SQL Editor.

begin;

alter table public.credit_monitor_notifications enable row level security;

-- Treat organization owner as a member even when organization_members row is missing.
create or replace function public.current_user_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_org_id
      and (
        o.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.organization_members m
          where m.organization_id = o.id
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
      )
  );
$$;

drop policy if exists "credit_notifications_member_access" on public.credit_monitor_notifications;

create policy "credit_notifications_member_access"
on public.credit_monitor_notifications
for all
to authenticated
using (
  auth.uid() is not null
  and public.current_user_is_org_member(organization_id)
)
with check (
  auth.uid() is not null
  and public.current_user_is_org_member(organization_id)
  and exists (
    select 1
    from public.parties p
    where p.id = credit_monitor_notifications.party_id
      and p.organization_id = credit_monitor_notifications.organization_id
  )
);

grant execute on function public.current_user_is_org_member(uuid) to authenticated;
grant select, insert, update, delete on public.credit_monitor_notifications to authenticated;

commit;

notify pgrst, 'reload schema';
