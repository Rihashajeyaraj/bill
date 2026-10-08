from typing import List, Optional, Dict, Any
from app.core.supabase import get_admin_supabase_client

# Only physical base table columns in Supabase proforma_invoices table schema
KNOWN_COLUMNS = {
    "id", "organization_id", "proforma_no", "proforma_date",
    "valid_till", "due_date", "party_id", "place_of_supply_state",
    "currency_code", "exchange_rate", "subtotal", "discount_total", "taxable_total",
    "cgst_total", "sgst_total", "igst_total", "cess_total", "vat_total", "tax_total",
    "round_off", "grand_total", "status", "notes", "terms", "converted_document_id",
    "converted_at", "created_by", "metadata", "created_at", "updated_at"
}

def clean_header_payload(header_data: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    meta = dict(header_data.get("metadata") or {})
    
    for key, val in header_data.items():
        if key in KNOWN_COLUMNS:
            cleaned[key] = val
        else:
            if val is not None:
                meta[key] = val
            
    cleaned["metadata"] = meta
    return cleaned

def unpack_header_result(header: Dict[str, Any]) -> Dict[str, Any]:
    if not header:
        return header
    result = dict(header)
    meta = result.get("metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            if k not in result:
                result[k] = v
    return result

class ProformaRepository:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def generate_proforma_no(self, organization_id: str) -> str:
        count = len(self.db.table("proforma_invoices").select("id", count="exact").eq("organization_id", organization_id).execute().data or [])
        next_no = count + 1
        return f"PI-{next_no:04d}"

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        proformas = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id).order("proforma_date", desc=True).execute().data or []
        unpacked = []
        for p in proformas:
            p_unpacked = unpack_header_result(p)
            if p_unpacked.get("party_id"):
                party_res = self.db.table("parties").select("display_name").eq("id", p_unpacked["party_id"]).limit(1).execute()
                if party_res.data:
                    p_unpacked["party_name"] = party_res.data[0]["display_name"]
            unpacked.append(p_unpacked)
        return unpacked

    def get_by_id(self, proforma_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        res = self.db.table("proforma_invoices").select("*").eq("id", proforma_id).eq("organization_id", organization_id).limit(1).execute()
        if not res.data:
            return None
        proforma = unpack_header_result(res.data[0])
        if proforma.get("party_id"):
            party_res = self.db.table("parties").select("display_name").eq("id", proforma["party_id"]).limit(1).execute()
            if party_res.data:
                proforma["party_name"] = party_res.data[0]["display_name"]
        items_res = self.db.table("proforma_invoice_items").select("*").eq("proforma_id", proforma_id).order("line_no").execute()
        proforma["items"] = items_res.data or []
        return proforma

    def create(self, header_data: Dict[str, Any], items_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        cleaned_header = clean_header_payload(header_data)
        try:
            h_res = self.db.table("proforma_invoices").insert(cleaned_header).execute()
        except Exception:
            if "created_by" in cleaned_header:
                cleaned_header.pop("created_by", None)
            h_res = self.db.table("proforma_invoices").insert(cleaned_header).execute()
        header = h_res.data[0]
        proforma_id = header["id"]
        
        for item in items_data:
            item["proforma_id"] = proforma_id
            self.db.table("proforma_invoice_items").insert(item).execute()
            
        return self.get_by_id(proforma_id, header["organization_id"])

    def update(self, proforma_id: str, organization_id: str, header_data: Dict[str, Any], items_data: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        if header_data:
            cleaned_header = clean_header_payload(header_data)
            self.db.table("proforma_invoices").update(cleaned_header).eq("id", proforma_id).eq("organization_id", organization_id).execute()
            
        if items_data is not None:
            self.db.table("proforma_invoice_items").delete().eq("proforma_id", proforma_id).execute()
            for item in items_data:
                item["proforma_id"] = proforma_id
                self.db.table("proforma_invoice_items").insert(item).execute()
                
        return self.get_by_id(proforma_id, organization_id)
