from typing import List, Optional, Dict, Any
import logging
from app.core.supabase import get_admin_supabase_client, get_supabase_client
from app.schemas.party import PartyCreate, PartyUpdate
from app.core.auth import is_valid_uuid

logger = logging.getLogger(__name__)

VALID_PARTY_COLUMNS = {
    "id", "organization_id", "party_type", "display_name", "legal_name",
    "contact_person", "phone", "email", "billing_address_line1",
    "billing_address_line2", "city", "state_name", "state_code",
    "country_code", "postal_code", "gstin", "pan",
    "opening_balance", "credit_limit", "notes", "is_active",
    "created_by", "created_at", "updated_at"
}

def _clean_party_data(data: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = dict(data)
    # Map equivalent tax identifier fields to existing database columns
    if "tax_id" in cleaned and not cleaned.get("gstin"):
        cleaned["gstin"] = cleaned.pop("tax_id")
    if "vat_number" in cleaned and not cleaned.get("gstin"):
        cleaned["gstin"] = cleaned.pop("vat_number")
    # Derive PAN from 15-char GSTIN if PAN is not explicitly set
    if cleaned.get("gstin") and not cleaned.get("pan"):
        gstin_str = str(cleaned["gstin"]).strip().upper()
        if len(gstin_str) == 15:
            cleaned["pan"] = gstin_str[2:12]
        elif len(gstin_str) == 10:
            cleaned["pan"] = gstin_str
    return {k: v for k, v in cleaned.items() if k in VALID_PARTY_COLUMNS and v is not None}

class PartyRepository:
    def __init__(self, token: Optional[str] = None):
        self.db = get_supabase_client(token) if token else get_admin_supabase_client()

    def get_all(self, organization_id: str, party_type: Optional[str] = None) -> List[Dict[str, Any]]:
        if not is_valid_uuid(organization_id):
            return []
        try:
            query = self.db.table("parties").select("*").eq("organization_id", organization_id).order("display_name")
            if party_type:
                query = query.eq("party_type", party_type)
            res = query.execute()
            return res.data or []
        except Exception as e:
            logger.error(f"Error getting parties for org {organization_id}: {e}")
            return []

    def get_by_id(self, party_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        if not is_valid_uuid(organization_id) or not is_valid_uuid(party_id):
            return None
        try:
            res = self.db.table("parties").select("*").eq("id", party_id).eq("organization_id", organization_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting party {party_id}: {e}")
            return None

    def create(self, organization_id: str, party_data: PartyCreate, user_id: str) -> Dict[str, Any]:
        data = party_data.model_dump()
        data["organization_id"] = organization_id
        if user_id and is_valid_uuid(user_id):
            try:
                u_res = self.db.table("users").select("id").eq("id", user_id).limit(1).execute()
                if u_res.data:
                    data["created_by"] = user_id
            except Exception:
                pass
        clean_data = _clean_party_data(data)
        res = self.db.table("parties").insert(clean_data).execute()
        return res.data[0]

    def update(self, party_id: str, organization_id: str, party_data: PartyUpdate) -> Optional[Dict[str, Any]]:
        data = party_data.model_dump(exclude_unset=True)
        if not data:
            return self.get_by_id(party_id, organization_id)
        clean_data = _clean_party_data(data)
        res = self.db.table("parties").update(clean_data).eq("id", party_id).eq("organization_id", organization_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def delete(self, party_id: str, organization_id: str) -> bool:
        if not is_valid_uuid(organization_id) or not is_valid_uuid(party_id):
            return False
        res = self.db.table("parties").delete().eq("id", party_id).eq("organization_id", organization_id).execute()
        return bool(res.data)
