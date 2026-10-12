import os
import sys
import json
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.abspath("backend"))
from app.core.supabase import get_admin_supabase_client

db = get_admin_supabase_client()

print("=" * 60)
print("QUERY 1: Functions in pg_proc")
print("=" * 60)
url = "https://tczrxkmdhbsfbjxzlvav.supabase.co/rest/v1/"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenJ4a21kaGJzZmJqeHpsdmF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk3NTQ4NSwiZXhwIjoyMTAwNTUxNDg1fQ.3G5TECkLuCCq2JluYYZZW36hwK-K-7DkcneU87i7zwk"
req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
schema = json.loads(urllib.request.urlopen(req).read().decode())

target_funcs = [
    'convert_sales_proforma_to_invoice',
    'convert_proforma_to_invoice',
    'allocate_tax_invoice_no',
    'allocate_invoice_no'
]

found_funcs = []
for p, p_data in schema.get("paths", {}).items():
    if "/rpc/" in p:
        func_name = p.replace("/rpc/", "")
        if func_name in target_funcs:
            # extract args from post schema
            post_schema = p_data.get("post", {})
            params = post_schema.get("parameters", [])
            args_list = []
            for param in params:
                if param.get("name") == "args":
                    props = param.get("schema", {}).get("properties", {})
                    for prop_name, prop_val in props.items():
                        args_list.append(f"{prop_name} {prop_val.get('format') or prop_val.get('type')}")
            found_funcs.append((func_name, ", ".join(args_list)))

print(f"{'proname':<35} | {'args'}")
print("-" * 75)
if found_funcs:
    for name, args in found_funcs:
        print(f"{name:<35} | {args}")
else:
    print("(0 rows)")

for fn in target_funcs:
    if fn not in [f[0] for f in found_funcs]:
        # verify non-existence via direct RPC call
        try:
            db.rpc(fn, {}).execute()
        except Exception as e:
            err_str = str(e)
            if "PGRST202" in err_str:
                pass # confirmed not found in schema

print("\n" + "=" * 60)
print("QUERY 2: Duplicate invoice numbers per organization")
print("=" * 60)
# Fetch all invoices
inv_res = db.table("invoices").select("organization_id, invoice_no").limit(5000).execute()
invoices = inv_res.data or []

counter = Counter((inv.get("organization_id"), inv.get("invoice_no")) for inv in invoices)
duplicates = [(org_id, inv_no, cnt) for (org_id, inv_no), cnt in counter.items() if cnt > 1]

print(f"{'organization_id':<38} | {'invoice_no':<20} | {'count'}")
print("-" * 70)
if duplicates:
    for org_id, inv_no, cnt in duplicates:
        print(f"{str(org_id):<38} | {str(inv_no):<20} | {cnt}")
else:
    print("(0 rows)")

print("\n" + "=" * 60)
print("QUERY 3: Invoices per organization")
print("=" * 60)
org_res = db.table("organizations").select("id, company_name").limit(1000).execute()
orgs = org_res.data or []

# Count invoices per org
org_inv_counts = Counter(inv.get("organization_id") for inv in invoices)

org_list = []
for o in orgs:
    oid = o.get("id")
    cname = o.get("company_name") or "Unnamed"
    cnt = org_inv_counts.get(oid, 0)
    org_list.append((oid, cname, cnt))

org_list.sort(key=lambda x: x[2], reverse=True)

print(f"{'id':<38} | {'company_name':<35} | {'invoices'}")
print("-" * 85)
for oid, cname, cnt in org_list:
    print(f"{str(oid):<38} | {str(cname)[:35]:<35} | {cnt}")

print("\n" + "=" * 60)
print("QUERY 4: Columns in public.payments (ordinal position)")
print("=" * 60)
# From PostgREST definitions / openapi properties (PostgREST preserves catalog column order)
payments_props = schema.get("definitions", {}).get("payments", {}).get("properties", {})
print(f"{'column_name'}")
print("-" * 30)
for col in payments_props.keys():
    print(col)

print("\n" + "=" * 60)
print("QUERY 5: Columns in public.invoices matching specific list")
print("=" * 60)
candidate_cols = [
    'source_proforma_id',
    'shipper_name',
    'vessel_name',
    'bl_number',
    'financial_year',
    'sequence_no',
    'export_type',
    'document_type',
    'customer_phone'
]

invoices_props = schema.get("definitions", {}).get("invoices", {}).get("properties", {})
present_cols = [col for col in candidate_cols if col in invoices_props]

print(f"{'column_name'}")
print("-" * 30)
if present_cols:
    for col in present_cols:
        print(col)
else:
    print("(0 rows)")
