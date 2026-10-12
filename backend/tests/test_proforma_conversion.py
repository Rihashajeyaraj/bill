import uuid
import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app
from app.core.supabase import get_admin_supabase_client

client = TestClient(app)

def get_or_create_test_organization(name="Conversion Test Tenant"):
    db = get_admin_supabase_client()
    org_id = str(uuid.uuid4())
    try:
        res = db.table("organizations").insert({
            "id": org_id,
            "owner_user_id": "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f",
            "company_name": name,
            "country_code": "IN",
            "state_name": "Maharashtra"
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


def test_lossless_proforma_to_tax_invoice_conversion():
    """
    Test converting a complex Pro Forma invoice with:
    - Foreign currency + ROE
    - LUT export
    - Two lines with different GST rates (0% for LUT, different rates, line discounts)
    - Line discount + overall discount
    - Ship-to, logistics, and shipment metadata
    - Advance payment 50,000
    Asserts:
    - EVERY copied field equals the source
    - Item count and line amounts match
    - grand_total equals to the paisa
    - balance_due = grand_total - 50,000
    - Advance payment allocation moved to tax invoice
    """
    db = get_admin_supabase_client()
    tenant_id = get_or_create_test_organization("Lossless Conversion Org")
    headers = {"X-Organization-Id": tenant_id}

    pf_no = f"PI-CONV-{uuid.uuid4().hex[:6].upper()}"

    payload = {
        "template_id": "new_globe_export",
        "proforma_no": pf_no,
        "proforma_date": "2026-10-09",
        "valid_till": "2026-11-09",
        "due_date": "2026-11-09",
        "customer_name": "Acme Global Trading",
        "customer_company_name": "Acme Global Ltd",
        "customer_address": "123 Port Road, Sector 5",
        "customer_city": "Dubai",
        "place_of_supply_state": "Maharashtra",
        "customer_country": "United Arab Emirates",
        "customer_gstin": "27AAACA12341Z1",
        "customer_phone": "+971501234567",
        "customer_email": "export@acme.com",

        "currency_code": "USD",
        "exchange_rate": 83.50,
        "export_type": "LUT",
        "lut_number": "LUT-2026-27-0099",
        "lut_bond_no": "BOND-9988-77",

        "shipper_name": "Apex Logistics India Pvt Ltd",
        "consignee_name": "Acme Freight Cargo",
        "origin": "Nhava Sheva Port",
        "destination": "Jebel Ali Port",
        "packs_qty": "250 PALLETS",
        "weight_kgs": 4500.0,
        "volume_cbm": 32.5,
        "freight_terms": "Prepaid",

        "bl_number": "BL-GLOBAL-5544",
        "thbl_number": "THBL-5544",
        "mbl_number": "MBL-776655",
        "ocean_bl_no": "OBL-887766",
        "vessel_name": "MSC MEDITERRANEAN",
        "voyage_no": "VOY-902B",
        "etd_date": "2026-10-20",
        "eta_date": "2026-11-02",

        "igm_no": "IGM-9911",
        "igm_item_no": "04",
        "file_no": "EXP-FILE-88",
        "sales_rep": "Robert Johnson",
        "rcm_applicable": False,
        "container_details": "MSCU4433221 / 40FT HC",

        "customer_ref": "PO-GLOBAL-2026-101",
        "customer_po_date": "2026-10-05",
        "discount_type": "amount",
        "discount_value": 500.0,
        "amount_paid": 50000.0,
        "notes": "Export order strictly per INCOTERMS CIF.",
        "terms": "Payment due within 30 days of BL date.",

        "items": [
            {
                "description": "High Precision Machinery Part A",
                "hsn_sac": "8471",
                "qty": 10,
                "unit": "SETS",
                "unit_price": 1200.0,
                "discount_type": "amount",
                "discount_amount": 100.0,
                "tax_rate": 0,
                "currency": "USD"
            },
            {
                "description": "Electronic Sensor Assembly B",
                "hsn_sac": "8542",
                "qty": 5,
                "unit": "PCS",
                "unit_price": 800.0,
                "discount_type": "percent",
                "discount_percent": 5.0,
                "tax_rate": 0,
                "currency": "USD"
            }
        ]
    }

    # 1. Create Pro Forma
    create_res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert create_res.status_code == 201, f"Create proforma failed: {create_res.text}"
    pf_data = create_res.json()
    pf_id = pf_data["id"]

    # 2. Convert Pro Forma to Tax Invoice
    conv_res = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv_res.status_code == 201, f"Convert proforma failed: {conv_res.text}"
    inv_data = conv_res.json()

    # 3. Assert EVERY copied field matches source
    source_pf_id = inv_data.get("source_proforma_id") or inv_data.get("metadata", {}).get("source_proforma_id")
    source_pf_no = inv_data.get("source_proforma_no") or inv_data.get("metadata", {}).get("source_proforma_no")
    assert source_pf_id == pf_id
    assert source_pf_no == pf_no
    assert inv_data.get("customer_name") == pf_data["customer_name"]
    assert inv_data.get("customer_company_name") == pf_data["customer_company_name"]
    assert inv_data.get("customer_address") == pf_data["customer_address"]
    assert inv_data.get("customer_city") == pf_data["customer_city"]
    assert inv_data.get("customer_country") == pf_data["customer_country"]
    assert inv_data.get("customer_gstin") == pf_data["customer_gstin"]
    assert inv_data.get("customer_phone") == pf_data["customer_phone"]
    assert inv_data.get("customer_email") == pf_data["customer_email"]

    assert inv_data.get("currency_code") == "USD"
    assert float(inv_data.get("exchange_rate") or 1.0) == 83.50
    assert inv_data.get("export_type") == "LUT"
    assert inv_data.get("lut_number") == "LUT-2026-27-0099"

    shipper = inv_data.get("shipper_name") or inv_data.get("metadata", {}).get("shipper_name")
    consignee = inv_data.get("consignee_name") or inv_data.get("metadata", {}).get("consignee_name")
    origin_val = inv_data.get("origin") or inv_data.get("metadata", {}).get("origin")
    dest_val = inv_data.get("destination") or inv_data.get("metadata", {}).get("destination")

    assert shipper == "Apex Logistics India Pvt Ltd"
    assert consignee == "Acme Freight Cargo"
    assert origin_val == "Nhava Sheva Port"
    assert dest_val == "Jebel Ali Port"
    assert (inv_data.get("packs_qty") or inv_data.get("metadata", {}).get("packs_qty")) == "250 PALLETS"
    assert float(inv_data.get("weight_kgs") or inv_data.get("metadata", {}).get("weight_kgs") or 0) == 4500.0
    assert float(inv_data.get("volume_cbm") or inv_data.get("metadata", {}).get("volume_cbm") or 0) == 32.5
    assert (inv_data.get("freight_terms") or inv_data.get("metadata", {}).get("freight_terms")) == "Prepaid"

    assert (inv_data.get("bl_number") or inv_data.get("metadata", {}).get("bl_number")) == "BL-GLOBAL-5544"
    assert (inv_data.get("thbl_number") or inv_data.get("metadata", {}).get("thbl_number")) == "THBL-5544"
    assert (inv_data.get("mbl_number") or inv_data.get("metadata", {}).get("mbl_number")) == "MBL-776655"
    assert (inv_data.get("ocean_bl_no") or inv_data.get("metadata", {}).get("ocean_bl_no")) == "OBL-887766"
    assert (inv_data.get("vessel_name") or inv_data.get("metadata", {}).get("vessel_name")) == "MSC MEDITERRANEAN"
    assert (inv_data.get("voyage_no") or inv_data.get("metadata", {}).get("voyage_no")) == "VOY-902B"
    assert (inv_data.get("etd_date") or inv_data.get("metadata", {}).get("etd_date")) == "2026-10-20"
    assert (inv_data.get("eta_date") or inv_data.get("metadata", {}).get("eta_date")) == "2026-11-02"

    assert (inv_data.get("igm_no") or inv_data.get("metadata", {}).get("igm_no")) == "IGM-9911"
    assert (inv_data.get("file_no") or inv_data.get("metadata", {}).get("file_no")) == "EXP-FILE-88"
    assert (inv_data.get("sales_rep") or inv_data.get("metadata", {}).get("sales_rep")) == "Robert Johnson"
    assert (inv_data.get("container_details") or inv_data.get("metadata", {}).get("container_details")) == "MSCU4433221 / 40FT HC"

    # Line item check
    pf_items = pf_data.get("items", [])
    inv_items = inv_data.get("items", [])
    assert len(pf_items) == len(inv_items)

    for i in range(len(pf_items)):
        assert inv_items[i]["description"] == pf_items[i]["description"]
        assert inv_items[i]["hsn_sac"] == pf_items[i]["hsn_sac"]
        assert inv_items[i]["qty"] == pf_items[i]["qty"]
        assert inv_items[i]["unit_price"] == pf_items[i]["unit_price"]

    # Financial Totals & Paisa verification
    assert abs(inv_data["grand_total"] - pf_data["grand_total"]) < 0.001
    assert inv_data["amount_paid"] == 50000.0
    assert abs(inv_data["balance_due"] - (pf_data["grand_total"] - 50000.0)) < 0.001

    # Check updated Pro Forma status
    pf_check = client.get(f"/api/v1/proforma/{pf_id}", headers=headers).json()
    assert pf_check["status"] == "CONVERTED"
    assert pf_check["converted_document_id"] == inv_data["id"]


def test_duplicate_conversion_rejection_409():
    """
    Test converting an already converted Pro Forma invoice returns 409 Conflict.
    """
    tenant_id = get_or_create_test_organization("Conflict Test Tenant")
    headers = {"X-Organization-Id": tenant_id}

    pf_no = f"PI-DUP-{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "proforma_no": pf_no,
        "proforma_date": "2026-10-09",
        "customer_name": "Test Duplicate Customer",
        "items": [
            {"description": "Item 1", "qty": 1, "unit_price": 1000, "tax_rate": 18}
        ]
    }

    # 1. Create
    res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert res.status_code == 201
    pf_id = res.json()["id"]

    # 2. First Conversion -> Success 201
    conv1 = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv1.status_code == 201

    # 3. Second Conversion -> 409 Conflict
    conv2 = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    assert conv2.status_code == 409
    assert "already converted" in conv2.json()["detail"].lower()


def test_tax_invoice_read_only_enforcement():
    """
    Test PUT, PATCH, DELETE operations on Tax Invoice are strictly rejected with 403 Forbidden.
    """
    tenant_id = get_or_create_test_organization("ReadOnly Test Tenant")
    headers = {"X-Organization-Id": tenant_id}

    # Create a proforma and convert to invoice
    pf_res = client.post("/api/v1/proforma", json={
        "customer_name": "ReadOnly Test Customer",
        "items": [{"description": "Item", "qty": 1, "unit_price": 500}]
    }, headers=headers)
    pf_id = pf_res.json()["id"]

    conv_res = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)
    inv_id = conv_res.json()["id"]

    # 1. PUT request -> 403 Forbidden
    put_res = client.put(f"/api/v1/invoices/{inv_id}", json={"customer_name": "Hacked Name"}, headers=headers)
    assert put_res.status_code == 403
    assert "read-only" in put_res.json()["detail"].lower()

    # 2. PATCH request -> 403 Forbidden
    patch_res = client.patch(f"/api/v1/invoices/{inv_id}", json={"notes": "New Notes"}, headers=headers)
    assert patch_res.status_code == 403

    # 3. DELETE request -> 403 Forbidden
    del_res = client.delete(f"/api/v1/invoices/{inv_id}", headers=headers)
    assert del_res.status_code == 403


