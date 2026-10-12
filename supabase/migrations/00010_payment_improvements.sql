-- Migration 00010: Payment Improvements, Customer Standardization & Idempotency
-- Enables customer_id everywhere on payments, indexes, and idempotency key

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_advance BOOLEAN DEFAULT FALSE;

-- Create indexes for fast lookup and RLS enforcement
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_party_id ON public.payments(party_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_id ON public.payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON public.payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_doc_id ON public.payment_allocations(document_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON public.payment_allocations(payment_id);

NOTIFY pgrst, 'reload schema';
