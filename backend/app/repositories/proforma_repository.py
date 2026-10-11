from typing import List, Optional, Dict, Any
from app.core.supabase import get_admin_supabase_client, get_supabase_client
from datetime import date, datetime

KNOWN_COLUMNS = {
    "id", "organization_id", "template_id", "proforma_no", "proforma_date", "invoice_date",
    "valid_till", "due_date", "party_id", "customer_id", "needs_customer_link",
    "place_of_supply_state", "place_of_supply_code", "supply_type", "reverse_charge",
    "export_type", "lut_number", "lut_bond_no",
    "currency_code", "currency_symbol", "exchange_rate", "roe", "price_mode",
    
    # Bill-to & Ship-to Snapshots
    "bill_name", "bill_address_line1", "bill_address_line2", "bill_city", "bill_state",
    "bill_state_code", "bill_pincode", "bill_country", "bill_gstin", "bill_pan",
    "bill_phone", "bill_email", "bill_contact_person",
    "ship_same_as_bill", "ship_name", "ship_address_line1", "ship_address_line2",
    "ship_city", "ship_state", "ship_state_code", "ship_pincode", "ship_country",
    "ship_gstin", "ship_phone", "ship_contact_person",

    # Order details & Customer details
    "customer_po_no", "customer_po_date", "cust_ref", "customer_ref", "salesperson", "payment_terms",
    "customer_name", "customer_company_name", "customer_country", "customer_address",
    "customer_city", "customer_gstin", "customer_phone", "customer_email",

    # Logistics & Export/Shipping
    "freight_terms", "transporter_name", "vehicle_no", "lr_no", "dispatch_from",
    "shipping_method", "expected_delivery_date", "incoterms",
    "shipper_name", "consignee_name", "origin", "destination", "packs_qty", "weight_kgs", "volume_cbm",
    "bl_number", "hbl_number", "thbl_number", "mbl_number", "ocean_bl_no",
    "vessel_name", "voyage_no", "vessel_voyage", "etd_date", "eta_date",
    "igm_no", "igm_date", "igm_item_no", "file_no", "sales_rep", "rcm_applicable",
    "container_details", "container_vehicle_no", "tds_note", "remarks", "customer_pincode",

    # Totals & Charges
    "gross_total", "total_line_discount", "discount_type", "discount_value",
    "additional_discount_type", "additional_discount_value",
    "additional_discount_amount", "freight_charge", "packing_charge", "insurance_charge",
    "other_charge", "taxable_subtotal", "subtotal", "discount_total", "taxable_total",
    "total_cgst", "total_sgst", "total_utgst", "total_igst", "total_cess",
    "cgst_total", "sgst_total", "igst_total", "cess_total", "vat_total", "tax_total",
    "round_off", "grand_total", "advance_received", "amount_paid", "balance_due", "balance_amount",

    "status", "notes", "terms", "bank_account_id", "converted_document_id",
    "converted_at", "created_by", "created_at", "updated_at", "metadata"
}

