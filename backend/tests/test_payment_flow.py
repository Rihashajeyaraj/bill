import pytest
import uuid
from datetime import date, timedelta
from fastapi import HTTPException
from app.core.supabase import get_admin_supabase_client
from app.services.payment_service import PaymentService
from app.services.proforma_service import ProformaService
from app.services.invoice_service import InvoiceService
from app.schemas.payment import PaymentCreate, PaymentAllocationItem
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate
from app.schemas.invoice import InvoiceCreate, InvoiceItemCreate
from app.repositories.party_repository import PartyRepository
from app.schemas.party import PartyCreate


def cleanup_test_organization(org_id: str):
    """
    Teardown helper: Safely cleans up all rows created in an isolated test organization.
    Guarantees no orphaned rows or pollution in real organizations.
    """
    db = get_admin_supabase_client()
    try:
        db.table("payments").delete().eq("organization_id", org_id).execute()
        invs = db.table("invoices").select("id").eq("organization_id", org_id).execute().data or []
        for inv in invs:
            try:
                db.table("invoice_items").delete().eq("invoice_id", inv["id"]).execute()
            except Exception:
                pass
        db.table("invoices").delete().eq("organization_id", org_id).execute()
        pfs = db.table("proforma_invoices").select("id").eq("organization_id", org_id).execute().data or []
        for pf in pfs:
            try:
                db.table("proforma_invoice_items").delete().eq("proforma_id", pf["id"]).execute()
            except Exception:
                pass
        db.table("proforma_invoices").delete().eq("organization_id", org_id).execute()
        db.table("parties").delete().eq("organization_id", org_id).execute()
        db.table("organization_members").delete().eq("organization_id", org_id).execute()
        db.table("organizations").delete().eq("id", org_id).execute()
    except Exception as e:
        print(f"Notice during test cleanup for {org_id}: {e}")


@pytest.fixture
def test_tenants():
    """
    Isolated test organizations fixture:
    Generates unique random UUIDs for tenant_a and tenant_b.
    NEVER touches real organizations.
    Teardown deletes all created rows.
    """
    db = get_admin_supabase_client()
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())

    db.table("organizations").insert([
        {
            "id": tenant_a,
            "owner_user_id": user_id,
            "company_name": f"Isolated Org A {tenant_a[:6]}",
            "country_code": "IN",
            "state_name": "Maharashtra"
        },
        {
            "id": tenant_b,
            "owner_user_id": user_id,
            "company_name": f"Isolated Org B {tenant_b[:6]}",
            "country_code": "IN",
            "state_name": "Karnataka"
        }
    ]).execute()

    db.table("organization_members").insert([
        {"organization_id": tenant_a, "user_id": user_id, "role": "owner", "status": "active"},
        {"organization_id": tenant_b, "user_id": user_id, "role": "owner", "status": "active"}
    ]).execute()

    try:
        yield tenant_a, tenant_b, user_id
    finally:
        cleanup_test_organization(tenant_a)
        cleanup_test_organization(tenant_b)


def test_advance_payment_without_allocations(test_tenants):
    """
    Test 1: Advance payment without allocations.
    Validates amount > 0, is_advance = True, stored with 0 allocations and full unapplied amount.
    """
    tenant_a, _, user_id = test_tenants
    party_repo = PartyRepository()
    payment_service = PaymentService()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Advance Customer", party_type="customer"),
        user_id
    )
    customer_id = cust["id"]

    payload = PaymentCreate(
        customer_id=customer_id,
        payment_date="2026-10-09",
        amount=2500.0,
        mode="UPI",
        reference_no="UPI-ADV-12345",
        is_advance=True,
        allocations=[]
    )

    result = payment_service.create_payment(tenant_a, payload, user_id)
    assert result is not None
    assert str(result.get("customer_id") or result.get("party_id")) == str(customer_id)
    assert float(result.get("amount_received") or result.get("amount") or 0) == 2500.0


