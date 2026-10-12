import urllib.request
import json

BASE_URL = "http://localhost:8000/api/v1"

def check_endpoint(path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    # Simulate authorization or organization headers if needed
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"[{method} {path}] Status: {resp.status}")
            data = resp.read().decode('utf-8')
            print(f"  Response (first 200 chars): {data[:200]}")
    except urllib.error.HTTPError as e:
        print(f"[{method} {path}] HTTPError {e.code}: {e.read().decode('utf-8')[:300]}")
    except Exception as e:
        print(f"[{method} {path}] Exception: {e}")

print("--- TESTING BACKEND ENDPOINTS ---")
check_endpoint("/parties?party_type=customer")
check_endpoint("/items")
check_endpoint("/templates")
check_endpoint("/templates/system")
check_endpoint("/proforma")
