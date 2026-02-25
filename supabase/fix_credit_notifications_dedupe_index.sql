-- Fix legacy full-row dedupe index that causes 409/23505 on repeated alerts.
-- Intended behavior: only one unread alert per (org, party, alert_type).

alter table if exists public.credit_monitor_notifications
  drop constraint if exists idx_credit_notifications_dedupe;

drop index if exists public.idx_credit_notifications_dedupe;

-- If duplicate unread rows exist, keep only the newest unread row.
with ranked_unread as (
  select
    id,
    row_number() over (
      partition by organization_id, party_id, alert_type
      order by created_at desc, id desc
    ) as rn
  from public.credit_monitor_notifications
  where is_read = false
)
update public.credit_monitor_notifications n
set is_read = true
from ranked_unread r
where n.id = r.id
  and r.rn > 1;

drop index if exists public.idx_credit_notifications_unread_unique;
create unique index if not exists idx_credit_notifications_unread_unique
  on public.credit_monitor_notifications (organization_id, party_id, alert_type)
  where is_read = false;
