begin;

insert into public.organization_members (
  organization_id,
  user_id,
  role,
  status,
  joined_at,
  created_at,
  updated_at
)
select
  o.id,
  o.owner_user_id,
  'owner'::public.organization_role,
  'active'::public.member_status,
  coalesce(o.created_at, now()),
  now(),
  now()
from public.organizations o
where o.owner_user_id is not null
on conflict (organization_id, user_id)
do update
set role = 'owner'::public.organization_role,
    status = 'active'::public.member_status,
    updated_at = now();

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
      and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

grant execute on function public.current_user_is_org_member(uuid) to authenticated;

alter table public.proforma_invoices enable row level security;
alter table public.proforma_invoice_items enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists "organization_members_member_access" on public.organization_members;
create policy "organization_members_member_access"
on public.organization_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_user_is_org_member(organization_id)
);

drop policy if exists "proforma_invoices_member_access" on public.proforma_invoices;
create policy "proforma_invoices_member_access"
on public.proforma_invoices for all
to authenticated
using (public.current_user_is_org_member(organization_id))
with check (public.current_user_is_org_member(organization_id));

drop policy if exists "proforma_invoice_items_member_access" on public.proforma_invoice_items;
create policy "proforma_invoice_items_member_access"
on public.proforma_invoice_items for all
to authenticated
using (
  exists (
    select 1
    from public.proforma_invoices p
    where p.id = proforma_invoice_items.proforma_id
      and public.current_user_is_org_member(p.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.proforma_invoices p
    where p.id = proforma_invoice_items.proforma_id
      and public.current_user_is_org_member(p.organization_id)
  )
);

commit;

notify pgrst, 'reload schema';
