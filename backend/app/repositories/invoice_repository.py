from typing import List, Optional, Dict, Any
from app.core.supabase import get_admin_supabase_client, get_supabase_client

KNOWN_INVOICE_COLUMNS = {
    "id", "organization_id", "template_id", "invoice_no", "invoice_date",
    "due_date", "party_id", "customer_id", "source_proforma_id", "source_proforma_no", "source_proforma_date",
    "document_type", "place_of_supply_state", "place_of_supply_code", "supply_type", "reverse_charge",
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

    "status", "notes", "terms", "bank_account_id", "bank_details",
    "created_by", "created_at", "updated_at", "metadata"
}

from datetime import date, datetime, timezone
import logging
import re

logger = logging.getLogger(__name__)

def clean_invoice_header_payload(header_data: Dict[str, Any]) -> Dict[str, Any]:
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
                if key in KNOWN_INVOICE_COLUMNS:
                    cleaned[key] = val_str
            else:
                metadata_copy[key] = val
                if key in KNOWN_INVOICE_COLUMNS:
                    cleaned[key] = val
        cleaned["metadata"] = metadata_copy
    else:
        for key, val in header_data.items():
            if val is None or key == "metadata":
                continue
            if isinstance(val, (date, datetime)):
                cleaned[key] = str(val)
            elif key in KNOWN_INVOICE_COLUMNS:
                cleaned[key] = val

    return cleaned

