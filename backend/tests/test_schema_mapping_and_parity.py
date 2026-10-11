import re
from pathlib import Path
from datetime import date, datetime
import pytest

from app.schemas.proforma import ProFormaResponse, ProFormaItemBase
from app.schemas.invoice import InvoiceResponse, InvoiceItemBase

EXCLUDE_HEADER = {
    "id",
    "proforma_no",
    "invoice_no",
    "status",
    "created_at",
    "updated_at",
    "converted_document_id",
    "converted_at",
    "created_by",
    "document_type",
    "source_proforma_id",
    "source_proforma_no",
    "source_proforma_date",
    "valid_till",
    "needs_customer_link",
    "proforma_date"
}

EXCLUDE_ITEMS = {
    "id",
    "proforma_id",
    "invoice_id",
    "created_at",
    "updated_at"
}


def parse_sql_table_columns(sql_text: str, table_name: str) -> set:
    columns = set()
    
    # 1. Match CREATE TABLE [IF NOT EXISTS] public.<table_name> (...)
    pattern = rf"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?{table_name}\s*\((.*?)\);"
    match = re.search(pattern, sql_text, re.IGNORECASE | re.DOTALL)
    if match:
        table_body = match.group(1)
        for line in table_body.splitlines():
            clean = line.strip().rstrip(",")
            if not clean or clean.startswith("--"):
                continue
            first_word = clean.split()[0].lower()
            if first_word in ("constraint", "primary", "unique", "foreign", "check"):
                continue
            col_name = clean.split()[0].strip('"').lower()
            columns.add(col_name)

    # 2. Match ALTER TABLE [IF EXISTS] public.<table_name> ADD COLUMN [IF NOT EXISTS] <col_name>
    alter_pattern = rf"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?{table_name}\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)"
    for m in re.finditer(alter_pattern, sql_text, re.IGNORECASE):
        columns.add(m.group(1).lower())

    return columns


