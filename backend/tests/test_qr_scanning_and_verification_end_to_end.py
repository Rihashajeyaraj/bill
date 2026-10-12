import base64
import uuid
import pytest
import cv2
import numpy as np
from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_admin_supabase_client
from app.services.proforma_service import ProformaService
from app.services.invoice_service import InvoiceService

client = TestClient(app)

def decode_qr_image_url(data_uri: str) -> str:
    """
    Decodes the QR code data URL using OpenCV's QRCodeDetector.
    Simulates a mobile phone camera or handheld optical scanner.
    """
    assert data_uri and data_uri.startswith("data:image/png;base64,"), "Invalid PNG Data URI"
    raw_b64 = data_uri.split("data:image/png;base64,")[1]
    raw_bytes = base64.b64decode(raw_b64)
    mat = cv2.imdecode(np.frombuffer(raw_bytes, np.uint8), cv2.IMREAD_COLOR)
    detector = cv2.QRCodeDetector()
    decoded_url, points, _ = detector.detectAndDecode(mat)
    assert decoded_url, "OpenCV QR detector failed to decode QR code image"
    return decoded_url


def test_pi_0009_qr_scanning_and_verification_flow():
    """
    Test scanning the QR code for PI-0009 and confirming that:
    1. The QR code image decodes to the authentic verification URL.
    2. Resolving the verification token returns the correct invoice metadata, items, and totals.
    3. The data matches the saved invoice data for PDF rendering and downloading.
    """
    db = get_admin_supabase_client()
    res = db.table("proforma_invoices").select("*").eq("proforma_no", "PI-0009").execute()
    assert res.data, "PI-0009 must exist in database"
    
    # Pick the target PI-0009 (linked to INV-0010 for RIHASHA PVT)
    target_row = next((r for r in res.data if r.get("organization_id") == "51a51175-8295-4728-a619-a49b59024cda"), res.data[0])
    org_id = target_row["organization_id"]
    pf_id = target_row["id"]
    
    pf_service = ProformaService()
    pf = pf_service.get_proforma(pf_id, org_id)

    # 1. Verify QR image is generated and crisp
    qr_img = pf.get("qr_code_image")
    assert qr_img is not None
    assert qr_img.startswith("data:image/png;base64,")

    # 2. Scan and decode the QR code using optical QR detector
    scanned_url = decode_qr_image_url(qr_img)
    expected_url = pf.get("verification_url")
    assert scanned_url == expected_url, f"Scanned URL '{scanned_url}' did not match expected '{expected_url}'"
    assert "/verify/proforma/pfv_" in scanned_url

    # 3. Extract verification token and resolve via API
    token = scanned_url.split("/verify/proforma/")[1]
    verify_res = client.get(f"/api/v1/proforma/verify/{token}")
    assert verify_res.status_code == 200, f"Failed to verify token: {verify_res.text}"
    v_data = verify_res.json()

    # 4. Verify authentic saved metadata
    assert v_data["verified"] is True
    assert v_data["proforma_no"] == "PI-0009"
    assert v_data["id"] == pf_id
    assert v_data["company_name"].upper() == "RIHASHA PVT"
    assert v_data["currency_code"] == "EUR"
    assert abs(v_data["grand_total"] - 743282.0) < 0.05
    assert len(v_data["items"]) >= 1
    assert v_data["items"][0]["description"] == "oil "
    assert v_data["items"][0]["qty"] == 9000.0
    assert v_data["items"][0]["rate"] == 70.0
    assert abs(v_data["items"][0]["amount_inr"] - 630000.0) < 0.05
    assert v_data["bank"]["account_no"] == "7647666666666"


def test_tax_invoice_qr_scanning_and_verification_flow():
    """
    Test scanning the QR code for Tax Invoice (INV-0010) and confirming:
    1. Stable QR code generated with txv_ token and verification URL.
    2. Optical scanner decodes the QR image to the verification page URL.
    3. Verification API resolves the authentic invoice data with items and PDF readiness.
    4. Cross-tenant access is blocked with 403 Forbidden.
    """
    db = get_admin_supabase_client()
    res = db.table("invoices").select("*").eq("invoice_no", "INV-0010").execute()
    assert res.data, "INV-0010 must exist in database"
    
    target_row = next((r for r in res.data if r.get("organization_id") == "51a51175-8295-4728-a619-a49b59024cda"), res.data[0])
    org_id = target_row["organization_id"]
    inv_id = target_row["id"]

    inv_service = InvoiceService()
    inv = inv_service.get_invoice(inv_id, org_id)

    # 1. Verify Tax Invoice has stable verification token and QR code
    token = inv.get("verification_token")
    assert token is not None
    assert token.startswith("txv_")
    qr_img = inv.get("qr_code_image")
    assert qr_img is not None
    assert qr_img.startswith("data:image/png;base64,")

    # 2. Optical scan using OpenCV detector
    scanned_url = decode_qr_image_url(qr_img)
    assert scanned_url == inv.get("verification_url")
    assert "/verify/invoice/txv_" in scanned_url

    # 3. Call Tax Invoice verification endpoint
    verify_res = client.get(f"/api/v1/invoices/verify/{token}")
    assert verify_res.status_code == 200, f"Verification failed: {verify_res.text}"
    v_data = verify_res.json()

    assert v_data["verified"] is True
    assert v_data["invoice_type"] == "TAX_INVOICE"
    assert v_data["invoice_no"] == "INV-0010"
    assert v_data["id"] == inv_id
    assert v_data["company_name"].upper() == "RIHASHA PVT"
    assert v_data["currency_code"] == "EUR"
    assert abs(v_data["grand_total"] - 743282.0) < 0.05
    assert len(v_data["items"]) == 1
    assert v_data["items"][0]["description"] == "oil "
    assert v_data["items"][0]["rate"] == 70.0
    assert abs(v_data["items"][0]["amount_inr"] - 630000.0) < 0.05
    assert v_data["bank"]["account_no"] == "7647666666666"

    # 4. Enforce tenant isolation: cross-tenant caller is blocked with 403 Forbidden
    other_tenant_id = str(uuid.uuid4())
    cross_tenant_res = client.get(
        f"/api/v1/invoices/verify/{token}",
        headers={"X-Organization-Id": other_tenant_id}
    )
    assert cross_tenant_res.status_code == 403
    assert "cross-tenant" in cross_tenant_res.json().get("detail", "").lower()

    # 5. Forged token is rejected with 400 Bad Request
    forged_token = token[:-4] + "XXXX"
    forged_res = client.get(f"/api/v1/invoices/verify/{forged_token}")
    assert forged_res.status_code == 400
