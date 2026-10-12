import sys
import os
import uuid

# Add backend directory to sys.path
backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, backend_dir)

from app.core.supabase import get_admin_supabase_client
from app.repositories.party_repository import PartyRepository
from app.schemas.party import PartyCreate
from app.services.proforma_service import ProformaService
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate

def test_parties_saving():
    db = get_admin_supabase_client()
    # Get a demo company ID
    orgs = db.table("organizations").select("id").limit(1).execute()
    if not orgs.data:
        print("[ERROR] No organization found in DB.")
        return
    
    org_id = orgs.data[0]["id"]
    member = db.table("organization_members").select("user_id").eq("organization_id", org_id).limit(1).execute()
    user_id = member.data[0]["user_id"] if member.data else None
    print(f"Testing Party Creation for Org ID: {org_id}, User ID: {user_id}")

    test_customer_name = f"Test Customer {uuid.uuid4().hex[:6]}"
    
    # 1. Test Direct Party Repo Creation
    party_repo = PartyRepository()
    party_data = PartyCreate(
        party_type="customer",
        display_name=test_customer_name,
        legal_name=f"{test_customer_name} Pvt Ltd",
        contact_person=test_customer_name,
        phone="+919887073124",
        email="testcustomer@example.com",
        billing_address_line1="123 Test St",
        city="Thoothukudi",
        state_name="Tamil Nadu",
        country_code="IN",
        gstin="33AAAAA0000A1Z5"
    )

    created = party_repo.create(org_id, party_data, user_id)
    print(f"[OK] Direct Party Created in Supabase 'parties' table: ID = {created.get('id')}, Name = {created.get('display_name')}")

    # Verify query in parties table
    res = db.table("parties").select("*").eq("id", created["id"]).execute()
    assert res.data, "Failed to query created party from Supabase!"
    print(f"[SUCCESS] Verified row in Supabase parties table for party ID: {created['id']}")

    # 2. Test ProForma Service Auto Customer Creation
    pf_service = ProformaService()
    pf_customer_name = f"Auto Customer {uuid.uuid4().hex[:6]}"
    pf_data = ProFormaCreate(
        template_id="modern-emerald",
        proforma_date="2026-10-09",
        customer_name=pf_customer_name,
        customer_company_name=f"{pf_customer_name} Corp",
        customer_address="456 Beach Road",
        customer_city="Goa",
        customer_gstin="30BBBBB1111B2Z6",
        customer_phone="+919876543210",
        customer_email="autocustomer@example.com",
        place_of_supply_state="Goa",
        save_customer_to_master=True,
        items=[
            ProFormaItemCreate(
                description="Consulting Service",
                qty=1,
                unit_price=5000,
                tax_rate=18
            )
        ]
    )

    pf_result = pf_service.create_proforma(org_id, pf_data, user_id)
    assert pf_result.get("party_id"), "party_id was not set by save_customer_to_master!"
    
    saved_party = db.table("parties").select("*").eq("id", pf_result["party_id"]).execute()
    assert saved_party.data, "Auto-saved customer row missing from Supabase parties table!"
    print(f"[SUCCESS] ProForma auto-saved customer to Supabase parties table: ID = {pf_result['party_id']}, Name = {saved_party.data[0]['display_name']}")

if __name__ == "__main__":
    test_parties_saving()
