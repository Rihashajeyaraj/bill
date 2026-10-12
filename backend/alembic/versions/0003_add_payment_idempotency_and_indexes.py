"""add payment idempotency and indexes

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-09 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;
    ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
    ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_advance BOOLEAN DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON public.payments(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_party_id ON public.payments(party_id);
    CREATE INDEX IF NOT EXISTS idx_payments_org_id ON public.payments(organization_id);
    CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON public.payments(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_doc_id ON public.payment_allocations(document_id);
    CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON public.payment_allocations(payment_id);

    NOTIFY pgrst, 'reload schema';
    """)


def downgrade():
    op.execute("""
    DROP INDEX IF EXISTS idx_payment_allocations_payment_id;
    DROP INDEX IF EXISTS idx_payment_allocations_doc_id;
    DROP INDEX IF EXISTS idx_payments_idempotency;
    DROP INDEX IF EXISTS idx_payments_org_id;
    DROP INDEX IF EXISTS idx_payments_party_id;
    DROP INDEX IF EXISTS idx_payments_customer_id;

    ALTER TABLE public.payments DROP COLUMN IF EXISTS is_advance;
    ALTER TABLE public.payments DROP COLUMN IF EXISTS idempotency_key;
    ALTER TABLE public.payments DROP COLUMN IF EXISTS customer_id;
    """)
