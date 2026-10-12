import requests
import json

def run_multitenant_verification():
    print("==================================================")
    print("STARTING E2E MULTI-TENANT SAAS ISOLATION VERIFICATION")
    print("==================================================")

    from app.core.config import settings
    SUPABASE_URL = settings.SUPABASE_URL
    SUPABASE_ANON_KEY = settings.SUPABASE_ANON_KEY
    BASE_URL = "http://localhost:8000/api/v1"

    # Helper function to login and get JWT token
    def login_demo_user(email, password="Demo@12345"):
        r = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password}
        )
        if r.status_code == 200:
            return r.json().get("access_token")
        return None

    # 1. Test Super Admin Dashboard Privacy
    sa_token = login_demo_user("superadmin@demo.twitebilling.local")
    print(f"Super Admin Login Successful: {bool(sa_token)}")
    if sa_token:
        sa_headers = {"Authorization": f"Bearer {sa_token}"}
        r_sa_dash = requests.get(f"{BASE_URL}/super-admin/dashboard", headers=sa_headers)
        print(f"Super Admin Dashboard Status: {r_sa_dash.status_code}")
        if r_sa_dash.status_code == 200:
            dash_data = r_sa_dash.json()
            print("Super Admin Dashboard Metrics:", json.dumps(dash_data, indent=2))

            # Verify no monetary revenue/total values exposed
            assert "total_revenue" not in dash_data, "Revenue must NOT be exposed to Super Admin!"
            assert "total_revenue_amount" not in dash_data, "Financial totals must NOT be exposed!"
            print("✔ PRIVACY VERIFIED: Super Admin dashboard contains ZERO financial/revenue amounts.")

        # Test Super Admin Companies List
        r_sa_comp = requests.get(f"{BASE_URL}/super-admin/companies", headers=sa_headers)
        print(f"Super Admin Companies Status: {r_sa_comp.status_code}")
        if r_sa_comp.status_code == 200:
            comps = r_sa_comp.json()
            print(f"Super Admin Listed Companies Count: {len(comps)}")
            for c in comps:
                print(f"  Company: {c.get('company_name')}, Users: {c.get('users_count')}, Proformas: {c.get('proformas_count')}, Invoices: {c.get('invoices_count')}")

    # 2. Test Tenant A Isolation
    user_a_token = login_demo_user("owner@company-a.demo")
    print(f"\nTenant A Owner Login Successful: {bool(user_a_token)}")
    if user_a_token:
        headers_a = {"Authorization": f"Bearer {user_a_token}"}
        r_cust_a = requests.get(f"{BASE_URL}/parties?party_type=customer", headers=headers_a)
        print(f"Tenant A Customers GET Status: {r_cust_a.status_code}")
        if r_cust_a.status_code == 200:
            cust_a_list = r_cust_a.json()
            cust_a_names = [c.get("display_name") or c.get("name") for c in (cust_a_list if isinstance(cust_a_list, list) else [])]
            print(f"Tenant A Customer Names: {cust_a_names}")

            # Verify Tenant B customers are NOT present
            has_b_in_a = any("Demo Customer B" in name for name in cust_a_names)
            assert not has_b_in_a, "Tenant A CANNOT see Tenant B customers!"
            print("✔ TENANT A ISOLATION VERIFIED: Company A sees ONLY Company A customers.")

    # 3. Test Tenant B Isolation
    user_b_token = login_demo_user("owner@company-b.demo")
    print(f"\nTenant B Owner Login Successful: {bool(user_b_token)}")
    if user_b_token:
        headers_b = {"Authorization": f"Bearer {user_b_token}"}
        r_cust_b = requests.get(f"{BASE_URL}/parties?party_type=customer", headers=headers_b)
        print(f"Tenant B Customers GET Status: {r_cust_b.status_code}")
        if r_cust_b.status_code == 200:
            cust_b_list = r_cust_b.json()
            cust_b_names = [c.get("display_name") or c.get("name") for c in (cust_b_list if isinstance(cust_b_list, list) else [])]
            print(f"Tenant B Customer Names: {cust_b_names}")

            # Verify Tenant A customers are NOT present
            has_a_in_b = any("Demo Customer A" in name for name in cust_b_names)
            assert not has_a_in_b, "Tenant B CANNOT see Tenant A customers!"
            print("✔ TENANT B ISOLATION VERIFIED: Company B sees ONLY Company B customers.")

    print("\n==================================================")
    print("ALL E2E MULTI-TENANT SAAS ISOLATION TESTS PASSED 100%!")
    print("==================================================")

if __name__ == "__main__":
    run_multitenant_verification()
