import uuid
import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_admin_supabase_client
from app.services.proforma_service import (
    generate_proforma_verification_token,
    verify_proforma_verification_token,
    extract_invoice_id_from_token
)

client = TestClient(app)

def get_or_create_test_organization(name="Pro Forma QR Test Tenant"):
    db = get_admin_supabase_client()
    org_id = str(uuid.uuid4())
    try:
        res = db.table("organizations").insert({
            "id": org_id,
            "owner_user_id": "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f",
            "company_name": name,
            "country_code": "IN",
            "state_name": "Goa"
        }).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]["id"]
    except Exception:
        pass

    try:
        res = db.table("organizations").select("id").execute()
        if res.data and len(res.data) > 0:
            return res.data[0]["id"]
    except Exception:
        pass
    return org_id

def test_automatic_qr_code_generation_on_proforma_creation():
    """
    1. Verify creating a Pro Forma automatically generates its QR code.
    2. Verify QR image is crisp data URI (PNG).
    3. Verify verification token is attached without leaking secrets.
    """
    tenant_id = get_or_create_test_organization("QR Auto Gen Org")
    headers = {"X-Organization-Id": tenant_id}
    pf_no = f"PI-QR-{uuid.uuid4().hex[:6].upper()}"

    payload = {
        "template_id": "modern_gst",
        "proforma_no": pf_no,
        "proforma_date": "2026-10-12",
        "customer_name": "Global Logistics Corp",
        "customer_country": "India",
        "place_of_supply_state": "Goa",
        "currency_code": "INR",
        "items": [
            {
                "description": "Port Handling Services",
                "hsn_sac": "996511",
                "qty": 2.0,
                "unit": "BOX",
                "unit_price": 5000.0,
                "tax_rate": 18.0
            }
        ]
    }

    create_res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert create_res.status_code == 201, f"Failed to create proforma: {create_res.text}"
    created = create_res.json()

    # Automatic QR code verification
    assert created.get("qr_code_image") is not None, "Missing qr_code_image in response"
    assert created["qr_code_image"].startswith("data:image/png;base64,"), "qr_code_image must be a valid PNG Data URI"
    assert created.get("verification_url") is not None, "Missing verification_url"
    assert created.get("verification_token") is not None, "Missing verification_token"
    assert created["verification_token"].startswith("pfv_"), "verification_token must start with pfv_"
    assert created["id"] in created["verification_token"], "verification_token must bind to the invoice ID"
    assert created.get("qr_code_url") == created["verification_url"], "qr_code_url should match verification_url"

    # Verify no secrets in token or URL
    assert "Bearer" not in created["verification_token"]
    assert "service_role" not in created["verification_token"]
    assert "password" not in created["verification_token"]

def test_distinct_qr_identifiers_for_different_invoices():
    """
    Verify two different invoices have distinct identifiers and verification URLs.
    """
    tenant_id = get_or_create_test_organization("Distinct QR Org")
    headers = {"X-Organization-Id": tenant_id}

    pf1_no = f"PI-DIST1-{uuid.uuid4().hex[:6].upper()}"
    pf2_no = f"PI-DIST2-{uuid.uuid4().hex[:6].upper()}"

    base_payload = {
        "template_id": "modern_gst",
        "proforma_date": "2026-10-12",
        "customer_name": "Test Customer",
        "place_of_supply_state": "Goa",
        "currency_code": "INR",
        "items": [{"description": "Service Item", "qty": 1.0, "unit_price": 1000.0, "tax_rate": 18.0}]
    }

    res1 = client.post("/api/v1/proforma", json={**base_payload, "proforma_no": pf1_no}, headers=headers)
    res2 = client.post("/api/v1/proforma", json={**base_payload, "proforma_no": pf2_no}, headers=headers)
    assert res1.status_code == 201
    assert res2.status_code == 201

    inv1 = res1.json()
    inv2 = res2.json()

    assert inv1["id"] != inv2["id"]
    assert inv1["verification_token"] != inv2["verification_token"]
    assert inv1["verification_url"] != inv2["verification_url"]
    assert inv1["qr_code_image"] != inv2["qr_code_image"]

def test_qr_generation_idempotency_on_edit_and_reopen():
    """
    Verify reopening or editing an invoice does not duplicate records or change its stable QR identifier.
    """
    tenant_id = get_or_create_test_organization("Idempotent QR Org")
    headers = {"X-Organization-Id": tenant_id}
    pf_no = f"PI-IDEM-{uuid.uuid4().hex[:6].upper()}"

    payload = {
        "template_id": "modern_gst",
        "proforma_no": pf_no,
        "proforma_date": "2026-10-12",
        "customer_name": "Initial Customer",
        "place_of_supply_state": "Goa",
        "currency_code": "INR",
        "items": [{"description": "Initial Item", "qty": 1.0, "unit_price": 2000.0, "tax_rate": 18.0}]
    }

    res_create = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert res_create.status_code == 201
    created = res_create.json()
    orig_id = created["id"]
    orig_token = created["verification_token"]
    orig_url = created["verification_url"]

    # Reopening (GET)
    res_get = client.get(f"/api/v1/proforma/{orig_id}", headers=headers)
    assert res_get.status_code == 200
    fetched = res_get.json()
    assert fetched["id"] == orig_id
    assert fetched["verification_token"] == orig_token
    assert fetched["verification_url"] == orig_url

    # Editing (PUT) - update customer name and item
    update_payload = {
        "customer_name": "Updated Customer Name",
        "notes": "Added customer note",
        "items": [{"description": "Updated Item", "qty": 2.0, "unit_price": 2000.0, "tax_rate": 18.0}]
    }
    res_put = client.put(f"/api/v1/proforma/{orig_id}", json=update_payload, headers=headers)
    assert res_put.status_code == 200
    updated = res_put.json()

    assert updated["id"] == orig_id
    assert updated["verification_token"] == orig_token, "Verification token must remain stable for the same invoice"
    assert updated["verification_url"] == orig_url
    assert updated["grand_total"] == 4720.0  # 4000 + 18% GST