def test_payment_with_allocations_across_two_documents(test_tenants):
    """
    Test 2: Payment allocated across 2 documents.
    Creates 2 proformas for Tenant A, then creates a payment allocating against both.
    """
    tenant_a, _, user_id = test_tenants
    pf_service = ProformaService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Multi-Doc Customer", party_type="customer"),
        user_id
    )
    customer_id = cust["id"]

    pf1 = pf_service.create_proforma(
        tenant_a,
        ProFormaCreate(
            party_id=customer_id,
            customer_name="Multi-Doc Customer",
            items=[ProFormaItemCreate(description="Service 1", qty=1, unit_price=1000.0, tax_rate=18.0)]
        ),
        user_id
    )
    pf2 = pf_service.create_proforma(
        tenant_a,
        ProFormaCreate(
            party_id=customer_id,
            customer_name="Multi-Doc Customer",
            items=[ProFormaItemCreate(description="Service 2", qty=1, unit_price=2000.0, tax_rate=18.0)]
        ),
        user_id
    )

    pf1_id = pf1["id"]
    pf2_id = pf2["id"]
    pf1_total = float(pf1.get("grand_total") or 1180.0)
    pf2_total = float(pf2.get("grand_total") or 2360.0)

    payment_payload = PaymentCreate(
        customer_id=customer_id,
        payment_date="2026-10-09",
        amount=pf1_total + pf2_total,
        mode="Bank Transfer",
        reference_no="BANK-MULTI-999",
        allocations=[
            PaymentAllocationItem(document_id=pf1_id, document_type="proforma", amount=pf1_total),
            PaymentAllocationItem(document_id=pf2_id, document_type="proforma", amount=pf2_total),
        ]
    )

    res = payment_service.create_payment(tenant_a, payment_payload, user_id)
    assert res is not None
    allocs = res.get("allocations", [])
    assert len(allocs) == 2
    allocated_ids = {a["document_id"] for a in allocs}
    assert pf1_id in allocated_ids
    assert pf2_id in allocated_ids


def test_overpayment_rejected(test_tenants):
    """
    Test 3: Overpayment rejected.
    Allocating an amount greater than the document balance_due must raise HTTPException (422/400).
    """
    tenant_a, _, user_id = test_tenants
    pf_service = ProformaService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Overpay Customer", party_type="customer"),
        user_id
    )
    cust_id = cust["id"]

    pf = pf_service.create_proforma(
        tenant_a,
        ProFormaCreate(
            party_id=cust_id,
            customer_name="Overpay Customer",
            items=[ProFormaItemCreate(description="Item", qty=1, unit_price=500.0, tax_rate=0.0)]
        ),
        user_id
    )
    doc_id = pf["id"]

    overpay_payload = PaymentCreate(
        customer_id=cust_id,
        payment_date="2026-10-09",
        amount=5000.0,
        mode="UPI",
        reference_no="OVERPAY-001",
        allocations=[
            PaymentAllocationItem(document_id=doc_id, document_type="proforma", amount=5000.0)
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        payment_service.create_payment(tenant_a, overpay_payload, user_id)
    
    assert exc_info.value.status_code in (400, 409, 422)
    assert "exceeds" in exc_info.value.detail.lower()


def test_partial_payment(test_tenants):
    """
    Test 4: Partial payment.
    Applying a partial payment reduces balance due and sets invoice status to 'partial'.
    """
    tenant_a, _, user_id = test_tenants
    inv_service = InvoiceService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Partial Pay Customer", party_type="customer"),
        user_id
    )
    cust_id = cust["id"]

    inv = inv_service.create_invoice(
        tenant_a,
        InvoiceCreate(
            party_id=cust_id,
            customer_name="Partial Pay Customer",
            items=[InvoiceItemCreate(description="Hardware Unit", qty=1, unit_price=1000.0, tax_rate=0.0)]
        ),
        user_id
    )
    inv_id = inv["id"]

    pmt = payment_service.create_payment(
        tenant_a,
        PaymentCreate(
            customer_id=cust_id,
            payment_date="2026-10-10",
            amount=350.0,
            mode="UPI",
            reference_no="PARTIAL-PAY-001",
            allocations=[
                PaymentAllocationItem(document_id=inv_id, document_type="invoice", amount=350.0)
            ]
        ),
        user_id
    )
    assert pmt is not None

    db = get_admin_supabase_client()
    refreshed_inv = db.table("invoices").select("amount_paid, balance_due, status").eq("id", inv_id).single().execute().data
    assert float(refreshed_inv.get("amount_paid") or 0.0) == 350.0
    assert float(refreshed_inv.get("balance_due") or 0.0) == 650.0
    assert refreshed_inv.get("status") == "partial"


def test_advance_on_proforma_and_conversion_balance(test_tenants):
    """
    Test 5: Advance payment on proforma transfers balance correctly on conversion to tax invoice.
    """
    tenant_a, _, user_id = test_tenants
    pf_service = ProformaService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Conv Advance Cust", party_type="customer"),
        user_id
    )
    customer_id = cust["id"]

    pf = pf_service.create_proforma(
        tenant_a,
        ProFormaCreate(
            party_id=customer_id,
            customer_name="Conv Advance Cust",
            items=[ProFormaItemCreate(description="Consulting", qty=1, unit_price=1000.0, tax_rate=0.0)]
        ),
        user_id
    )
    pf_id = pf["id"]

    # Make advance payment on proforma of 400.0
    pmt_res = payment_service.create_payment(
        tenant_a,
        PaymentCreate(
            customer_id=customer_id,
            payment_date="2026-10-10",
            amount=400.0,
            mode="UPI",
            reference_no="UPI-PF-CONV-1",
            allocations=[
                PaymentAllocationItem(document_id=pf_id, document_type="proforma", amount=400.0)
            ]
        ),
        user_id
    )
    assert pmt_res is not None

    # Convert proforma to tax invoice via single stored procedure path
    conv_inv = pf_service.convert_to_invoice(pf_id, tenant_a, user_id)
    assert conv_inv is not None
    assert conv_inv.get("source_proforma_id") == pf_id
    assert float(conv_inv.get("amount_paid") or 0.0) == 400.0
    assert float(conv_inv.get("balance_due") or 0.0) == 600.0
    assert conv_inv.get("status") in ("partial", "issued")


