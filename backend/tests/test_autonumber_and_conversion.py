import uuid
import pytest
import concurrent.futures
from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_admin_supabase_client

client = TestClient(app)

def create_isolated_tenant(name="AutoNumber Tenant"):
    db = get_admin_supabase_client()
    org_id = str(uuid.uuid4())
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    db.table("organizations").insert({
        "id": org_id,
        "owner_user_id": user_id,
        "company_name": name,
        "country_code": "IN",
        "state_name": "Maharashtra"
    }).execute()
    db.table("organization_members").insert({
        "organization_id": org_id,
        "user_id": user_id,
        "role": "owner",
        "status": "active"
    }).execute()
    return org_id

def test_auto_generate_proforma_numbers_in_sequence():
    """
    1. Pro Forma Invoice — Auto-Generate Number:
       - Automatically generate unique numbers in format: PI-0001, PI-0002, PI-0003...
       - Backend/database generated, never reuse numbers within the same organization.
    """
    tenant_id = create_isolated_tenant("PI AutoNumber Tenant")
    headers = {"X-Organization-Id": tenant_id}

    # Create 3 Pro Forma Invoices without supplying proforma_no
    pfs = []
    for i in range(3):
        payload = {
            "template_id": "modern_gst",
            "proforma_date": "2026-10-11",
            "customer_name": f"Customer {i+1}",
            "place_of_supply_state": "Maharashtra",
            "items": [
                {
                    "description": f"Service item {i+1}",
                    "qty": 1,
                    "unit_price": 1000.0,
                    "tax_rate": 18.0
                }
            ]
        }
        res = client.post("/api/v1/proforma", json=payload, headers=headers)
        assert res.status_code == 201, f"Failed to create proforma: {res.text}"
        data = res.json()
        pfs.append(data)

    pno1 = pfs[0]["proforma_no"]
    pno2 = pfs[1]["proforma_no"]
    pno3 = pfs[2]["proforma_no"]

    assert pno1 == "PI-0001", f"Expected PI-0001, got {pno1}"
    assert pno2 == "PI-0002", f"Expected PI-0002, got {pno2}"
    assert pno3 == "PI-0003", f"Expected PI-0003, got {pno3}"
    assert len({pno1, pno2, pno3}) == 3, "Pro Forma numbers must all be distinct"

    # Test endpoint /api/v1/proforma/next-number
    res_next = client.get("/api/v1/proforma/next-number", headers=headers)
    assert res_next.status_code == 200
    assert res_next.json()["proforma_no"] == "PI-0004"

def test_convert_proforma_to_tax_invoice_auto_numbering():
    """
    2. Tax Invoice — Auto-Generate Number During Conversion:
       - Generates Tax Invoice in format INV-0001, INV-0002...
       - proforma_no and invoice_no kept as separate fields.
       - Correct status 'CONVERTED' and link 'converted_document_id'.
    """
    tenant_id = create_isolated_tenant("Conversion Tenant")
    headers = {"X-Organization-Id": tenant_id}

    # Create a draft Pro Forma
    payload = {
        "template_id": "modern_gst",
        "proforma_date": "2026-10-11",
        "customer_name": "Atlas Corp",
        "place_of_supply_state": "Maharashtra",
        "items": [
            {
                "description": "Consulting Services",
                "qty": 2,
                "unit_price": 5000.0,
                "tax_rate": 18.0
            }
        ]
    }
    pf_res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert pf_res.status_code == 201
    pf_data = pf_res.json()
    pf_id = pf_data["id"]
    assert pf_data["proforma_no"] == "PI-0001"

    # Convert to Tax Invoice
    conv_res = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv_res.status_code in [200, 201], f"Conversion failed: {conv_res.text}"
    inv_data = conv_res.json()

    assert inv_data["invoice_no"] == "INV-0001"
    assert inv_data["source_proforma_id"] == pf_id
    assert inv_data["source_proforma_no"] == "PI-0001"
    assert inv_data["invoice_no"] != pf_data["proforma_no"], "invoice_no and proforma_no must be distinct"

    # Verify Pro Forma status in database / API
    pf_get = client.get(f"/api/v1/proforma/{pf_id}", headers=headers).json()
    assert pf_get["status"] == "CONVERTED"
    assert pf_get["converted_document_id"] == inv_data["id"]
    assert pf_get["converted_invoice_no"] == "INV-0001"

def test_convert_when_inv_0001_already_exists():
    """
    4. Database and Concurrency Safety:
       - Converting when INV-0001 already exists must safely produce INV-0002.
       - Fixes root cause of invoices_organization_id_invoice_no_key duplicate key error.
    """
    tenant_id = create_isolated_tenant("Existing Invoice Tenant")
    headers = {"X-Organization-Id": tenant_id}
    db = get_admin_supabase_client()

    # Pre-insert INV-0001 manually to simulate existing historical invoice or legacy sequence
    db.table("invoices").insert({
        "organization_id": tenant_id,
        "invoice_no": "INV-0001",
        "invoice_date": "2026-10-01",
        "grand_total": 500.0,
        "status": "issued"
    }).execute()

    # Create a new draft Pro Forma
    payload = {
        "template_id": "modern_gst",
        "proforma_date": "2026-10-11",
        "customer_name": "Delta Tech",
        "place_of_supply_state": "Maharashtra",
        "items": [
            {
                "description": "Hardware Installation",
                "qty": 1,
                "unit_price": 7500.0,
                "tax_rate": 18.0
            }
        ]
    }
    pf_res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert pf_res.status_code == 201
    pf_id = pf_res.json()["id"]

    # Convert the Pro Forma - MUST NOT fail with invoices_organization_id_invoice_no_key
    conv_res = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv_res.status_code in [200, 201], f"Conversion failed when INV-0001 exists: {conv_res.text}"
    inv_data = conv_res.json()

    assert inv_data["invoice_no"] == "INV-0002", f"Expected INV-0002, got {inv_data['invoice_no']}"
    assert inv_data["source_proforma_id"] == pf_id

