import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals
from app.services.invoice_service import InvoiceService
import uuid

client = TestClient(app)

def test_tax_invoice_foreign_currency_and_gst_parity():
    """
    Validates:
    1. Foreign currency (EUR/USD) and ROE preservation from Pro Forma to Tax Invoice
    2. Amount in INR, Taxable amount, and GST totals match on row and document level
    3. Row deduplication preserves exact 1 row
    4. Branding, freight terms, and bank details are correctly populated
    """
    db = get_admin_supabase_client()
    tenant_id = str(uuid.uuid4())
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    
    # Setup test organization with branding and bank details
    db.table("organizations").insert({
        "id": tenant_id,
        "owner_user_id": user_id,
        "company_name": "RIHASHA PVT",
        "state_name": "Tamil Nadu",
        "country_code": "IN",
        "settings": {
            "profile": {
                "companyName": "RIHASHA PVT",
                "logoUrl": "https://example.com/logo.png"
            },
            "bank": {
                "bankName": "IOB Bank",
                "accountNo": "7647666666666",
                "ifsc": "IOBS0001234"
            }
        }
    }).execute()

    headers = {"X-Organization-Id": tenant_id}

    # Create Pro Forma with EUR currency matching PI-0009 figures
    # Qty 9000, Unit Price 70.0, Currency EUR, ROE 1.0
    # Expected INR amount = 9000 * 70 = 6,30,000.00
    # Discount = 100.00 -> Taxable = 6,29,900.00
    # IGST @ 18% = 1,13,382.00
    # Grand Total = 7,43,282.00
    # Advance = 90,000.00 -> Balance Due = 6,53,282.00
    pf_payload = {
        "customer_name": "Customer",
        "customer_state": "Goa",
        "currency_code": "EUR",
        "currency_symbol": "€",
        "exchange_rate": 1.0,
        "roe": 1.0,
        "export_type": "TAX_PAYMENT",
        "freight_terms": "Collect",
        "advance_received": 90000.0,
        "discount_type": "amount",
        "discount_value": 100.0,
        "items": [
            {
                "description": "Industrial Oil",
                "hsn_sac": "00031",
                "qty": 9000.0,
                "unit": "litre",
                "unit_price": 70.0,
                "tax_rate": 18.0
            }
        ]
    }

    create_res = client.post("/api/v1/proforma", json=pf_payload, headers=headers)
    assert create_res.status_code == 201, f"Failed to create proforma: {create_res.text}"
    pf_data = create_res.json()
    pf_id = pf_data["id"]

    assert pf_data["currency_code"] == "EUR"
    assert pf_data["exchange_rate"] == 1.0
    assert abs(pf_data["subtotal"] - 630000.0) < 0.01
    assert abs(pf_data["taxable_total"] - 629900.0) < 0.01
    assert abs(pf_data["igst_total"] - 113382.0) < 0.01
    assert abs(pf_data["grand_total"] - 743282.0) < 0.01
    assert abs(pf_data["amount_paid"] - 90000.0) < 0.01
    assert abs(pf_data["balance_due"] - 653282.0) < 0.01

    # Convert to Tax Invoice
    conv_res = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv_res.status_code == 201, f"Conversion failed: {conv_res.text}"
    conv_data = conv_res.json()
    inv_id = conv_data["invoice_id"]

    # Fetch Tax Invoice through InvoiceService
    inv_service = InvoiceService()
    inv = inv_service.get_invoice(inv_id, tenant_id)

    # 1. Currency & ROE preserved
    assert inv["currency_code"] == "EUR"
    assert inv["currency_symbol"] == "€"
    assert inv["roe"] == 1.0
    assert inv["exchange_rate"] == 1.0

    # 2. Logistics & Freight Terms preserved
    assert inv["freight_terms"] == "Collect"

    # 3. Branding preserved
    assert inv["company_name"] == "RIHASHA PVT"
    assert inv["bank"]["account_no"] == "7647666666666"

    # 4. Item Rows: exactly 1 row, no duplicates
    assert len(inv["items"]) == 1
    it = inv["items"][0]

    # 5. Row-level calculations match exact figures
    assert it["rate"] == 70.0
    assert it["unit_price"] == 70.0
    assert it["qty"] == 9000.0
    assert abs(it["amount_inr"] - 630000.0) < 0.01
    assert abs(it["amountInr"] - 630000.0) < 0.01
    assert abs(it["taxable_amount"] - 629900.0) < 0.01
    assert abs(it["gst_total"] - 113382.0) < 0.01
    assert abs(it["tax_amount"] - 113382.0) < 0.01
    assert it["igst_rate"] == 18.0

    # 6. Document Totals match
    assert abs(inv["totals"]["subTotal"] - 630000.0) < 0.01
    assert abs(inv["totals"]["taxable_total"] - 629900.0) < 0.01
    assert abs(inv["totals"]["igst_total"] - 113382.0) < 0.01
    assert abs(inv["totals"]["tax_total"] - 113382.0) < 0.01
    assert abs(inv["totals"]["grand_total"] - 743282.0) < 0.01
    assert abs(inv["totals"]["advance_received"] - 90000.0) < 0.01
    assert abs(inv["totals"]["balance_due"] - 653282.0) < 0.01
    assert inv["payment_status"] == "Partially Paid"


