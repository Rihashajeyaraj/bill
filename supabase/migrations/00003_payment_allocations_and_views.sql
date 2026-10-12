-- Migration: 00003_payment_allocations_and_views.sql
-- Description: Create payment_allocations table and open documents view

CREATE TABLE IF NOT EXISTS public.payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    document_type VARCHAR(20) NOT NULL DEFAULT 'invoice', -- 'invoice' or 'proforma'
    document_id UUID NOT NULL,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by tenant and document
CREATE INDEX IF NOT EXISTS idx_payment_allocations_org_doc ON public.payment_allocations(organization_id, document_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON public.payment_allocations(payment_id);

-- Enable RLS on payment_allocations
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'payment_allocations' AND policyname = 'Users can view payment allocations for their org'
    ) THEN
        CREATE POLICY "Users can view payment allocations for their org" ON public.payment_allocations
            FOR SELECT USING (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'payment_allocations' AND policyname = 'Users can insert payment allocations for their org'
    ) THEN
        CREATE POLICY "Users can insert payment allocations for their org" ON public.payment_allocations
            FOR INSERT WITH CHECK (
                organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;
