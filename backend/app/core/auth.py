import uuid
import jwt
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
from app.core.config import settings
from app.core.supabase import get_admin_supabase_client, get_supabase_client

security = HTTPBearer(auto_error=False)

def is_valid_uuid(val: Optional[str]) -> bool:
    if not val:
        return False
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, TypeError, AttributeError):
        return False

class UserContext(BaseModel):
    user_id: str
    email: str = ""
    company_id: str
    role: str = "owner"
    token: str

def decode_jwt_token(token: str) -> dict:
    """
    Decodes JWT token with secret if valid, or falls back to unverified decode.
    """
    if settings.SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256", "RS256", "ES256", "HS384", "HS512"],
                options={"verify_aud": False}
            )
        except Exception:
            pass
    try:
        return jwt.decode(
            token,
            options={"verify_signature": False, "verify_aud": False}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

import time
from typing import Optional, Dict, Tuple

AUTH_CACHE_TTL_SECONDS = 60.0
_user_org_cache: Dict[str, Tuple[Dict[str, str], float]] = {}
_dev_org_cache: Dict[str, Tuple[dict, float]] = {}
_dev_default_org_cache: Tuple[Optional[dict], float] = (None, 0.0)

def invalidate_auth_cache(user_id: Optional[str] = None):
    global _dev_default_org_cache
    if user_id:
        _user_org_cache.pop(user_id, None)
    else:
        _user_org_cache.clear()
        _dev_org_cache.clear()
        _dev_default_org_cache = (None, 0.0)

async def get_current_user_context(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_organization_id: Optional[str] = Header(None)
) -> UserContext:
    global _dev_default_org_cache
    now = time.time()
    admin_client = get_admin_supabase_client()
    valid_org_header = x_organization_id if is_valid_uuid(x_organization_id) else None

    if not credentials or not credentials.credentials:
        # Dev mode / testing fallback
        if valid_org_header:
            cached_org, org_ts = _dev_org_cache.get(valid_org_header, ({}, 0.0))
            if cached_org and (now - org_ts) < AUTH_CACHE_TTL_SECONDS:
                real_uid = cached_org.get("owner_user_id") or "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
                return UserContext(
                    user_id=real_uid,
                    email="dev@example.com",
                    company_id=valid_org_header,
                    role="owner",
                    token="dev-token"
                )
            org_check = admin_client.table("organizations").select("id, owner_user_id").eq("id", valid_org_header).limit(1).execute()
            if org_check.data:
                cached_data = org_check.data[0]
                _dev_org_cache[valid_org_header] = (cached_data, now)
                real_uid = cached_data.get("owner_user_id") or "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
                return UserContext(
                    user_id=real_uid,
                    email="dev@example.com",
                    company_id=valid_org_header,
                    role="owner",
                    token="dev-token"
                )

        default_org, def_ts = _dev_default_org_cache
        if default_org and (now - def_ts) < AUTH_CACHE_TTL_SECONDS:
            return UserContext(
                user_id=default_org.get("owner_user_id") or "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f",
                email="dev@example.com",
                company_id=default_org.get("id"),
                role="owner",
                token="dev-token"
            )

        res = admin_client.table("organizations").select("id, owner_user_id").limit(1).execute()
        if res.data and len(res.data) > 0:
            org = res.data[0]
            _dev_default_org_cache = (org, now)
            return UserContext(
                user_id=org.get("owner_user_id") or "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f",
                email="dev@example.com",
                company_id=org.get("id"),
                role="owner",
                token="dev-token"
            )
        return UserContext(
            user_id="127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f",
            email="dev@example.com",
            company_id="00000000-0000-0000-0000-000000000000",
            role="owner",
            token="dev-token"
        )

    token = credentials.credentials
    payload = decode_jwt_token(token)
    user_id = payload.get("sub") or payload.get("id") or "00000000-0000-0000-0000-000000000000"
    email = payload.get("email", "")

    # Check cached organization memberships for this user
    cached_map, map_ts = _user_org_cache.get(user_id, ({}, 0.0))
    if cached_map and (now - map_ts) < AUTH_CACHE_TTL_SECONDS:
        user_org_map = cached_map
    else:
        # Query all active organization memberships and owned orgs for this user
        members_res = admin_client.table("organization_members").select("organization_id, role").eq("user_id", user_id).eq("status", "active").execute()
        owned_res = admin_client.table("organizations").select("id").eq("owner_user_id", user_id).execute()

        user_org_map = {}
        if members_res.data:
            for m in members_res.data:
                user_org_map[m["organization_id"]] = m.get("role") or "accountant"
        if owned_res.data:
            for o in owned_res.data:
                if o["id"] not in user_org_map:
                    user_org_map[o["id"]] = "owner"
        _user_org_cache[user_id] = (user_org_map, now)

    if valid_org_header:
        if valid_org_header not in user_org_map:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: User does not belong to organization {valid_org_header}"
            )
        target_org_id = valid_org_header
        target_role = user_org_map[valid_org_header]
    else:
        if user_org_map:
            target_org_id = list(user_org_map.keys())[0]
            target_role = user_org_map[target_org_id]
        else:
            first_org = admin_client.table("organizations").select("id").limit(1).execute()
            if first_org.data:
                target_org_id = first_org.data[0]["id"]
                target_role = "owner"
            else:
                target_org_id = "00000000-0000-0000-0000-000000000000"
                target_role = "owner"

    return UserContext(
        user_id=user_id,
        email=email,
        company_id=target_org_id,
        role=target_role,
        token=token
    )