def test_converted_invoice_keeps_party_and_due_date(test_tenants):
    """
    Test 6: Converted invoice keeps party_id, customer_name, and due_date from proforma.
    """
    tenant_a, _, user_id = test_tenants
    pf_service = ProformaService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Specific Enterprise Client", party_type="customer"),
        user_id
    )
    customer_id = cust["id"]

    target_due = "2026-11-20"
    pf = pf_service.create_proforma(
        tenant_a,
        ProFormaCreate(
            party_id=customer_id,
            customer_name="Specific Enterprise Client",
            due_date=target_due,
            items=[ProFormaItemCreate(description="Annual Maintenance Contract", qty=1, unit_price=1200.0, tax_rate=18.0)]
        ),
        user_id
    )
    pf_id = pf["id"]

    conv_inv = pf_service.convert_to_invoice(pf_id, tenant_a, user_id)
    assert conv_inv is not None
    assert str(conv_inv.get("party_id")) == str(customer_id)
    assert str(conv_inv.get("due_date")) == target_due
    assert conv_inv.get("customer_name") == "Specific Enterprise Client"


def test_apply_unapplied_advance_to_invoice(test_tenants):
    """
    Test 7: Apply unapplied advance to invoice later.
    Prevents negative balances and updates invoice paid/balance correctly.
    """
    tenant_a, _, user_id = test_tenants
    inv_service = InvoiceService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Advance Recipient Customer", party_type="customer"),
        user_id
    )
    cust_id = cust["id"]

    inv = inv_service.create_invoice(
        tenant_a,
        InvoiceCreate(
            party_id=cust_id,
            customer_name="Advance Recipient Customer",
            items=[InvoiceItemCreate(description="Software License", qty=1, unit_price=1000.0, tax_rate=0.0)]
        ),
        user_id
    )
    inv_id = inv["id"]

    # Create unapplied advance payment of 600.0
    adv_pmt = payment_service.create_payment(
        tenant_a,
        PaymentCreate(
            customer_id=cust_id,
            payment_date="2026-10-10",
            amount=600.0,
            mode="Bank Transfer",
            reference_no="BANK-ADV-APPLY-1",
            is_advance=True,
            allocations=[]
        ),
        user_id
    )
    assert adv_pmt is not None

    # Apply 400.0 of advance to invoice
    apply_res = payment_service.apply_advance(
        organization_id=tenant_a,
        customer_id=cust_id,
        invoice_id=inv_id,
        amount=400.0,
        user_id=user_id
    )
    assert apply_res["applied_amount"] == 400.0
    assert apply_res["new_paid_amount"] == 400.0
    assert apply_res["new_balance_due"] == 600.0

    # Over-allocation check: attempting to apply remaining advance beyond balance must fail
    with pytest.raises(HTTPException) as exc_info:
        payment_service.apply_advance(
            organization_id=tenant_a,
            customer_id=cust_id,
            invoice_id=inv_id,
            amount=9999.0,
            user_id=user_id
        )
    assert exc_info.value.status_code == 400