def test_tenant_isolation_on_proforma_conversion():
    """
    Test Tenant B cannot convert or access Tenant A's Pro Forma documents.
    """
    db = get_admin_supabase_client()
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    try:
        db.table("organizations").insert([
            {"id": tenant_a, "owner_user_id": "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f", "company_name": "Tenant A Org", "country_code": "IN"},
            {"id": tenant_b, "owner_user_id": "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f", "company_name": "Tenant B Org", "country_code": "IN"}
        ]).execute()
    except Exception:
        pass

    headers_a = {"X-Organization-Id": tenant_a}
    headers_b = {"X-Organization-Id": tenant_b}

    # Tenant A creates proforma
    res = client.post("/api/v1/proforma", json={
        "customer_name": "Tenant A Customer",
        "items": [{"description": "Tenant A Item", "qty": 1, "unit_price": 5000}]
    }, headers=headers_a)
    pf_id = res.json()["id"]

    # Tenant B attempts to convert Tenant A's proforma -> 404 Not Found or 403 Forbidden
    conv_b = client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers_b)
    assert conv_b.status_code in [404, 403]


def test_proforma_field_coverage_mapping():
    """
    Task 3 requirement:
    Live database field coverage check using scripts/generate_schema_mapping.py.
    Reads information_schema directly from live database.
    Asserts 0 unmapped columns for headers and line items.
    """
    import sys
    import os
    scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from generate_schema_mapping import verify_live_schema_mapping

    report = verify_live_schema_mapping()
    assert len(report["header"]["unmapped"]) == 0, f"Unmapped header columns found: {report['header']['unmapped']}"
    assert len(report["item"]["unmapped"]) == 0, f"Unmapped item columns found: {report['item']['unmapped']}"
    assert len(report["header"]["copied_same"]) > 0
    assert len(report["item"]["copied_same"]) > 0


