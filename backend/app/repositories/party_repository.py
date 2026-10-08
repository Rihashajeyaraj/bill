from typing import List, Optional, Dict, Any
import logging
from app.core.supabase import get_admin_supabase_client
from app.schemas.party import PartyCreate, PartyUpdate
from app.core.auth import is_valid_uuid

logger = logging.getLogger(__name__)

class PartyRepository:
    def __init__(self):
        self.db = get_admin_supabase_client()

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
        data["created_by"] = user_id
        res = self.db.table("parties").insert(data).execute()
        return res.data[0]

    def update(self, party_id: str, organization_id: str, party_data: PartyUpdate) -> Optional[Dict[str, Any]]:
        data = party_data.model_dump(exclude_unset=True)
        if not data:
            return self.get_by_id(party_id, organization_id)
        res = self.db.table("parties").update(data).eq("id", party_id).eq("organization_id", organization_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def delete(self, party_id: str, organization_id: str) -> bool:
        if not is_valid_uuid(organization_id) or not is_valid_uuid(party_id):
            return False
        res = self.db.table("parties").delete().eq("id", party_id).eq("organization_id", organization_id).execute()
        return bool(res.data)
