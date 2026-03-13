begin;

create or replace function public.peek_sales_proforma_no(
  p_organization_id uuid,
  p_proforma_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := 'PI';
  v_next bigint := 1;
begin
  if p_organization_id is null then
    return public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);
  end if;

  if not public.current_user_is_org_member(p_organization_id) then
    return public.format_org_document_number(v_prefix, v_next, p_proforma_date, 4);
  end if;

  insert into public.organization_document_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.sales_proforma_prefix, s.sales_proforma_next_no
    into v_prefix, v_next
  from public.organization_document_sequences s
  where s.organization_id = p_organization_id;

  return public.format_org_document_number(
    coalesce(nullif(trim(v_prefix), ''), 'PI'),
    coalesce(v_next, 1),
    p_proforma_date,
    4
  );
exception
  when others then
    return public.format_org_document_number('PI', 1, p_proforma_date, 4);
end;
$$;

grant execute on function public.peek_sales_proforma_no(uuid, date) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