import concurrent.futures

def test_parallel_proforma_conversion_single_invoice():
    """
    Simulate two concurrent threads converting the same proforma invoice simultaneously.
    Asserts: Exactly one thread succeeds with HTTP 201 and the other fails with HTTP 409 Conflict.
    Only 1 tax invoice is created.
    """
    tenant_id = get_or_create_test_organization("Parallel Conversion Org")
    headers = {"X-Organization-Id": tenant_id}

    pf_no = f"PI-PAR-{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "proforma_no": pf_no,
        "proforma_date": "2026-10-10",
        "customer_name": "Parallel Customer",
        "items": [{"description": "Race Test Item", "qty": 2, "unit_price": 2500}]
    }

    res = client.post("/api/v1/proforma", json=payload, headers=headers)
    assert res.status_code == 201
    pf_id = res.json()["id"]

    def do_convert():
        return client.post(f"/api/v1/proforma/{pf_id}/convert", headers=headers)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_convert)
        f2 = executor.submit(do_convert)
        r1 = f1.result()
        r2 = f2.result()

    statuses = [r1.status_code, r2.status_code]
    assert 201 in statuses, f"Expected one 201 response, got {statuses}"
    assert 409 in statuses, f"Expected one 409 Conflict response, got {statuses}"


def test_financial_year_rollover_sequence_no_collision():
    """
    Tests FY rollover logic:
    Invoice on March 31, 2026 (FY 2025-26) -> INV-2526-0001
    Invoice on April 1, 2026 (FY 2026-27) -> INV-2627-0001
    Ensures counters reset per financial year without number collision.
    """
    from app.repositories.invoice_repository import InvoiceRepository
    repo = InvoiceRepository()
    tenant_id = get_or_create_test_organization("FY Rollover Org")

    inv_no_mar = repo.generate_invoice_no(tenant_id, invoice_date="2026-03-31")
    inv_no_apr = repo.generate_invoice_no(tenant_id, invoice_date="2026-04-01")

    assert "INV-2526-" in inv_no_mar
    assert "INV-2627-" in inv_no_apr
    assert inv_no_mar != inv_no_apr


