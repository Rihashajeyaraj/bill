"""add proforma export and logistics fields

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-09 13:45:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
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
    """)


def downgrade():
    op.execute("""
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS export_type;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS lut_number;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS lut_bond_no;

    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS bl_number;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS hbl_number;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS thbl_number;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS mbl_number;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS ocean_bl_no;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS vessel_name;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS voyage_no;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS vessel_voyage;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS etd_date;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS eta_date;

    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS igm_no;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS igm_item_no;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS file_no;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS sales_rep;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS rcm_applicable;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS container_details;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS container_vehicle_no;

    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS discount_type;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS discount_value;
    ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS roe;
    """)
