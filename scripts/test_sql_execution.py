import urllib.request
import urllib.error
import json

url_base = "https://tczrxkmdhbsfbjxzlvav.supabase.co"
service_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenJ4a21kaGJzZmJqeHpsdmF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk3NTQ4NSwiZXhwIjoyMTAwNTUxNDg1fQ.3G5TECkLuCCq2JluYYZZW36hwK-K-7DkcneU87i7zwk"

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Content-Type": "application/json"
}

endpoints_to_try = [
    ("/pg/query", {"query": "SELECT 1"}),
    ("/database/query", {"query": "SELECT 1"}),
    ("/sql", {"query": "SELECT 1"}),
    ("/rest/v1/rpc/exec_sql", {"query": "SELECT 1"}),
    ("/rest/v1/rpc/run_sql", {"sql": "SELECT 1"}),
    ("/rest/v1/rpc/execute_sql", {"sql": "SELECT 1"}),
]

for ep, body in endpoints_to_try:
    req = urllib.request.Request(f"{url_base}{ep}", data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"SUCCESS {ep}: {resp.status} {resp.read().decode()}")
    except urllib.error.HTTPError as e:
        print(f"HTTPError {ep}: {e.code} {e.read().decode()[:100]}")
    except Exception as e:
        print(f"Error {ep}: {e}")