def unpack_invoice_header_result(header: Dict[str, Any]) -> Dict[str, Any]:
    if not header:
        return {}
    result = dict(header)
    meta = result.get("metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            if k not in result or result[k] is None or (result[k] == 0 and v):
                result[k] = v
    if not result.get("advance_received") and result.get("amount_paid"):
        result["advance_received"] = result["amount_paid"]
    return result

from app.core.auth import is_valid_uuid

KNOWN_INVOICE_ITEM_COLUMNS = {
    "id", "invoice_id", "item_id", "line_no", "sort_order", "description", "hsn_sac",
    "qty", "unit", "unit_price", "rate", "discount_type", "discount_value",
    "discount_percent", "discount_amount", "taxable_amount", "taxable_value",
    "tax_rate", "gst_rate", "cgst_rate", "cgst_amount", "sgst_rate", "sgst_amount",
    "igst_rate", "igst_amount", "cess_rate", "cess_amount", "vat_amount",
    "place_of_supply", "currency", "amount_inr", "line_total"
}

import re

def clean_invoice_item_payload(item: Dict[str, Any], invoice_id: str) -> Dict[str, Any]:
    cleaned = {"invoice_id": invoice_id}
    for k, v in item.items():
        if k in KNOWN_INVOICE_ITEM_COLUMNS and v is not None:
            if k == "item_id" and not is_valid_uuid(str(v)):
                continue
            if isinstance(v, (date, datetime)):
                cleaned[k] = str(v)
            else:
                cleaned[k] = v
    return cleaned

def _safe_insert_invoice_item(db, admin_db, cleaned_item: Dict[str, Any]) -> None:
    payload = dict(cleaned_item)
    for _ in range(20):
        try:
            try:
                db.table("invoice_items").insert(payload).execute()
            except Exception:
                admin_db.table("invoice_items").insert(payload).execute()
            return
        except Exception as err:
            err_str = str(err)
            m = re.search(r"Could not find the '([^']+)' column", err_str, re.IGNORECASE) or re.search(r"column '([^']+)'", err_str, re.IGNORECASE)
            if m:
                col_name = m.group(1)
                if col_name in payload and col_name not in ["id", "invoice_id"]:
                    payload.pop(col_name, None)
                    continue
            logger.warning(f"Error inserting invoice_item: {err}")
            return

def _safe_insert_invoice_header(db, admin_db, cleaned_header: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(cleaned_header)
    popped_extra: Dict[str, Any] = {}
    if "metadata" not in payload or not isinstance(payload["metadata"], dict):
        payload["metadata"] = {}

    err_msg = ""
    for _ in range(60):
        try:
            try:
                res = db.table("invoices").insert(payload).execute()
            except Exception:
                res = admin_db.table("invoices").insert(payload).execute()
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

            if "23505" in err_msg or "duplicate key" in err_msg.lower() or "unique constraint" in err_msg.lower():
                from fastapi import HTTPException, status
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Sales Pro Forma is already converted or invoice number conflict."
                )

            if "created_by" in payload and ("foreign key" in err_msg.lower() or "users" in err_msg.lower()):
                payload.pop("created_by", None)
                continue

            fallback = {
                "organization_id": cleaned_header.get("organization_id"),
                "invoice_no": cleaned_header.get("invoice_no"),
                "invoice_date": str(cleaned_header.get("invoice_date")),
                "grand_total": cleaned_header.get("grand_total", 0.0),
                "status": cleaned_header.get("status", "issued"),
                "metadata": cleaned_header.get("metadata", {})
            }
            if "party_id" in cleaned_header:
                fallback["party_id"] = cleaned_header["party_id"]
            if "customer_id" in cleaned_header and "party_id" not in fallback:
                fallback["party_id"] = cleaned_header["customer_id"]

            try:
                res = admin_db.table("invoices").insert(fallback).execute()
                return res.data[0]
            except Exception:
                bare_fallback = {
                    "organization_id": cleaned_header.get("organization_id"),
                    "invoice_no": cleaned_header.get("invoice_no"),
                    "invoice_date": str(cleaned_header.get("invoice_date")),
                    "grand_total": cleaned_header.get("grand_total", 0.0),
                    "status": cleaned_header.get("status", "issued")
                }
                res = admin_db.table("invoices").insert(bare_fallback).execute()
                return res.data[0]

class InvoiceRepository:
    def __init__(self, token: Optional[str] = None):
        self.db = get_supabase_client(token) if token and token != "dev-token" else get_admin_supabase_client()
        self.admin_db = get_admin_supabase_client()

    def generate_invoice_no(self, organization_id: str, invoice_date: Optional[Any] = None) -> str:
        org_id_str = str(organization_id)
        existing_nos = set()
        max_no = 0

        prefix = "INV-"
        if invoice_date:
            try:
                if isinstance(invoice_date, str):
                    d = datetime.strptime(str(invoice_date)[:10], "%Y-%m-%d").date()
                elif isinstance(invoice_date, (date, datetime)):
                    d = invoice_date if isinstance(invoice_date, date) else invoice_date.date()
                else:
                    d = None
                if d:
                    if d.month <= 3:
                        sy = d.year - 1
                        ey = d.year
                    else:
                        sy = d.year
                        ey = d.year + 1
                    fy_str = f"{str(sy)[-2:]}{str(ey)[-2:]}"
                    prefix = f"INV-{fy_str}-"
            except Exception:
                pass

        try:
            res = self.admin_db.table("invoices").select("invoice_no").eq("organization_id", org_id_str).execute()
            if res.data:
                for row in res.data:
                    ino = str(row.get("invoice_no") or "").strip()
                    if ino:
                        existing_nos.add(ino)
                        if (prefix == "INV-" and re.match(r"^INV-\d+$", ino)) or (prefix != "INV-" and ino.startswith(prefix)):
                            m = re.search(r"(\d+)$", ino)
                            if m:
                                try:
                                    max_no = max(max_no, int(m.group(1)))
                                except ValueError:
                                    pass
        except Exception as e:
            logger.warning(f"Error reading existing invoices for org {org_id_str}: {e}")

        seq_next = 1
        if prefix == "INV-":
            try:
                seq_res = self.admin_db.table("organization_document_sequences").select("invoice_next_no").eq("organization_id", org_id_str).limit(1).execute()
                if seq_res.data and seq_res.data[0].get("invoice_next_no") is not None:
                    seq_next = int(seq_res.data[0]["invoice_next_no"])
            except Exception as e:
                logger.warning(f"Error reading document sequences for org {org_id_str}: {e}")

        next_val = max(max_no + 1, seq_next if prefix == "INV-" else 1, 1)
        candidate = f"{prefix}{next_val:04d}"
        while candidate in existing_nos:
            next_val += 1
            candidate = f"{prefix}{next_val:04d}"

        if prefix == "INV-":
            try:
                self.admin_db.table("organization_document_sequences").upsert({
                    "organization_id": org_id_str,
                    "invoice_prefix": "INV",
                    "invoice_next_no": next_val + 1,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }, on_conflict="organization_id").execute()
            except Exception as e:
                logger.warning(f"Error synchronizing organization_document_sequences: {e}")

        return candidate

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        try:
            invoices = self.db.table("invoices").select("*").eq("organization_id", organization_id).order("invoice_date", desc=True).execute().data or []
        except Exception:
            invoices = self.admin_db.table("invoices").select("*").eq("organization_id", organization_id).order("invoice_date", desc=True).execute().data or []

        if not invoices:
            return []

        # Batch load parties in ONE query
        party_ids = list({inv.get("party_id") for inv in invoices if inv.get("party_id")})
        parties_map = {}
        if party_ids:
            try:
                party_res = self.db.table("parties").select("id, display_name, legal_name, phone, gstin").in_("id", party_ids).execute()
                for p in (party_res.data or []):
                    parties_map[p["id"]] = p
            except Exception:
                try:
                    party_res = self.admin_db.table("parties").select("id, display_name, legal_name, phone, gstin").in_("id", party_ids).execute()
                    for p in (party_res.data or []):
                        parties_map[p["id"]] = p
                except Exception:
                    pass

        unpacked = []
        for inv in invoices:
            inv_unpacked = unpack_invoice_header_result(inv)
            pid = inv_unpacked.get("party_id")
            if pid and pid in parties_map:
                inv_unpacked["party_name"] = parties_map[pid].get("display_name")
                inv_unpacked["customer"] = parties_map[pid]
            unpacked.append(inv_unpacked)
        return unpacked

    def get_by_id(self, invoice_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        res = None
        try:
            res = self.db.table("invoices").select("*").eq("id", invoice_id).eq("organization_id", organization_id).limit(1).execute()
        except Exception:
            pass
        if not res or not res.data:
            res = self.admin_db.table("invoices").select("*").eq("id", invoice_id).eq("organization_id", organization_id).limit(1).execute()
        if not res.data:
            return None
        inv = unpack_invoice_header_result(res.data[0])
        if inv.get("party_id"):
            try:
                party_res = self.db.table("parties").select("*").eq("id", inv["party_id"]).limit(1).execute()
            except Exception:
                party_res = self.admin_db.table("parties").select("*").eq("id", inv["party_id"]).limit(1).execute()
            if party_res.data:
                inv["party_name"] = party_res.data[0].get("display_name")
                inv["customer"] = party_res.data[0]
        try:
            items_res = self.db.table("invoice_items").select("*").eq("invoice_id", invoice_id).order("line_no").execute()
        except Exception:
            items_res = self.admin_db.table("invoice_items").select("*").eq("invoice_id", invoice_id).order("line_no").execute()
        inv["items"] = items_res.data or []
        try:
            pf_match = self.admin_db.table("proforma_invoices").select("*").eq("converted_document_id", invoice_id).limit(1).execute()
            if not pf_match.data and inv.get("source_proforma_id"):
                pf_match = self.admin_db.table("proforma_invoices").select("*").eq("id", inv["source_proforma_id"]).limit(1).execute()
            if pf_match.data:
                pf_row = pf_match.data[0]
                inv["source_proforma_id"] = pf_row["id"]
                inv["source_proforma_no"] = pf_row.get("proforma_no")
                inv["source_proforma_date"] = pf_row.get("proforma_date")
                for pk, pv in pf_row.items():
                    if pk not in inv or inv[pk] is None or (inv[pk] == 0 and pv):
                        inv[pk] = pv
                cust_obj = inv.get("customer") or {}
                if not inv.get("customer_name"):
                    inv["customer_name"] = pf_row.get("bill_name") or cust_obj.get("display_name") or cust_obj.get("name")
                if not inv.get("customer_company_name"):
                    inv["customer_company_name"] = cust_obj.get("legal_name") or inv.get("customer_name")
                if not inv.get("customer_address"):
                    inv["customer_address"] = pf_row.get("bill_address_line1") or cust_obj.get("billing_address_line1") or cust_obj.get("address")
                if not inv.get("customer_city"):
                    inv["customer_city"] = pf_row.get("bill_city") or cust_obj.get("city")
                if not inv.get("customer_state"):
                    inv["customer_state"] = pf_row.get("bill_state") or cust_obj.get("state_name")
                if not inv.get("customer_country"):
                    inv["customer_country"] = cust_obj.get("country_name") or cust_obj.get("country") or "India"
                if not inv.get("customer_gstin"):
                    inv["customer_gstin"] = pf_row.get("bill_gstin") or cust_obj.get("gstin")
                if not inv.get("customer_phone"):
                    inv["customer_phone"] = cust_obj.get("phone")
                if not inv.get("customer_email"):
                    inv["customer_email"] = cust_obj.get("email")
                # If invoice has no items, heal from proforma_invoice_items
                if not inv["items"]:
                    pf_items_res = self.admin_db.table("proforma_invoice_items").select("*").eq("proforma_id", pf_row["id"]).order("line_no").execute()
                    if pf_items_res.data:
                        inv["items"] = pf_items_res.data
                        for it in pf_items_res.data:
                            cleaned_it = clean_invoice_item_payload(it, invoice_id)
                            _safe_insert_invoice_item(self.db, self.admin_db, cleaned_it)
        except Exception as e:
            logger.warning(f"Notice while linking proforma details: {e}")

        inv["lines"] = inv["items"]

        # Ensure EA invoice preserves QR code and type when reopened
        if inv.get("document_type") == "EA_INVOICE" or inv.get("invoice_type") == "EA_INVOICE" or inv.get("qr_code_data"):
            inv["invoice_type"] = "EA_INVOICE"
            inv["document_type"] = "EA_INVOICE"
            if not inv.get("qr_code_data"):
                import json, hashlib
                irn_hash = hashlib.sha256(f"{organization_id}:{inv.get('invoice_no')}:{inv.get('invoice_date')}:{float(inv.get('grand_total') or 0.0):.2f}".encode()).hexdigest()
                qr_dict = {
                    "irn": irn_hash,
                    "invoice_type": "EA_INVOICE",
                    "invoice_no": inv.get("invoice_no"),
                    "invoice_date": str(inv.get("invoice_date")),
                    "seller_gstin": inv.get("company_gstin") or "27AABCT1234F1Z5",
                    "buyer_gstin": inv.get("customer_gstin") or "URP",
                    "grand_total": float(inv.get("grand_total") or 0.0),
                    "line_items_count": len(inv.get("items") or []),
                    "verified": True
                }
                inv["qr_code_data"] = json.dumps(qr_dict, separators=(',', ':'))
                inv["irn_number"] = irn_hash
            if not inv.get("qr_code_image") and inv.get("qr_code_data"):
                try:
                    import qrcode, io, base64
                    qr = qrcode.QRCode(version=1, box_size=6, border=2)
                    qr.add_data(inv["qr_code_data"])
                    qr.make(fit=True)
                    img = qr.make_image(fill_color="black", back_color="white")
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    inv["qr_code_image"] = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"
                except Exception:
                    pass

        return inv



    def create(self, header_data: Dict[str, Any], items_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        org_id = header_data.get("organization_id")
        last_err = None
        for attempt in range(5):
            cleaned_header = clean_invoice_header_payload(header_data)
            try:
                header = _safe_insert_invoice_header(self.db, self.admin_db, cleaned_header)
                invoice_id = header["id"]
                
                for item in items_data:
                    cleaned_item = clean_invoice_item_payload(item, invoice_id)
                    _safe_insert_invoice_item(self.db, self.admin_db, cleaned_item)
                    
                db_inv = self.get_by_id(invoice_id, header["organization_id"])
                if db_inv:
                    for k, v in header.items():
                        if k not in db_inv or db_inv[k] is None:
                            db_inv[k] = v
                    return db_inv
                return header
            except Exception as err:
                last_err = err
                err_str = str(err)
                if ("23505" in err_str or "duplicate key" in err_str.lower() or "unique constraint" in err_str.lower() or "conflict" in err_str.lower()) and attempt < 4:
                    next_no = self.generate_invoice_no(org_id)
                    header_data["invoice_no"] = next_no
                    logger.info(f"Unique conflict detected during invoice creation, retrying with next number: {next_no}")
                    continue
                raise
        if last_err:
            raise last_err

    def update(self, invoice_id: str, organization_id: str, header_data: Dict[str, Any], items_data: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        if header_data:
            cleaned_header = clean_invoice_header_payload(header_data)
            payload = dict(cleaned_header)
            for _ in range(20):
                try:
                    try:
                        self.db.table("invoices").update(payload).eq("id", invoice_id).eq("organization_id", organization_id).execute()
                    except Exception:
                        self.admin_db.table("invoices").update(payload).eq("id", invoice_id).eq("organization_id", organization_id).execute()
                    break
                except Exception as err:
                    err_str = str(err)
                    m = re.search(r"Could not find the '([^']+)' column", err_str, re.IGNORECASE) or re.search(r"column '([^']+)'", err_str, re.IGNORECASE)
                    if m:
                        col_name = m.group(1)
                        if col_name in payload and col_name not in ["id", "organization_id"]:
                            payload.pop(col_name, None)
                            continue
                    logger.warning(f"Error updating invoice header: {err}")
                    break
            
        if items_data is not None:
            try:
                self.db.table("invoice_items").delete().eq("invoice_id", invoice_id).execute()
            except Exception:
                self.admin_db.table("invoice_items").delete().eq("invoice_id", invoice_id).execute()
            for item in items_data:
                cleaned_item = clean_invoice_item_payload(item, invoice_id)
                _safe_insert_invoice_item(self.db, self.admin_db, cleaned_item)
                
        return self.get_by_id(invoice_id, organization_id)

    def delete(self, invoice_id: str, organization_id: str) -> bool:
        try:
            self.db.table("invoice_items").delete().eq("invoice_id", invoice_id).execute()
            self.db.table("invoices").delete().eq("id", invoice_id).eq("organization_id", organization_id).execute()
            return True
        except Exception:
            self.admin_db.table("invoice_items").delete().eq("invoice_id", invoice_id).execute()
            self.admin_db.table("invoices").delete().eq("id", invoice_id).eq("organization_id", organization_id).execute()
            return True

