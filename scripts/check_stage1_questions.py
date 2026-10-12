import os
import sys
import json
import urllib.request

backend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend")
sys.path.insert(0, backend_dir)

from app.core.supabase import get_admin_supabase_client

db = get_admin_supabase_client()

print("--- 1. Testing RPC endpoints via OpenAPI & Direct RPC ---")
# Check PostgREST root definitions and paths
url = "https://tczrxkmdhbsfbjxzlvav.supabase.co/rest/v1/"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenJ4a21kaGJzZmJqeHpsdmF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk3NTQ4NSwiZXhwIjoyMTAwNTUxNDg1fQ.3G5TECkLuCCq2JluYYZZW36hwK-K-7DkcneU87i7zwk"

req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
with urllib.request.urlopen(req) as resp:
    schema = json.loads(resp.read().decode())

rpc_paths = [p for p in schema.get("paths", {}).keys() if "/rpc/" in p]
print("Deployed RPC Paths in PostgREST:")
for r in sorted(rpc_paths):
    print(" ", r)

print("\n--- 2. Checking if public.payment_allocations exists in schema ---")
tables = list(schema.get("definitions", {}).keys())
print("Is 'payment_allocations' in tables?", "payment_allocations" in tables)

print("\n--- 3. Testing direct RPC call for convert_proforma_to_invoice ---")
try:
    res = db.rpc("convert_proforma_to_invoice", {
        "p_proforma_id": "00000000-0000-0000-0000-000000000000",
        "p_org_id": "00000000-0000-0000-0000-000000000000",
        "p_user_id": "00000000-0000-0000-0000-000000000000"
    }).execute()
    print("convert_proforma_to_invoice result:", res.data)
except Exception as e:
    print("convert_proforma_to_invoice error:", e)

print("\n--- 4. Testing direct RPC call for convert_sales_proforma_to_invoice ---")
try:
    res = db.rpc("convert_sales_proforma_to_invoice", {
        "p_proforma_id": "00000000-0000-0000-0000-000000000000"
    }).execute()
    print("convert_sales_proforma_to_invoice result:", res.data)
except Exception as e:
    print("convert_sales_proforma_to_invoice error:", e)

print("\n--- 5. Checking direct query on payment_allocations table ---")
try:
    res = db.table("payment_allocations").select("*").limit(1).execute()
    print("payment_allocations query success:", res.data)
except Exception as e:
    print("payment_allocations query error:", e)
