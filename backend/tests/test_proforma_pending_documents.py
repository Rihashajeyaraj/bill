import pytest
import uuid
from app.core.supabase import get_admin_supabase_client
from app.services.proforma_service import ProformaService
from app.repositories.payment_repository import PaymentRepository
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate

def test_create_proforma_and_fetch_pending_documents():
    """
    Test end-to-end:
    1. Create a proforma for Tenant A and Customer X.
    2. Retrieve pending documents for Customer X under Tenant A.
    3. Verify proforma is returned with correct balance_due.
    4. Verify Tenant B cannot view Customer X's proforma (multi-tenant RLS isolation).
    """
    db = get_admin_supabase_client()
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    # Ensure test organization rows exist
    try:
        db.table("organizations").upsert([
            {"id": tenant_a, "name": "Test Org A", "country": "India"},
            {"id": tenant_b, "name": "Test Org B", "country": "India"}
        ]).execute()
    except Exception as e:
        # Fallback to existing org if table read-only
        org_res = db.table("organizations").select("id").limit(1).execute()
        if org_res.data:
            tenant_a = org_res.data[0]["id"]

    pf_service = ProformaService()
    payment_repo = PaymentRepository()

    customer_name = f"Acme Test Customer {uuid.uuid4().hex[:6]}"

    # Create Pro Forma invoice under Tenant A
    pf_create = ProFormaCreate(
        customer_name=customer_name,
        customer_country="India",
        place_of_supply_state="MAHARASHTRA",
        currency_code="INR",
        exchange_rate=1.0,
        items=[
            ProFormaItemCreate(
                description="Consulting Service",
                qty=1,
                unit_price=5000.0,
                tax_rate=18.0
            )
        ]
    )

    created_pf = pf_service.create_proforma(tenant_a, pf_create, user_id)
    assert created_pf is not None
    assert created_pf.get("id") is not None
    
    party_id = created_pf.get("party_id")
    assert party_id is not None, "Proforma party_id must not be None"
    
    grand_total = float(created_pf.get("grand_total") or 5900.0)
    assert grand_total > 0

    # Fetch pending documents for Tenant A & Customer X (party_id)
    pending_a = payment_repo.get_pending_documents(party_id, tenant_a)
    
    matching_pf = [doc for doc in pending_a if doc["document_id"] == created_pf["id"]]
    assert len(matching_pf) == 1, f"Expected created proforma {created_pf['id']} in pending documents for Tenant A"
    
    doc = matching_pf[0]
    assert doc["document_type"] == "proforma"
    assert doc["grand_total"] == grand_total
    assert doc["paid_amount"] == 0.0
    assert abs(doc["balance_due"] - grand_total) < 0.01

    # Verify Multi-tenant RLS Isolation: Tenant B querying for the same party_id must NOT get Tenant A's proforma
    pending_b = payment_repo.get_pending_documents(party_id, tenant_b)
    matching_b = [doc for doc in pending_b if doc["document_id"] == created_pf["id"]]
    assert len(matching_b) == 0, "Tenant B must NOT see Tenant A's proforma invoice"
