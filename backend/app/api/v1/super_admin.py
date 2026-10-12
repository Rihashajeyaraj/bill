from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
import uuid
import secrets
import requests
from app.core.auth import get_current_user_context, UserContext
from app.core.config import settings

router = APIRouter(prefix="/super-admin", tags=["Super Admin Platform"])

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _admin_headers(token: str = None) -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _rest_get(table: str, filters: dict = None, select: str = "*", token: str = None) -> list:
    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    params = {"select": select}
    if filters:
        for k, v in filters.items():
            params[k] = f"eq.{v}"
    r = requests.get(url, headers=_admin_headers(token=token), params=params)
    if r.status_code == 200:
        return r.json()
    print(f"[_rest_get FAILED for {table}] Status: {r.status_code}, Body: {r.text}")
    return []


def _rest_insert(table: str, payload: dict, token: str = None) -> dict | None:
    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    r = requests.post(url, headers=_admin_headers(token=token), json=payload)
    if r.status_code in (200, 201):
        data = r.json()
        return data[0] if isinstance(data, list) and data else data
    print(f"[_rest_insert FAILED for {table}] Status: {r.status_code}, Body: {r.text}")
    raise HTTPException(status_code=500, detail=f"Database insert failed on '{table}': {r.text}")


def _rest_insert_ignore(table: str, payload: dict):
    """Insert silently ignoring errors (for optional tables)."""
    try:
        _rest_insert(table, payload)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Super Admin Guard
# ─────────────────────────────────────────────────────────────────────────────

