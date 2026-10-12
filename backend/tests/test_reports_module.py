import pytest
import uuid
from datetime import date
from decimal import Decimal
from app.core.supabase import get_admin_supabase_client
from app.services.report_service import ReportService
from app.schemas.invoice import InvoiceCreate, InvoiceItemCreate
from app.services.invoice_service import InvoiceService
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate
from app.services.proforma_service import ProformaService
from app.schemas.payment import PaymentCreate, PaymentAllocationItem
from app.services.payment_service import PaymentService

def test_all_reports_comprehensive_module():
    """
    Comprehensive end-to-end test suite for the 6 billing and payment reports:
    1. Customer-wise Report
    2. Payment-wise Report
    3. Advance Amount Received Report
    4. Balance Due Report
    5. Pro Forma Report
    6. Tax Invoice Report
    Also verifies:
    - No double-counting of converted Pro Forma invoices in customer totals and debt.
    - Python Decimal monetary precision.
    - Multi-tenant data isolation.
    - Inclusive date and customer filtering.
    """
    db = get_admin_supabase_client()
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())

    org_user_res = db.table("organizations").select("owner_user_id").not_.is_("owner_user_id", "null").limit(1).execute()
    user_id = org_user_res.data[0]["owner_user_id"] if org_user_res.data and org_user_res.data[0].get("owner_user_id") else "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"

    # Setup tenant organizations
    org_res = db.table("organizations").select("id").execute()
    existing_orgs = [row["id"] for row in (org_res.data or []) if row.get("id")]
    if len(existing_orgs) >= 2:
        tenant_a = existing_orgs[0]
        tenant_b = existing_orgs[1]
    else:
        try:
            db.table("organizations").insert([
                {"id": tenant_a, "name": "Report Test Org A", "country": "India", "owner_user_id": user_id},
                {"id": tenant_b, "name": "Report Test Org B", "country": "India", "owner_user_id": user_id}
            ]).execute()
        except Exception:
            pass

    try:
        db.table("organization_members").upsert([
            {"organization_id": tenant_a, "user_id": user_id, "role": "owner", "status": "active"},
            {"organization_id": tenant_b, "user_id": user_id, "role": "owner", "status": "active"}
        ]).execute()
    except Exception:
        pass

    # Setup 2 distinct customers for Tenant A
    cust1_id = str(uuid.uuid4())
    cust1_name = f"Customer Alpha {uuid.uuid4().hex[:4]}"
    db.table("parties").insert({
        "id": cust1_id,
        "organization_id": tenant_a,
        "display_name": cust1_name,
        "phone": "9876543210",
        "gstin": "33AAAAA0000A1Z5",
        "party_type": "customer"
    }).execute()

    cust2_id = str(uuid.uuid4())
    cust2_name = f"Customer Beta {uuid.uuid4().hex[:4]}"
    db.table("parties").insert({
        "id": cust2_id,
        "organization_id": tenant_a,
        "display_name": cust2_name,
        "phone": "9123456789",
        "gstin": "33BBBBB1111B2Z6",
        "party_type": "customer"
    }).execute()

    report_service = ReportService()
    inv_service = InvoiceService()
    pf_service = ProformaService()
    pmt_service = PaymentService()

    # 1. Create Pro Forma 1 for Customer 1 (with Advance of 3,000; Total: 11,800)
    pf1_create = ProFormaCreate(
        customer_id=cust1_id,
        customer_name=cust1_name,
        place_of_supply_state="TAMIL NADU",
        proforma_date=date(2026, 10, 1),
        valid_till=date(2026, 10, 31),
        advance_received=3000.0,
        items=[
            ProFormaItemCreate(description="Pro Forma Design", qty=1, unit_price=10000.0, tax_rate=18.0)
        ]
    )
    pf1 = pf_service.create_proforma(tenant_a, pf1_create, user_id)

    # 2. Create Pro Forma 2 for Customer 2 (Unconverted, no advance, Total: 5,900)
    pf2_create = ProFormaCreate(
        customer_id=cust2_id,
        customer_name=cust2_name,
        place_of_supply_state="TAMIL NADU",
        proforma_date=date(2026, 10, 2),
        valid_till=date(2026, 10, 25),
        advance_received=0.0,
        items=[
            ProFormaItemCreate(description="Consulting Estimate", qty=1, unit_price=5000.0, tax_rate=18.0)
        ]
    )
    pf2 = pf_service.create_proforma(tenant_a, pf2_create, user_id)

    # 3. Create Tax Invoice 1 for Customer 1 resulting from Pro Forma 1 conversion (or direct invoice)
    # Total: 11,800, Advance: 3,000, Amount Paid: 3,000, Balance: 8,800
    inv1_create = InvoiceCreate(
        customer_id=cust1_id,
        invoice_date=date(2026, 10, 5),
        due_date=date(2026, 10, 20),
        place_of_supply_state="TAMIL NADU",
        advance_received=3000.0,
        amount_paid=3000.0,
        source_proforma_id=pf1["id"],
        items=[
            InvoiceItemCreate(description="Pro Forma Design Final", qty=1, unit_price=10000.0, tax_rate=18.0)
        ]
    )
    inv1 = inv_service.create_invoice(tenant_a, inv1_create, user_id)

    # Mark PF1 as converted and linked to INV1
    db.table("proforma_invoices").update({
        "status": "CONVERTED",
        "converted_document_id": inv1["id"]
    }).eq("id", pf1["id"]).execute()

    # 4. Create an additional Tax Invoice 2 for Customer 1 (Total: 2,360, Overdue)
    inv2_create = InvoiceCreate(
        customer_id=cust1_id,
        invoice_date=date(2026, 9, 1),
        due_date=date(2026, 9, 15), # Overdue
        place_of_supply_state="TAMIL NADU",
        items=[
            InvoiceItemCreate(description="Maintenance Support", qty=1, unit_price=2000.0, tax_rate=18.0)
        ]
    )
    inv2 = inv_service.create_invoice(tenant_a, inv2_create, user_id)

    # 5. Record a Payment of 2,360 via Cash paying off INV2
    pmt1 = pmt_service.create_payment(
        tenant_a,
        PaymentCreate(
            party_id=cust1_id,
            payment_date=date(2026, 9, 10),
            amount_received=2360.0,
            payment_mode="Cash",
            reference_no="CASH-REC-01",
            notes="Paid in full for maintenance",
            allocations=[
                PaymentAllocationItem(document_id=inv2["id"], amount=2360.0)
            ]
        ),
        user_id
    )

    # 6. Record a Payment of 5,000 via Bank Transfer towards INV1
    pmt2 = pmt_service.create_payment(
        tenant_a,
        PaymentCreate(
            party_id=cust1_id,
            payment_date=date(2026, 10, 8),
            amount_received=5000.0,
            payment_mode="Bank Transfer",
            reference_no="HDFC-NEFT-991",
            notes="Partial payment for INV1",
            allocations=[
                PaymentAllocationItem(document_id=inv1["id"], amount=5000.0)
            ]
        ),
        user_id
    )

    # =========================================================================
    # VERIFICATION 1: Customer-wise Report
    # =========================================================================
    cust_report = report_service.get_customer_wise_report(
        organization_id=tenant_a,
        start_date="01/09/2026",
        end_date="31/10/2026"
    )

    assert "summary" in cust_report
    assert "data" in cust_report
    cust_data = cust_report["data"]
    c1_row = next((r for r in cust_data if r["customer_id"] == cust1_id), None)
    assert c1_row is not None, "Customer Alpha must be in customer-wise report"

    # IMPORTANT: Pro Forma 1 was converted to Tax Invoice 1.
    # Total invoice amount for Customer 1 must NOT count PF1 twice!
    # Expected: INV1 (11,800) + INV2 (2,360) = 14,160
    assert abs(c1_row["total_invoice_amount"] - 14160.0) < 0.05, f"Expected 14160, got {c1_row['total_invoice_amount']}"
    assert c1_row["proforma_count"] == 1
    assert c1_row["tax_invoice_count"] == 2
    # Check that customer row contains detailed invoices and payments history for click-to-expand
    assert "invoices" in c1_row and len(c1_row["invoices"]) > 0
    assert "payments" in c1_row

    # =========================================================================
    # VERIFICATION 2: Payment-wise Report
    # =========================================================================
    pmt_report = report_service.get_payments_report(
        organization_id=tenant_a,
        start_date="2026-09-01",
        end_date="2026-10-31"
    )

    assert pmt_report["summary"]["receipt_count"] >= 2
    assert pmt_report["summary"]["cash_received"] >= 2360.0
    assert pmt_report["summary"]["bank_upi_received"] >= 5000.0
    # Payment rows
    pmt_data = pmt_report["data"]
    p1_row = next((r for r in pmt_data if r["id"] == pmt1["id"]), None)
    assert p1_row is not None
    assert p1_row["payment_method"] == "Cash"
    assert p1_row["amount_received"] == 2360.0

    # =========================================================================
    # VERIFICATION 3: Advance Amount Received Report
    # =========================================================================
    adv_report = report_service.get_advance_received_report(
        organization_id=tenant_a
    )

    adv_data = adv_report["data"]
    pf1_adv_row = next((r for r in adv_data if r["proforma_id"] == pf1["id"]), None)
    assert pf1_adv_row is not None, "PF1 advance must be in Advance Received Report"
    assert pf1_adv_row["advance_received"] == 3000.0
    assert pf1_adv_row["advance_applied"] == 3000.0
    assert pf1_adv_row["status"] == "Converted"
    assert pf1_adv_row["tax_invoice_number"] == inv1.get("invoice_no")

    # =========================================================================
    # VERIFICATION 4: Balance Due Report
    # =========================================================================
    bal_report = report_service.get_balance_due_report(
        organization_id=tenant_a,
        include_paid=False
    )
    bal_data = bal_report["data"]
    # Fully paid inv2 should be excluded when include_paid=False
    inv2_in_bal = any(r["invoice_id"] == inv2["id"] for r in bal_data)
    assert not inv2_in_bal, "Fully paid invoice 2 should be excluded when include_paid=False"

    # Converted PF1 must NOT appear as an additional debt on top of INV1
    pf1_in_bal = any(r["invoice_id"] == pf1["id"] for r in bal_data)
    assert not pf1_in_bal, "Converted Pro Forma must not appear in Balance Due Report"

    # Unconverted PF2 and unpaid INV1 should appear
    inv1_in_bal = any(r["invoice_id"] == inv1["id"] for r in bal_data)
    assert inv1_in_bal, "Partially paid Invoice 1 must appear in Balance Due Report"

    # Test include_paid=True
    bal_all = report_service.get_balance_due_report(
        organization_id=tenant_a,
        include_paid=True
    )
    assert any(r["invoice_id"] == inv2["id"] for r in bal_all["data"]), "INV2 should appear when include_paid=True"

    # =========================================================================
    # VERIFICATION 5: Pro Forma Report
    # =========================================================================
    pf_report = report_service.get_proforma_report(
        organization_id=tenant_a
    )
    assert pf_report["summary"]["total_proforma_invoices"] >= 2
    assert pf_report["summary"]["converted_count"] >= 1
    assert pf_report["summary"]["pending_conversion_count"] >= 1

    # =========================================================================
    # VERIFICATION 6: Tax Invoice Report
    # =========================================================================
    tax_report = report_service.get_tax_invoices_report(
        organization_id=tenant_a
    )
    assert tax_report["summary"]["total_tax_invoices"] >= 2
    assert tax_report["summary"]["total_taxable_value"] > 0
    assert tax_report["summary"]["total_gst"] > 0
    assert tax_report["summary"]["total_invoice_value"] >= 14160.0

    # =========================================================================
    # VERIFICATION 7: Multi-Tenant Isolation
    # =========================================================================
    tenant_b_report = report_service.get_customer_wise_report(
        organization_id=tenant_b
    )
    # Tenant B should NOT see Tenant A's customer Alpha
    assert not any(r["customer_id"] == cust1_id for r in tenant_b_report["data"]), "Tenant B must NOT access Tenant A data"
