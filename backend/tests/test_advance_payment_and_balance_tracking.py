import pytest
import uuid
from decimal import Decimal
from datetime import date
from fastapi import HTTPException
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import (
    calculate_document_totals,
    validate_advance_amount,
    to_decimal
)
from app.services.proforma_service import ProformaService
from app.services.invoice_service import InvoiceService
from app.services.payment_service import PaymentService
from app.repositories.payment_repository import PaymentRepository
from app.repositories.party_repository import PartyRepository
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate
from app.schemas.invoice import InvoiceCreate, InvoiceItemCreate
from app.schemas.payment import PaymentCreate, PaymentAllocationItem
from app.schemas.party import PartyCreate


def cleanup_test_organization(org_id: str):
    """Clean up test organization and related rows."""
    db = get_admin_supabase_client()
    try:
        db.table("payment_allocations").delete().eq("organization_id", org_id).execute()
    except Exception:
        pass
    try:
        db.table("payments").delete().eq("organization_id", org_id).execute()
    except Exception:
        pass
    try:
        invs = db.table("invoices").select("id").eq("organization_id", org_id).execute().data or []
        for inv in invs:
            try:
                db.table("invoice_items").delete().eq("invoice_id", inv["id"]).execute()
            except Exception:
                pass
        db.table("invoices").delete().eq("organization_id", org_id).execute()
    except Exception:
        pass
    try:
        pfs = db.table("proforma_invoices").select("id").eq("organization_id", org_id).execute().data or []
        for pf in pfs:
            try:
                db.table("proforma_invoice_items").delete().eq("proforma_id", pf["id"]).execute()
            except Exception:
                pass
        db.table("proforma_invoices").delete().eq("organization_id", org_id).execute()
    except Exception:
        pass
    try:
        db.table("parties").delete().eq("organization_id", org_id).execute()
        db.table("organization_members").delete().eq("organization_id", org_id).execute()
        db.table("organizations").delete().eq("id", org_id).execute()
    except Exception:
        pass


@pytest.fixture
def test_org():
    """Provides an isolated test organization with teardown."""
    db = get_admin_supabase_client()
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    org_id = str(uuid.uuid4())

    db.table("organizations").insert({
        "id": org_id,
        "owner_user_id": user_id,
        "company_name": f"Advance Test Org {org_id[:6]}",
        "country_code": "IN",
        "state_name": "Maharashtra"
    }).execute()

    db.table("organization_members").insert({
        "organization_id": org_id,
        "user_id": user_id,
        "role": "owner",
        "status": "active"
    }).execute()

    try:
        yield org_id, user_id
    finally:
        cleanup_test_organization(org_id)


# =========================================================================
# 1. Zero Advance
# =========================================================================
def test_1_zero_advance():
    items = [
        {"qty": 100, "unit_price": 1000, "tax_rate": 18, "description": "Consulting Services"}
    ]
    # Total before tax = 1,00,000; GST (18%) = 18,000; Grand total = 1,18,000
    res = calculate_document_totals(items, "Maharashtra", "Maharashtra", advance_received=0)
    assert res.subtotal == Decimal("100000.00")
    assert res.tax_total == Decimal("18000.00")
    assert res.grand_total == Decimal("118000.00")
    assert res.advance_received == Decimal("0.00")
    assert res.balance_payable == Decimal("118000.00")
    assert res.payment_status == "UNPAID"


# =========================================================================
# 2. Partial Advance
# =========================================================================
def test_2_partial_advance():
    items = [
        {"qty": 100, "unit_price": 1000, "tax_rate": 18, "description": "Consulting Services"}
    ]
    res = calculate_document_totals(items, "Maharashtra", "Maharashtra", advance_received=30000)
    assert res.grand_total == Decimal("118000.00")
    assert res.advance_received == Decimal("30000.00")
    assert res.balance_payable == Decimal("88000.00")
    assert res.payment_status == "PARTIALLY_PAID"


# =========================================================================
# 3. Advance Equal to Invoice Total
# =========================================================================
def test_3_advance_equal_to_invoice_total():
    items = [
        {"qty": 100, "unit_price": 1000, "tax_rate": 18, "description": "Consulting Services"}
    ]
    res = calculate_document_totals(items, "Maharashtra", "Maharashtra", advance_received=118000)
    assert res.grand_total == Decimal("118000.00")
    assert res.advance_received == Decimal("118000.00")
    assert res.balance_payable == Decimal("0.00")
    assert res.payment_status == "PAID"


