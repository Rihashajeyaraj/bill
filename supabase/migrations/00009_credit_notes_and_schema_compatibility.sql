-- Migration: 00009_credit_notes_and_schema_compatibility.sql
-- Description: Add missing credit_notes table, compatibility views (customers, proforma_items, tax_invoice_items), document_counters, and audit_logs.

-- 1. Create credit_notes table
CREATE TABLE IF NOT EXISTS public.credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    credit_note_no VARCHAR(100) NOT NULL,
    credit_note_date DATE NOT NULL DEFAULT CURRENT_DATE,
    tax_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    related_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.parties(id) ON DELETE SET NULL,
    party_id UUID REFERENCES public.parties(id) ON DELETE SET NULL,
    reason TEXT,
    taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    taxable_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_cgst NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    cgst_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_sgst NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    sgst_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    total_igst NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    igst_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure tenant_id and organization_id default triggers/values
CREATE OR REPLACE FUNCTION public.sync_credit_note_tenant_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tenant_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        NEW.tenant_id := NEW.organization_id;
    END IF;
    IF NEW.organization_id IS NULL AND NEW.tenant_id IS NOT NULL THEN
        NEW.organization_id := NEW.tenant_id;
    END IF;
    IF NEW.tax_invoice_id IS NULL AND NEW.related_invoice_id IS NOT NULL THEN
        NEW.tax_invoice_id := NEW.related_invoice_id;
    END IF;
    IF NEW.related_invoice_id IS NULL AND NEW.tax_invoice_id IS NOT NULL THEN
        NEW.related_invoice_id := NEW.tax_invoice_id;
    END IF;
    IF NEW.customer_id IS NULL AND NEW.party_id IS NOT NULL THEN
        NEW.customer_id := NEW.party_id;
    END IF;
    IF NEW.party_id IS NULL AND NEW.customer_id IS NOT NULL THEN
        NEW.party_id := NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_credit_note_tenant_fields ON public.credit_notes;
CREATE TRIGGER trg_sync_credit_note_tenant_fields
BEFORE INSERT OR UPDATE ON public.credit_notes
FOR EACH ROW EXECUTE FUNCTION public.sync_credit_note_tenant_fields();

-- Indexes for credit_notes
CREATE INDEX IF NOT EXISTS idx_credit_notes_tenant_tax_invoice ON public.credit_notes(tenant_id, tax_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_org_related_invoice ON public.credit_notes(organization_id, related_invoice_id);

-- Enable RLS on credit_notes
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'credit_notes' AND policyname = 'Users can access credit_notes for their org'
    ) THEN
        CREATE POLICY "Users can access credit_notes for their org" ON public.credit_notes
            FOR ALL USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ) OR tenant_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- 2. Schema compatibility views (customers, proforma_items, tax_invoice_items)
CREATE OR REPLACE VIEW public.customers AS
SELECT 
    id,
    organization_id AS tenant_id,
    organization_id,
    display_name AS name,
    display_name,
    email,
    phone,
    gstin,
    billing_address,
    created_at,
    updated_at
FROM public.parties
WHERE type = 'Customer' OR party_type = 'Customer' OR type IS NULL;

CREATE OR REPLACE VIEW public.proforma_items AS
SELECT * FROM public.proforma_invoice_items;

CREATE OR REPLACE VIEW public.tax_invoice_items AS
SELECT * FROM public.invoice_items;

-- 3. Create document_counters table
CREATE TABLE IF NOT EXISTS public.document_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    prefix VARCHAR(20),
    next_number INTEGER NOT NULL DEFAULT 1,
    financial_year_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'document_counters' AND policyname = 'Users can access document_counters for their org'
    ) THEN
        CREATE POLICY "Users can access document_counters for their org" ON public.document_counters
            FOR ALL USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ) OR tenant_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- 4. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Users can access audit_logs for their org'
    ) THEN
        CREATE POLICY "Users can access audit_logs for their org" ON public.audit_logs
            FOR ALL USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ) OR tenant_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
