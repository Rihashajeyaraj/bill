-- Fix stack-depth recursion and provide stable membership snapshot RPC.
-- Run this in Supabase SQL Editor.

begin;

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

  select * into v_org
  from public.organizations o
  where o.id = v_member.organization_id;

  select * into v_tax
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

drop policy if exists "org_members_select_member" on public.organization_members;
create policy "org_members_select_member"
on public.organization_members
for select
to authenticated
using (
  organization_members.user_id = auth.uid()
  or public.current_user_is_org_owner(organization_members.organization_id)
);

grant execute on function public.current_user_is_org_member(uuid) to authenticated;
grant execute on function public.current_user_org_role(uuid) to authenticated;
grant execute on function public.current_user_is_org_owner(uuid) to authenticated;
grant execute on function public.get_my_membership_snapshot() to authenticated;

commit;

notify pgrst, 'reload schema';