def test_convert_already_converted_proforma_is_idempotent():
    """
    3. Correct Validation:
       - Validate original Pro Forma using ID/proforma_no.
       - If already converted, return existing linked Tax Invoice instead of creating another invoice or throwing 409.
       - Clicking Convert again must not create duplicate Tax Invoice.
    """
    tenant_id = create_isolated_tenant("Idempotency Tenant")
    headers = {"X-Organization-Id": tenant_id}

    # Create Pro Forma
    payload = {
        "template_id": "modern_gst",
        "proforma_date": "2026-10-11",
        "customer_name": "Echo Dynamics",
        "place_of_supply_state": "Maharashtra",
        "items": [
            {
                "description": "Server Maintenance",
                "qty": 1,
                "unit_price": 12000.0,
                "tax_rate": 18.0
            }
        ]
    }
    pf_res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert pf_res.status_code == 201
    pf_id = pf_res.json()["id"]

    # First conversion
    conv1 = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv1.status_code in [200, 201]
    inv1 = conv1.json()

    # Second conversion attempt on the SAME proforma
    conv2 = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv2.status_code in [200, 201], f"Second convert should succeed idempotently, got: {conv2.text}"
    inv2 = conv2.json()

    # Must return the SAME invoice, not create a new one
    assert inv1["id"] == inv2["id"]
    assert inv1["invoice_no"] == inv2["invoice_no"]

    # Verify database has only ONE invoice for this proforma
    db = get_admin_supabase_client()
    count_res = db.table("invoices").select("id").eq("organization_id", tenant_id).execute()
    assert len(count_res.data) == 1, f"Expected exactly 1 invoice, found {len(count_res.data)}"

def test_numbering_across_different_organizations():
    """
    Numbering across different organizations:
    - Scope all operations to the correct organization.
    - Org A and Org B both start at PI-0001 and INV-0001 independently without collision.
    """
    tenant_a = create_isolated_tenant("Org A Tenant")
    tenant_b = create_isolated_tenant("Org B Tenant")

    headers_a = {"X-Organization-Id": tenant_a}
    headers_b = {"X-Organization-Id": tenant_b}

    payload = {
        "template_id": "modern_gst",
        "customer_name": "Client Multi-Tenant",
        "place_of_supply_state": "Maharashtra",
        "items": [{"description": "Item", "qty": 1, "unit_price": 1000.0, "tax_rate": 18.0}]
    }

    # Create Pro Forma in Org A and Org B
    res_a = client.post("/api/v1/proforma", json=payload, headers=headers_a).json()
    res_b = client.post("/api/v1/proforma", json=payload, headers=headers_b).json()

    assert res_a["proforma_no"] == "PI-0001"
    assert res_b["proforma_no"] == "PI-0001"

    # Convert in Org A and Org B
    inv_a = client.post(f"/api/v1/proforma/{res_a['id']}/convert", headers=headers_a).json()
    inv_b = client.post(f"/api/v1/proforma/{res_b['id']}/convert", headers=headers_b).json()

    assert inv_a["invoice_no"] == "INV-0001"
    assert inv_b["invoice_no"] == "INV-0001"
    assert inv_a["organization_id"] == tenant_a
    assert inv_b["organization_id"] == tenant_b

def test_concurrent_conversion_requests():
    """
    Database and Concurrency Safety:
    - Run concurrent conversion requests across threads.
    - Safe execution without duplicate key error.
    """
    tenant_id = create_isolated_tenant("Concurrent Tenant")
    headers = {"X-Organization-Id": tenant_id}

    # Create 3 draft proformas
    pf_ids = []
    for i in range(3):
        payload = {
            "template_id": "modern_gst",
            "customer_name": f"Concurrent Customer {i+1}",
            "place_of_supply_state": "Maharashtra",
            "items": [{"description": f"Service {i+1}", "qty": 1, "unit_price": 2000.0, "tax_rate": 18.0}]
        }
        res = client.post("/api/v1/proforma", json=payload, headers=headers).json()
        pf_ids.append(res["id"])

    def convert_call(pid):
        return client.post(f"/api/v1/proforma/{pid}/convert", headers=headers)

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(convert_call, pf_ids))

    invoice_nos = []
    for r in results:
        assert r.status_code in [200, 201], f"Concurrent conversion failed: {r.text}"
        inv_no = r.json()["invoice_no"]
        invoice_nos.append(inv_no)

    assert len(invoice_nos) == 3
    assert len(set(invoice_nos)) == 3, f"All converted invoice numbers must be unique: {invoice_nos}"
    for ino in invoice_nos:
        assert ino.startswith("INV-"), f"Invoice number format incorrect: {ino}"
