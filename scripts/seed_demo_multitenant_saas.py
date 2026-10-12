import requests
import json
import time
import uuid

def seed_demo_multitenant():
    print("==================================================")
    print("STARTING DEMO MULTI-TENANT SAAS DATA SEEDING")
    print("==================================================")

    from app.core.config import settings
    SUPABASE_URL = settings.SUPABASE_URL
    SUPABASE_ANON_KEY = settings.SUPABASE_ANON_KEY

    def ensure_demo_user(u_email, u_pass="Demo@12345", meta=None):
        if settings.SUPABASE_SERVICE_ROLE_KEY:
            try:
                r_adm = requests.post(
                    f"{SUPABASE_URL}/auth/v1/admin/users",
                    headers={
                        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={"email": u_email, "password": u_pass, "email_confirm": True, "user_metadata": meta or {}}
                )
                if r_adm.status_code in (200, 201):
                    return r_adm.json().get("id")
            except Exception:
                pass

        payload = {"email": u_email, "password": u_pass}
        if meta:
            payload["data"] = meta
        r_sub = requests.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json=payload
        )
        s_data_sub = r_sub.json()
        u_id = s_data_sub.get("user", {}).get("id") or s_data_sub.get("id")
        if not u_id:
            r_login = requests.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": u_email, "password": u_pass}
            )
            l_data = r_login.json()
            u_id = (l_data.get("user") or {}).get("id")
        return u_id

    # 1. Ensure seed user and get real auth user_id
    email = "saas.seed.user@demo.twitebilling.local"
    password = "DemoPassword123!"
    user_id = ensure_demo_user(email, password)
    print(f"Authenticated Seed User ID: {user_id}")

    from app.core.supabase import get_admin_supabase_client
    client = get_admin_supabase_client()

    # 2. Create or get Demo Company A
    res_a = client.table("organizations").select("*").eq("company_name", "Demo Company A").execute()
    if res_a.data and len(res_a.data) > 0:
        org_a = res_a.data[0]
    else:
        res_ins_a = client.table("organizations").insert({
            "owner_user_id": user_id,
            "company_name": "Demo Company A",
            "country_code": "IN",
            "state_name": "Tamil Nadu"
        }).execute()
        org_a = res_ins_a.data[0]
    org_a_id = org_a["id"]
    print(f"Demo Company A ID: {org_a_id}")

    # 3. Create or get Demo Company B
    res_b = client.table("organizations").select("*").eq("company_name", "Demo Company B").execute()
    if res_b.data and len(res_b.data) > 0:
        org_b = res_b.data[0]
    else:
        res_ins_b = client.table("organizations").insert({
            "owner_user_id": user_id,
            "company_name": "Demo Company B",
            "country_code": "IN",
            "state_name": "Maharashtra"
        }).execute()
        org_b = res_ins_b.data[0]
    org_b_id = org_b["id"]
    print(f"Demo Company B ID: {org_b_id}")

    # Helper function to signup/login demo user and return real auth user_id
    def ensure_demo_user(u_email, u_pass="Demo@12345", meta=None):
        payload = {"email": u_email, "password": u_pass}
        if meta:
            payload["data"] = meta
        r_sub = requests.post(
            f"{SUPABASE_URL}/auth/v1/signup",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json=payload
        )
        s_data_sub = r_sub.json()
        u_id = s_data_sub.get("user", {}).get("id") or s_data_sub.get("id")
        if not u_id:
            r_login = requests.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": u_email, "password": u_pass}
            )
            l_data = r_login.json()
            u_id = l_data.get("user", {}).get("id")
        return u_id

    # Super Admin registration
    sa_id = ensure_demo_user("superadmin@demo.twitebilling.local", meta={"platform_role": "SUPER_ADMIN"})
    print(f"Super Admin User ID: {sa_id}")
    if sa_id:
        try:
            client.table("profiles").upsert({
                "id": sa_id,
                "email": "superadmin@demo.twitebilling.local",
                "full_name": "Super Admin"
            }).execute()
            print("Super Admin profile set in profiles table.")
        except Exception as e:
            print("Notice on profiles table:", e)

    # Role mapper to ensure valid DB organization_role enum values
    def map_db_role(r_val):
        r_low = str(r_val or "").lower()
        if r_low in ("owner",):
            return "owner"
        if r_low in ("admin", "accounter", "accountant"):
            return "accounter"
        return "staff"

    # 4. Seed Members for Company A
    users_a = [
        ("owner@company-a.demo", "Owner Company A", "owner"),
        ("admin@company-a.demo", "Admin Company A", "admin"),
        ("accountant@company-a.demo", "Accountant Company A", "accountant"),
        ("employee@company-a.demo", "Employee Company A", "employee"),
    ]
    for memail, mname, mrole in users_a:
        m_id = ensure_demo_user(memail)
        if m_id:
            existing = client.table("organization_members").select("*").eq("organization_id", org_a_id).eq("user_id", m_id).execute()
            if not existing.data:
                client.table("organization_members").insert({
                    "organization_id": org_a_id,
                    "user_id": m_id,
                    "role": map_db_role(mrole),
                    "status": "active"
                }).execute()

    # 5. Seed Members for Company B
    users_b = [
        ("owner@company-b.demo", "Owner Company B", "owner"),
        ("accountant@company-b.demo", "Accountant Company B", "accountant"),
    ]
    for memail, mname, mrole in users_b:
        m_id = ensure_demo_user(memail)
        if m_id:
            existing = client.table("organization_members").select("*").eq("organization_id", org_b_id).eq("user_id", m_id).execute()
            if not existing.data:
                client.table("organization_members").insert({
                    "organization_id": org_b_id,
                    "user_id": m_id,
                    "role": map_db_role(mrole),
                    "status": "active"
                }).execute()

    # 6. Seed Customers for Company A
    cust_a = ["Demo Customer A1", "Demo Customer A2", "Demo Customer A3", "Demo Customer A4", "Demo Customer A5"]
    for cname in cust_a:
        ex = client.table("parties").select("*").eq("organization_id", org_a_id).eq("display_name", cname).execute()
        if not ex.data:
            client.table("parties").insert({
                "organization_id": org_a_id,
                "party_type": "customer",
                "display_name": cname,
                "legal_name": f"{cname} Pvt Ltd",
                "country_code": "IN",
                "state_name": "Tamil Nadu",
                "gstin": "33AAAAA0000A1Z5"
            }).execute()

    # 7. Seed Customers for Company B
    cust_b = ["Demo Customer B1", "Demo Customer B2", "Demo Customer B3"]
    for cname in cust_b:
        ex = client.table("parties").select("*").eq("organization_id", org_b_id).eq("display_name", cname).execute()
        if not ex.data:
            client.table("parties").insert({
                "organization_id": org_b_id,
                "party_type": "customer",
                "display_name": cname,
                "legal_name": f"{cname} Corp",
                "country_code": "IN",
                "state_name": "Maharashtra",
                "gstin": "27BBBBB0000B1Z5"
            }).execute()

    # 8. Seed Items for Company A
    items_a = [
        ("Demo Product A1 - Consulting", 1000.0, "9983"),
        ("Demo Product A2 - Software License", 5000.0, "9984"),
        ("Demo Product A3 - Support Package", 2000.0, "9985"),
        ("Demo Product A4 - Hardware Item", 15000.0, "8471"),
        ("Demo Product A5 - Maintenance", 3000.0, "9987"),
    ]
    for iname, price, hsn in items_a:
        ex = client.table("items").select("*").eq("organization_id", org_a_id).eq("item_name", iname).execute()
        if not ex.data:
            client.table("items").insert({
                "organization_id": org_a_id,
                "item_type": "product",
                "item_name": iname,
                "hsn_sac": hsn,
                "sale_price": price,
                "tax_rate": 18.0
            }).execute()

    # 9. Seed Items for Company B
    items_b = [
        ("Demo Product B1 - Industrial Part", 12000.0, "8481"),
        ("Demo Product B2 - Chemical Solvent", 4500.0, "2801"),
        ("Demo Product B3 - Logistics Service", 8000.0, "9965"),
    ]
    for iname, price, hsn in items_b:
        ex = client.table("items").select("*").eq("organization_id", org_b_id).eq("item_name", iname).execute()
        if not ex.data:
            client.table("items").insert({
                "organization_id": org_b_id,
                "item_type": "product",
                "item_name": iname,
                "hsn_sac": hsn,
                "sale_price": price,
                "tax_rate": 18.0
            }).execute()

    # 10. Seed Pro Formas for Company A
    for i in range(1, 4):
        pno = f"PI-COMP-A-{i:03d}"
        ex = client.table("proforma_invoices").select("*").eq("organization_id", org_a_id).eq("proforma_no", pno).execute()
        if not ex.data:
            client.table("proforma_invoices").insert({
                "organization_id": org_a_id,
                "proforma_no": pno,
                "proforma_date": "2026-10-08",
                "valid_till": "2026-10-30",
                "due_date": "2026-10-25",
                "status": "DRAFT",
                "grand_total": 11800.0 * i
            }).execute()

    # 11. Seed Pro Formas for Company B
    for i in range(1, 3):
        pno = f"PI-COMP-B-{i:03d}"
        ex = client.table("proforma_invoices").select("*").eq("organization_id", org_b_id).eq("proforma_no", pno).execute()
        if not ex.data:
            client.table("proforma_invoices").insert({
                "organization_id": org_b_id,
                "proforma_no": pno,
                "proforma_date": "2026-10-08",
                "valid_till": "2026-10-30",
                "due_date": "2026-10-25",
                "status": "DRAFT",
                "grand_total": 23600.0 * i
            }).execute()

    # 12. Seed Tax Invoices for Company A
    for i in range(1, 4):
        ino = f"INV-COMP-A-{i:03d}"
        ex = client.table("invoices").select("*").eq("organization_id", org_a_id).eq("invoice_no", ino).execute()
        if not ex.data:
            client.table("invoices").insert({
                "organization_id": org_a_id,
                "invoice_no": ino,
                "invoice_date": "2026-10-08",
                "due_date": "2026-10-25",
                "status": "issued" if i < 3 else "paid",
                "subtotal": 10000.0 * i,
                "tax_total": 1800.0 * i,
                "grand_total": 11800.0 * i
            }).execute()

    # 13. Seed Tax Invoices for Company B
    for i in range(1, 3):
        ino = f"INV-COMP-B-{i:03d}"
        ex = client.table("invoices").select("*").eq("organization_id", org_b_id).eq("invoice_no", ino).execute()
        if not ex.data:
            client.table("invoices").insert({
                "organization_id": org_b_id,
                "invoice_no": ino,
                "invoice_date": "2026-10-08",
                "due_date": "2026-10-25",
                "status": "issued",
                "subtotal": 20000.0 * i,
                "tax_total": 3600.0 * i,
                "grand_total": 23600.0 * i
            }).execute()

    print("==================================================")
    print("DEMO DATA SEEDING COMPLETED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    seed_demo_multitenant()