# =========================================================================
# 4. Negative Advance Rejection
# =========================================================================
def test_4_negative_advance_rejection():
    with pytest.raises(HTTPException) as exc_info:
        validate_advance_amount(-500, Decimal("118000.00"))
    assert exc_info.value.status_code == 422
    assert "cannot be negative" in exc_info.value.detail.lower()


# =========================================================================
# 5. Advance Exceeding Invoice Total Rejection
# =========================================================================
def test_5_advance_exceeding_invoice_total_rejection():
    with pytest.raises(HTTPException) as exc_info:
        validate_advance_amount(150000, Decimal("118000.00"))
    assert exc_info.value.status_code == 422
    assert "cannot exceed invoice total" in exc_info.value.detail.lower()


# =========================================================================
# 6. Pro Forma Conversion Preserving the Advance
# =========================================================================
def test_6_proforma_conversion_preserving_the_advance(test_org):
    org_id, user_id = test_org
    party_repo = PartyRepository()
    cust = party_repo.create(org_id, PartyCreate(display_name="Advance Freight Client", party_type="customer", state_name="Maharashtra"), user_id)
    cust_id = cust["id"]

    pf_service = ProformaService()
    pf_payload = ProFormaCreate(
        proforma_no=f"PI-{uuid.uuid4().hex[:6].upper()}",
        proforma_date=date.today(),
        party_id=cust_id,
        items=[
            ProFormaItemCreate(
                description="Ocean Freight",
                qty=100,
                unit_price=1000,
                tax_rate=18
            )
        ],
        advance_received=30000.0,
        amount_paid=30000.0
    )
    created_pf = pf_service.create_proforma(org_id, pf_payload, user_id)
    pf_id = created_pf["id"]
    assert float(created_pf.get("advance_received") or 0) == 30000.0

    # Convert to Tax Invoice
    conv_result = pf_service.convert_to_invoice(pf_id, org_id, user_id)
    assert conv_result is not None
    tax_inv_id = conv_result.get("invoice_id") or conv_result.get("id")

    # Fetch resulting Tax Invoice
    inv_service = InvoiceService()
    tax_inv = inv_service.get_invoice(tax_inv_id, org_id)
    assert float(tax_inv["grand_total"]) == 118000.0
    assert float(tax_inv.get("advance_received") or tax_inv.get("amount_paid") or 0) == 30000.0
    assert float(tax_inv.get("amount_paid") or 0) == 30000.0
    assert float(tax_inv.get("balance_due") or 0) == 88000.0
    assert tax_inv["status"] == "partial"

    # Source proforma status must be converted
    updated_pf = pf_service.get_proforma(pf_id, org_id)
    assert "converted" in updated_pf["status"].lower()


# =========================================================================
# 7. Payment In Displaying the Correct Advance
# =========================================================================
def test_7_payment_in_displaying_the_correct_advance(test_org):
    org_id, user_id = test_org
    party_repo = PartyRepository()
    cust = party_repo.create(org_id, PartyCreate(display_name="Receivables Client", party_type="customer", state_name="Maharashtra"), user_id)
    cust_id = cust["id"]

    pf_service = ProformaService()
    pf_payload = ProFormaCreate(
        proforma_no=f"PI-{uuid.uuid4().hex[:6].upper()}",
        proforma_date=date.today(),
        party_id=cust_id,
        items=[
            ProFormaItemCreate(
                description="Logistics",
                qty=100,
                unit_price=1000,
                tax_rate=18
            )
        ],
        advance_received=30000.0
    )
    created_pf = pf_service.create_proforma(org_id, pf_payload, user_id)
    pf_service.convert_to_invoice(created_pf["id"], org_id, user_id)

    # Inspect Payment In Receivables
    pay_repo = PaymentRepository()
    receivables = pay_repo.get_receivables(org_id, customer_id=cust_id)
    assert len(receivables) == 1
    doc = receivables[0]
    assert float(doc["grand_total"]) == 118000.0
    assert float(doc["advance_received"]) == 30000.0
    assert float(doc["additional_payments"]) == 0.0
    assert float(doc["total_received"]) == 30000.0
    assert float(doc["balance_due"]) == 88000.0
    assert doc["payment_status"] == "PARTIALLY_PAID"


