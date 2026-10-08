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
    Decodes JWT token without verification or with secret if available.
    """
    try:
        if settings.SUPABASE_JWT_SECRET:
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False}
            )
        else:
            payload = jwt.decode(
                token,
                options={"verify_signature": False, "verify_aud": False}
            )
        return payload
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user_context(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_organization_id: Optional[str] = Header(None)
) -> UserContext:
    admin_client = get_admin_supabase_client()
    valid_org_header = x_organization_id if is_valid_uuid(x_organization_id) else None

    if not credentials or not credentials.credentials:
        # Fallback for dev mode / testing if no credentials provided
        if valid_org_header:
            org_res = admin_client.table("organizations").select("id, owner_user_id").eq("id", valid_org_header).limit(1).execute()
            if org_res.data and len(org_res.data) > 0:
                org = org_res.data[0]
                return UserContext(
                    user_id=org.get("owner_user_id") or "00000000-0000-0000-0000-000000000000",
                    email="dev@example.com",
                    company_id=org.get("id"),
                    role="owner",
                    token="dev-token"
                )

        res = admin_client.table("organizations").select("id, owner_user_id").limit(1).execute()
        if res.data and len(res.data) > 0:
            org = res.data[0]
            return UserContext(
                user_id=org.get("owner_user_id") or "00000000-0000-0000-0000-000000000000",
                email="dev@example.com",
                company_id=org.get("id"),
                role="owner",
                token="dev-token"
            )
        return UserContext(
            user_id="00000000-0000-0000-0000-000000000000",
            email="dev@example.com",
            company_id="00000000-0000-0000-0000-000000000000",
            role="owner",
            token="dev-token"
        )

    token = credentials.credentials
    payload = decode_jwt_token(token)
    user_id = payload.get("sub") or payload.get("id") or "00000000-0000-0000-0000-000000000000"
    email = payload.get("email", "")

    # Query organization membership to resolve company_id and role
    query = admin_client.table("organization_members").select("organization_id, role, status").eq("user_id", user_id).eq("status", "active")
    
    if valid_org_header:
        query = query.eq("organization_id", valid_org_header)
        
    members_res = query.execute()

    if members_res.data and len(members_res.data) > 0:
        member = members_res.data[0]
        company_id = member["organization_id"]
        role = member["role"]
    else:
        # Check if user is owner of any organization directly
        org_res = admin_client.table("organizations").select("id").eq("owner_user_id", user_id).limit(1).execute()
        if org_res.data and len(org_res.data) > 0:
            company_id = org_res.data[0]["id"]
            role = "owner"
        elif valid_org_header:
            company_id = valid_org_header
            role = "owner"
        else:
            first_org = admin_client.table("organizations").select("id").limit(1).execute()
            if first_org.data and len(first_org.data) > 0:
                company_id = first_org.data[0]["id"]
                role = "owner"
            else:
                # Create default organization if none exists
                new_org = admin_client.table("organizations").insert({
                    "owner_user_id": user_id,
                    "company_name": "My Billing Business",
                    "country_code": "IN",
                    "state_name": "Tamil Nadu"
                }).execute()
                company_id = new_org.data[0]["id"]
                role = "owner"

    return UserContext(
        user_id=user_id,
        email=email,
        company_id=company_id,
        role=role,
        token=token
    )
