-- Fix duplicate credit monitoring notifications and enforce one active alert per type.
-- Target behavior:
-- 1) Create 1 notification when limit is exceeded.
-- 2) Do not recreate duplicates after user reads it.
-- 3) Create a new notification only after alert is resolved and exceeded again.

alter table if exists public.credit_monitor_notifications
  add column if not exists is_active boolean not null default true;

alter table if exists public.credit_monitor_notifications
  drop constraint if exists idx_credit_notifications_dedupe;

drop index if exists public.idx_credit_notifications_dedupe;
drop index if exists public.idx_credit_notifications_unread_unique;
drop index if exists public.idx_credit_notifications_active_unique;

-- Keep only the newest row active for each (org, party, alert_type).
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, party_id, alert_type
      order by created_at desc, id desc
    ) as rn
  from public.credit_monitor_notifications
)
update public.credit_monitor_notifications n
set
  is_active = (r.rn = 1),
  is_read = case when r.rn = 1 then n.is_read else true end
from ranked r
where n.id = r.id;

create unique index if not exists idx_credit_notifications_active_unique
  on public.credit_monitor_notifications (organization_id, party_id, alert_type)
  where is_active = true;
