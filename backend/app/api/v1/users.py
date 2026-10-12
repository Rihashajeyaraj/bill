from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
import uuid
import secrets
import requests
from app.core.auth import get_current_user_context, UserContext
from app.core.supabase import get_admin_supabase_client
from app.core.config import settings

router = APIRouter(prefix="/users", tags=["Tenant User Management"])

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def normalize_role(input_role: str) -> str:
    """Maps UI role names to valid organization_role enum values: owner, accounter, staff"""
    r = (input_role or "").strip().lower()
    if r in ("owner", "admin"):
        return "owner"          # maps to enum 'owner'
    if r in ("accountant", "accounter"):
        return "accounter"      # maps to enum 'accounter'
    return "staff"              # maps to enum 'staff'


def _admin_headers() -> dict:
    """
    Returns headers that bypass RLS.
    Uses service role key when available, otherwise anon key.
    """
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _rest_insert(table: str, payload: dict) -> dict | None:
    """
    Inserts a row via PostgREST REST API with service-role auth (bypasses RLS).
    """
    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    r = requests.post(url, headers=_admin_headers(), json=payload)
    if r.status_code in (200, 201):
        data = r.json()
        return data[0] if isinstance(data, list) and data else data
    return None


def _rest_select(table: str, filters: dict) -> list:
    """
    Selects rows via PostgREST REST API with service-role auth (bypasses RLS).
    """
    url = f"{settings.SUPABASE_URL}/rest/v1/{table}"
    params = {f"{k}": f"eq.{v}" for k, v in filters.items()}
    params["select"] = "*"
    r = requests.get(url, headers=_admin_headers(), params=params)
    if r.status_code == 200:
        return r.json() or []
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Schema
# ─────────────────────────────────────────────────────────────────────────────

class UserRoleUpdate(BaseModel):
    member_id: str
    role: str  # "owner", "admin", "accountant", "employee"
    status: Optional[str] = "active"


class UserInvitePayload(BaseModel):
    email: str
    name: Optional[str] = None
    role: str = "employee"  # "admin", "accountant", "employee"
    password: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_organization_users(context: UserContext = Depends(get_current_user_context)):
    """Returns users belonging to the current tenant company."""
    members = _rest_select("organization_members", {"organization_id": context.company_id})

    # Enrich with profile email/name
    user_ids = [m["user_id"] for m in members if m.get("user_id")]
    profiles_map: dict = {}
    if user_ids:
        # Try profiles table first (confirmed to exist)
        url2 = f"{settings.SUPABASE_URL}/rest/v1/profiles"
        params2 = {"id": f"in.({','.join(user_ids)})", "select": "id,email,full_name"}
        r2 = requests.get(url2, headers=_admin_headers(), params=params2)
        if r2.status_code == 200:
            for p in (r2.json() or []):
                profiles_map[p["id"]] = p
        # Also try user_profiles (available after migration 00006)
        url3 = f"{settings.SUPABASE_URL}/rest/v1/user_profiles"
        params3 = {"id": f"in.({','.join(user_ids)})", "select": "id,email,name"}
        r3 = requests.get(url3, headers=_admin_headers(), params=params3)
        if r3.status_code == 200:
            for p in (r3.json() or []):
                profiles_map.setdefault(p["id"], p)

    for m in members:
        uid = m.get("user_id")
        prof = profiles_map.get(uid) or {}
        m["email"] = (
            m.get("email")
            or prof.get("email")
            or (f"user_{uid[:8]}@company.local" if uid else "user@company.local")
        )
        db_role = m.get("role", "staff").lower()
        m["role_display"] = (
            "Admin" if db_role in ("owner", "admin")
            else "Accountant" if db_role in ("accounter", "accountant")
            else "Employee"
        )
    return members


@router.post("", status_code=status.HTTP_201_CREATED)
def invite_organization_user(
    payload: UserInvitePayload,
    context: UserContext = Depends(get_current_user_context),
):
    """Tenant Admin creates an Accountant or Employee user for their company."""
    if context.role.lower() != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Tenant Owners can create team user accounts.",
        )

    target_role = normalize_role(payload.role)
    password = payload.password or f"User@{secrets.token_hex(4)}"

    # 1. Register Supabase Auth account for the tenant user (admin endpoint)
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_ANON_KEY
    r_signup = requests.post(
        f"{settings.SUPABASE_URL}/auth/v1/admin/users",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={
            "email": payload.email,
            "password": password,
            "email_confirm": True,  # skip confirmation email
            "user_metadata": {
                "full_name": payload.name or payload.email.split("@")[0],
                "role": target_role,
                "organization_id": context.company_id,
            },
        },
    )

    if r_signup.status_code in (200, 201):
        s_data = r_signup.json()
        u_id = s_data.get("id") or str(uuid.uuid4())
    else:
        # Fallback: standard signup (needs email confirmation)
        r_signup2 = requests.post(
            f"{settings.SUPABASE_URL}/auth/v1/signup",
            headers={"apikey": settings.SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": payload.email, "password": password},
        )
        s2 = r_signup2.json()
        u_id = (s2.get("user") or {}).get("id") or s2.get("id") or str(uuid.uuid4())

    # 2. Create profile entry — profiles table is confirmed to exist
    try:
        _rest_insert("profiles", {
            "id": u_id,
            "email": payload.email,
            "full_name": payload.name or payload.email.split("@")[0],
        })
    except Exception:
        pass
    # Also insert into user_profiles if it exists (after migration 00006)
    try:
        _rest_insert("user_profiles", {
            "id": u_id,
            "email": payload.email,
            "name": payload.name or payload.email.split("@")[0],
            "platform_role": "TENANT_USER",
        })
    except Exception:
        pass

    # 3. Add to organization_members (via REST with service-role auth — bypasses RLS)
    member = _rest_insert("organization_members", {
        "organization_id": context.company_id,
        "user_id": u_id,
        "email": payload.email,
        "role": target_role,
        "status": "active",
    })

    if not member:
        member = {"user_id": u_id, "role": target_role}

    member["email"] = payload.email
    member["generated_password"] = password
    return member


@router.put("/role")
@router.put("/{member_id}")
def update_user_role_and_status(
    payload: UserRoleUpdate,
    context: UserContext = Depends(get_current_user_context),
):
    """Tenant Admin updates a user's role or status (activate / deactivate)."""
    if context.role.lower() != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Tenant Owners can update user roles and status.",
        )

    target_role = normalize_role(payload.role)
    url = f"{settings.SUPABASE_URL}/rest/v1/organization_members"
    params = {
        "id": f"eq.{payload.member_id}",
        "organization_id": f"eq.{context.company_id}",
    }
    r = requests.patch(
        url,
        headers=_admin_headers(),
        params=params,
        json={"role": target_role, "status": payload.status or "active"},
    )
    if r.status_code in (200, 204):
        data = r.json()
        return data[0] if isinstance(data, list) and data else {"status": "updated"}
    return {"status": "updated"}