# =========================================================================
# 8. Additional Payments Reducing the Balance
# =========================================================================
def test_8_additional_payments_reducing_the_balance(test_org):
    org_id, user_id = test_org
    party_repo = PartyRepository()
    cust = party_repo.create(org_id, PartyCreate(display_name="Multi Payment Client", party_type="customer", state_name="Maharashtra"), user_id)
    cust_id = cust["id"]

    # Create proforma with 30,000 advance and convert
    pf_service = ProformaService()
    pf_payload = ProFormaCreate(
        proforma_no=f"PI-{uuid.uuid4().hex[:6].upper()}",
        proforma_date=date.today(),
        party_id=cust_id,
        items=[ProFormaItemCreate(description="Handling", qty=100, unit_price=1000, tax_rate=18)],
        advance_received=30000.0
    )
    created_pf = pf_service.create_proforma(org_id, pf_payload, user_id)
    conv = pf_service.convert_to_invoice(created_pf["id"], org_id, user_id)
    tax_inv_id = conv.get("invoice_id") or conv.get("id")

    # Record additional payment of 50,000
    payment_service = PaymentService()
    pay_payload = PaymentCreate(
        customer_id=cust_id,
        payment_date=str(date.today()),
        amount=50000.0,
        mode="Bank Transfer",
        reference_no="NEFT-998877",
        is_advance=False,
        allocations=[
            PaymentAllocationItem(invoice_id=tax_inv_id, amount_allocated=50000.0)
        ]
    )
    payment_service.create_payment(org_id, pay_payload, user_id)

    # Verify updated receivables
    pay_repo = PaymentRepository()
    receivables = pay_repo.get_receivables(org_id, customer_id=cust_id)
    assert len(receivables) == 1
    doc = receivables[0]
    assert float(doc["grand_total"]) == 118000.0
    assert float(doc["advance_received"]) == 30000.0
    assert float(doc["additional_payments"]) == 50000.0
    assert float(doc["total_received"]) == 80000.0
    assert float(doc["balance_due"]) == 38000.0
    assert doc["payment_status"] == "PARTIALLY_PAID"


# =========================================================================
# 9. Duplicate Conversion Prevention
# =========================================================================
def test_9_duplicate_conversion_prevention(test_org):
    org_id, user_id = test_org
    party_repo = PartyRepository()
    cust = party_repo.create(org_id, PartyCreate(display_name="Dup Client", party_type="customer", state_name="Maharashtra"), user_id)

    pf_service = ProformaService()
    pf_payload = ProFormaCreate(
        proforma_no=f"PI-{uuid.uuid4().hex[:6].upper()}",
        proforma_date=date.today(),
        party_id=cust["id"],
        items=[ProFormaItemCreate(description="Cargo", qty=10, unit_price=1000, tax_rate=18)],
        advance_received=5000.0
    )
    created_pf = pf_service.create_proforma(org_id, pf_payload, user_id)
    pf_id = created_pf["id"]

    # First conversion succeeds
    pf_service.convert_to_invoice(pf_id, org_id, user_id)

    # Second conversion attempt must raise 409 Conflict
    with pytest.raises(HTTPException) as exc_info:
        pf_service.convert_to_invoice(pf_id, org_id, user_id)
    assert exc_info.value.status_code == 409
    assert "already converted" in exc_info.value.detail.lower()


# =========================================================================
# 10. Duplicate Advance-Payment Prevention
# =========================================================================
def test_10_duplicate_advance_payment_prevention(test_org):
    org_id, user_id = test_org
    db = get_admin_supabase_client()
    party_repo = PartyRepository()
    cust = party_repo.create(org_id, PartyCreate(display_name="No Double Advance", party_type="customer", state_name="Maharashtra"), user_id)

    pf_service = ProformaService()
    pf_payload = ProFormaCreate(
        proforma_no=f"PI-{uuid.uuid4().hex[:6].upper()}",
        proforma_date=date.today(),
        party_id=cust["id"],
        items=[ProFormaItemCreate(description="Inspection", qty=10, unit_price=1000, tax_rate=18)],
        advance_received=4000.0
    )
    created_pf = pf_service.create_proforma(org_id, pf_payload, user_id)
    conv = pf_service.convert_to_invoice(created_pf["id"], org_id, user_id)
    tax_inv_id = conv.get("invoice_id") or conv.get("id")

    # Verify payments table: exactly ONE advance payment was created
    pays = db.table("payments").select("*").eq("organization_id", org_id).execute().data or []
    advance_pays = [p for p in pays if p.get("invoice_id") == tax_inv_id or "[advance]" in str(p.get("notes") or "").lower()]
    assert len(advance_pays) == 1

    # In receivables, total received is exactly 4000 (never double counted)
    pay_repo = PaymentRepository()
    receivables = pay_repo.get_receivables(org_id, customer_id=cust["id"])
    doc = receivables[0]
    assert float(doc["advance_received"]) == 4000.0
    assert float(doc["total_received"]) == 4000.0


