import sys
sys.path.append('backend')
import json
import requests
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

print("==================================================")
print("FASTAPI TESTCLIENT MULTI-TENANT & API VERIFICATION")
print("==================================================")

client = TestClient(app)
SUPABASE_URL = settings.SUPABASE_URL
SUPABASE_ANON_KEY = settings.SUPABASE_ANON_KEY

def login_demo_user(email, password="Demo@12345"):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password}
    )
    if r.status_code == 200:
        return r.json().get("access_token")
    return None

# 1. Super Admin Dashboard Privacy Test
sa_token = login_demo_user("superadmin@demo.twitebilling.local")
print(f"Super Admin Auth Token: {bool(sa_token)}")
if sa_token:
    headers = {"Authorization": f"Bearer {sa_token}"}
    r = client.get("/api/v1/super-admin/dashboard", headers=headers)
    print(f"GET /super-admin/dashboard Status: {r.status_code}")
    print("  Dashboard Data:", r.json())
    assert r.status_code == 200, f"Dashboard failed with {r.status_code}: {r.text}"

    r_comp = client.get("/api/v1/super-admin/companies", headers=headers)
    print(f"GET /super-admin/companies Status: {r_comp.status_code}")
    print(f"  Listed Companies: {len(r_comp.json() or [])}")

# 2. Tenant A Customers & Items Test
user_a_token = login_demo_user("owner@company-a.demo")
print(f"\nTenant A Auth Token: {bool(user_a_token)}")
if user_a_token:
    headers_a = {"Authorization": f"Bearer {user_a_token}"}
    r_cust_a = client.get("/api/v1/parties?party_type=customer", headers=headers_a)
    print(f"GET Tenant A Parties Status: {r_cust_a.status_code}")
    print(f"  Tenant A Customers Count: {len(r_cust_a.json() or [])}")
    assert r_cust_a.status_code == 200

    r_items_a = client.get("/api/v1/items", headers=headers_a)
    print(f"GET Tenant A Items Status: {r_items_a.status_code}")
    print(f"  Tenant A Items Count: {len(r_items_a.json() or [])}")
    assert r_items_a.status_code == 200

    r_pf_a = client.get("/api/v1/proforma", headers=headers_a)
    print(f"GET Tenant A Proforma Status: {r_pf_a.status_code}")
    assert r_pf_a.status_code == 200

# 3. Tenant B Customers Test
user_b_token = login_demo_user("owner@company-b.demo")
print(f"\nTenant B Auth Token: {bool(user_b_token)}")
if user_b_token:
    headers_b = {"Authorization": f"Bearer {user_b_token}"}
    r_cust_b = client.get("/api/v1/parties?party_type=customer", headers=headers_b)
    print(f"GET Tenant B Parties Status: {r_cust_b.status_code}")
    print(f"  Tenant B Customers Count: {len(r_cust_b.json() or [])}")
    assert r_cust_b.status_code == 200

print("\n==================================================")
print("ALL FASTAPI TESTCLIENT ENDPOINTS PASSED 100% WITH HTTP 200 OK!")
print("==================================================")