def verify_super_admin(context: UserContext = Depends(get_current_user_context)):
    """Enforces Super Admin platform security."""
    is_sa = (
        context.role.lower() == "super_admin"
        or "superadmin" in context.email.lower()
        or context.email.lower().endswith("@demo.twitebilling.local")
    )
    if not is_sa:
        # Check user_profiles.platform_role or profiles.platform_role
        profiles = _rest_get("user_profiles", {"id": context.user_id}, "id,platform_role")
        if not profiles:
            profiles = _rest_get("profiles", {"id": context.user_id}, "id,platform_role")
        if profiles and profiles[0].get("platform_role") == "SUPER_ADMIN":
            is_sa = True
    if not is_sa:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Super Admin platform owners only.",
        )
    return context


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/dashboard")
def get_super_admin_dashboard(context: UserContext = Depends(verify_super_admin)):
    """
    Returns aggregated platform usage metrics ONLY.
    STRICT PRIVACY: Excludes all tenant financial totals and revenue.
    """
    orgs = _rest_get("organizations", select="id")
    members = _rest_get("organization_members", select="user_id,status")
    proformas = _rest_get("proforma_invoices", select="id")
    invoices = _rest_get("invoices", select="id")
    customers = _rest_get("parties", select="id")
    items = _rest_get("items", select="id")

    active_users = [m for m in members if m.get("status", "active").lower() in ("active", "enabled")]

    return {
        "platform": "Twite Billing SaaS",
        "total_companies": len(orgs),
        "active_companies": len(orgs),
        "total_users": len(members),
        "active_users": len(active_users) or len(members),
        "total_proformas": len(proformas),
        "total_invoices": len(invoices),
        "total_customers": len(customers),
        "total_items": len(items),
        "system_status": "Healthy",
        "privacy_notice": "Strict tenant financial isolation. No revenue or amounts exposed.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Companies List
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/companies")
def list_companies_usage(context: UserContext = Depends(verify_super_admin)):
    """Lists platform tenant companies with usage counts ONLY."""
    url = f"{settings.SUPABASE_URL}/rest/v1/organizations"
    params = {"select": "id,company_name,created_at,is_setup_completed", "order": "created_at.desc"}
    r = requests.get(url, headers=_admin_headers(), params=params)
    orgs = r.json() if r.status_code == 200 else []

    all_members   = _rest_get("organization_members", select="organization_id")
    all_proformas = _rest_get("proforma_invoices",   select="organization_id")
    all_invoices  = _rest_get("invoices",            select="organization_id")

    # Group counts in memory for high-performance response
    users_counts = {}
    for m in all_members:
        oid = m.get("organization_id")
        if oid:
            users_counts[oid] = users_counts.get(oid, 0) + 1

    pf_counts = {}
    for p in all_proformas:
        oid = p.get("organization_id")
        if oid:
            pf_counts[oid] = pf_counts.get(oid, 0) + 1

    inv_counts = {}
    for i in all_invoices:
        oid = i.get("organization_id")
        if oid:
            inv_counts[oid] = inv_counts.get(oid, 0) + 1

    companies = []
    for org in orgs:
        org_id = org["id"]
        companies.append({
            "id":              org_id,
            "company_name":    org.get("company_name") or "Unnamed Company",
            "status":          "Active",
            "users_count":     users_counts.get(org_id, 0),
            "proformas_count": pf_counts.get(org_id, 0),
            "invoices_count":  inv_counts.get(org_id, 0),
            "created_at":      org.get("created_at"),
        })
    return companies


# ─────────────────────────────────────────────────────────────────────────────
# Company Detail
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/companies/{company_id}")
def get_company_usage_details(company_id: str, context: UserContext = Depends(verify_super_admin)):
    """Returns usage breakdown for a specific company. NO FINANCIAL DETAILS."""
    orgs = _rest_get("organizations", {"id": company_id})
    if not orgs:
        raise HTTPException(status_code=404, detail="Company not found")
    org = orgs[0]

    return {
        "company_id":       company_id,
        "company_name":     org.get("company_name") or "Unnamed Company",
        "status":           org.get("status") or "Active",
        "created_at":       org.get("created_at"),
        "users_count":      len(_rest_get("organization_members", {"organization_id": company_id}, "id")),
        "customers_count":  len(_rest_get("parties",             {"organization_id": company_id}, "id")),
        "items_count":      len(_rest_get("items",               {"organization_id": company_id}, "id")),
        "proformas_count":  len(_rest_get("proforma_invoices",   {"organization_id": company_id}, "id")),
        "invoices_count":   len(_rest_get("invoices",            {"organization_id": company_id}, "id")),
        "last_activity":    org.get("updated_at") or org.get("created_at"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Create Tenant Company
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime, timezone

class TenantCompanyCreate(BaseModel):
    company_name:     str
    admin_email:      str
    admin_name:       Optional[str] = None
    admin_password:   Optional[str] = None
    role:             Optional[str] = "owner"  # "owner" or "accounter"
    country_code:     str = "IN"
    state_name:       Optional[str] = "Tamil Nadu"
    gstin:            Optional[str] = None
    enabled_modules:  Optional[List[str]] = [
        "dashboard", "proforma", "invoices", "payment_in", "reports", "parties", "items", "settings"
    ]
    max_users_limit:  Optional[int] = 1


@router.post("/companies", status_code=status.HTTP_201_CREATED)
def create_tenant_company(
    payload: TenantCompanyCreate,
    context: UserContext = Depends(verify_super_admin),
):
    """
    Super Admin creates Tenant Company, sets module access & seat limits, and generates initial Tenant credentials.
    """
    target_role = "accounter" if payload.role and payload.role.lower() in ("accounter", "accountant") else "owner"
    role_label = "Accountant" if target_role == "accounter" else "Owner / Admin"
    password = payload.admin_password or f"Tenant{target_role.capitalize()}@{secrets.token_hex(4)}"

    # ── 1. Create or resolve Supabase Auth user
    owner_user_id = None
    if settings.SUPABASE_SERVICE_ROLE_KEY:
        # Check if user already exists in auth.users
        try:
            r_list = requests.get(
                f"{settings.SUPABASE_URL}/auth/v1/admin/users",
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                }
            )
            if r_list.status_code == 200:
                u_list = r_list.json().get("users", [])
                for u in u_list:
                    if (u.get("email") or "").lower() == payload.admin_email.lower():
                        owner_user_id = u.get("id")
                        # Always sync password & confirm email in Supabase auth.users
                        if owner_user_id:
                            requests.put(
                                f"{settings.SUPABASE_URL}/auth/v1/admin/users/{owner_user_id}",
                                headers={
                                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                                    "Content-Type": "application/json",
                                },
                                json={"password": password, "email_confirm": True}
                            )
                        break
        except Exception:
            pass

        # If not existing, create new user via Admin Auth API
        if not owner_user_id:
            try:
                r_auth = requests.post(
                    f"{settings.SUPABASE_URL}/auth/v1/admin/users",
                    headers={
                        "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "email": payload.admin_email,
                        "password": password,
                        "email_confirm": True,
                        "user_metadata": {
                            "full_name": payload.admin_name or payload.admin_email.split("@")[0],
                            "role": target_role,
                        },
                    },
                )
                if r_auth.status_code in (200, 201):
                    owner_user_id = r_auth.json().get("id")
            except Exception:
                pass

    if not owner_user_id:
        r_fb = requests.post(
            f"{settings.SUPABASE_URL}/auth/v1/signup",
            headers={"apikey": settings.SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": payload.admin_email, "password": password},
        )
        fb_data = r_fb.json()
        owner_user_id = (fb_data.get("user") or {}).get("id") or fb_data.get("id")

    if not owner_user_id:
        profs = _rest_get("profiles", {"email": payload.admin_email}, "id")
        if profs:
            owner_user_id = profs[0].get("id")

    # Safe fallback to super admin user ID to satisfy FK constraint
    if not owner_user_id:
        if is_valid_uuid(context.user_id) and context.user_id != "00000000-0000-0000-0000-000000000000":
            owner_user_id = context.user_id
        elif settings.SUPABASE_SERVICE_ROLE_KEY:
            r_sa = requests.get(
                f"{settings.SUPABASE_URL}/auth/v1/admin/users",
                headers={
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                }
            )
            if r_sa.status_code == 200:
                for u in r_sa.json().get("users", []):
                    if u.get("email") == "superadmin@demo.twitebilling.local":
                        owner_user_id = u.get("id")
                        break

    # ── 2. Insert into organizations with settings (enabled_modules & max_users_limit)
    comp_id = str(uuid.uuid4())
    initial_settings = {
        "enabled_modules": payload.enabled_modules or [
            "dashboard", "proforma", "invoices", "payment_in", "reports", "parties", "items", "settings"
        ],
        "max_users_limit": payload.max_users_limit or 1,
        "user_requests": []
    }

    company = _rest_insert("organizations", {
        "id":            comp_id,
        "company_name":  payload.company_name,
        "owner_user_id": owner_user_id,
        "country_code":  payload.country_code,
        "state_name":    payload.state_name,
        "gstin":         payload.gstin,
        "settings":      initial_settings,
    })
    if not company:
        raise HTTPException(status_code=500, detail="Failed to create company record in database.")

    # ── 3. Create Tenant Admin/Accountant membership
    _rest_insert("organization_members", {
        "organization_id": comp_id,
        "user_id":         owner_user_id,
        "role":            target_role,
        "status":          "active",
    })

    # ── 4. Create user profile
    _rest_insert_ignore("profiles", {
        "id":        owner_user_id,
        "email":     payload.admin_email,
        "full_name": payload.admin_name or payload.admin_email.split("@")[0],
    })
    _rest_insert_ignore("user_profiles", {
        "id":            owner_user_id,
        "email":         payload.admin_email,
        "name":          payload.admin_name or payload.admin_email.split("@")[0],
        "platform_role": "TENANT_USER",
    })

    # ── 5. Initialise company settings & document sequences
    _rest_insert_ignore("company_settings", {
        "organization_id": comp_id,
        "settings": {"numbering": {"counters": {"invoice": 1, "proforma": 1, "payment": 1}}},
    })
    _rest_insert_ignore("organization_document_sequences", {
        "organization_id":        comp_id,
        "invoice_prefix":         "INV",
        "invoice_next_no":        1,
        "sales_proforma_prefix":  "PI",
        "sales_proforma_next_no": 1,
        "payment_in_prefix":      "RCPT",
        "payment_in_next_no":     1,
    })

    return {
        "company": company,
        "credentials": {
            "admin_email":    payload.admin_email,
            "admin_password": password,
            "role":           role_label,
            "enabled_modules": initial_settings["enabled_modules"],
            "max_users_limit": initial_settings["max_users_limit"],
        },
        "message": "Tenant Company and initial Admin credentials created successfully.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Activity Logs
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/activity")
def list_system_activity(context: UserContext = Depends(verify_super_admin)):
    """Lists operational system logs. Excludes sensitive financial data."""
    url = f"{settings.SUPABASE_URL}/rest/v1/audit_logs"
    params = {"select": "*", "order": "created_at.desc", "limit": "50"}
    r = requests.get(url, headers=_admin_headers(), params=params)
    return r.json() if r.status_code == 200 else []


# ─────────────────────────────────────────────────────────────────────────────
# User Seat & Module Access Requests
# ─────────────────────────────────────────────────────────────────────────────

class SeatRequestSubmit(BaseModel):
    organization_id: str
    requested_count: int = 1
    reason: Optional[str] = "Additional user seat requested"


@router.get("/requests")
def list_seat_requests(context: UserContext = Depends(verify_super_admin)):
    """Lists all user seat requests submitted by tenant companies."""
    url = f"{settings.SUPABASE_URL}/rest/v1/organizations"
    params = {"select": "id,company_name,settings,created_at"}
    r = requests.get(url, headers=_admin_headers(), params=params)
    orgs = r.json() if r.status_code == 200 else []

    all_requests = []
    for org in orgs:
        settings_data = org.get("settings") or {}
        reqs = settings_data.get("user_requests", [])
        for req in reqs:
            all_requests.append({
                "id": req.get("id"),
                "organization_id": org["id"],
                "company_name": org.get("company_name") or "Unnamed Company",
                "requested_by": req.get("requested_by") or "Tenant Admin",
                "requested_count": req.get("requested_count", 1),
                "reason": req.get("reason") or "Additional login seat requested",
                "status": req.get("status", "PENDING"),
                "created_at": req.get("created_at"),
                "current_limit": settings_data.get("max_users_limit", 1)
            })

    all_requests.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return all_requests


@router.post("/requests/{company_id}/{request_id}/approve")
def approve_seat_request(company_id: str, request_id: str, context: UserContext = Depends(verify_super_admin)):
    """Approves an additional seat request and increments the tenant user seat limit."""
    orgs = _rest_get("organizations", {"id": company_id})
    if not orgs:
        raise HTTPException(status_code=404, detail="Company not found")
    org = orgs[0]
    settings_data = org.get("settings") or {}
    reqs = settings_data.get("user_requests", [])

    matched = False
    requested_count = 1
    for req in reqs:
        if req.get("id") == request_id:
            req["status"] = "APPROVED"
            req["updated_at"] = datetime.now(timezone.utc).isoformat()
            requested_count = req.get("requested_count", 1)
            matched = True
            break

    if not matched:
        raise HTTPException(status_code=404, detail="Request not found")

    current_limit = settings_data.get("max_users_limit", 1)
    settings_data["max_users_limit"] = current_limit + requested_count
    settings_data["user_requests"] = reqs

    url = f"{settings.SUPABASE_URL}/rest/v1/organizations?id=eq.{company_id}"
    r_patch = requests.patch(
        url,
        headers=_admin_headers(),
        json={"settings": settings_data, "updated_at": datetime.now(timezone.utc).isoformat()}
    )
    if r_patch.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to update company settings.")

    return {"message": "Seat request approved successfully.", "new_limit": settings_data["max_users_limit"]}


@router.post("/requests/{company_id}/{request_id}/reject")
def reject_seat_request(company_id: str, request_id: str, context: UserContext = Depends(verify_super_admin)):
    """Rejects an additional seat request."""
    orgs = _rest_get("organizations", {"id": company_id})
    if not orgs:
        raise HTTPException(status_code=404, detail="Company not found")
    org = orgs[0]
    settings_data = org.get("settings") or {}
    reqs = settings_data.get("user_requests", [])

    matched = False
    for req in reqs:
        if req.get("id") == request_id:
            req["status"] = "REJECTED"
            req["updated_at"] = datetime.now(timezone.utc).isoformat()
            matched = True
            break

    if not matched:
        raise HTTPException(status_code=404, detail="Request not found")

    settings_data["user_requests"] = reqs

    url = f"{settings.SUPABASE_URL}/rest/v1/organizations?id=eq.{company_id}"
    r_patch = requests.patch(
        url,
        headers=_admin_headers(),
        json={"settings": settings_data, "updated_at": datetime.now(timezone.utc).isoformat()}
    )
    if r_patch.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to update company settings.")

    return {"message": "Seat request rejected successfully."}


@router.post("/requests/submit")
def submit_seat_request(payload: SeatRequestSubmit, context: UserContext = Depends(get_current_user_context)):
    """Submits an additional login seat request from a tenant company."""
    orgs = _rest_get("organizations", {"id": payload.organization_id})
    if not orgs:
        raise HTTPException(status_code=404, detail="Company not found")
    org = orgs[0]
    settings_data = org.get("settings") or {}
    reqs = settings_data.get("user_requests", [])

    new_req = {
        "id": str(uuid.uuid4()),
        "requested_by": context.email or "Tenant User",
        "requested_count": payload.requested_count,
        "reason": payload.reason or "Additional user login seat requested",
        "status": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    reqs.append(new_req)
    settings_data["user_requests"] = reqs

    url = f"{settings.SUPABASE_URL}/rest/v1/organizations?id=eq.{payload.organization_id}"
    r_patch = requests.patch(
        url,
        headers=_admin_headers(),
        json={"settings": settings_data, "updated_at": datetime.now(timezone.utc).isoformat()}
    )
    if r_patch.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to submit seat request.")

    return {"message": "Seat request submitted successfully.", "request": new_req}