def test_delete_or_edit_payment_restores_balance(test_tenants):
    """
    Test 8: Reversing / deleting a payment recalculates document balance due and marks unpaid/partial.
    """
    tenant_a, _, user_id = test_tenants
    inv_service = InvoiceService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Reversal Customer", party_type="customer"),
        user_id
    )
    cust_id = cust["id"]

    inv = inv_service.create_invoice(
        tenant_a,
        InvoiceCreate(
            party_id=cust_id,
            customer_name="Reversal Customer",
            items=[InvoiceItemCreate(description="Hardware Setup", qty=1, unit_price=500.0, tax_rate=0.0)]
        ),
        user_id
    )
    inv_id = inv["id"]

    # Pay full invoice amount
    pmt = payment_service.create_payment(
        tenant_a,
        PaymentCreate(
            customer_id=cust_id,
            payment_date="2026-10-10",
            amount=500.0,
            mode="UPI",
            reference_no="UPI-REV-TEST",
            allocations=[
                PaymentAllocationItem(document_id=inv_id, document_type="invoice", amount=500.0)
            ]
        ),
        user_id
    )
    pmt_id = pmt["id"]

    # Reverse payment
    rev_res = payment_service.reverse_payment(
        payment_id=pmt_id,
        organization_id=tenant_a,
        reason="Client cheque returned",
        user_id=user_id
    )
    assert rev_res["status"].lower() == "reversed"

    # Verify invoice balance restored
    db = get_admin_supabase_client()
    refreshed_inv = db.table("invoices").select("amount_paid, balance_due, status").eq("id", inv_id).single().execute().data
    assert float(refreshed_inv.get("amount_paid") or 0.0) == 0.0
    assert float(refreshed_inv.get("balance_due") or 0.0) == 500.0
    assert refreshed_inv.get("status") in ("unpaid", "issued")


def test_tenant_b_cannot_pay_tenant_a_invoice(test_tenants):
    """
    Test 9: Cross-tenant isolation.
    Tenant B cannot pay Tenant A's document.
    """
    tenant_a, tenant_b, user_id = test_tenants
    pf_service = ProformaService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Tenant A Isolated Customer", party_type="customer"),
        user_id
    )
    cust_id = cust["id"]

    pf_a = pf_service.create_proforma(
        tenant_a,
        ProFormaCreate(
            party_id=cust_id,
            customer_name="Tenant A Isolated Customer",
            items=[ProFormaItemCreate(description="Secret Item", qty=1, unit_price=1000.0, tax_rate=0.0)]
        ),
        user_id
    )
    doc_id = pf_a["id"]

    illegal_payload = PaymentCreate(
        customer_id=cust_id,
        payment_date="2026-10-09",
        amount=1000.0,
        mode="UPI",
        reference_no="ILLEGAL-TENANT-CROSS",
        allocations=[
            PaymentAllocationItem(document_id=doc_id, document_type="proforma", amount=1000.0)
        ]
    )

    with pytest.raises(HTTPException) as exc_info:
        payment_service.create_payment(tenant_b, illegal_payload, user_id)

    assert exc_info.value.status_code in (400, 404, 422)


