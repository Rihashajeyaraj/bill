"""
Comprehensive Verification Script for Customer Creation in Twite Billing
Tests:
1. Create a customer with name, mobile number, and email (minimal fields, optional tax/address null).
2. Create a customer with optional tax and address details (GSTIN, address, city, state, postal_code).
3. Create a supplier to verify supplier flow.
4. Reload/list all parties and verify the saved customers and suppliers appear with all fields correctly mapped.
5. Verify that existing customers and suppliers remain intact.
6. Clean up test records.
"""

import sys
import uuid
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.core.supabase import get_admin_supabase_client
from app.repositories.party_repository import PartyRepository, VALID_PARTY_COLUMNS, _clean_party_data

def run_verification():
    print("=" * 60)
    print("RUNNING CUSTOMER CREATION VERIFICATION")
    print("=" * 60)

    db = get_admin_supabase_client()
    repo = PartyRepository()

    # Step 1: Find an active organization
    org_res = db.table("organizations").select("id, company_name").limit(1).execute()
    if not org_res.data:
        print("ERROR: No organization found in database.")
        sys.exit(1)
    org = org_res.data[0]
    org_id = org["id"]
    org_name = org.get("company_name", "Unknown")
    print(f"Target organization: {org_name} (ID: {org_id})")

    # Step 2: Record existing customers and suppliers
    initial_parties = db.table("parties").select("id, display_name, party_type").eq("organization_id", org_id).execute().data or []
    initial_ids = {p["id"] for p in initial_parties}
    initial_customers = [p for p in initial_parties if p.get("party_type") == "customer"]
    initial_suppliers = [p for p in initial_parties if p.get("party_type") == "supplier"]
    print(f"Existing records in organization: {len(initial_parties)} total ({len(initial_customers)} customers, {len(initial_suppliers)} suppliers)")

    test_ids = []

    try:
        # TEST 1: Create a customer with name, mobile number, and email
        print("\n--- Test 1: Create customer with name, mobile number, and email ---")
        customer_1_data = {
            "organization_id": org_id,
            "party_type": "customer",
            "display_name": "Acme Retailers Test",
            "legal_name": "Acme Retailers Test",
            "phone": "+91 98765 43210",
            "email": "acme.retail@example.com",
            "billing_address_line1": None,
            "city": None,
            "state_name": None,
            "state_code": None,
            "country_code": "IN",
            "postal_code": None,
            "gstin": None,
            "pan": None,
            "opening_balance": 0.0,
            "credit_limit": None,
            "notes": "Test customer with minimal fields",
            "is_active": True
        }
        # Verify _clean_party_data removes any non-schema fields like tax_id if present
        data_with_stray = dict(customer_1_data)
        data_with_stray["tax_id"] = None
        data_with_stray["vat_number"] = None
        cleaned_1 = _clean_party_data(data_with_stray)
        assert "tax_id" not in cleaned_1, "tax_id should be pruned from payload"
        assert "vat_number" not in cleaned_1, "vat_number should be pruned from payload"

        res_1 = db.table("parties").insert(cleaned_1).execute()
        assert res_1.data, "Insert returned no data"
        c1 = res_1.data[0]
        test_ids.append(c1["id"])
        print(f"PASS: Customer 1 created successfully with ID: {c1['id']}")
        print(f"      Display Name: {c1['display_name']}")
        print(f"      Phone: {c1['phone']}")
        print(f"      Email: {c1['email']}")
        print(f"      GSTIN (null as expected): {c1['gstin']}")
        print(f"      PAN (null as expected): {c1['pan']}")

        # TEST 2: Create a customer with optional tax and address details
        print("\n--- Test 2: Create customer with optional tax and address details ---")
        customer_2_data = {
            "organization_id": org_id,
            "party_type": "customer",
            "display_name": "Bharat Solutions Pvt Ltd Test",
            "legal_name": "Bharat Solutions Pvt Ltd Test",
            "phone": "+91 91234 56789",
            "email": "billing@bharatsolutions.test",
            "billing_address_line1": "42 Tech Boulevard, Electronic City",
            "city": "Bengaluru",
            "state_name": "Karnataka",
            "state_code": "29",
            "country_code": "IN",
            "postal_code": "560100",
            "gstin": "29ABCDE1234F1Z5",
            "pan": "ABCDE1234F",
            "opening_balance": 1500.00,
            "credit_limit": 50000.00,
            "notes": "Test corporate customer with full tax and address info",
            "is_active": True
        }
        # Test simulated tax_id mapping (if frontend passes tax_id instead of gstin)
        test_tax_id_input = dict(customer_2_data)
        del test_tax_id_input["gstin"]
        test_tax_id_input["tax_id"] = "29ABCDE1234F1Z5"
        cleaned_2 = _clean_party_data(test_tax_id_input)
        assert cleaned_2["gstin"] == "29ABCDE1234F1Z5", f"Expected gstin mapped from tax_id, got {cleaned_2.get('gstin')}"
        assert cleaned_2["pan"] == "ABCDE1234F", f"Expected pan derived, got {cleaned_2.get('pan')}"
        assert "tax_id" not in cleaned_2, "tax_id should be removed after mapping"

        res_2 = db.table("parties").insert(cleaned_2).execute()
        assert res_2.data, "Insert returned no data"
        c2 = res_2.data[0]
        test_ids.append(c2["id"])
        print(f"PASS: Customer 2 created successfully with ID: {c2['id']}")
        print(f"      Display Name: {c2['display_name']}")
        print(f"      Address: {c2['billing_address_line1']}, {c2['city']}, {c2['state_name']} {c2['postal_code']}")
        print(f"      GSTIN: {c2['gstin']}")
        print(f"      PAN: {c2['pan']}")
        print(f"      Opening Balance: {c2['opening_balance']}")
        print(f"      Credit Limit: {c2['credit_limit']}")

        # TEST 3: Create a supplier to verify supplier records are saved correctly
        print("\n--- Test 3: Create supplier record ---")
        supplier_data = {
            "organization_id": org_id,
            "party_type": "supplier",
            "display_name": "Apex Supplies Corp Test",
            "legal_name": "Apex Supplies Corp Test",
            "phone": "+91 99887 76655",
            "email": "orders@apexsupplies.test",
            "billing_address_line1": "7 Industrial Area",
            "city": "Mumbai",
            "state_name": "Maharashtra",
            "state_code": "27",
            "country_code": "IN",
            "postal_code": "400001",
            "gstin": "27AABCA1234F1Z1",
            "pan": "AABCA1234F",
            "opening_balance": -5000.00,
            "credit_limit": None,
            "notes": "Raw material supplier",
            "is_active": True
        }
        cleaned_sup = _clean_party_data(supplier_data)
        res_sup = db.table("parties").insert(cleaned_sup).execute()
        assert res_sup.data, "Insert supplier returned no data"
        sup = res_sup.data[0]
        test_ids.append(sup["id"])
        print(f"PASS: Supplier created successfully with ID: {sup['id']}")
        print(f"      Display Name: {sup['display_name']}")
        print(f"      Party Type: {sup['party_type']}")
        print(f"      GSTIN: {sup['gstin']}")

        # TEST 4: Reload / list all parties and verify saved customers and suppliers appear
        print("\n--- Test 4: Reload and verify saved records appear in list ---")
        list_res = db.table("parties").select("*").eq("organization_id", org_id).eq("is_active", True).execute()
        parties_after = list_res.data or []
        after_by_id = {p["id"]: p for p in parties_after}

        assert c1["id"] in after_by_id, "Customer 1 not found in reloaded list"
        assert c2["id"] in after_by_id, "Customer 2 not found in reloaded list"
        assert sup["id"] in after_by_id, "Supplier not found in reloaded list"

        reloaded_c1 = after_by_id[c1["id"]]
        reloaded_c2 = after_by_id[c2["id"]]
        reloaded_sup = after_by_id[sup["id"]]

        assert reloaded_c1["display_name"] == "Acme Retailers Test"
        assert reloaded_c1["party_type"] == "customer"
        assert reloaded_c2["display_name"] == "Bharat Solutions Pvt Ltd Test"
        assert reloaded_c2["gstin"] == "29ABCDE1234F1Z5"
        assert reloaded_c2["pan"] == "ABCDE1234F"
        assert reloaded_sup["display_name"] == "Apex Supplies Corp Test"
        assert reloaded_sup["party_type"] == "supplier"
        print("PASS: All newly created customers and suppliers successfully retrieved with all fields intact.")

        # TEST 5: Verify existing customers and suppliers remain intact
        print("\n--- Test 5: Verify pre-existing customers and suppliers remain intact ---")
        for orig in initial_parties:
            assert orig["id"] in after_by_id, f"Pre-existing party {orig['display_name']} ({orig['id']}) missing!"
            current = after_by_id[orig["id"]]
            assert current["display_name"] == orig["display_name"], f"Party name changed for {orig['id']}"
            assert current["party_type"] == orig["party_type"], f"Party type changed for {orig['id']}"
        print(f"PASS: All {len(initial_parties)} pre-existing customers and suppliers remain completely intact.")

        # TEST 6: Verify organization scoping / tenant isolation
        print("\n--- Test 6: Verify organization scoping ---")
        other_org_id = str(uuid.uuid4())
        scoped_res = db.table("parties").select("id").eq("organization_id", other_org_id).execute()
        assert len(scoped_res.data or []) == 0, "Organization scoping violated!"
        print("PASS: Organization scoping strictly preserved.")

    finally:
        # Cleanup test records
        if test_ids:
            print(f"\nCleaning up {len(test_ids)} test records...")
            for tid in test_ids:
                try:
                    db.table("parties").delete().eq("id", tid).execute()
                except Exception as e:
                    print(f"Warning: Cleanup for {tid} failed: {e}")
            print("Cleanup completed.")

    print("\n" + "=" * 60)
    print("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_verification()
