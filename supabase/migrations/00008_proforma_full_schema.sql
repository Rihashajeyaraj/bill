-- Migration 00008: Comprehensive Pro Forma Schema Upgrade & Backfill
-- Ensures proforma_invoices and proforma_invoice_items contain all bill-to, ship-to, logistics, tax breakdown, and company profile columns.

-- 1. Upgrade proforma_invoices table
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.parties(id) ON DELETE SET NULL;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS needs_customer_link BOOLEAN NOT NULL DEFAULT false;

-- Bill-to Snapshot
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_name TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_address_line1 TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_address_line2 TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_city TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_state TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_state_code TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_pincode TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_country TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_gstin TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_pan TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_phone TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_email TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bill_contact_person TEXT;

-- Ship-to Snapshot
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_same_as_bill BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_name TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_address_line1 TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_address_line2 TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_city TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_state TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_state_code TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_pincode TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_country TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_gstin TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_phone TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS ship_contact_person TEXT;

-- Place of Supply & Tax Mode
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS place_of_supply_code TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS supply_type TEXT NOT NULL DEFAULT 'intra';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT false;

-- Dates & Customer Order references
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS invoice_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS customer_po_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS customer_po_date DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS cust_ref TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS salesperson TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- Logistics
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS freight_terms TEXT DEFAULT 'Collect';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS transporter_name TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS vehicle_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS lr_no TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS dispatch_from TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS shipping_method TEXT;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS expected_delivery_date DATE;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS incoterms TEXT;

-- Currency & Pricing Mode
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '₹';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS price_mode TEXT DEFAULT 'exclusive';

-- Additional Charges & Financial Totals
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS gross_total NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS total_line_discount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS additional_discount_type TEXT DEFAULT 'amount';
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS additional_discount_value NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS additional_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS freight_charge NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS packing_charge NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS insurance_charge NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS other_charge NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS taxable_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS total_cgst NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS total_sgst NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS total_utgst NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS total_igst NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS total_cess NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS advance_received NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS balance_due NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Tenant Bank Account link
ALTER TABLE public.proforma_invoices ADD COLUMN IF NOT EXISTS bank_account_id UUID;


-- 2. Upgrade proforma_invoice_items table
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS rate NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'percent';
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS discount_value NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS cess_rate NUMERIC(6,3) NOT NULL DEFAULT 0;
ALTER TABLE public.proforma_invoice_items ADD COLUMN IF NOT EXISTS cess_amount NUMERIC(14,2) NOT NULL DEFAULT 0;


-- 3. Upgrade organizations (Company Settings) table
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signature_url TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS cin TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS iec TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS default_terms TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS bank_accounts JSONB DEFAULT '[]'::jsonb;


-- 4. Safe Backfill Logic for existing proforma rows
UPDATE public.proforma_invoices
SET customer_id = party_id
WHERE customer_id IS NULL AND party_id IS NOT NULL;

UPDATE public.proforma_invoices
SET needs_customer_link = true
WHERE customer_id IS NULL AND party_id IS NULL;

UPDATE public.proforma_invoices
SET invoice_date = proforma_date
WHERE invoice_date IS NULL;

UPDATE public.proforma_invoices
SET currency_symbol = '₹'
WHERE currency_code = 'INR' OR currency_symbol IS NULL;

UPDATE public.proforma_invoice_items
SET rate = unit_price
WHERE rate = 0 AND unit_price > 0;

UPDATE public.proforma_invoice_items
SET taxable_value = taxable_amount
WHERE taxable_value = 0 AND taxable_amount > 0;

UPDATE public.proforma_invoice_items
SET gst_rate = tax_rate
WHERE gst_rate = 0 AND tax_rate > 0;
