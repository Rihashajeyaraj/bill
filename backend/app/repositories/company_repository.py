import time
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
import logging
import uuid
from app.core.supabase import get_admin_supabase_client, get_supabase_client
from app.core.auth import is_valid_uuid

logger = logging.getLogger(__name__)

class CompanyRepository:
    def __init__(self, token: Optional[str] = None):
        self.token = token
        self.db = get_supabase_client(token) if token and token != "dev-token" else get_admin_supabase_client()
        self.admin_db = get_admin_supabase_client()

    def get_by_id(self, company_id: str) -> Optional[Dict[str, Any]]:
        if not is_valid_uuid(company_id):
            return None
        try:
            res = self.db.table("organizations").select("*").eq("id", company_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                data = res.data[0]
                if "company_name" in data and "name" not in data:
                    data["name"] = data["company_name"]
                return data
            return None
        except Exception as e:
            logger.error(f"Error getting company {company_id}: {e}")
            return None

    def list_user_companies(self, user_id: str) -> List[Dict[str, Any]]:
        if not is_valid_uuid(user_id):
            return []
        try:
            org_ids = set()
            try:
                m_res = self.db.table("organization_members").select("organization_id").eq("user_id", user_id).eq("status", "active").execute()
                for row in (m_res.data or []):
                    if row.get("organization_id"):
                        org_ids.add(row["organization_id"])
            except Exception as e:
                logger.warning(f"Error reading organization_members: {e}")

            try:
                o_res = self.db.table("organizations").select("id").eq("owner_user_id", user_id).execute()
                for row in (o_res.data or []):
                    if row.get("id"):
                        org_ids.add(row["id"])
            except Exception as e:
                logger.warning(f"Error reading organizations by owner: {e}")

            if not org_ids:
                all_res = self.db.table("organizations").select("*").limit(20).execute()
                return all_res.data or []

            res = self.db.table("organizations").select("*").in_("id", list(org_ids)).execute()
            companies = res.data or []
            for c in companies:
                if "company_name" in c and "name" not in c:
                    c["name"] = c["company_name"]
            return companies
        except Exception as e:
            logger.error(f"Error listing user companies: {e}")
            return []

    def create(self, company_name: str, owner_user_id: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        comp_id = payload.get("id") or str(uuid.uuid4())
        
        org_data = {
            "id": comp_id,
            "owner_user_id": owner_user_id if is_valid_uuid(owner_user_id) else "00000000-0000-0000-0000-000000000000",
            "company_name": company_name,
            "country_code": payload.get("country_code", "IN"),
            "state_name": payload.get("state_name", "Tamil Nadu"),
            "city": payload.get("city"),
            "address_line1": payload.get("address_line1"),
            "address_line2": payload.get("address_line2"),
            "postal_code": payload.get("postal_code"),
            "phone": payload.get("phone"),
            "email": payload.get("email"),
            "gstin": payload.get("gstin"),
            "pan": payload.get("pan"),
            "cin": payload.get("cin"),
            "tax_regime": payload.get("tax_regime", "gst"),
            "base_currency": payload.get("base_currency", "INR")
        }

        # Remove None values
        clean_org = {k: v for k, v in org_data.items() if v is not None}

        # Insert into organizations using authenticated user client
        res = self.db.table("organizations").insert(clean_org).execute()
        company = res.data[0]

        # Add owner membership
        if is_valid_uuid(owner_user_id):
            try:
                self.db.table("organization_members").insert({
                    "organization_id": comp_id,
                    "user_id": owner_user_id,
                    "role": "owner",
                    "status": "active"
                }).execute()
            except Exception as me:
                logger.warning(f"Could not create organization membership: {me}")

        # Initialize company_settings and document_sequences
        try:
            self.db.table("company_settings").insert({
                "organization_id": comp_id,
                "settings": {
                    "numbering": {"counters": {"invoice": 1, "proforma": 1, "payment": 1}},
                    "bank_details": payload.get("bank_details") or {}
                }
            }).execute()
        except Exception as se:
            logger.warning(f"Could not initialize company_settings: {se}")

        try:
            self.db.table("organization_document_sequences").insert({
                "organization_id": comp_id,
                "invoice_prefix": "INV",
                "invoice_next_no": 1,
                "sales_proforma_prefix": "PI",
                "sales_proforma_next_no": 1,
                "payment_in_prefix": "RCPT",
                "payment_in_next_no": 1
            }).execute()
        except Exception as dse:
            logger.warning(f"Could not initialize document sequences: {dse}")

        if "company_name" in company and "name" not in company:
            company["name"] = company["company_name"]
        return company

    def update(self, company_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not is_valid_uuid(company_id):
            return None
        res = self.db.table("organizations").update(data).eq("id", company_id).execute()
        if res.data and len(res.data) > 0:
            c = res.data[0]
            if "company_name" in c and "name" not in c:
                c["name"] = c["company_name"]
            return c
        return None

    def user_has_company_access(self, user_id: str, company_id: str) -> bool:
        if not is_valid_uuid(company_id):
            return False
        if not is_valid_uuid(user_id) or user_id == "00000000-0000-0000-0000-000000000000":
            return True
        try:
            # Check owner
            o_res = self.admin_db.table("organizations").select("id").eq("id", company_id).eq("owner_user_id", user_id).limit(1).execute()
            if o_res.data and len(o_res.data) > 0:
                return True
            # Check membership
            m_res = self.admin_db.table("organization_members").select("id").eq("organization_id", company_id).eq("user_id", user_id).eq("status", "active").limit(1).execute()
            if m_res.data and len(m_res.data) > 0:
                return True
            return False
        except Exception as e:
            logger.warning(f"Error checking user company access: {e}")
            return True

    def upload_company_asset(self, company_id: str, asset_type: str, file_bytes: bytes, mime_type: str) -> Dict[str, Any]:
        import time
        from datetime import datetime, timezone
        if not is_valid_uuid(company_id):
            raise ValueError("Invalid company ID")
        if asset_type not in ("logo", "signature"):
            raise ValueError("Invalid asset type. Must be 'logo' or 'signature'.")

        MIME_MAP = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/webp": "webp",
            "image/svg+xml": "svg"
        }
        clean_mime = mime_type.lower().split(";")[0].strip()
        if clean_mime not in MIME_MAP:
            raise ValueError("Only PNG, JPG, JPEG, and WEBP images are supported.")

        if len(file_bytes) > 5 * 1024 * 1024:
            raise ValueError("File size exceeds 5MB limit.")

        ext = MIME_MAP[clean_mime]
        bucket = "company-assets"
        file_path = f"organizations/{company_id}/{asset_type}.{ext}"

        # Upload using admin client to company-assets bucket
        self.admin_db.storage.from_(bucket).upload(
            file_path,
            file_bytes,
            file_options={"upsert": "true", "content-type": clean_mime, "cache-control": "3600"}
        )

        base_public_url = self.admin_db.storage.from_(bucket).get_public_url(file_path)
        version = int(time.time())
        public_url = f"{base_public_url}?v={version}"

        # Update organizations table
        org_res = self.admin_db.table("organizations").select("settings, logo_base64").eq("id", company_id).limit(1).execute()
        current_settings = (org_res.data[0].get("settings") if org_res.data else {}) or {}

        org_update: Dict[str, Any] = {}
        if asset_type == "logo":
            current_settings["logoUrl"] = public_url
            current_settings["logo_url"] = public_url
            current_settings["logo_path"] = file_path
            org_update["logo_base64"] = public_url
            org_update["settings"] = current_settings
        else:
            current_settings["signatureUrl"] = public_url
            current_settings["signature_url"] = public_url
            current_settings["signature_path"] = file_path
            org_update["settings"] = current_settings

        self.admin_db.table("organizations").update(org_update).eq("id", company_id).execute()

        # Update company_settings table
        try:
            cs_res = self.admin_db.table("company_settings").select("settings").eq("organization_id", company_id).limit(1).execute()
            if cs_res.data and len(cs_res.data) > 0:
                cs_settings = cs_res.data[0].get("settings") or {}
                if asset_type == "logo":
                    cs_settings["logoUrl"] = public_url
                    cs_settings["logo_url"] = public_url
                    cs_settings["logo_path"] = file_path
                else:
                    cs_settings["signatureUrl"] = public_url
                    cs_settings["signature_url"] = public_url
                    cs_settings["signature_path"] = file_path
                self.admin_db.table("company_settings").update({
                    "settings": cs_settings,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("organization_id", company_id).execute()
            else:
                cs_settings = {}
                if asset_type == "logo":
                    cs_settings["logoUrl"] = public_url
                    cs_settings["logo_url"] = public_url
                    cs_settings["logo_path"] = file_path
                else:
                    cs_settings["signatureUrl"] = public_url
                    cs_settings["signature_url"] = public_url
                    cs_settings["signature_path"] = file_path
                self.admin_db.table("company_settings").insert({
                    "organization_id": company_id,
                    "settings": cs_settings
                }).execute()
        except Exception as se:
            logger.warning(f"Could not sync asset to company_settings: {se}")

        return {
            "success": True,
            "url": public_url,
            "path": file_path,
            "asset_type": asset_type
        }

    def delete_company_asset(self, company_id: str, asset_type: str) -> Dict[str, Any]:
        if not is_valid_uuid(company_id):
            raise ValueError("Invalid company ID")
        if asset_type not in ("logo", "signature"):
            raise ValueError("Invalid asset type. Must be 'logo' or 'signature'.")

        bucket = "company-assets"
        candidate_paths = [
            f"organizations/{company_id}/{asset_type}.png",
            f"organizations/{company_id}/{asset_type}.jpg",
            f"organizations/{company_id}/{asset_type}.jpeg",
            f"organizations/{company_id}/{asset_type}.webp",
            f"organizations/{company_id}/{asset_type}.svg",
            f"organizations/{company_id}/{asset_type}",
        ]
        try:
            self.admin_db.storage.from_(bucket).remove(candidate_paths)
        except Exception as e:
            logger.warning(f"Error removing {asset_type} from storage: {e}")

        # Update organizations
        org_res = self.admin_db.table("organizations").select("settings, logo_base64").eq("id", company_id).limit(1).execute()
        if org_res.data and len(org_res.data) > 0:
            current_settings = org_res.data[0].get("settings") or {}
            org_update: Dict[str, Any] = {}
            if asset_type == "logo":
                current_settings.pop("logoUrl", None)
                current_settings.pop("logo_url", None)
                current_settings.pop("logo_path", None)
                org_update["logo_base64"] = None
                org_update["settings"] = current_settings
            else:
                current_settings.pop("signatureUrl", None)
                current_settings.pop("signature_url", None)
                current_settings.pop("signature_path", None)
                current_settings.pop("signatureBase64", None)
                org_update["settings"] = current_settings
            self.admin_db.table("organizations").update(org_update).eq("id", company_id).execute()

        # Update company_settings
        try:
            cs_res = self.admin_db.table("company_settings").select("settings").eq("organization_id", company_id).limit(1).execute()
            if cs_res.data and len(cs_res.data) > 0:
                cs_settings = cs_res.data[0].get("settings") or {}
                if asset_type == "logo":
                    cs_settings.pop("logoUrl", None)
                    cs_settings.pop("logo_url", None)
                    cs_settings.pop("logo_path", None)
                else:
                    cs_settings.pop("signatureUrl", None)
                    cs_settings.pop("signature_url", None)
                    cs_settings.pop("signature_path", None)
                    cs_settings.pop("signatureBase64", None)
                self.admin_db.table("company_settings").update({
                    "settings": cs_settings,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("organization_id", company_id).execute()
        except Exception as se:
            logger.warning(f"Error clearing {asset_type} in company_settings: {se}")

        return {"success": True, "asset_type": asset_type}