def test_sql_schema_column_parity():
    """
    Parses supabase/schema.sql and migration files and asserts:
    every column of proforma_invoices (except EXCLUDE) exists on invoices with the same name.
    every column of proforma_invoice_items (except EXCLUDE) exists on invoice_items with the same name.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    schema_sql_path = repo_root / "supabase" / "schema.sql"
    add_fields_path = repo_root / "supabase" / "add_proforma_reference_fields.sql"

    combined_sql = ""
    if schema_sql_path.exists():
        combined_sql += schema_sql_path.read_text(encoding="utf-8") + "\n"
    if add_fields_path.exists():
        combined_sql += add_fields_path.read_text(encoding="utf-8") + "\n"

    # Also include migrations directory if present
    migrations_dir = repo_root / "supabase" / "migrations"
    if migrations_dir.is_dir():
        for f in migrations_dir.glob("*.sql"):
            combined_sql += f.read_text(encoding="utf-8") + "\n"

    pf_cols = parse_sql_table_columns(combined_sql, "proforma_invoices")
    inv_cols = parse_sql_table_columns(combined_sql, "invoices")

    assert pf_cols, "Failed to parse columns for public.proforma_invoices"
    assert inv_cols, "Failed to parse columns for public.invoices"

    missing_header = (pf_cols - EXCLUDE_HEADER) - inv_cols
    assert not missing_header, f"Columns missing on public.invoices: {sorted(missing_header)}"

    pf_item_cols = parse_sql_table_columns(combined_sql, "proforma_invoice_items")
    inv_item_cols = parse_sql_table_columns(combined_sql, "invoice_items")

    assert pf_item_cols, "Failed to parse columns for public.proforma_invoice_items"
    assert inv_item_cols, "Failed to parse columns for public.invoice_items"

    missing_items = (pf_item_cols - EXCLUDE_ITEMS) - inv_item_cols
    assert not missing_items, f"Columns missing on public.invoice_items: {sorted(missing_items)}"


def test_python_response_schemas_parity():
    """
    Asserts: a fully populated proforma payload and the invoice response
    contain the same field values for every shared field.
    """
    sample_payload = {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "organization_id": "660e8400-e29b-41d4-a716-446655440001",
        "template_id": "new_globe_export",
        "proforma_no": "PI-2026-0001",
        "proforma_date": "2026-10-11",
        "due_date": "2026-11-11",
        "customer_name": "Acme Global Freight Ltd",
        "customer_company_name": "Acme Global Freight Ltd",
        "customer_address": "123 Harbour Way, Port Industrial Zone",
        "customer_city": "Chennai",
        "customer_state": "Tamil Nadu",
        "customer_country": "India",
        "customer_gstin": "33AAACA1234A1Z5",
        "customer_phone": "+91 9876543210",
        "customer_email": "ops@acmeglobal.com",
        "customer_pincode": "600001",
        "customer_ref": "REF-CUST-8899",
        "currency_code": "USD",
        "exchange_rate": 98.45,
        "roe": 98.45,
        "export_type": "DOMESTIC",
        "shipper_name": "Global Cargo Shippers Inc",
        "consignee_name": "Acme Global Freight Ltd",
        "origin": "Chennai Port (INMAA)",
        "destination": "Jebel Ali Port (AEJEA)",
        "packs_qty": "100",
        "weight_kgs": 4500.50,
        "volume_cbm": 32.75,
        "freight_terms": "Prepaid",
        "bl_number": "BL-778899",
        "thbl_number": "THBL-1122",
        "mbl_number": "MBL-3344",
        "ocean_bl_no": "OBL-5566",
        "vessel_name": "Ever Given",
        "voyage_no": "V.042W",
        "etd_date": "2026-10-15",
        "eta_date": "2026-10-28",
        "igm_no": "IGM-9988",
        "igm_date": "2026-10-10",
        "igm_item_no": "42",
        "file_no": "FILE-FF-2026",
        "sales_rep": "Rahul Sharma",
        "rcm_applicable": False,
        "container_details": "MSKU1234567 / 40HC / TN-01-AB-1234",
        "tds_note": "* Kindly deduct T.D.S on Invoice amount excluding GST amount.",
        "remarks": "Handle temperature-sensitive cargo with care.",
        "subtotal": 57455.25,
        "discount_total": 0.0,
        "taxable_total": 57455.25,
        "cgst_total": 4851.01,
        "sgst_total": 4851.01,
        "igst_total": 0.0,
        "tax_total": 9702.02,
        "round_off": 0.0,
        "grand_total": 67157.27,
        "amount_paid": 0.0,
        "balance_due": 67157.27,
        "terms": "1. Payment within 30 days\n2. Interest @ 18% p.a. for delayed payments",
        "items": [
            {
                "line_no": 1,
                "description": "Ocean Freight Charges",
                "hsn_sac": "996521",
                "qty": 1.0,
                "unit": "PCS",
                "unit_price": 50.0,
                "rate": 50.0,
                "tax_rate": 5.0,
                "cgst_rate": 2.5,
                "sgst_rate": 2.5,
                "igst_rate": 0.0,
                "cgst_amount": 123.06,
                "sgst_amount": 123.06,
                "igst_amount": 0.0,
                "amount_inr": 4922.50,
                "taxable_amount": 4922.50,
                "currency": "USD",
                "place_of_supply": "Tamil Nadu",
                "line_total": 5168.62
            }
        ]
    }

    pf_obj = ProFormaResponse(**sample_payload)

    # Convert proforma dump to invoice response payload
    dumped = pf_obj.model_dump()
    inv_payload = {k: v for k, v in dumped.items() if k in InvoiceResponse.model_fields}
    inv_payload["invoice_no"] = "INV-2627-0001"
    inv_payload["invoice_date"] = pf_obj.proforma_date
    inv_payload["status"] = "issued"

    inv_obj = InvoiceResponse(**inv_payload)

    # Assert all shared fields have identical values
    shared_fields = set(ProFormaResponse.model_fields.keys()) & set(InvoiceResponse.model_fields.keys())
    # Exclude status (proforma is DRAFT/CONVERTED while invoice is issued)
    # Exclude invoice_date (proforma may have None while invoice has proforma_date)
    testable_fields = shared_fields - {"status", "invoice_date", "items"}

    for field in sorted(testable_fields):
        pf_val = getattr(pf_obj, field)
        inv_val = getattr(inv_obj, field)
        assert pf_val == inv_val, f"Field '{field}' mismatch: ProFormaResponse has {pf_val!r}, InvoiceResponse has {inv_val!r}"

    # Assert item shared fields
    assert len(pf_obj.items) == len(inv_obj.items)
    for pf_item, inv_item in zip(pf_obj.items, inv_obj.items):
        item_shared = set(ProFormaItemBase.model_fields.keys()) & set(InvoiceItemBase.model_fields.keys())
        for ifield in sorted(item_shared):
            pf_ival = getattr(pf_item, ifield)
            inv_ival = getattr(inv_item, ifield)
            assert pf_ival == inv_ival, f"Item field '{ifield}' mismatch: {pf_ival!r} vs {inv_ival!r}"
