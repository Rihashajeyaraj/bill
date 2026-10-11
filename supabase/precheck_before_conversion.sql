-- Read-Only Precheck Queries Before Lossless Conversion Migration

-- 1. Check for duplicate (organization_id, invoice_no) in public.invoices
-- If any rows are returned, duplicate invoice numbers must be reconciled before applying unique constraint.
select organization_id, invoice_no, count(*) as duplicate_count
from public.invoices
group by organization_id, invoice_no
having count(*) > 1;

-- 2. Check for columns present on public.proforma_invoices but missing on public.invoices
-- (Columns in this list would NOT be copied during conversion)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'proforma_invoices'
  and column_name not in (
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices'
  )
  and column_name not in ('proforma_no', 'converted_document_id', 'converted_at')
order by ordinal_position;

-- 3. Check for columns present on public.proforma_invoice_items but missing on public.invoice_items
-- (Columns in this list would NOT be copied during conversion)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'proforma_invoice_items'
  and column_name not in (
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_items'
  )
  and column_name not in ('proforma_id')
order by ordinal_position;
