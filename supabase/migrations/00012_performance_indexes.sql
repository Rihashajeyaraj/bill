-- Migration 00012: Performance Compound Indexes
-- Optimizes high-frequency queries across Dashboard, Invoices, Proformas, Payments, and Reports.

-- 1. Invoices: Date-range lookups, ordering, status filtering, and party queries
CREATE INDEX IF NOT EXISTS idx_invoices_org_date ON public.invoices(organization_id, invoice_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON public.invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_org_party ON public.invoices(organization_id, party_id);

-- 2. Proforma Invoices: Date-range lookups, ordering, status, and conversion tracking
CREATE INDEX IF NOT EXISTS idx_proforma_org_date ON public.proforma_invoices(organization_id, proforma_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proforma_org_status ON public.proforma_invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_proforma_org_party ON public.proforma_invoices(organization_id, party_id);
CREATE INDEX IF NOT EXISTS idx_proforma_org_converted ON public.proforma_invoices(organization_id, converted_document_id);

-- 3. Payments: Cash received filtering, direction scoping, and party lookups
CREATE INDEX IF NOT EXISTS idx_payments_org_date_dir ON public.payments(organization_id, payment_date DESC, direction);
CREATE INDEX IF NOT EXISTS idx_payments_org_party ON public.payments(organization_id, party_id);

-- 4. Parties & Items: Tenant-scoped active entity queries
CREATE INDEX IF NOT EXISTS idx_parties_org_type ON public.parties(organization_id, party_type, is_active);
CREATE INDEX IF NOT EXISTS idx_items_org_active ON public.items(organization_id, is_active);
