from typing import List, Optional, Dict, Any
from app.core.supabase import get_admin_supabase_client

# Only physical base table columns in Supabase invoices table schema
KNOWN_INVOICE_COLUMNS = {
    "id", "organization_id", "invoice_no", "invoice_date",
    "due_date", "party_id", "place_of_supply_state",
    "currency_code", "exchange_rate", "subtotal", "discount_total", "taxable_total",
    "cgst_total", "sgst_total", "igst_total", "cess_total", "vat_total", "tax_total",
    "round_off", "grand_total", "amount_paid", "balance_due", "status", "notes", "terms",
    "created_by", "metadata", "created_at", "updated_at"
}

def clean_invoice_header_payload(header_data: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    meta = dict(header_data.get("metadata") or {})
    
    for key, val in header_data.items():
        if key in KNOWN_INVOICE_COLUMNS:
            cleaned[key] = val
        else:
            if val is not None:
                meta[key] = val
            
    cleaned["metadata"] = meta
    return cleaned

def unpack_invoice_header_result(header: Dict[str, Any]) -> Dict[str, Any]:
    if not header:
        return header
    result = dict(header)
    meta = result.get("metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            if k not in result:
                result[k] = v
    return result

class InvoiceRepository:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def generate_invoice_no(self, organization_id: str) -> str:
        count = len(self.db.table("invoices").select("id", count="exact").eq("organization_id", organization_id).execute().data or [])
        next_no = count + 1
        return f"INV-{next_no:04d}"

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        invoices = self.db.table("invoices").select("*").eq("organization_id", organization_id).order("invoice_date", desc=True).execute().data or []
        unpacked = []
        for inv in invoices:
            inv_unpacked = unpack_invoice_header_result(inv)
            if inv_unpacked.get("party_id"):
                party_res = self.db.table("parties").select("display_name").eq("id", inv_unpacked["party_id"]).limit(1).execute()
                if party_res.data:
                    inv_unpacked["party_name"] = party_res.data[0]["display_name"]
            unpacked.append(inv_unpacked)
        return unpacked

    def get_by_id(self, invoice_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        res = self.db.table("invoices").select("*").eq("id", invoice_id).eq("organization_id", organization_id).limit(1).execute()
        if not res.data:
            return None
        inv = unpack_invoice_header_result(res.data[0])
        if inv.get("party_id"):
            party_res = self.db.table("parties").select("display_name").eq("id", inv["party_id"]).limit(1).execute()
            if party_res.data:
                inv["party_name"] = party_res.data[0]["display_name"]
        items_res = self.db.table("invoice_items").select("*").eq("invoice_id", invoice_id).order("line_no").execute()
        inv["items"] = items_res.data or []
        return inv

    def create(self, header_data: Dict[str, Any], items_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        cleaned_header = clean_invoice_header_payload(header_data)
        h_res = self.db.table("invoices").insert(cleaned_header).execute()
        header = h_res.data[0]
        invoice_id = header["id"]
        
        for item in items_data:
            item["invoice_id"] = invoice_id
            self.db.table("invoice_items").insert(item).execute()
            
        return self.get_by_id(invoice_id, header["organization_id"])

    def update(self, invoice_id: str, organization_id: str, header_data: Dict[str, Any], items_data: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        if header_data:
            cleaned_header = clean_invoice_header_payload(header_data)
            self.db.table("invoices").update(cleaned_header).eq("id", invoice_id).eq("organization_id", organization_id).execute()
            
        if items_data is not None:
            self.db.table("invoice_items").delete().eq("invoice_id", invoice_id).execute()
            for item in items_data:
                item["invoice_id"] = invoice_id
                self.db.table("invoice_items").insert(item).execute()
                
        return self.get_by_id(invoice_id, organization_id)
