from typing import List, Optional, Dict, Any
import logging
from app.core.supabase import get_admin_supabase_client
from app.schemas.item import ItemCreate, ItemUpdate
from app.core.auth import is_valid_uuid

logger = logging.getLogger(__name__)

VALID_ITEM_COLUMNS = {
    "id", "organization_id", "item_type", "item_name", "item_code",
    "sku", "hsn_sac", "unit", "sale_price", "purchase_price",
    "tax_rate", "tax_inclusive", "opening_stock", "current_stock",
    "reorder_level", "category_id", "is_active", "created_by"
}

def _clean_item_data(data: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in data.items() if k in VALID_ITEM_COLUMNS and v is not None}

class ItemRepository:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        if not is_valid_uuid(organization_id):
            return []
        try:
            res = self.db.table("items").select("*").eq("organization_id", organization_id).order("item_name").execute()
            return res.data or []
        except Exception as e:
            logger.error(f"Error getting items for org {organization_id}: {e}")
            return []

    def get_by_id(self, item_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        if not is_valid_uuid(organization_id) or not is_valid_uuid(item_id):
            return None
        try:
            res = self.db.table("items").select("*").eq("id", item_id).eq("organization_id", organization_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting item {item_id}: {e}")
            return None

    def create(self, organization_id: str, item_data: ItemCreate, user_id: str) -> Dict[str, Any]:
        data = item_data.model_dump()
        data["organization_id"] = organization_id
        if user_id and is_valid_uuid(user_id):
            data["created_by"] = user_id
        clean_data = _clean_item_data(data)
        res = self.db.table("items").insert(clean_data).execute()
        return res.data[0]

    def update(self, item_id: str, organization_id: str, item_data: ItemUpdate) -> Optional[Dict[str, Any]]:
        data = item_data.model_dump(exclude_unset=True)
        if not data:
            return self.get_by_id(item_id, organization_id)
        res = self.db.table("items").update(data).eq("id", item_id).eq("organization_id", organization_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def delete(self, item_id: str, organization_id: str) -> bool:
        if not is_valid_uuid(organization_id) or not is_valid_uuid(item_id):
            return False
        res = self.db.table("items").delete().eq("id", item_id).eq("organization_id", organization_id).execute()
        return bool(res.data)
