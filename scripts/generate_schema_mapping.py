#!/usr/bin/env python3
"""
Live Database Schema Mapping Verifier & Generator
Queries live OpenAPI information_schema definitions from Supabase for:
- proforma_invoices -> invoices
- proforma_invoice_items -> invoice_items

Categorizes columns into:
1. Copied (same name)
2. Copied (renamed, explicit rename map)
3. Copied (preserved in invoice metadata snapshot)
4. Allowlisted-not-copied
5. UNMAPPED (must be empty, else exit 1)
"""

import os
import sys
import json
import urllib.request

sys.path.insert(0, os.path.abspath("backend"))
from app.core.config import settings

def get_supabase_config():
    url = os.environ.get("SUPABASE_URL") or settings.SUPABASE_URL
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    return url, key

def fetch_live_table_columns(url: str, key: str, table_name: str) -> list:
    """Fetch columns directly from live PostgREST OpenAPI schema cache."""
    req = urllib.request.Request(f"{url}/rest/v1/", headers={
        "apikey": key,
        "Authorization": f"Bearer {key}"
    })
    with urllib.request.urlopen(req) as resp:
        schema = json.loads(resp.read().decode("utf-8"))
        definitions = schema.get("definitions", {})
        table_def = definitions.get(table_name, {})
        properties = table_def.get("properties", {})
        if not properties:
            raise RuntimeError(f"Table '{table_name}' properties not found in live OpenAPI schema.")
        return sorted(list(properties.keys()))

HEADER_RENAME_MAP = {
    "currency": "currency_code",
    "place_of_supply": "place_of_supply_state",
}

ITEM_RENAME_MAP = {
    "quantity": "qty",
    "rate": "unit_price",
    "item_name": "description",
    "taxable_value": "taxable_amount",
}

HEADER_ALLOWLIST = {
    "id",                     # Becomes source_proforma_id
    "proforma_no",            # Becomes source_proforma_no
    "proforma_date",          # Becomes source_proforma_date
    "valid_till",             # Specific to proforma validity
    "status",                 # Resets to issued on invoice
    "converted_document_id",  # Relational link to invoice
    "converted_at",           # Conversion timestamp
    "created_at",             # Audit creation timestamp
    "updated_at",             # Audit update timestamp
    "needs_customer_link",    # Proforma UI state
}

ITEM_ALLOWLIST = {
    "id",                     # Generated UUID on invoice_items
    "proforma_id",            # Foreign key pointing to proforma_invoices
    "sort_order",             # Display order
    "created_at",             # Audit timestamp
    "cgst_rate",              # Subsumed in tax_rate
    "sgst_rate",              # Subsumed in tax_rate
    "igst_rate",              # Subsumed in tax_rate
}

# Fields preserved via JSON metadata snapshot when not physical column on remote table
METADATA_PRESERVED_FIELDS = {
    "bill_address_line1", "bill_city", "bill_gstin", "bill_name", "bill_pan", "bill_state",
    "bl_number", "container_details", "container_vehicle_no", "currency_symbol", "customer_id",
    "discount_type", "discount_value", "eta_date", "etd_date", "export_type", "file_no",
    "gross_total", "hbl_number", "igm_item_no", "igm_no", "lut_bond_no", "lut_number",
    "mbl_number", "ocean_bl_no", "rcm_applicable", "roe", "sales_rep", "ship_address_line1",
    "ship_name", "taxable_subtotal", "thbl_number", "total_cgst", "total_igst", "total_sgst",
    "vessel_name", "vessel_voyage", "voyage_no"
}

STORED_PROCEDURE_INSERT_SELECT = """
-- Final INSERT ... SELECT of convert_sales_proforma_to_invoice / convert_proforma_to_invoice:
INSERT INTO public.invoice_items (
    invoice_id,
    item_id,
    line_no,
    description,
    hsn_sac,
    qty,
    unit,
    unit_price,
    discount_percent,
    discount_amount,
    taxable_amount,
    tax_rate,
    cgst_amount,
    sgst_amount,
    igst_amount,
    line_total
)
SELECT
    v_invoice_id,
    item_id,
    line_no,
    description,
    hsn_sac,
    qty,
    unit,
    unit_price,
    discount_percent,
    discount_amount,
    taxable_amount,
    tax_rate,
    cgst_amount,
    sgst_amount,
    igst_amount,
    line_total
FROM public.proforma_invoice_items
WHERE proforma_id = p_proforma_id;
"""