def test_tax_invoice_with_roe_conversion():
    """
    Validates foreign currency with ROE > 1 (e.g. USD / EUR @ 90.0)
    100 qty * 70 EUR @ 90.0 = 6,30,000 INR
    Document discount 100 EUR = 9,000 INR
    Taxable = 6,21,000 INR
    IGST @ 18% = 1,11,780 INR
    Grand Total = 7,32,780 INR
    """
    db = get_admin_supabase_client()
    tenant_id = str(uuid.uuid4())
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"

    db.table("organizations").insert({
        "id": tenant_id,
        "owner_user_id": user_id,
        "company_name": "RIHASHA EXPORTS",
        "state_name": "Tamil Nadu",
        "country_code": "IN"
    }).execute()

    headers = {"X-Organization-Id": tenant_id}

    pf_payload = {
        "customer_name": "Overseas Client",
        "customer_state": "Goa",
        "currency_code": "EUR",
        "currency_symbol": "€",
        "exchange_rate": 90.0,
        "roe": 90.0,
        "export_type": "TAX_PAYMENT",
        "discount_type": "amount",
        "discount_value": 100.0,
        "items": [
            {
                "description": "Machinery Parts",
                "hsn_sac": "8401",
                "qty": 100.0,
                "unit": "PCS",
                "unit_price": 70.0,
                "tax_rate": 18.0
            }
        ]
    }

    create_res = client.post("/api/v1/proforma", json=pf_payload, headers=headers)
    assert create_res.status_code == 201, f"Failed: {create_res.text}"
    pf_data = create_res.json()
    assert pf_data["currency_code"] == "EUR"
    assert pf_data["exchange_rate"] == 90.0
    assert abs(pf_data["subtotal"] - 630000.0) < 0.01
    assert abs(pf_data["taxable_total"] - 621000.0) < 0.01
    assert abs(pf_data["igst_total"] - 111780.0) < 0.01
    assert abs(pf_data["grand_total"] - 732780.0) < 0.01

    # Convert to invoice
    conv_res = client.post(f"/api/v1/proforma/{pf_data['id']}/convert", headers=headers)
    assert conv_res.status_code == 201, f"Failed: {conv_res.text}"
    inv_id = conv_res.json()["invoice_id"]

    inv_service = InvoiceService()
    inv = inv_service.get_invoice(inv_id, tenant_id)
    assert inv["currency_code"] == "EUR"
    assert inv["roe"] == 90.0
    assert len(inv["items"]) == 1
    it = inv["items"][0]
    assert it["rate"] == 70.0
    assert abs(it["amount_inr"] - 630000.0) < 0.01
    assert abs(it["taxable_amount"] - 621000.0) < 0.01
    assert abs(it["gst_total"] - 111780.0) < 0.01
    assert abs(inv["totals"]["grand_total"] - 732780.0) < 0.01