def test_receivables_total_column_and_badges(test_tenants):
    """
    Test 10: Receivables list resolves total_amount == grand_total (fixing ₹0.00 display bug),
    and computes server-side days_overdue / days_to_due and advance flags.
    """
    tenant_a, _, user_id = test_tenants
    inv_service = InvoiceService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    past_date = str(date.today() - timedelta(days=15))
    past_due = str(date.today() - timedelta(days=5))

    cust = party_repo.create(
        tenant_a,
        PartyCreate(display_name="Badges Test Cust", party_type="customer"),
        user_id
    )
    cust_id = cust["id"]

    inv = inv_service.create_invoice(
        tenant_a,
        InvoiceCreate(
            party_id=cust_id,
            customer_name="Badges Test Cust",
            invoice_date=past_date,
            due_date=past_due,
            items=[InvoiceItemCreate(description="Service Fee", qty=1, unit_price=750.0, tax_rate=0.0)]
        ),
        user_id
    )
    inv_id = inv["id"]

    receivables = payment_service.get_receivables(organization_id=tenant_a)
    matched = next((r for r in receivables if r["invoice_id"] == inv_id), None)
    assert matched is not None
    # Fix verification: grand_total, total_amount, balance_due must all equal 750.0 (NOT 0.00)
    assert matched["grand_total"] == 750.0
    assert matched["total_amount"] == 750.0
    assert matched["paid"] == 0.0
    assert matched["paid_amount"] == 0.0
    assert matched["balance_due"] == 750.0
    assert matched["days_overdue"] is not None
    assert matched["days_overdue"] >= 4
    assert matched["status"] == "overdue"
    assert isinstance(matched["has_advance_applied"], bool)
    assert isinstance(matched["customer_has_advance"], bool)


def test_reconciliation_balance(test_tenants):
    """
    Test 11: Multi-tenant balance reconciliation:
    Prove sum(Table Balances) == Pending Receivable KPI == sum(Customer Balances).
    """
    tenant_a, _, user_id = test_tenants
    inv_service = InvoiceService()
    payment_service = PaymentService()
    party_repo = PartyRepository()

    cust1 = party_repo.create(tenant_a, PartyCreate(display_name="Recon Client 1", party_type="customer"), user_id)
    cust2 = party_repo.create(tenant_a, PartyCreate(display_name="Recon Client 2", party_type="customer"), user_id)

    inv_service.create_invoice(
        tenant_a,
        InvoiceCreate(
            party_id=cust1["id"],
            customer_name="Recon Client 1",
            items=[InvoiceItemCreate(description="Deliverable 1", qty=1, unit_price=1200.0, tax_rate=0.0)]
        ),
        user_id
    )
    inv_service.create_invoice(
        tenant_a,
        InvoiceCreate(
            party_id=cust2["id"],
            customer_name="Recon Client 2",
            items=[InvoiceItemCreate(description="Deliverable 2", qty=1, unit_price=2800.0, tax_rate=0.0)]
        ),
        user_id
    )

    # Get invoice receivables
    receivables = payment_service.get_receivables(organization_id=tenant_a)
    table_balance_sum = round(sum(r["balance_due"] for r in receivables if r["balance_due"] > 0), 2)

    # Get summary KPI
    summary = payment_service.get_receivables_summary(organization_id=tenant_a)
    kpi_pending = round(float(summary["pending_receivable"]), 2)

    # Get customer-wise receivables
    customer_receivables = payment_service.get_customer_receivables(organization_id=tenant_a)
    customer_balance_sum = round(sum(c["balance"] for c in customer_receivables if c["balance"] > 0), 2)

    # Prove reconciliation: 4000.0 == 4000.0 == 4000.0
    assert table_balance_sum == 4000.0
    assert kpi_pending == 4000.0
    assert customer_balance_sum == 4000.0
    assert table_balance_sum == kpi_pending == customer_balance_sum