def test_qr_resolution_identifies_correct_invoice_with_all_metadata():
    """
    Verify scanning/resolving the verification token returns all required metadata:
    - proforma_no, id, organization_id, proforma_date, customer_name, currency_code, grand_total, status, verification_url.
    """
    tenant_id = get_or_create_test_organization("Verify Resolution Org")
    headers = {"X-Organization-Id": tenant_id}
    pf_no = f"PI-RES-{uuid.uuid4().hex[:6].upper()}"

    payload = {
        "template_id": "modern_gst",
        "proforma_no": pf_no,
        "proforma_date": "2026-10-12",
        "customer_name": "Acme Maritime Shipping",
        "customer_ref": "PO-MARITIME-889",
        "place_of_supply_state": "Goa",
        "currency_code": "EUR",
        "exchange_rate": 90.0,
        "items": [
            {
                "description": "Container Freight Transport",
                "hsn_sac": "996519",
                "qty": 1.0,
                "unit": "CONT",
                "unit_price": 7000.0,
                "currency": "EUR",
                "tax_rate": 18.0
            }
        ]
    }

    create_res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert create_res.status_code == 201
    created = create_res.json()
    token = created["verification_token"]

    # Call verification endpoint
    verify_res = client.get(f"/api/v1/proforma/verify/{token}")
    assert verify_res.status_code == 200, f"Failed to verify: {verify_res.text}"
    verified_data = verify_res.json()

    # Check all required fields from Section 2
    assert verified_data["verified"] is True
    assert verified_data["proforma_no"] == pf_no
    assert verified_data["id"] == created["id"]
    assert verified_data["organization_id"] == tenant_id
    assert verified_data["proforma_date"] == "2026-10-12"
    assert verified_data["customer_name"] == "Acme Maritime Shipping"
    assert verified_data["customer_ref"] == "PO-MARITIME-889"
    assert verified_data["currency_code"] == "EUR"
    assert verified_data["grand_total"] == created["grand_total"]
    assert verified_data["status"] == "DRAFT"
    assert verified_data["verification_url"] == created["verification_url"]
    assert verified_data["items_count"] == 1
    assert verified_data["is_cancelled"] is False

def test_cancelled_invoice_displays_correct_status():
    """
    Verify cancelling a proforma updates status to CANCELLED and verification endpoint reflects it.
    """
    tenant_id = get_or_create_test_organization("Cancel Status Org")
    headers = {"X-Organization-Id": tenant_id}
    pf_no = f"PI-CANC-{uuid.uuid4().hex[:6].upper()}"

    payload = {
        "template_id": "modern_gst",
        "proforma_no": pf_no,
        "proforma_date": "2026-10-12",
        "customer_name": "Cancelled Co",
        "place_of_supply_state": "Goa",
        "currency_code": "INR",
        "items": [{"description": "Fee", "qty": 1.0, "unit_price": 500.0, "tax_rate": 18.0}]
    }

    res_create = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert res_create.status_code == 201
    created = res_create.json()
    inv_id = created["id"]
    token = created["verification_token"]

    # Cancel invoice
    cancel_res = client.post(f"/api/v1/proforma/{inv_id}/cancel", headers=headers)
    assert cancel_res.status_code == 200
    cancelled_pf = cancel_res.json()
    assert cancelled_pf["status"] == "CANCELLED"

    # Verify endpoint reflects status
    verify_res = client.get(f"/api/v1/proforma/verify/{token}")
    assert verify_res.status_code == 200
    v_data = verify_res.json()
    assert v_data["status"] == "CANCELLED"
    assert v_data["is_cancelled"] is True

def test_cross_tenant_invoice_access_is_blocked():
    """
    Verify tenant B is forbidden (403) from accessing or verifying tenant A's invoice.
    """
    tenant_a = get_or_create_test_organization("Tenant A Company")
    tenant_b = get_or_create_test_organization("Tenant B Company")

    headers_a = {"X-Organization-Id": tenant_a}
    headers_b = {"X-Organization-Id": tenant_b}

    pf_no = f"PI-ISOL-{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "template_id": "modern_gst",
        "proforma_no": pf_no,
        "proforma_date": "2026-10-12",
        "customer_name": "Tenant A Customer",
        "place_of_supply_state": "Goa",
        "currency_code": "INR",
        "items": [{"description": "Secret Item", "qty": 1.0, "unit_price": 8000.0, "tax_rate": 18.0}]
    }

    res_create = client.post("/api/v1/proforma", json=payload, headers=headers_a)
    assert res_create.status_code == 201
    created = res_create.json()
    inv_id = created["id"]
    token = created["verification_token"]

    # Direct invoice access from Tenant B -> 404 / blocked
    res_b_get = client.get(f"/api/v1/proforma/{inv_id}", headers=headers_b)
    assert res_b_get.status_code in [403, 404], "Tenant B should not be able to get Tenant A proforma"

    # Token verification from Tenant B caller -> 403 Forbidden
    res_b_verify = client.get(f"/api/v1/proforma/verify/{token}", headers=headers_b)
    assert res_b_verify.status_code == 403, f"Cross-tenant verification should be 403, got {res_b_verify.status_code}"
    assert "cross-tenant" in res_b_verify.json().get("detail", "").lower()
