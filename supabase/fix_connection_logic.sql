-- Dynamic connection logic for invoice/bill outstanding.
-- Run this once on an existing database.

-- 1) Remove static paid/balance columns
alter table if exists public.invoices
  drop column if exists paid_amount,
  drop column if exists balance_amount;

alter table if exists public.purchase_bills
  drop column if exists paid_amount,
  drop column if exists balance_amount;

-- 2) Supporting indexes for dynamic aggregation
create index if not exists idx_payments_invoice_posted
  on public.payments (organization_id, invoice_id)
  where direction = 'in' and status = 'posted' and invoice_id is not null;

create index if not exists idx_payments_bill_posted
  on public.payments (organization_id, bill_id)
  where direction = 'out' and status = 'posted' and bill_id is not null;

create index if not exists idx_credit_notes_related_invoice_applied
  on public.credit_notes (organization_id, related_invoice_id)
  where status = 'applied' and related_invoice_id is not null;

create index if not exists idx_debit_notes_related_bill_applied
  on public.debit_notes (organization_id, related_bill_id)
  where status = 'applied' and related_bill_id is not null;

-- 3) Sales-side dynamic outstanding
create or replace view public.v_invoice_outstanding as
select
  i.id as invoice_id,
  i.organization_id,
  i.grand_total as invoice_total,
  coalesce(pi.applied_payment_in, 0)::numeric(14,2) as applied_payment_in,
  coalesce(cn.applied_credit_note, 0)::numeric(14,2) as applied_credit_note,
  greatest(
    i.grand_total
      - coalesce(pi.applied_payment_in, 0)
      - coalesce(cn.applied_credit_note, 0),
    0
  )::numeric(14,2) as outstanding
from public.invoices i
left join (
  select
    p.organization_id,
    p.invoice_id,
    sum(p.amount) as applied_payment_in
  from public.payments p
  where p.direction = 'in'
    and p.status = 'posted'
    and p.invoice_id is not null
  group by p.organization_id, p.invoice_id
) pi
  on pi.organization_id = i.organization_id
 and pi.invoice_id = i.id
left join (
  select
    n.organization_id,
    n.related_invoice_id as invoice_id,
    sum(n.grand_total) as applied_credit_note
  from public.credit_notes n
  where n.status = 'applied'
    and n.related_invoice_id is not null
  group by n.organization_id, n.related_invoice_id
) cn
  on cn.organization_id = i.organization_id
 and cn.invoice_id = i.id;

-- 4) Purchase-side dynamic outstanding
create or replace view public.v_purchase_bill_outstanding as
select
  b.id as bill_id,
  b.organization_id,
  b.grand_total as bill_total,
  coalesce(dn.applied_debit_note, 0)::numeric(14,2) as applied_debit_note,
  coalesce(po.applied_payment_out, 0)::numeric(14,2) as applied_payment_out,
  greatest(
    b.grand_total
      + coalesce(dn.applied_debit_note, 0)
      - coalesce(po.applied_payment_out, 0),
    0
  )::numeric(14,2) as outstanding
from public.purchase_bills b
left join (
  select
    p.organization_id,
    p.bill_id,
    sum(p.amount) as applied_payment_out
  from public.payments p
  where p.direction = 'out'
    and p.status = 'posted'
    and p.bill_id is not null
  group by p.organization_id, p.bill_id
) po
  on po.organization_id = b.organization_id
 and po.bill_id = b.id
left join (
  select
    n.organization_id,
    n.related_bill_id as bill_id,
    sum(n.grand_total) as applied_debit_note
  from public.debit_notes n
  where n.status = 'applied'
    and n.related_bill_id is not null
  group by n.organization_id, n.related_bill_id
) dn
  on dn.organization_id = b.organization_id
 and dn.bill_id = b.id;
