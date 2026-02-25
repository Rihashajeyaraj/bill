-- Permanent fix: keep owner membership row in sync automatically.
-- Run this in Supabase SQL Editor.

begin;

create or replace function public.sync_owner_membership_for_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null then
    return new;
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    new.id,
    new.owner_user_id,
    'owner'::public.organization_role,
    'active'::public.member_status,
    now()
  )
  on conflict (organization_id, user_id)
  do update
    set role = 'owner'::public.organization_role,
        status = 'active'::public.member_status,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_owner_membership_for_organization on public.organizations;

create trigger trg_sync_owner_membership_for_organization
after insert or update of owner_user_id
on public.organizations
for each row
execute function public.sync_owner_membership_for_organization();

-- Backfill existing organizations once.
insert into public.organization_members (
  organization_id,
  user_id,
  role,
  status,
  joined_at
)
select
  o.id,
  o.owner_user_id,
  'owner'::public.organization_role,
  'active'::public.member_status,
  now()
from public.organizations o
where o.owner_user_id is not null
on conflict (organization_id, user_id)
do update
  set role = 'owner'::public.organization_role,
      status = 'active'::public.member_status,
      updated_at = now();

grant execute on function public.sync_owner_membership_for_organization() to postgres, service_role;

commit;

notify pgrst, 'reload schema';
