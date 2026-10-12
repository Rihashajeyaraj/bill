"""create credit notes and schema compatibility

Revision ID: 0001
Revises: 
Create Date: 2026-10-09 12:17:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
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

    CREATE INDEX IF NOT EXISTS idx_credit_notes_tenant_tax_invoice ON public.credit_notes(tenant_id, tax_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_credit_notes_org_related_invoice ON public.credit_notes(organization_id, related_invoice_id);
    ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE VIEW public.customers AS
    SELECT id, organization_id AS tenant_id, organization_id, display_name AS name, display_name, email, phone, gstin, billing_address, created_at, updated_at
    FROM public.parties WHERE type = 'Customer' OR party_type = 'Customer' OR type IS NULL;

    CREATE OR REPLACE VIEW public.proforma_items AS SELECT * FROM public.proforma_invoice_items;
    CREATE OR REPLACE VIEW public.tax_invoice_items AS SELECT * FROM public.invoice_items;

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

    NOTIFY pgrst, 'reload schema';
    """)


def downgrade():
    op.execute("""
    DROP VIEW IF EXISTS public.tax_invoice_items;
    DROP VIEW IF EXISTS public.proforma_items;
    DROP VIEW IF EXISTS public.customers;
    DROP TABLE IF EXISTS public.audit_logs;
    DROP TABLE IF EXISTS public.document_counters;
    DROP TABLE IF EXISTS public.credit_notes;
    """)