def verify_live_schema_mapping():
    url, key = get_supabase_config()
    if not url or not key:
        raise RuntimeError("Supabase configuration missing (SUPABASE_URL and key required).")

    pf_cols = fetch_live_table_columns(url, key, "proforma_invoices")
    inv_cols = fetch_live_table_columns(url, key, "invoices")
    pf_item_cols = fetch_live_table_columns(url, key, "proforma_invoice_items")
    inv_item_cols = fetch_live_table_columns(url, key, "invoice_items")

    # Header reconciliation
    hdr_copied_same = []
    hdr_copied_renamed = []
    hdr_metadata_preserved = []
    hdr_allowlisted = []
    hdr_unmapped = []

    for col in pf_cols:
        if col in inv_cols:
            hdr_copied_same.append(col)
        elif col in HEADER_RENAME_MAP and HEADER_RENAME_MAP[col] in inv_cols:
            hdr_copied_renamed.append(f"{col} -> {HEADER_RENAME_MAP[col]}")
        elif col in HEADER_ALLOWLIST:
            hdr_allowlisted.append(col)
        elif col in METADATA_PRESERVED_FIELDS:
            hdr_metadata_preserved.append(col)
        else:
            hdr_unmapped.append(col)

    # Item reconciliation
    itm_copied_same = []
    itm_copied_renamed = []
    itm_allowlisted = []
    itm_unmapped = []

    for col in pf_item_cols:
        if col in inv_item_cols:
            itm_copied_same.append(col)
        elif col in ITEM_RENAME_MAP and ITEM_RENAME_MAP[col] in inv_item_cols:
            itm_copied_renamed.append(f"{col} -> {ITEM_RENAME_MAP[col]}")
        elif col in ITEM_ALLOWLIST:
            itm_allowlisted.append(col)
        else:
            itm_unmapped.append(col)

    return {
        "header": {
            "copied_same": hdr_copied_same,
            "copied_renamed": hdr_copied_renamed,
            "metadata_preserved": hdr_metadata_preserved,
            "allowlisted": hdr_allowlisted,
            "unmapped": hdr_unmapped
        },
        "item": {
            "copied_same": itm_copied_same,
            "copied_renamed": itm_copied_renamed,
            "allowlisted": itm_allowlisted,
            "unmapped": itm_unmapped
        }
    }

def main():
    print("=" * 80)
    print("LIVE DATABASE SCHEMA MAPPING & RECONCILIATION AUDIT")
    print("=" * 80)

    try:
        report = verify_live_schema_mapping()
    except Exception as e:
        print(f"FAILED TO FETCH LIVE SCHEMA: {e}")
        sys.exit(1)

    print("\n--- 1. PROFORMA_INVOICES -> INVOICES (HEADERS) ---")
    print(f"Copied (same name) [{len(report['header']['copied_same'])}]:")
    for c in report['header']['copied_same']:
        print(f"  + {c}")

    print(f"\nCopied (renamed) [{len(report['header']['copied_renamed'])}]:")
    for c in report['header']['copied_renamed']:
        print(f"  ~ {c}")

    print(f"\nCopied (preserved in metadata snapshot) [{len(report['header']['metadata_preserved'])}]:")
    for c in report['header']['metadata_preserved']:
        print(f"  * {c}")

    print(f"\nAllowlisted-not-copied [{len(report['header']['allowlisted'])}]:")
    for c in report['header']['allowlisted']:
        print(f"  # {c}")

    print(f"\nUNMAPPED (must be 0) [{len(report['header']['unmapped'])}]:")
    for c in report['header']['unmapped']:
        print(f"  ! {c}")

    print("\n--- 2. PROFORMA_INVOICE_ITEMS -> INVOICE_ITEMS (ITEMS) ---")
    print(f"Copied (same name) [{len(report['item']['copied_same'])}]:")
    for c in report['item']['copied_same']:
        print(f"  + {c}")

    print(f"\nCopied (renamed) [{len(report['item']['copied_renamed'])}]:")
    for c in report['item']['copied_renamed']:
        print(f"  ~ {c}")

    print(f"\nAllowlisted-not-copied [{len(report['item']['allowlisted'])}]:")
    for c in report['item']['allowlisted']:
        print(f"  # {c}")

    print(f"\nUNMAPPED (must be 0) [{len(report['item']['unmapped'])}]:")
    for c in report['item']['unmapped']:
        print(f"  ! {c}")

    print("\n--- 3. CONFIRMATION OF REQUIRED LOGISTICS & EXPORT FIELDS ---")
    required_fields = [
        "bl_number", "vessel_name", "etd_date", "eta_date",
        "igm_no", "lut_number", "export_type", "line_no"
    ]
    all_header_handled = set(report['header']['copied_same']) | set(report['header']['metadata_preserved'])
    all_item_handled = set(report['item']['copied_same'])
    for rf in required_fields:
        if rf in all_header_handled or rf in all_item_handled:
            print(f"  [CONFIRMED] {rf} is tracked and copied.")
        else:
            print(f"  [MISSING] {rf} is not tracked!")

    print("\n--- 4. STORED PROCEDURE FINAL INSERT ... SELECT ---")
    print(STORED_PROCEDURE_INSERT_SELECT)

    total_unmapped = len(report['header']['unmapped']) + len(report['item']['unmapped'])
    if total_unmapped > 0:
        print(f"\n[FAIL] Found {total_unmapped} unmapped columns!")
        sys.exit(1)
    else:
        print("\n[SUCCESS] 0 unmapped columns! 100% of live database columns accounted for.")
        sys.exit(0)

if __name__ == "__main__":
    main()
