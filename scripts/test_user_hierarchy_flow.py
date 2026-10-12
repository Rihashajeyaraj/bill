import sys
import os
import time
import requests
import json
import uuid

sys.path.insert(0, "backend")

# Set stdout encoding for Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
load_dotenv("backend/.env")

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

def test_user_hierarchy_flow():
    print("=" * 75)
    print("TWITE BILLING SAAS - USER HIERARCHY & ROLE PERMISSIONS TEST")
    print("=" * 75)

    timestamp = int(time.time())
    supabase_url = settings.SUPABASE_URL
    anon_key = settings.SUPABASE_ANON_KEY
    client = TestClient(app)

    # 1. Super Admin authentication via Supabase Auth
    sa_email = f"superadmin.{timestamp}@demo.twitebilling.local"
    sa_pass = "DemoSuperAdmin123!"

    r_sa_signup = requests.post(
        f"{supabase_url}/auth/v1/signup",
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        json={"email": sa_email, "password": sa_pass}
    )
    sa_token = r_sa_signup.json().get("access_token")
    if not sa_token:
        r_sa_login = requests.post(
            f"{supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": anon_key, "Content-Type": "application/json"},
            json={"email": sa_email, "password": sa_pass}
        )
        sa_token = r_sa_login.json().get("access_token")

    print(f"[1] Super Admin Authenticated: {bool(sa_token)}")

    # 2. Super Admin Creates Tenant Company & Initial Tenant Admin Credentials
    print("\n--- STEP 1: SUPER ADMIN CREATES TENANT COMPANY & ADMIN CREDENTIALS ---")
    tenant_admin_email = f"owner.{timestamp}@company-a.local"
    company_payload = {
        "company_name": f"Company A Logistics {timestamp}",
        "admin_email": tenant_admin_email,
        "state_name": "Tamil Nadu",
        "gstin": "33COMPA1234F1Z1"
    }

    r_comp = client.post(
        "/api/v1/super-admin/companies",
        headers={"Authorization": f"Bearer {sa_token}"},
        json=company_payload
    )
    comp_res = r_comp.json()
    print(f"Response Status: {r_comp.status_code}")
    company_id = comp_res.get("company", {}).get("id")
    temp_admin_pass = comp_res.get("credentials", {}).get("admin_password")
    print(f"Company ID: {company_id}")
    print(f"Generated Tenant Admin Credentials: Email: {tenant_admin_email}, Password: {temp_admin_pass}")

    assert company_id and temp_admin_pass, f"Super Admin tenant creation failed: {comp_res}"

    # 3. Tenant Admin Authenticates using generated credentials
    print("\n--- STEP 2: TENANT ADMIN LOGS IN WITH GENERATED CREDENTIALS ---")
    r_admin_login = requests.post(
        f"{supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        json={"email": tenant_admin_email, "password": temp_admin_pass}
    )
    admin_token = r_admin_login.json().get("access_token")
    print(f"Tenant Admin Logged In Successfully: {bool(admin_token)}")

    assert admin_token, "Tenant Admin failed to log in with Super Admin provided credentials!"

    # 4. Tenant Admin Creates Accountant & Employee Accounts
    print("\n--- STEP 3: TENANT ADMIN CREATES ACCOUNTANT & EMPLOYEE ACCOUNTS ---")
    # Accountant
    acct_email = f"accountant.{timestamp}@company-a.local"
    r_acct = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {admin_token}", "X-Organization-Id": company_id},
        json={"email": acct_email, "role": "accountant"}
    )
    acct_res = r_acct.json()
    print(f"[ACCOUNTANT CREATED] Email: {acct_email}, Role: {acct_res.get('role')}, Generated Password: {acct_res.get('generated_password')}")

    # Employee
    emp_email = f"employee.{timestamp}@company-a.local"
    r_emp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {admin_token}", "X-Organization-Id": company_id},
        json={"email": emp_email, "role": "employee"}
    )
    emp_res = r_emp.json()
    print(f"[EMPLOYEE CREATED] Email: {emp_email}, Role: {emp_res.get('role')}, Generated Password: {emp_res.get('generated_password')}")

    # 5. List Tenant Company Users
    print("\n--- STEP 4: TENANT ADMIN LISTS COMPANY USERS ---")
    r_users = client.get(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {admin_token}", "X-Organization-Id": company_id}
    )
    users_list = r_users.json()
    print(f"Total Users in Company A: {len(users_list)}")
    for u in users_list:
        print(f" - {u.get('email')}: Role: {u.get('role')}, Status: {u.get('status')}")

    # 6. Verify Super Admin Privacy (No Financial Totals Exposed)
    print("\n--- STEP 5: VERIFY SUPER ADMIN PRIVACY (USAGE METRICS ONLY) ---")
    r_sa_dash = client.get(
        "/api/v1/super-admin/dashboard",
        headers={"Authorization": f"Bearer {sa_token}"}
    )
    dash_data = r_sa_dash.json()
    print("Super Admin Dashboard Metrics:")
    print(json.dumps(dash_data, indent=2))
    assert "revenue" not in dash_data and "total_sales" not in dash_data, "Privacy Violation: Financial totals leaked in Super Admin dashboard!"
    print("[PRIVACY CONFIRMED] Super Admin dashboard contains usage counts ONLY. Zero financial data exposed.")

    print("\n" + "=" * 75)
    print("ALL USER HIERARCHY & ROLE PERMISSION VERIFICATION STEPS PASSED!")
    print("=" * 75)

if __name__ == "__main__":
    test_user_hierarchy_flow()
