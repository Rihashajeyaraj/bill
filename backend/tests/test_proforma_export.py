import uuid
from decimal import Decimal
from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals

client = TestClient(app)

def test_calculation_service_rounding_and_discount_distribution():
    """
    Test GST rounding check:
    With line total 72,081.10 and an overall discount of 9%,
    the taxable amount is 65,593.80 and 18% IGST must be 11,806.88 (ROUND_HALF_UP).
    """
    items = [{
        "description": "Export Equipment",
        "qty": 1,
        "unit_price": 72081.10,
        "tax_rate": 18,
        "currency": "INR"
    }]
    
    result = calculate_document_totals(
        raw_items=items,
        company_state="Maharashtra",
        customer_state="Delhi",  # Inter-state -> IGST
        export_type="DOMESTIC",
        overall_discount_type="percent",
        overall_discount_value=9
    )
    
    assert float(result.subtotal) == 72081.10
    assert float(result.discount_total) == 6487.30
    assert float(result.taxable_total) == 65593.80
    assert float(result.igst_total) == 11806.88
    assert float(result.grand_total) == 77401.00  # 77400.68 rounded to nearest 1.00


def test_proforma_create_and_get_with_export_fields():
    """
    Test posting a full Pro Forma with export, shipping, and logistics fields.
    Asserts HTTP 201/200, field persistence, and exact paisa rounding expectation.
    """
    payload = {
        "template_id": "new_globe_export",
        "proforma_no": "PI-TEST-EXP-001",
        "proforma_date": "2026-10-09",
        "valid_till": "2026-11-09",
        "due_date": "2026-11-09",
        "customer_name": "Global Export Corp",
        "customer_country": "India",
        "place_of_supply_state": "Delhi",

        "currency_code": "INR",
        "exchange_rate": 1.0,
        "export_type": "DOMESTIC",
        "lut_number": "LUT/2026/999",
        
        # Logistics & Export Fields
        "shipper_name": "Global Logistics Pvt Ltd",
        "consignee_name": "US Importing Co",
        "origin": "Mumbai Port",
        "destination": "New York Port",
        "packs_qty": "100 CTNS",
        "weight_kgs": 1250.5,
        "volume_cbm": 15.2,
        "freight_terms": "Collect",
        
        # Shipping Details
        "bl_number": "BL-998877",
        "hbl_number": "HBL-998877",
        "thbl_number": "THBL-1234",
        "mbl_number": "MBL-443322",
        "ocean_bl_no": "OBL-556677",
        "vessel_name": "MV Ocean Star",
        "voyage_no": "VOY-101",
        "etd_date": "2026-10-15",
        "eta_date": "2026-10-30",
        
        # Customs & Operations
        "igm_no": "IGM-7788",
        "igm_item_no": "ITEM-01",
        "file_no": "FILE-2026-9",
        "sales_rep": "Alice Smith",
        "rcm_applicable": False,
        "container_details": "TCLU1234567 / 40HC",

        "discount_type": "percent",
        "discount_value": 9.0,
        "notes": "Thank you for your export order.",
        "terms": "Standard export terms apply.",
        
        "items": [
            {
                "description": "Industrial Machinery Part",
                "hsn_sac": "8479",
                "qty": 1,
                "unit": "PCS",
                "unit_price": 72081.10,
                "tax_rate": 18,
                "currency": "INR"
            }
        ]
    }
    
    db = get_admin_supabase_client()
    org_id = str(uuid.uuid4())
    try:
        db.table("organizations").upsert([
            {"id": org_id, "name": "Export Test Org", "country": "India"}
        ]).execute()
    except Exception:
        org_res = db.table("organizations").select("id").limit(1).execute()
        if org_res.data:
            org_id = org_res.data[0]["id"]

    pf_no = f"PI-EXP-{uuid.uuid4().hex[:6].upper()}"
    payload["proforma_no"] = pf_no

    headers = {"X-Organization-Id": org_id}
    response = client.post("/api/v1/proforma", json=payload, headers=headers)

    assert response.status_code == 201, f"Failed: {response.text}"
    
    data = response.json()
    assert data["proforma_no"] == pf_no

    assert data["bl_number"] == "BL-998877"
    assert data["vessel_name"] == "MV Ocean Star"
    assert data["voyage_no"] == "VOY-101"
    assert data["etd_date"] == "2026-10-15"
    assert data["eta_date"] == "2026-10-30"
    assert data["igm_no"] == "IGM-7788"
    assert data["file_no"] == "FILE-2026-9"
    assert data["sales_rep"] == "Alice Smith"
    assert data["container_details"] == "TCLU1234567 / 40HC"

    # Assert paisa-level rounding expectation
    assert abs(data["taxable_total"] - 65593.80) < 0.01
    assert abs(data["total_igst"] - 11806.88) < 0.01

    # Test GET /api/v1/proforma/{id}
    proforma_id = data["id"]
    get_res = client.get(f"/api/v1/proforma/{proforma_id}", headers=headers)
    assert get_res.status_code == 200
    get_data = get_res.json()

    assert get_data["bl_number"] == "BL-998877"
    assert get_data["vessel_name"] == "MV Ocean Star"
    assert abs(get_data["taxable_total"] - 65593.80) < 0.01
    assert abs(get_data["total_igst"] - 11806.88) < 0.01