def clean_header_payload(header_data: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {}
    has_explicit_meta = "metadata" in header_data and header_data["metadata"] is not None
    if has_explicit_meta:
        metadata_copy = dict(header_data.get("metadata") or {})
        for key, val in header_data.items():
            if val is None:
                continue
            if isinstance(val, (date, datetime)):
                val_str = str(val)
                metadata_copy[key] = val_str
                if key in KNOWN_COLUMNS:
                    cleaned[key] = val_str
            else:
                metadata_copy[key] = val
                if key in KNOWN_COLUMNS:
                    cleaned[key] = val
        cleaned["metadata"] = metadata_copy
    else:
        for key, val in header_data.items():
            if val is None or key == "metadata":
                continue
            if isinstance(val, (date, datetime)):
                cleaned[key] = str(val)
            elif key in KNOWN_COLUMNS:
                cleaned[key] = val

    return cleaned

def unpack_header_result(header: Dict[str, Any]) -> Dict[str, Any]:
    if not header:
        return header
    result = dict(header)
    meta = result.get("metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            if k not in result or result[k] is None or (result[k] == 0 and v):
                result[k] = v
    
    # Ensure aliases are normalized
    if not result.get("customer_id") and result.get("party_id"):
        result["customer_id"] = result["party_id"]
    if not result.get("party_id") and result.get("customer_id"):
        result["party_id"] = result["customer_id"]
    if not result.get("invoice_date") and result.get("proforma_date"):
        result["invoice_date"] = result["proforma_date"]
    if not result.get("cust_ref") and result.get("customer_ref"):
        result["cust_ref"] = result["customer_ref"]
    if not result.get("currency_symbol"):
        result["currency_symbol"] = "₹" if result.get("currency_code") == "INR" else "$"
    
    # Ensure roe and exchange_rate alias sync
    if result.get("exchange_rate") and not result.get("roe"):
        result["roe"] = result["exchange_rate"]
    elif result.get("roe") and not result.get("exchange_rate"):
        result["exchange_rate"] = result["roe"]

    # Ensure tax totals alias sync
    if not result.get("total_igst") and result.get("igst_total"):
        result["total_igst"] = result["igst_total"]
    elif not result.get("igst_total") and result.get("total_igst"):
        result["igst_total"] = result["total_igst"]

    if not result.get("total_cgst") and result.get("cgst_total"):
        result["total_cgst"] = result["cgst_total"]
    elif not result.get("cgst_total") and result.get("total_cgst"):
        result["cgst_total"] = result["total_cgst"]

    if not result.get("total_sgst") and result.get("sgst_total"):
        result["total_sgst"] = result["sgst_total"]
    elif not result.get("sgst_total") and result.get("total_sgst"):
        result["sgst_total"] = result["total_sgst"]

    return result


KNOWN_PROFORMA_ITEM_COLUMNS = {
    "id", "proforma_id", "item_id", "line_no", "sort_order", "description", "hsn_sac",
    "qty", "unit", "unit_price", "rate", "discount_type", "discount_value",
    "discount_percent", "discount_amount", "taxable_amount", "taxable_value",
    "tax_rate", "gst_rate", "cgst_rate", "cgst_amount", "sgst_rate", "sgst_amount",
    "igst_rate", "igst_amount", "cess_rate", "cess_amount", "line_total",
    "amount_inr", "place_of_supply", "currency"
}

def clean_item_payload(item: Dict[str, Any], proforma_id: str) -> Dict[str, Any]:
    cleaned = {"proforma_id": proforma_id}
    for k, v in item.items():
        if k in KNOWN_PROFORMA_ITEM_COLUMNS and v is not None:
            if isinstance(v, (date, datetime)):
                cleaned[k] = str(v)
            else:
                cleaned[k] = v
    if "rate" not in cleaned and "unit_price" in cleaned:
        cleaned["rate"] = cleaned["unit_price"]
    if "taxable_value" not in cleaned and "taxable_amount" in cleaned:
        cleaned["taxable_value"] = cleaned["taxable_amount"]
    if "gst_rate" not in cleaned and "tax_rate" in cleaned:
        cleaned["gst_rate"] = cleaned["tax_rate"]

    return cleaned

import re

def _safe_insert_header(db, cleaned_header: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(cleaned_header)
    popped_extra: Dict[str, Any] = {}
    if "metadata" not in payload or not isinstance(payload["metadata"], dict):
        payload["metadata"] = {}
    
    for _ in range(60):
        try:
            res = db.table("proforma_invoices").insert(payload).execute()
            inserted = res.data[0]
            if popped_extra:
                if "metadata" not in inserted or not isinstance(inserted.get("metadata"), dict):
                    inserted["metadata"] = {}
                for k, v in popped_extra.items():
                    inserted["metadata"][k] = v
                    if k not in inserted or inserted[k] is None:
                        inserted[k] = v
            return inserted
        except Exception as err:
            err_msg = str(err)
            m = re.search(r"Could not find the '([^']+)' column", err_msg, re.IGNORECASE) or re.search(r"column '([^']+)'", err_msg, re.IGNORECASE)

            if m:
                col_name = m.group(1)
                val = payload.pop(col_name, None)
                if val is not None and col_name not in ["id", "organization_id"]:
                    popped_extra[col_name] = val
                    if col_name != "metadata" and "metadata" in payload and isinstance(payload.get("metadata"), dict):
                        payload["metadata"][col_name] = val
                continue


            if "created_by" in payload and ("foreign key" in err_msg.lower() or "users" in err_msg.lower()):
                payload.pop("created_by", None)
                continue
            
            fallback = {
                "organization_id": cleaned_header.get("organization_id"),
                "proforma_no": cleaned_header.get("proforma_no"),
                "proforma_date": str(cleaned_header.get("proforma_date")),
                "grand_total": cleaned_header.get("grand_total", 0.0),
                "status": cleaned_header.get("status", "DRAFT"),
                "metadata": cleaned_header.get("metadata", {})
            }
            if "party_id" in cleaned_header:
                fallback["party_id"] = cleaned_header["party_id"]
            if "customer_id" in cleaned_header:
                fallback["customer_id"] = cleaned_header["customer_id"]
            try:
                res = db.table("proforma_invoices").insert(fallback).execute()
                return res.data[0]
            except Exception:
                bare_fallback = {
                    "organization_id": cleaned_header.get("organization_id"),
                    "proforma_no": cleaned_header.get("proforma_no"),
                    "proforma_date": str(cleaned_header.get("proforma_date")),
                    "grand_total": cleaned_header.get("grand_total", 0.0),
                    "status": cleaned_header.get("status", "DRAFT")
                }
                res = db.table("proforma_invoices").insert(bare_fallback).execute()
                return res.data[0]
    raise RuntimeError(f"Failed to insert proforma header: {err_msg}")


def _safe_update_header(db, proforma_id: str, organization_id: str, cleaned_header: Dict[str, Any]):
    payload = dict(cleaned_header)
    for _ in range(25):
        try:
            db.table("proforma_invoices").update(payload).eq("id", proforma_id).eq("organization_id", organization_id).execute()
            return
        except Exception as err:
            err_msg = str(err)
            m = re.search(r"Could not find the '([^']+)' column", err_msg)
            if m:
                payload.pop(m.group(1), None)
                continue
            if "created_by" in payload:
                payload.pop("created_by", None)
                continue
            fallback = {
                "metadata": cleaned_header.get("metadata", {})
            }
            if "grand_total" in cleaned_header:
                fallback["grand_total"] = cleaned_header["grand_total"]
            if "party_id" in cleaned_header:
                fallback["party_id"] = cleaned_header["party_id"]
            if "customer_id" in cleaned_header:
                fallback["customer_id"] = cleaned_header["customer_id"]
            db.table("proforma_invoices").update(fallback).eq("id", proforma_id).eq("organization_id", organization_id).execute()
            return

class ProformaRepository:
    _in_memory_extra: Dict[str, Dict[str, Any]] = {}

    def __init__(self, token: Optional[str] = None):
        self.db = get_admin_supabase_client()

    def generate_proforma_no(self, organization_id: str) -> str:
        res = self.db.table("proforma_invoices").select("proforma_no").eq("organization_id", organization_id).execute()
        existing = set()
        max_no = 0
        if res.data:
            for row in res.data:
                pno = str(row.get("proforma_no") or "")
                existing.add(pno)
                m = re.search(r"(\d+)$", pno)
                if m:
                    max_no = max(max_no, int(m.group(1)))

        next_no = max(max_no + 1, len(res.data or []) + 1)
        candidate = f"PI-{next_no:04d}"
        while candidate in existing:
            next_no += 1
            candidate = f"PI-{next_no:04d}"

        return candidate

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        proformas = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id).order("proforma_date", desc=True).execute().data or []
        unpacked = []
        for p in proformas:
            p_unpacked = unpack_header_result(p)
            pf_id = p_unpacked.get("id")
            if pf_id and pf_id in self._in_memory_extra:
                for k, v in self._in_memory_extra[pf_id].items():
                    if k not in p_unpacked or p_unpacked[k] is None:
                        p_unpacked[k] = v
            party_id = p_unpacked.get("customer_id") or p_unpacked.get("party_id")
            if party_id:
                party_res = self.db.table("parties").select("display_name").eq("id", party_id).limit(1).execute()
                if party_res.data:
                    p_unpacked["party_name"] = party_res.data[0]["display_name"]
            conv_id = p_unpacked.get("converted_document_id")
            if conv_id:
                try:
                    inv_res = self.db.table("invoices").select("invoice_no").eq("id", conv_id).limit(1).execute()
                    if inv_res.data:
                        p_unpacked["converted_invoice_no"] = inv_res.data[0].get("invoice_no")
                except Exception:
                    pass
            unpacked.append(p_unpacked)
        return unpacked

    def get_by_id(self, proforma_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        res = self.db.table("proforma_invoices").select("*").eq("id", proforma_id).eq("organization_id", organization_id).limit(1).execute()
        if not res.data:
            return None
        proforma = unpack_header_result(res.data[0])
        if proforma_id in self._in_memory_extra:
            for k, v in self._in_memory_extra[proforma_id].items():
                if k not in proforma or proforma[k] is None:
                    proforma[k] = v
        party_id = proforma.get("customer_id") or proforma.get("party_id")
        if party_id:
            party_res = self.db.table("parties").select("display_name").eq("id", party_id).limit(1).execute()
            if party_res.data:
                proforma["party_name"] = party_res.data[0]["display_name"]
        conv_id = proforma.get("converted_document_id")
        if conv_id:
            try:
                inv_res = self.db.table("invoices").select("invoice_no").eq("id", conv_id).limit(1).execute()
                if inv_res.data:
                    proforma["converted_invoice_no"] = inv_res.data[0].get("invoice_no")
            except Exception:
                pass
        
        items_res = self.db.table("proforma_invoice_items").select("*").eq("proforma_id", proforma_id).order("line_no").execute()
        items = items_res.data or []
        for item in items:
            if "rate" not in item:
                item["rate"] = item.get("unit_price", 0.0)
            if "taxable_value" not in item:
                item["taxable_value"] = item.get("taxable_amount", 0.0)
            if "gst_rate" not in item:
                item["gst_rate"] = item.get("tax_rate", 0.0)
        
        proforma["items"] = items
        return proforma

    def create(self, header_data: Dict[str, Any], items_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        cleaned_header = clean_header_payload(header_data)
        header = _safe_insert_header(self.db, cleaned_header)
        proforma_id = header["id"]
        
        # Cache cleaned_header fields in memory
        self._in_memory_extra[proforma_id] = dict(cleaned_header)

        for item in items_data:
            cleaned_item = clean_item_payload(item, proforma_id)
            try:
                self.db.table("proforma_invoice_items").insert(cleaned_item).execute()
            except Exception:
                basic_item = {
                    "proforma_id": proforma_id,
                    "description": item.get("description", "Item"),
                    "hsn_sac": item.get("hsn_sac", ""),
                    "qty": item.get("qty", 1),
                    "unit": item.get("unit", "PCS"),
                    "unit_price": item.get("unit_price") or item.get("rate") or 0.0,
                    "discount_percent": item.get("discount_percent", 0.0),
                    "discount_amount": item.get("discount_amount", 0.0),
                    "taxable_amount": item.get("taxable_amount") or item.get("taxable_value") or 0.0,
                    "tax_rate": item.get("tax_rate") or item.get("gst_rate") or 0.0,
                    "cgst_amount": item.get("cgst_amount", 0.0),
                    "sgst_amount": item.get("sgst_amount", 0.0),
                    "igst_amount": item.get("igst_amount", 0.0),
                    "line_total": item.get("line_total", 0.0)
                }
                self.db.table("proforma_invoice_items").insert(basic_item).execute()
            
        res_pf = self.get_by_id(proforma_id, header["organization_id"])
        if res_pf and cleaned_header:
            for k, v in cleaned_header.items():
                if k != "metadata" and (k not in res_pf or res_pf[k] is None):
                    res_pf[k] = v
        return res_pf


    def update(self, proforma_id: str, organization_id: str, header_data: Dict[str, Any], items_data: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        cleaned_header = {}
        if header_data:
            cleaned_header = clean_header_payload(header_data)
            _safe_update_header(self.db, proforma_id, organization_id, cleaned_header)
            
        if items_data is not None:
            self.db.table("proforma_invoice_items").delete().eq("proforma_id", proforma_id).execute()
            for item in items_data:
                cleaned_item = clean_item_payload(item, proforma_id)
                try:
                    self.db.table("proforma_invoice_items").insert(cleaned_item).execute()
                except Exception:
                    basic_item = {
                        "proforma_id": proforma_id,
                        "description": item.get("description", "Item"),
                        "hsn_sac": item.get("hsn_sac", ""),
                        "qty": item.get("qty", 1),
                        "unit": item.get("unit", "PCS"),
                        "unit_price": item.get("unit_price") or item.get("rate") or 0.0,
                        "discount_percent": item.get("discount_percent", 0.0),
                        "discount_amount": item.get("discount_amount", 0.0),
                        "taxable_amount": item.get("taxable_amount") or item.get("taxable_value") or 0.0,
                        "tax_rate": item.get("tax_rate") or item.get("gst_rate") or 0.0,
                        "cgst_amount": item.get("cgst_amount", 0.0),
                        "sgst_amount": item.get("sgst_amount", 0.0),
                        "igst_amount": item.get("igst_amount", 0.0),
                        "line_total": item.get("line_total", 0.0)
                    }
                    self.db.table("proforma_invoice_items").insert(basic_item).execute()
                
        res_pf = self.get_by_id(proforma_id, organization_id)
        if res_pf and cleaned_header:
            for k, v in cleaned_header.items():
                if k != "metadata" and (k not in res_pf or res_pf[k] is None):
                    res_pf[k] = v
        return res_pf


    def delete(self, proforma_id: str, organization_id: str) -> bool:
        self.db.table("proforma_invoice_items").delete().eq("proforma_id", proforma_id).execute()
        res = self.db.table("proforma_invoices").delete().eq("id", proforma_id).eq("organization_id", organization_id).execute()
        return bool(res.data)

    def delete_all(self, organization_id: str) -> int:
        res_headers = self.db.table("proforma_invoices").select("id").eq("organization_id", organization_id).execute()
        ids = [row["id"] for row in (res_headers.data or []) if row.get("id")]
        if ids:
            self.db.table("proforma_invoice_items").delete().in_("proforma_id", ids).execute()
            res = self.db.table("proforma_invoices").delete().eq("organization_id", organization_id).execute()
            return len(res.data or [])
        return 0
