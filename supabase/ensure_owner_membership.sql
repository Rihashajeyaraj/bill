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

grant execute on function public.ensure_owner_membership(uuid) to authenticated;

notify pgrst, 'reload schema';
