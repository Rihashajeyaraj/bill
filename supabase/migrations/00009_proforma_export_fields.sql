-- Migration 00009: Add export, shipping, and logistics fields to proforma_invoices
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS export_type VARCHAR(50) DEFAULT 'DOMESTIC';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS lut_number VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS lut_bond_no VARCHAR(100);

ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bl_number VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS hbl_number VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS thbl_number VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS mbl_number VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ocean_bl_no VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS vessel_name VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS voyage_no VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS vessel_voyage VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS etd_date DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS eta_date DATE;

ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS igm_no VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS igm_item_no VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS file_no VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS sales_rep VARCHAR(100);
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS rcm_applicable BOOLEAN DEFAULT FALSE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS container_details TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS container_vehicle_no TEXT;

ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) DEFAULT 'amount';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS discount_value NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS roe NUMERIC(14,4) DEFAULT 1.0000;

NOTIFY pgrst, 'reload schema';
