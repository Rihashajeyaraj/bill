import time
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"

# Fetch default organization ID from dev endpoint or db
def get_default_org():
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/v1/dashboard")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return True
    except Exception as e:
        print(f"Error accessing root/dashboard: {e}")
        return False

def measure_endpoint(url, method="GET", headers=None, runs=3):
    headers = headers or {}
    times = []
    status_codes = []
    row_counts = []

    for i in range(runs):
        t0 = time.perf_counter()
        req = urllib.request.Request(url, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                elapsed = (time.perf_counter() - t0) * 1000 # ms
                body = resp.read()
                times.append(elapsed)
                status_codes.append(resp.status)
                try:
                    parsed = json.loads(body.decode("utf-8"))
                    if isinstance(parsed, list):
                        row_counts.append(len(parsed))
                    elif isinstance(parsed, dict):
                        if "data" in parsed and isinstance(parsed["data"], list):
                            row_counts.append(len(parsed["data"]))
                        elif "items" in parsed and isinstance(parsed["items"], list):
                            row_counts.append(len(parsed["items"]))
                        else:
                            row_counts.append(1)
                except Exception:
                    row_counts.append(1)
        except urllib.error.HTTPError as e:
            elapsed = (time.perf_counter() - t0) * 1000
            times.append(elapsed)
            status_codes.append(e.code)
            row_counts.append(0)
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000
            times.append(elapsed)
            status_codes.append(500)
            row_counts.append(0)

    avg_time = sum(times) / len(times) if times else 0
    return {
        "url": url,
        "avg_ms": round(avg_time, 2),
        "min_ms": round(min(times), 2) if times else 0,
        "max_ms": round(max(times), 2) if times else 0,
        "status": status_codes[0] if status_codes else 0,
        "row_count": row_counts[0] if row_counts else 0
    }

endpoints = [
    ("Dashboard", f"{BASE_URL}/api/v1/dashboard"),
    ("Pro Forma list", f"{BASE_URL}/api/v1/proforma"),
    ("Pro Forma next-no", f"{BASE_URL}/api/v1/proforma/next-number"),
    ("Tax Invoice list", f"{BASE_URL}/api/v1/invoices"),
    ("Payment In list", f"{BASE_URL}/api/v1/payments"),
    ("Payment In summary", f"{BASE_URL}/api/v1/payments/summary"),
    ("Reports: customer-wise", f"{BASE_URL}/api/v1/reports/customer-wise"),
    ("Reports: payments", f"{BASE_URL}/api/v1/reports/payments"),
    ("Reports: advances", f"{BASE_URL}/api/v1/reports/advances"),
    ("Reports: balance-due", f"{BASE_URL}/api/v1/reports/balance-due"),
    ("Reports: proforma", f"{BASE_URL}/api/v1/reports/proforma"),
    ("Reports: tax-invoices", f"{BASE_URL}/api/v1/reports/tax-invoices"),
    ("Parties (Customers)", f"{BASE_URL}/api/v1/parties?party_type=customer"),
    ("Items Master", f"{BASE_URL}/api/v1/items")
]

print("=== STARTING BASELINE PERFORMANCE BENCHMARK ===", flush=True)
results = []
for name, url in endpoints:
    print(f"Testing {name}...", flush=True)
    res = measure_endpoint(url, runs=2)
    results.append((name, res))
    print(f"{name:25} | Status: {res['status']} | Avg Latency: {res['avg_ms']} ms (min: {res['min_ms']}, max: {res['max_ms']}) | Rows: {res['row_count']}", flush=True)

with open("baseline_benchmark.json", "w") as f:
    json.dump(results, f, indent=2)
print("=== BENCHMARK COMPLETE ===")