# =========================================================================
# 11. Payment Status Transitions: UNPAID -> PARTIALLY_PAID -> PAID
# =========================================================================
def test_11_payment_status_transitions():
    items = [{"qty": 1, "unit_price": 1000, "tax_rate": 0, "description": "Consulting"}]
    # 0 advance -> UNPAID
    r0 = calculate_document_totals(items, "Maharashtra", "Maharashtra", advance_received=0)
    assert r0.grand_total == Decimal("1000.00")
    assert r0.payment_status == "UNPAID"

    # 400 advance -> PARTIALLY_PAID
    r1 = calculate_document_totals(items, "Maharashtra", "Maharashtra", advance_received=400)
    assert r1.balance_payable == Decimal("600.00")
    assert r1.payment_status == "PARTIALLY_PAID"

    # 1000 advance -> PAID
    r2 = calculate_document_totals(items, "Maharashtra", "Maharashtra", advance_received=1000)
    assert r2.balance_payable == Decimal("0.00")
    assert r2.payment_status == "PAID"


# =========================================================================
# 12. Payment Allocation Across Multiple Invoices
# =========================================================================
def test_12_payment_allocation_across_multiple_invoices(test_org):
    org_id, user_id = test_org
    party_repo = PartyRepository()
    cust = party_repo.create(org_id, PartyCreate(display_name="Multi Inv Client", party_type="customer", state_name="Maharashtra"), user_id)
    cust_id = cust["id"]

    inv_service = InvoiceService()
    # Create Invoice 1: 10,000
    inv1 = inv_service.create_invoice(org_id, InvoiceCreate(
        party_id=cust_id,
        invoice_date=date.today(),
        items=[InvoiceItemCreate(description="Service A", qty=10, unit_price=1000, tax_rate=0)]
    ), user_id)
    inv1_id = inv1["id"]

    # Create Invoice 2: 20,000
    inv2 = inv_service.create_invoice(org_id, InvoiceCreate(
        party_id=cust_id,
        invoice_date=date.today(),
        items=[InvoiceItemCreate(description="Service B", qty=20, unit_price=1000, tax_rate=0)]
    ), user_id)
    inv2_id = inv2["id"]

    # Pay 25,000 allocated: 10,000 to Inv 1, 15,000 to Inv 2
    pay_service = PaymentService()
    pay_res = pay_service.create_payment(org_id, PaymentCreate(
        customer_id=cust_id,
        payment_date=str(date.today()),
        amount=25000.0,
        mode="Bank Transfer",
        reference_no="SPLIT-PAY-100",
        allocations=[
            PaymentAllocationItem(invoice_id=inv1_id, amount_allocated=10000.0),
            PaymentAllocationItem(invoice_id=inv2_id, amount_allocated=15000.0)
        ]
    ), user_id)
    assert pay_res is not None

    # Check receivables
    pay_repo = PaymentRepository()
    receivables = pay_repo.get_receivables(org_id, customer_id=cust_id)
    inv1_doc = next(d for d in receivables if d["invoice_id"] == inv1_id)
    inv2_doc = next(d for d in receivables if d["invoice_id"] == inv2_id)

    assert float(inv1_doc["balance_due"]) == 0.0
    assert inv1_doc["payment_status"] == "PAID"

    assert float(inv2_doc["balance_due"]) == 5000.0
    assert inv2_doc["payment_status"] == "PARTIALLY_PAID"

    # Attempting to allocate more than the remaining balance (e.g. 10,000 when only 5,000 left)
    with pytest.raises(HTTPException) as exc_info:
        pay_service.create_payment(org_id, PaymentCreate(
            customer_id=cust_id,
            payment_date=str(date.today()),
            amount=10000.0,
            mode="Cash",
            allocations=[
                PaymentAllocationItem(invoice_id=inv2_id, amount_allocated=10000.0)
            ]
        ), user_id)
    assert exc_info.value.status_code in (409, 422)
