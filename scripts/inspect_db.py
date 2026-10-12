import urllib.request
import json

url = "https://tczrxkmdhbsfbjxzlvav.supabase.co/rest/v1/"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenJ4a21kaGJzZmJqeHpsdmF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk3NTQ4NSwiZXhwIjoyMTAwNTUxNDg1fQ.3G5TECkLuCCq2JluYYZZW36hwK-K-7DkcneU87i7zwk"

req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())

print("Tables in definitions:")
for k in sorted(data.get("definitions", {}).keys()):
    print(f"  {k}")

print("\nPaths/RPCs:")
for p in sorted(data.get("paths", {}).keys()):
    if "/rpc/" in p:
        print(f"  {p}")

if "proforma_invoices" in data.get("definitions", {}):
    print("\nproforma_invoices properties:")
    for prop in sorted(data["definitions"]["proforma_invoices"].get("properties", {}).keys()):
        print(f"  {prop}")

if "invoices" in data.get("definitions", {}):
    print("\ninvoices properties:")
    for prop in sorted(data["definitions"]["invoices"].get("properties", {}).keys()):
        print(f"  {prop}")

if "proforma_invoice_items" in data.get("definitions", {}):
    print("\nproforma_invoice_items properties:")
    for prop in sorted(data["definitions"]["proforma_invoice_items"].get("properties", {}).keys()):
        print(f"  {prop}")

if "invoice_items" in data.get("definitions", {}):
    print("\ninvoice_items properties:")
    for prop in sorted(data["definitions"]["invoice_items"].get("properties", {}).keys()):
        print(f"  {prop}")
