-- Ensure owner access does not break when organization_members rows are missing/stale.
-- Safe/idempotent patch.

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
  )
  or exists (
    select 1
    from public.organizations o
    where o.id = p_org_id
      and o.owner_user_id = auth.uid()
  );
$$;

create or replace function public.current_user_org_role(p_org_id uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = public
as $$
  with owner_check as (
    select o.owner_user_id = auth.uid() as is_owner
    from public.organizations o
    where o.id = p_org_id
  ),
  member_role as (
    select m.role
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
    limit 1
  )
  select case
    when coalesce((select is_owner from owner_check), false) then 'owner'::public.organization_role
    else (select role from member_role)
  end;
$$;

create or replace function public.current_user_is_org_owner(p_org_id uuid)
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
      and o.owner_user_id = auth.uid()
  );
$$;

-- Backfill/repair owner membership rows for all organizations.
insert into public.organization_members (
  organization_id,
  user_id,
  role,
  status,
  joined_at
)
select
  o.id as organization_id,
  o.owner_user_id as user_id,
  'owner'::public.organization_role as role,
  'active'::public.member_status as status,
  coalesce(o.created_at, now()) as joined_at
from public.organizations o
where o.owner_user_id is not null
on conflict (organization_id, user_id)
do update
set role = 'owner'::public.organization_role,
    status = 'active'::public.member_status,
    updated_at = now();

grant execute on function public.current_user_is_org_member(uuid) to authenticated;
grant execute on function public.current_user_org_role(uuid) to authenticated;
grant execute on function public.current_user_is_org_owner(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
select pg_notify('pgrst', 'reload config');
