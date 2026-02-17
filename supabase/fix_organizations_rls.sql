-- Fix for 403/500 errors caused by RLS recursion on organizations/organization_members
-- Run this full script in Supabase SQL Editor.

begin;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_tax_profiles enable row level security;

-- Helper functions must bypass RLS to avoid recursive policy evaluation.
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

-- Drop old policies.
drop policy if exists "organizations_select_member" on public.organizations;
drop policy if exists "organizations_insert_owner" on public.organizations;
drop policy if exists "organizations_update_owner" on public.organizations;

drop policy if exists "org_members_select_member" on public.organization_members;
drop policy if exists "org_members_insert_owner" on public.organization_members;
drop policy if exists "org_members_update_owner" on public.organization_members;

drop policy if exists "org_tax_select_member" on public.organization_tax_profiles;
drop policy if exists "org_tax_manage_owner_accounter" on public.organization_tax_profiles;

-- Organizations policies.
create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (
  owner_user_id = auth.uid()
  or public.current_user_is_org_member(id)
);

create policy "organizations_insert_owner"
on public.organizations
for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy "organizations_update_owner"
on public.organizations
for update
to authenticated
using (
  owner_user_id = auth.uid()
  or public.current_user_is_org_owner(id)
)
with check (
  owner_user_id = auth.uid()
  or public.current_user_is_org_owner(id)
);

-- Organization members policies (non-recursive).
create policy "org_members_select_member"
on public.organization_members
for select
to authenticated
using (
  organization_members.user_id = auth.uid()
  or public.current_user_is_org_owner(organization_members.organization_id)
);

create policy "org_members_insert_owner"
on public.organization_members
for insert
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
on public.organization_members
for update
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

-- Tax profile policies.
create policy "org_tax_select_member"
on public.organization_tax_profiles
for select
to authenticated
using (
  public.current_user_is_org_member(organization_id)
  or exists (
    select 1 from public.organizations o
    where o.id = organization_tax_profiles.organization_id
      and o.owner_user_id = auth.uid()
  )
);

create policy "org_tax_manage_owner_accounter"
on public.organization_tax_profiles
for all
to authenticated
using (
  public.current_user_org_role(organization_id) in ('owner'::public.organization_role, 'accounter'::public.organization_role)
  or exists (
    select 1 from public.organizations o
    where o.id = organization_tax_profiles.organization_id
      and o.owner_user_id = auth.uid()
  )
)
with check (
  public.current_user_org_role(organization_id) in ('owner'::public.organization_role, 'accounter'::public.organization_role)
  or exists (
    select 1 from public.organizations o
    where o.id = organization_tax_profiles.organization_id
      and o.owner_user_id = auth.uid()
  )
);

-- Grants.
grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.organization_members to authenticated;
grant select, insert, update on public.organization_tax_profiles to authenticated;

grant execute on function public.current_user_is_org_member(uuid) to authenticated;
grant execute on function public.current_user_org_role(uuid) to authenticated;
grant execute on function public.current_user_is_org_owner(uuid) to authenticated;
grant execute on function public.ensure_owner_membership(uuid) to authenticated;
grant execute on function public.get_my_membership_snapshot() to authenticated;

commit;

notify pgrst, 'reload schema';
