import requests
import json
import uuid
import sys

def verify_company_persistence():
    print("==================================================")
    print("STARTING COMPANY CREATION PERSISTENCE VERIFICATION")
    print("==================================================")

    from app.core.config import settings
    from supabase import create_client

    SUPABASE_URL = settings.SUPABASE_URL
    SUPABASE_ANON_KEY = settings.SUPABASE_ANON_KEY

    # 1. Register a test user to obtain a valid JWT token
    user_email = f"test_owner_{uuid.uuid4().hex[:6]}@example.com"
    user_password = "TestPassword123!"

    print(f"Registering Test User: {user_email}")
    r_signup = requests.post(
        f"{SUPABASE_URL}/auth/v1/signup",
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": user_email, "password": user_password}
    )
    signup_data = r_signup.json()
    auth_token = signup_data.get("access_token")
    user_id = signup_data.get("user", {}).get("id") or signup_data.get("id")
    print(f"User ID: {user_id}")
    print(f"Auth Token Present: {bool(auth_token)}")
    assert auth_token, "Must obtain auth token!"

    # Create client authenticated with JWT token
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(auth_token)

    # 2. Create Test Company 001
    comp1_id = str(uuid.uuid4())
    comp1_name = "Test Company 001"
    print(f"\nCreating Company 1: {comp1_name} (ID: {comp1_id})...")
    res1 = client.table("organizations").insert({
        "id": comp1_id,
        "owner_user_id": user_id,
        "company_name": comp1_name,
        "country_code": "IN",
        "state_name": "Tamil Nadu",
        "city": "Chennai",
        "address_line1": "123 Business Way",
        "phone": "+919876543210",
        "email": user_email,
        "base_currency": "INR",
        "is_setup_completed": True
    }).execute()
    print("INSERT 1 Response Data:", res1.data)
    assert res1.data and len(res1.data) == 1, "INSERT 1 must return inserted row!"

    # Immediate SELECT verification from PostgreSQL
    v1 = client.table("organizations").select("id, company_name, created_at").eq("id", comp1_id).execute()
    print("VERIFY SELECT 1:", v1.data)
    assert v1.data and len(v1.data) == 1, "SELECT verification for Company 1 failed!"
    print("[OK] COMPANY 1 PERSISTENCE CONFIRMED IN SUPABASE POSTGRESQL!")

    # 3. Create Test Company 002
    comp2_id = str(uuid.uuid4())
    comp2_name = "Test Company 002"
    print(f"\nCreating Company 2: {comp2_name} (ID: {comp2_id})...")
    res2 = client.table("organizations").insert({
        "id": comp2_id,
        "owner_user_id": user_id,
        "company_name": comp2_name,
        "country_code": "IN",
        "state_name": "Maharashtra",
        "city": "Mumbai",
        "address_line1": "456 Enterprise Road",
        "phone": "+919876543211",
        "email": user_email,
        "base_currency": "INR",
        "is_setup_completed": True
    }).execute()
    print("INSERT 2 Response Data:", res2.data)
    assert res2.data and len(res2.data) == 1, "INSERT 2 must return inserted row!"

    # Immediate SELECT verification for Company 2
    v2 = client.table("organizations").select("id, company_name, created_at").eq("id", comp2_id).execute()
    print("VERIFY SELECT 2:", v2.data)
    assert v2.data and len(v2.data) == 1, "SELECT verification for Company 2 failed!"
    print("[OK] COMPANY 2 PERSISTENCE CONFIRMED IN SUPABASE POSTGRESQL!")

    # 4. Verify Total Companies for this user
    all_user_comps = client.table("organizations").select("id, company_name").eq("owner_user_id", user_id).execute()
    print(f"\nTotal Companies confirmed for user in PostgreSQL: {len(all_user_comps.data)}")
    assert len(all_user_comps.data) >= 2, "Expected at least 2 records in organizations table!"

    print("\n==================================================")
    print("ALL COMPANY CREATION PERSISTENCE TESTS PASSED 100%!")
    print("==================================================")

if __name__ == "__main__":
    verify_company_persistence()