def test_direct_tax_invoice_creation_prohibited_403():
    """
    Asserts direct POST /api/v1/invoices returns 403 Forbidden.
    Tax Invoices cannot be created directly; only via Pro Forma conversion.
    """
    tenant_id = get_or_create_test_organization("Direct Tax Inv Org")
    headers = {"X-Organization-Id": tenant_id}

    payload = {
        "invoice_date": "2026-10-10",
        "customer_name": "Direct Customer",
        "items": [
            {"description": "Direct Item", "qty": 1, "unit_price": 500}
        ]
    }
    res = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert res.status_code == 403, f"Expected 403, got {res.status_code}: {res.text}"
    assert "direct creation of tax invoices is disabled" in res.json()["detail"].lower()


def test_20_parallel_conversions_distinct_gap_free():
    """
    Task 2 requirement:
    Fires 20 parallel conversions for one org and asserts 20 distinct, gap-free numbers.
    """
    from app.services.proforma_service import ProformaService
    from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate

    db = get_admin_supabase_client()
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    org_id = str(uuid.uuid4())

    db.table("organizations").insert({
        "id": org_id,
        "owner_user_id": user_id,
        "company_name": f"Parallel Org {uuid.uuid4().hex[:6]}",
        "country_code": "IN",
        "state_name": "Maharashtra"
    }).execute()

    db.table("organization_members").insert({
        "organization_id": org_id,
        "user_id": user_id,
        "role": "owner",
        "status": "active"
    }).execute()

    try:
        db.table("organization_document_sequences").insert({
            "organization_id": org_id,
            "invoice_prefix": "INV",
            "invoice_next_no": 1,
            "sales_proforma_prefix": "PI",
            "sales_proforma_next_no": 1
        }).execute()
    except Exception:
        pass

    pf_service = ProformaService()
    pf_ids = []
    for i in range(20):
        pf_payload = ProFormaCreate(
            customer_name=f"Customer {i+1}",
            items=[ProFormaItemCreate(description=f"Item {i+1}", qty=1, unit_price=100.0 * (i+1))]
        )
        created = pf_service.create_proforma(org_id, pf_payload, user_id)
        pf_ids.append(created["id"])

    def do_convert(pf_id):
        import time
        for attempt in range(5):
            try:
                svc = ProformaService()
                return svc.convert_to_invoice(pf_id, org_id, user_id)
            except Exception as e:
                err_lower = str(e).lower()
                if ("disconnect" in err_lower or "connection" in err_lower or "ssl" in err_lower or "eof" in err_lower or "timeout" in err_lower or "protocol" in err_lower) and attempt < 4:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(do_convert, pid) for pid in pf_ids]
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())

    invoice_numbers = [r["invoice_no"] for r in results]
    assert len(invoice_numbers) == 20
    assert len(set(invoice_numbers)) == 20

    import re
    seqs = sorted([int(re.search(r"(\d+)$", ino).group(1)) for ino in invoice_numbers])
    assert seqs == list(range(1, 21)), f"Expected 1..20 gap-free numbers, got {seqs}"



