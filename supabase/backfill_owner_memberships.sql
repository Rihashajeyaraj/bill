-- Backfill missing owner rows in organization_members.
-- Run this in Supabase SQL Editor once.

begin;

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
  now() as joined_at
from public.organizations o
where o.owner_user_id is not null
on conflict (organization_id, user_id)
do update
set
  role = 'owner'::public.organization_role,
  status = 'active'::public.member_status,
  joined_at = coalesce(public.organization_members.joined_at, now()),
  updated_at = now();

commit;

notify pgrst, 'reload schema';
