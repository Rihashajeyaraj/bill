-- Rollback for Lossless Sales Proforma to Tax Invoice Conversion
begin;

drop function if exists public.convert_sales_proforma_to_invoice(uuid);
drop function if exists public.allocate_tax_invoice_no(uuid, date);
drop index if exists public.idx_invoices_org_invoice_no;

commit;

notify pgrst, 'reload schema';
