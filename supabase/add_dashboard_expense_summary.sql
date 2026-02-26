-- Dashboard expense donut summary API source.
-- Run in Supabase SQL editor.

begin;

create or replace function public.dashboard_expense_summary(p_organization_id uuid)
returns table(category text, total numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(e.category), ''), 'Uncategorized') as category,
    coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as total
  from public.expenses e
  where e.organization_id = p_organization_id
    and public.current_user_is_org_member(p_organization_id)
  group by 1
  order by total desc;
$$;

grant execute on function public.dashboard_expense_summary(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
