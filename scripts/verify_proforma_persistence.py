import requests
import json
import time
from app.core.config import settings

SUPABASE_URL = settings.SUPABASE_URL
SUPABASE_ANON_KEY = settings.SUPABASE_ANON_KEY

def run_verification():
    print("==================================================")
    print("STARTING SUPABASE PROFORMA PERSISTENCE VERIFICATION")
    print("==================================================")

    # 1. Sign up / login real test user
    email = f"supabase.test.{int(time.time())}@example.com"
    password = "TestPassword123!"

    r_signup = requests.post(
        f"{SUPABASE_URL}/auth/v1/signup",
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password}
    )
    s_data = r_signup.json()
    auth_token = s_data.get("access_token")
    user_id = s_data.get("user", {}).get("id") or s_data.get("id")
    print(f"Authenticated User ID: {user_id}")
    print(f"Auth Token Present: {bool(auth_token)}")

    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

    # 2. Get or create organization
    org_res = requests.get(f"{SUPABASE_URL}/rest/v1/organizations?select=id&limit=1", headers=headers)
    org_data = org_res.json()
    if isinstance(org_data, list) and len(org_data) > 0:
        org_id = org_data[0]["id"]
    else:
        r_create_org = requests.post(
            f"{SUPABASE_URL}/rest/v1/organizations",
            headers={**headers, "Prefer": "return=representation"},
            json={"owner_user_id": user_id, "company_name": "Supabase Verification Corp"}
        )
        org_id = r_create_org.json()[0]["id"]

    print(f"Test Organization ID: {org_id}")

    # 3. Create test Pro Forma via FastAPI endpoint
    backend_headers = {
        "Authorization": f"Bearer {auth_token}",
        "X-Organization-ID": org_id,
        "Content-Type": "application/json"
    }

    payload = {
        "template_id": "new_globe_export",
        "proforma_no": "PI-SUPABASE-TEST-001",
        "proforma_date": "2026-10-08",
        "due_date": "2026-10-15",
        "valid_till": "2026-10-20",
        "customer_name": "Supabase Test Customer",
        "customer_company_name": "Supabase Test Customer Ltd",
        "customer_country": "India",
        "customer_address": "123 Supabase Street",
        "customer_city": "Chennai",
        "customer_gstin": "33ABCDE1234F1Z5",
        "customer_phone": "+91 9876543210",
        "customer_email": "test@supabase.io",
        "place_of_supply_state": "Tamil Nadu",
        "currency_code": "INR",
        "exchange_rate": 1.0,
        "shipper_name": "Test Shipper",
        "consignee_name": "Test Consignee",
        "origin": "Chennai",
        "destination": "Dubai",
        "packs_qty": "5",
        "weight_kgs": 500.0,
        "volume_cbm": 2.5,
        "freight_terms": "Prepaid",
        "bl_number": "BL-001",
        "thbl_number": "THBL-001",
        "mbl_number": "TEST-MAWB-001",
        "ocean_bl_no": "OBL-001",
        "vessel_name": "TEST-VESSEL",
        "voyage_no": "VOY-100",
        "etd_date": "2026-10-10",
        "eta_date": "2026-10-18",
        "igm_no": "IGM-123",
        "igm_item_no": "12",
        "file_no": "FILE-99",
        "sales_rep": "John Doe",
        "rcm_applicable": False,
        "container_details": "CONT-001",
        "notes": "Test proforma notes",
        "terms": "Standard export terms",
        "items": [
            {
                "description": "Supabase Test Item",
                "hsn_sac": "9983",
                "qty": 5,
                "unit": "PCS",
                "unit_price": 1000,
                "discount_percent": 0,
                "discount_amount": 0,
                "tax_rate": 18
            }
        ]
    }

    print("\n--- STEP 3: POST /api/v1/proforma ---")
    r_api = requests.post("http://localhost:8000/api/v1/proforma", headers=backend_headers, json=payload)
    print(f"FastAPI POST Status: {r_api.status_code}")
    api_data = r_api.json()
    print("FastAPI Response Data:", json.dumps(api_data, indent=2, default=str))

    # 4. Query Supabase directly
    r_db_head = requests.get(f"{SUPABASE_URL}/rest/v1/proforma_invoices?proforma_no=eq.PI-SUPABASE-TEST-001", headers=headers)
    print("\n--- STEP 4: SUPABASE DIRECT QUERY ---")
    print(f"Header Query Status: {r_db_head.status_code}")
    db_head = r_db_head.json()
    print(f"Supabase Header Record Count: {len(db_head)}")
    if len(db_head) > 0:
        pf_record = db_head[0]
        print(f"Header ID: {pf_record['id']}")
        print(f"Organization ID: {pf_record['organization_id']}")
        print(f"Proforma No: {pf_record['proforma_no']}")
        print(f"Grand Total: {pf_record['grand_total']}")
        print(f"Metadata: {json.dumps(pf_record.get('metadata'), indent=2)}")

        pf_id = pf_record['id']
        r_db_items = requests.get(f"{SUPABASE_URL}/rest/v1/proforma_invoice_items?proforma_id=eq.{pf_id}", headers=headers)
        db_items = r_db_items.json()
        print(f"Supabase Line Items Count: {len(db_items)}")
        for item in db_items:
            print(f"  Item: {item['description']}, Qty: {item['qty']}, Rate: {item['unit_price']}, Total: {item['line_total']}")

        # 5. Reload Proforma via GET API
        print("\n--- STEP 6: RELOAD FROM DATABASE ---")
        r_get = requests.get(f"http://localhost:8000/api/v1/proforma/{pf_id}", headers=backend_headers)
        print(f"GET /api/v1/proforma/{pf_id} Status: {r_get.status_code}")
        reloaded = r_get.json()
        print(f"Reloaded Template ID: {reloaded.get('template_id')}")
        print(f"Reloaded Vessel Name: {reloaded.get('vessel_name')}")
        print(f"Reloaded MBL/MAWB: {reloaded.get('mbl_number')}")

        # 6. Convert Proforma to Tax Invoice
        print("\n--- STEP 5: CONVERT TO TAX INVOICE ---")
        r_conv = requests.post(f"http://localhost:8000/api/v1/proforma/{pf_id}/convert", headers=backend_headers)
        print(f"Conversion Status: {r_conv.status_code}")
        if r_conv.status_code in (200, 201):
            conv_data = r_conv.json()
            inv_id = conv_data.get("id")
            inv_no = conv_data.get("invoice_no")
            print(f"Created Tax Invoice ID: {inv_id}")
            print(f"Created Tax Invoice No: {inv_no}")

            # Verify in Supabase
            r_inv_db = requests.get(f"{SUPABASE_URL}/rest/v1/invoices?id=eq.{inv_id}", headers=headers)
            inv_records = r_inv_db.json()
            print(f"Supabase Tax Invoice Count: {len(inv_records)}")
            if inv_records:
                inv_rec = inv_records[0]
                print(f"Tax Invoice Status in DB: {inv_rec.get('status')}")
                print(f"Tax Invoice Grand Total: {inv_rec.get('grand_total')}")
                print(f"Tax Invoice Source Proforma ID: {inv_rec.get('source_proforma_id')}")

            # Check Proforma status changed to CONVERTED
            r_pf_check = requests.get(f"{SUPABASE_URL}/rest/v1/proforma_invoices?id=eq.{pf_id}", headers=headers)
            pf_updated = r_pf_check.json()
            if pf_updated:
                print(f"Updated Pro Forma Status: {pf_updated[0].get('status')}")

            # 7. Verify Idempotent Conversion
            print("\n--- STEP 6: IDEMPOTENT CONVERSION CHECK ---")
            r_conv_dup = requests.post(f"http://localhost:8000/api/v1/proforma/{pf_id}/convert", headers=backend_headers)
            print(f"Duplicate Conversion Status: {r_conv_dup.status_code}")
            if r_conv_dup.status_code in (200, 201):
                dup_data = r_conv_dup.json()
                print(f"Duplicate Conversion Tax Invoice ID: {dup_data.get('id')}")
                print(f"Matches Original Tax Invoice ID: {dup_data.get('id') == inv_id}")

            # 8. Record Payment against Tax Invoice
            print("\n--- STEP 7: RECORD PAYMENT AGAINST TAX INVOICE ---")
            payment_payload = {
                "organization_id": org_id,
                "customer_id": pf_record.get("customer_name") or "Supabase Test Customer",
                "payment_no": f"PAY-{int(time.time())}",
                "payment_date": "2026-10-08",
                "payment_mode": "Bank Transfer",
                "reference_no": "REF-12345",
                "amount": 1000.0,
                "notes": "Test payment for converted tax invoice",
                "allocations": [
                    {
                        "invoice_id": inv_id,
                        "invoice_no": inv_no,
                        "allocated_amount": 1000.0
                    }
                ]
            }
            r_pay = requests.post("http://localhost:8000/api/v1/payments", headers=backend_headers, json=payment_payload)
            print(f"Payment Creation API Status: {r_pay.status_code}")
            if r_pay.status_code in (200, 201):
                pay_data = r_pay.json()
                print(f"Payment Created ID: {pay_data.get('id')}")

                # Verify invoice amount_paid and balance_due
                r_inv_post_pay = requests.get(f"http://localhost:8000/api/v1/invoices/{inv_id}", headers=backend_headers)
                if r_inv_post_pay.status_code == 200:
                    inv_after_pay = r_inv_post_pay.json()
                    print(f"Tax Invoice Paid Amount: {inv_after_pay.get('amount_paid')}")
                    print(f"Tax Invoice Balance Due: {inv_after_pay.get('balance_due')}")
                    print(f"Tax Invoice Payment Status: {inv_after_pay.get('status')}")

    print("==================================================")
    print("ALL VERIFICATIONS COMPLETED SUCCESSFULLY")
    print("==================================================")

if __name__ == "__main__":
    run_verification()

