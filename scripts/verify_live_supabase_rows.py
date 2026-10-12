import sys
import os
import time
import json
import requests

sys.path.insert(0, "backend")

# Ensure UTF-8 output encoding for Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
load_dotenv("backend/.env")

from app.core.config import settings
from app.repositories.company_repository import CompanyRepository
from app.repositories.party_repository import PartyRepository
from app.repositories.item_repository import ItemRepository
from app.repositories.proforma_repository import ProformaRepository
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.payment_repository import PaymentRepository
from app.services.proforma_service import ProformaService
from app.schemas.party import PartyCreate
from app.schemas.item import ItemCreate
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate

def run_live_supabase_verification():
    print("=" * 75)
    print("LIVE PRODUCTION SUPABASE DATABASE VERIFICATION")
    print("Direct PostgREST API Row Verification (Source of Truth)")
    print("=" * 75)

    timestamp = int(time.time())
    supabase_url = settings.SUPABASE_URL
    anon_key = settings.SUPABASE_ANON_KEY

    # Step 0: Authenticate live user to get valid JWT token for RLS
    user_email = f"live.verifier.{timestamp}@twitebilling.local"
    user_pass = "LiveVerification123!"

    r_auth = requests.post(
        f"{supabase_url}/auth/v1/signup",
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        json={"email": user_email, "password": user_pass}
    )
    auth_data = r_auth.json()
    auth_token = auth_data.get("access_token")
    user_id = (auth_data.get("user") or {}).get("id") or auth_data.get("id")

    assert auth_token, f"Failed to authenticate with Supabase: {auth_data}"
    print(f"\n[AUTH SUCCESS] User ID: {user_id}")

    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

    # Helper function to perform raw HTTP GET against Supabase PostgREST
    def query_live_table(table_name, filter_query=""):
        url = f"{supabase_url}/rest/v1/{table_name}?{filter_query}"
        resp = requests.get(url, headers=headers)
        return resp.status_code, resp.json()

    # 1. CREATE COMPANY
    print("\n--- 1. VERIFYING COMPANY CREATION IN SUPABASE ---")
    company_repo = CompanyRepository(token=auth_token)
    comp_data = company_repo.create(
        company_name=f"Twite SaaS Enterprise {timestamp}",
        owner_user_id=user_id,
        payload={
            "country_code": "IN",
            "state_name": "Tamil Nadu",
            "city": "Chennai",
            "address_line1": "100 IT Corridor",
            "email": f"billing@{timestamp}.twitesaas.com",
            "gstin": "33AABCT1234F1Z9"
        }
    )
    company_id = comp_data["id"]
    print(f"Company ID created: {company_id}")

    # Query raw PostgREST table
    status_code, comp_rows = query_live_table("organizations", f"id=eq.{company_id}")
    print(f"PostgREST HTTP Status: {status_code}")
    print("Live Row Data from Supabase Table Editor:")
    print(json.dumps(comp_rows, indent=2))
    assert status_code == 200 and len(comp_rows) > 0, "Company row not found in live Supabase table!"

    # 2. CREATE CUSTOMER
    print("\n--- 2. VERIFYING CUSTOMER (PARTY) CREATION IN SUPABASE ---")
    party_repo = PartyRepository(token=auth_token)
    party_data = PartyCreate(
        party_type="customer",
        display_name=f"Global Logistics Corp {timestamp}",
        legal_name=f"Global Logistics Private Limited",
        email=f"billing@{timestamp}.globallogistics.com",
        phone="+91-9123456789",
        gstin="33GBLGT9876C1Z4",
        city="Chennai",
        state_name="Tamil Nadu",
        country_code="IN"
    )
    party_res = party_repo.create(organization_id=company_id, party_data=party_data, user_id=user_id)
    party_id = party_res["id"]
    print(f"Customer Party ID created: {party_id}")

    # Query raw PostgREST table
    status_code, party_rows = query_live_table("parties", f"id=eq.{party_id}")
    print(f"PostgREST HTTP Status: {status_code}")
    print("Live Row Data from Supabase Table Editor:")
    print(json.dumps(party_rows, indent=2))
    assert status_code == 200 and len(party_rows) > 0, "Customer row not found in live Supabase table!"

    # 3. CREATE ITEM
    print("\n--- 3. VERIFYING ITEM (PRODUCT/SERVICE) CREATION IN SUPABASE ---")
    item_repo = ItemRepository()
    item_data = ItemCreate(
        item_type="service",
        item_name=f"Enterprise Billing API License {timestamp}",
        sku=f"API-{timestamp}",
        hsn_sac="998314",
        unit="Subscription",
        sale_price=25000.0,
        tax_rate=18.0
    )
    item_res = item_repo.create(organization_id=company_id, item_data=item_data, user_id=user_id)
    item_id = item_res["id"]
    print(f"Item ID created: {item_id}")

    # Query raw PostgREST table
    status_code, item_rows = query_live_table("items", f"id=eq.{item_id}")
    print(f"PostgREST HTTP Status: {status_code}")
    print("Live Row Data from Supabase Table Editor:")
    print(json.dumps(item_rows, indent=2))
    assert status_code == 200 and len(item_rows) > 0, "Item row not found in live Supabase table!"

    # 4. CREATE PROFORMA
    print("\n--- 4. VERIFYING PROFORMA INVOICE & ITEMS CREATION IN SUPABASE ---")
    proforma_service = ProformaService(token=auth_token)
    pf_create = ProFormaCreate(
        party_id=party_id,
        proforma_date="2026-10-08",
        due_date="2026-10-22",
        place_of_supply_state="Tamil Nadu",
        items=[
            ProFormaItemCreate(
                item_id=item_id,
                description="Enterprise Billing API License - Annual Subscription",
                hsn_sac="998314",
                qty=1.0,
                unit="Subscription",
                unit_price=25000.0,
                tax_rate=18.0
            )
        ],
        notes="Proforma estimate for enterprise cloud subscription"
    )
    pf_res = proforma_service.create_proforma(organization_id=company_id, data=pf_create, user_id=user_id)
    pf_id = pf_res["id"]
    print(f"Proforma ID created: {pf_id}")

    # Query raw PostgREST tables for header and line items
    status_code_h, pf_header_rows = query_live_table("proforma_invoices", f"id=eq.{pf_id}")
    status_code_i, pf_item_rows = query_live_table("proforma_invoice_items", f"proforma_id=eq.{pf_id}")
    print(f"Header HTTP Status: {status_code_h}, Items HTTP Status: {status_code_i}")
    print("Live Proforma Header Row:")
    print(json.dumps(pf_header_rows, indent=2))
    print(f"Live Proforma Items ({len(pf_item_rows)} rows):")
    print(json.dumps(pf_item_rows, indent=2))
    assert status_code_h == 200 and len(pf_header_rows) > 0, "Proforma header row not found in live Supabase table!"
    assert status_code_i == 200 and len(pf_item_rows) > 0, "Proforma items rows not found in live Supabase table!"

    # 5. CONVERT TO TAX INVOICE
    print("\n--- 5. VERIFYING TAX INVOICE & ITEMS CREATION IN SUPABASE ---")
    inv_res = proforma_service.convert_to_invoice(proforma_id=pf_id, organization_id=company_id, user_id=user_id)
    inv_id = inv_res["id"]
    print(f"Tax Invoice ID created: {inv_id}")

    # Query raw PostgREST tables for header and line items
    status_code_inv_h, inv_header_rows = query_live_table("invoices", f"id=eq.{inv_id}")
    status_code_inv_i, inv_item_rows = query_live_table("invoice_items", f"invoice_id=eq.{inv_id}")
    print(f"Header HTTP Status: {status_code_inv_h}, Items HTTP Status: {status_code_inv_i}")
    print("Live Tax Invoice Header Row:")
    print(json.dumps(inv_header_rows, indent=2))
    print(f"Live Tax Invoice Items ({len(inv_item_rows)} rows):")
    print(json.dumps(inv_item_rows, indent=2))
    assert status_code_inv_h == 200 and len(inv_header_rows) > 0, "Tax Invoice header row not found in live Supabase table!"
    assert status_code_inv_i == 200 and len(inv_item_rows) > 0, "Tax Invoice items rows not found in live Supabase table!"

    # 6. RECEIVE PAYMENT
    print("\n--- 6. VERIFYING PAYMENT IN CREATION & ALLOCATION IN SUPABASE ---")
    payment_repo = PaymentRepository(token=auth_token)
    grand_total = float(inv_res.get("grand_total") or 29500.0)
    pmt_res = payment_repo.create_payment(
        organization_id=company_id,
        payment_no=payment_repo.generate_payment_no(company_id),
        payment_date="2026-10-08",
        party_id=party_id,
        amount=grand_total,
        amount_received=grand_total,
        tds_amount=0.0,
        tds_rate=0.0,
        payment_mode="Bank Transfer",
        reference_no=f"NEFT-{timestamp}",
        notes="Full payment against Tax Invoice",
        user_id=user_id,
        allocations=[
            {
                "invoice_id": inv_id,
                "amount_allocated": grand_total
            }
        ]
    )
    pmt_id = pmt_res["id"]
    print(f"Payment ID created: {pmt_id}")

    # Query raw PostgREST table for payment
    status_code_pmt, pmt_rows = query_live_table("payments", f"id=eq.{pmt_id}")
    print(f"Payment HTTP Status: {status_code_pmt}")
    print("Live Payment Row from Supabase Table Editor:")
    print(json.dumps(pmt_rows, indent=2))
    assert status_code_pmt == 200 and len(pmt_rows) > 0, "Payment row not found in live Supabase table!"

    # Query raw PostgREST table for updated invoice status
    _, updated_inv_rows = query_live_table("invoices", f"id=eq.{inv_id}")
    print("\nUpdated Tax Invoice Status in Live Supabase Table:")
    print(json.dumps(updated_inv_rows, indent=2))
    assert updated_inv_rows[0].get("status") == "paid", "Tax Invoice status was not updated to paid!"

    print("\n" + "=" * 75)
    print("CONFIRMED: ALL 6 ENTITIES CREATED REAL, VISIBLE ROWS IN SUPABASE!")
    print("=" * 75)

if __name__ == "__main__":
    run_live_supabase_verification()
