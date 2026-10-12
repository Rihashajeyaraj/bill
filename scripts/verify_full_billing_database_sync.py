import sys
import os
import uuid

backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, backend_dir)

from app.core.supabase import get_admin_supabase_client
from app.services.proforma_service import ProformaService
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate

def verify_full_flow():
    db = get_admin_supabase_client()
    
    # Get organization ID
    orgs = db.table("organizations").select("id").limit(1).execute()
    if not orgs.data:
        print("[ERROR] No organization found.")
        return
    org_id = orgs.data[0]["id"]
    
    # Get valid user ID
    member = db.table("organization_members").select("user_id").eq("organization_id", org_id).limit(1).execute()
    user_id = member.data[0]["user_id"] if member.data else "00000000-0000-0000-0000-000000000000"

    print(f"--- TESTING COMPLETE SUPABASE Persistance FLOW FOR ORG: {org_id} ---")

    # Step 1: Create Pro Forma Invoice with Auto-Customer Save and Advance Payment
    cust_name = f"Apex Logistics {uuid.uuid4().hex[:6]}"
    pf_service = ProformaService()
    
    pf_data = ProFormaCreate(
        template_id="modern-emerald",
        proforma_date="2026-10-09",
        valid_till="2026-11-09",
        customer_name=cust_name,
        customer_company_name=f"{cust_name} Ltd",
        customer_address="12 Main Boulevard",
        customer_city="Chennai",
        customer_gstin="33AAAAA9999A1Z1",
        customer_phone="+919988776655",
        customer_email="apex@example.com",
        place_of_supply_state="Tamil Nadu",
        save_customer_to_master=True,
        amount_paid=2500.0,
        items=[
            ProFormaItemCreate(
                description="Freight Shipping Services",
                hsn_sac="996511",
                qty=2,
                unit="CONTAINER",
                unit_price=5000,
                tax_rate=18
            )
        ]
    )

    proforma = pf_service.create_proforma(org_id, pf_data, user_id)
    pf_id = proforma["id"]
    party_id = proforma.get("party_id")
    print(f"[OK] 1. Pro Forma Created: ID={pf_id}, No={proforma.get('proforma_no')}, Party ID={party_id}")

    # Verify Party Table Row
    assert party_id, "party_id must be populated!"
    party_row = db.table("parties").select("*").eq("id", party_id).execute()
    assert party_row.data, "Customer row must exist in Supabase 'parties' table!"
    print(f"[SUCCESS] 2. Customer row verified in Supabase 'parties' table: {party_row.data[0]['display_name']}")

    # Verify Pro Forma Items Table Rows
    pf_items = db.table("proforma_invoice_items").select("*").eq("proforma_id", pf_id).execute()
    assert pf_items.data, "Line items must exist in Supabase 'proforma_invoice_items' table!"
    print(f"[SUCCESS] 3. Proforma items verified in Supabase 'proforma_invoice_items' table: {len(pf_items.data)} items found")

    # Step 2: Convert Pro Forma to Tax Invoice
    tax_inv = pf_service.convert_to_invoice(pf_id, org_id, user_id, amount_paid=2500.0)
    inv_id = tax_inv["id"]
    print(f"[OK] 4. Converted to Tax Invoice: ID={inv_id}, Invoice No={tax_inv.get('invoice_no')}")

    # Verify Tax Invoice Row in Supabase 'invoices' table
    inv_row = db.table("invoices").select("*").eq("id", inv_id).execute()
    assert inv_row.data, "Tax invoice row must exist in Supabase 'invoices' table!"
    assert inv_row.data[0].get("party_id") == party_id, "Tax invoice party_id must match Customer ID!"
    print(f"[SUCCESS] 5. Tax invoice row verified in Supabase 'invoices' table with linked party_id={party_id}")

    # Verify Tax Invoice Items Row in Supabase 'invoice_items' table
    inv_items = db.table("invoice_items").select("*").eq("invoice_id", inv_id).execute()
    assert inv_items.data, "Line items must exist in Supabase 'invoice_items' table!"
    print(f"[SUCCESS] 6. Tax invoice items verified in Supabase 'invoice_items' table: {len(inv_items.data)} items found")

    # Verify Payment Row in Supabase 'payments' table
    payments = db.table("payments").select("*").eq("organization_id", org_id).eq("party_id", party_id).execute()
    assert payments.data, "Payment record must exist in Supabase 'payments' table!"
    print(f"[SUCCESS] 7. Payment row verified in Supabase 'payments' table: Amount={payments.data[0]['amount']}, No={payments.data[0]['payment_no']}")

    # Verify Proforma Status in Supabase 'proforma_invoices' table
    updated_pf = db.table("proforma_invoices").select("status, converted_document_id").eq("id", pf_id).execute()
    assert updated_pf.data[0]["status"] == "CONVERTED", "Proforma status must be updated to CONVERTED!"
    assert updated_pf.data[0]["converted_document_id"] == inv_id, "Proforma converted_document_id must match Tax Invoice ID!"
    print(f"[SUCCESS] 8. Proforma status updated to CONVERTED with linked tax_invoice_id={inv_id}")

    print("\n--- ALL SUPABASE TABLES PERSISTENCE VERIFIED 100% SUCCESSFULLY ---")

if __name__ == "__main__":
    verify_full_flow()
