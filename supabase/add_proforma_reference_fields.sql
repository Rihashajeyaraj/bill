-- Migration: add_proforma_reference_fields.sql
-- Idempotent schema additions for Proforma Invoices and Tax Invoices (exact copy support)
-- Note: Duplicates removed; grand_total_in_words is computed at render time; tax_amount is computed from cgst+sgst+igst.

-- 1. Upgrade proforma_invoices
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS packs_qty NUMERIC(14,3);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS weight_kgs NUMERIC(14,3);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS volume_cbm NUMERIC(14,3);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS freight_terms TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bl_number TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS hbl_number TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS thbl_number TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS mbl_number TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ocean_bl_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS vessel_name TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS voyage_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS vessel_voyage TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS etd_date DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS eta_date DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS igm_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS igm_date DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS igm_item_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS file_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS sales_rep TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS rcm_applicable BOOLEAN DEFAULT false;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS container_details TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS container_vehicle_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS customer_ref TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS customer_pincode TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS tds_note TEXT DEFAULT '* Kindly deduct T.D.S on Invoice amount excluding GST amount.';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS remarks TEXT;

-- 2. Upgrade invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS shipper_name TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS consignee_name TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS packs_qty NUMERIC(14,3);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS weight_kgs NUMERIC(14,3);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS volume_cbm NUMERIC(14,3);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS freight_terms TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS bl_number TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS hbl_number TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS thbl_number TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS mbl_number TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS ocean_bl_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vessel_name TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS voyage_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vessel_voyage TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS etd_date DATE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS eta_date DATE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS igm_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS igm_date DATE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS igm_item_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS file_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS sales_rep TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS rcm_applicable BOOLEAN DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS container_details TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS container_vehicle_no TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_ref TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_pincode TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tds_note TEXT DEFAULT '* Kindly deduct T.D.S on Invoice amount excluding GST amount.';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS remarks TEXT;

-- 3. Upgrade proforma_invoice_items
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS amount_inr NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS place_of_supply TEXT;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';

-- 4. Upgrade invoice_items
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS amount_inr NUMERIC(14,2) DEFAULT 0;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS place_of_supply TEXT;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';

NOTIFY pgrst, 'reload schema';
