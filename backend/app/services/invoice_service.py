from decimal import Decimal
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, date
import logging
from fastapi import HTTPException, status
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals, validate_advance_amount, to_decimal
from app.schemas.invoice import InvoiceCreate, InvoiceUpdate
from app.utils.num2words import number_to_words_indian

import hmac
import hashlib
import base64
import io
import qrcode
from app.core.config import settings
from app.core.auth import is_valid_uuid

logger = logging.getLogger(__name__)

def generate_invoice_verification_token(invoice_id: str, organization_id: str) -> str:
    """
    Generates a secure, deterministic, opaque verification token for a Tax Invoice.
    Uses HMAC-SHA256 over invoice_id and organization_id to ensure tamper resistance.
    """
    secret = (settings.SUPABASE_JWT_SECRET or "twite-invoice-verification-key").encode("utf-8")
    message = f"twite_txv:{invoice_id}:{organization_id}".encode("utf-8")
    sig = hmac.new(secret, message, hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig[:16]).decode("utf-8").rstrip("=")
    return f"txv_{invoice_id}_{sig_b64}"

def verify_invoice_verification_token(token: str, organization_id: str) -> bool:
    """
    Verifies that the given token matches the expected HMAC for invoice_id and organization_id.
    """
    if not token or not token.startswith("txv_"):
        return False
    parts = token.split("_", 2)
    if len(parts) < 3:
        return False
    _, invoice_id, _ = parts
    expected_token = generate_invoice_verification_token(invoice_id, organization_id)
    return hmac.compare_digest(token, expected_token)

def extract_invoice_id_from_token(token: str) -> Optional[str]:
    """
    Extracts the invoice UUID from an opaque verification token.
    Supports txv_, pfv_, and inv_ prefixes.
    """
    if not token or not (token.startswith("txv_") or token.startswith("pfv_") or token.startswith("inv_")):
        return None
    parts = token.split("_", 2)
    if len(parts) < 3:
        return None
    return parts[1]

def generate_invoice_qr_image(data: str) -> str:
    """
    Generates a crisp, high-resolution square QR code image with white background
    and quiet zone, returned as a PNG Data URI.
    """
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"

class InvoiceService:
    def __init__(self, token: Optional[str] = None):
        self.invoice_repo = InvoiceRepository(token=token)
        self.party_repo = PartyRepository(token=token)
        self.db = get_admin_supabase_client()
        self.admin_db = get_admin_supabase_client()

    def get_company_details(self, organization_id: str) -> Dict[str, Any]:
        res = self.db.table("organizations").select("*").eq("id", organization_id).limit(1).execute()
        if res.data:
            return res.data[0]
        return {}

    def get_customer_details(self, party_id: Optional[str], organization_id: str) -> Dict[str, Any]:
        if not party_id:
            return {}
        party = self.party_repo.get_by_id(party_id, organization_id)
        return party or {}

    def get_company_state(self, organization_id: str) -> str:
        comp = self.get_company_details(organization_id)
        return comp.get("state_name") or comp.get("state") or ""

    def get_customer_state(self, party_id: Optional[str], organization_id: str) -> str:
        cust = self.get_customer_details(party_id, organization_id)
        return cust.get("state_name") or cust.get("state_code") or ""

    def _build_hsn_summary(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        hsn_map: Dict[str, Dict[str, Any]] = {}
        for item in items:
            hsn = str(item.get("hsn_sac") or "OTHER").strip()
            if not hsn:
                hsn = "OTHER"
            if hsn not in hsn_map:
                hsn_map[hsn] = {
                    "hsn_sac": hsn,
                    "taxable_value": 0.0,
                    "gst_rate": float(item.get("gst_rate") or item.get("tax_rate") or 0.0),
                    "cgst_rate": float(item.get("cgst_rate") or 0.0),
                    "cgst_amount": 0.0,
                    "sgst_rate": float(item.get("sgst_rate") or 0.0),
                    "sgst_amount": 0.0,
                    "igst_rate": float(item.get("igst_rate") or 0.0),
                    "igst_amount": 0.0,
                    "total_tax": 0.0
                }
            taxable = float(item.get("taxable_value") or item.get("taxable_amount") or 0.0)
            cgst = float(item.get("cgst_amount") or 0.0)
            sgst = float(item.get("sgst_amount") or 0.0)
            igst = float(item.get("igst_amount") or 0.0)
            hsn_map[hsn]["taxable_value"] += taxable
            hsn_map[hsn]["cgst_amount"] += cgst
            hsn_map[hsn]["sgst_amount"] += sgst
            hsn_map[hsn]["igst_amount"] += igst
            hsn_map[hsn]["total_tax"] += (cgst + sgst + igst)
        return list(hsn_map.values())

    def _build_full_invoice_payload(self, inv: Dict[str, Any], organization_id: str) -> Dict[str, Any]:
        company = self.get_company_details(organization_id)
        party_id = inv.get("party_id") or inv.get("customer_id")
        customer = self.get_customer_details(party_id, organization_id) if party_id else {}

        # Look up linked proforma for missing shipment, customer snapshot, and reference fields
        pf_row = None
        pf_id = inv.get("source_proforma_id")
        if pf_id:
            try:
                pf_res = self.admin_db.table("proforma_invoices").select("*").eq("id", pf_id).limit(1).execute()
                if pf_res.data:
                    pf_row = pf_res.data[0]
            except Exception:
                pass
        if not pf_row:
            try:
                pf_match = self.admin_db.table("proforma_invoices").select("*").eq("converted_document_id", inv.get("id")).limit(1).execute()
                if pf_match.data:
                    pf_row = pf_match.data[0]
            except Exception:
                pass

        if pf_row:
            inv["source_proforma_id"] = pf_row["id"]
            inv["source_proforma_no"] = pf_row.get("proforma_no")
            inv["source_proforma_date"] = str(pf_row.get("proforma_date") or "")
            for ship_col in [
                "freight_terms", "bl_number", "hbl_number", "thbl_number", "mbl_number", "ocean_bl_no",
                "vessel_name", "voyage_no", "vessel_voyage", "etd_date", "eta_date", "igm_no", "igm_date",
                "igm_item_no", "file_no", "sales_rep", "rcm_applicable", "container_details", "container_vehicle_no",
                "cust_ref", "customer_ref", "export_type", "lut_number", "lut_bond_no", "roe", "exchange_rate",
                "currency_code", "currency_symbol",
                "shipper_name", "consignee_name", "origin", "destination", "packs_qty", "weight_kgs", "volume_cbm",
                "bill_name", "bill_address_line1", "bill_address_line2", "bill_city", "bill_state", "bill_state_code",
                "bill_pincode", "bill_country", "bill_gstin", "bill_pan", "bill_phone", "bill_email",
                "customer_name", "customer_company_name", "customer_address", "customer_city", "customer_state",
                "customer_country", "customer_pincode", "customer_gstin", "customer_phone", "customer_email",
                "notes", "terms", "remarks", "tds_note", "template_id"
            ]:
                val = inv.get(ship_col)
                pf_val = pf_row.get(ship_col)
                if val is None or val == "" or (val == 0 and pf_val):
                    if pf_val is not None:
                        inv[ship_col] = pf_val
                elif ship_col == "currency_code" and str(val).upper() == "INR" and pf_val and str(pf_val).upper() != "INR":
                    inv[ship_col] = pf_val
                elif ship_col in ["roe", "exchange_rate"] and float(val or 1.0) == 1.0 and pf_val and float(pf_val or 1.0) != 1.0:
                    inv[ship_col] = pf_val

        # Freight terms default: if shipping details exist or linked to proforma, ensure freight_terms is set
        has_shipping = any(inv.get(k) for k in ["bl_number", "vessel_name", "ocean_bl_no", "mbl_number", "igm_no", "etd_date", "eta_date"])
        if not inv.get("freight_terms"):
            inv["freight_terms"] = (pf_row.get("freight_terms") if pf_row else None) or ("Collect" if has_shipping else "Collect")

        bill_name = (
            inv.get("bill_name") or
            inv.get("customer_name") or
            customer.get("display_name") or
            customer.get("legal_name") or
            "Customer"
        )
        bill_address = (
            inv.get("bill_address_line1") or
            inv.get("customer_address") or
            customer.get("billing_address_line1") or
            ""
        )
        bill_city = inv.get("bill_city") or inv.get("customer_city") or customer.get("city") or ""
        bill_state = inv.get("bill_state") or inv.get("place_of_supply_state") or customer.get("state_name") or ""
        bill_country = (
            inv.get("bill_country") or
            inv.get("customer_country") or
            (pf_row.get("bill_country") if pf_row else None) or
            (pf_row.get("customer_country") if pf_row else None) or
            customer.get("country_name") or
            customer.get("country") or
            "India"
        )
        bill_gstin = inv.get("bill_gstin") or inv.get("customer_gstin") or customer.get("gstin") or ""
        bill_phone = inv.get("bill_phone") or inv.get("customer_phone") or customer.get("phone") or ""
        bill_email = inv.get("bill_email") or inv.get("customer_email") or customer.get("email") or ""

        inv["bill_name"] = bill_name
        inv["bill_address_line1"] = bill_address
        inv["bill_city"] = bill_city
        inv["bill_state"] = bill_state
        inv["bill_country"] = bill_country
        inv["customer_country"] = bill_country
        inv["bill_gstin"] = bill_gstin
        inv["bill_phone"] = bill_phone
        inv["bill_email"] = bill_email
        inv["customer_name"] = bill_name

        if inv.get("ship_same_as_bill", True) or not inv.get("ship_name"):
            inv["ship_same_as_bill"] = True
            inv["ship_name"] = bill_name
            inv["ship_address_line1"] = bill_address
            inv["ship_city"] = bill_city
            inv["ship_state"] = bill_state
            inv["ship_country"] = bill_country
            inv["ship_gstin"] = bill_gstin
            inv["ship_phone"] = bill_phone

        # Company profile, branding and bank setup
        comp_settings = company.get("settings") if isinstance(company.get("settings"), dict) else {}
        profile_settings = comp_settings.get("profile") if isinstance(comp_settings.get("profile"), dict) else {}

        raw_legal = (
            company.get("company_name") or
            company.get("legal_name") or
            company.get("name") or
            profile_settings.get("companyName") or
            profile_settings.get("legalName") or
            ""
        ).strip()
        if not raw_legal or raw_legal.upper() == "COMPANY NAME":
            legal_name = (pf_row.get("company_name") if pf_row else None) or (pf_row.get("companyName") if pf_row else None) or "RIHASHA PVT"
        else:
            legal_name = raw_legal

        company["company_name"] = legal_name
        company["legal_name"] = legal_name
        company["name"] = legal_name
        inv["company_name"] = legal_name
        inv["companyName"] = legal_name

        logo_val = (
            company.get("logo_base64") or
            company.get("logo_url") or
            profile_settings.get("logoBase64") or
            profile_settings.get("logo_url") or
            comp_settings.get("logoUrl") or
            comp_settings.get("invoiceTemplate", {}).get("logoUrl") or
            (pf_row.get("company_logo_url") if pf_row else None) or
            (pf_row.get("logo_url") if pf_row else None) or
            (pf_row.get("logo_base64") if pf_row else None) or
            ""
        )
        company["logo_base64"] = logo_val
        company["logoBase64"] = logo_val
        company["logo_url"] = logo_val
        company["logoUrl"] = logo_val
        inv["companyLogoUrl"] = logo_val
        inv["logo_url"] = logo_val
        inv["logoBase64"] = logo_val

        sig_val = (
            company.get("signature_base64") or
            company.get("signature_url") or
            profile_settings.get("signatureBase64") or
            comp_settings.get("signatureUrl") or
            ""
        )
        company["signature_base64"] = sig_val
        company["signatureBase64"] = sig_val
        company["signature_url"] = sig_val
        company["signatureUrl"] = sig_val
        inv["companySignatureUrl"] = sig_val
        inv["signature_url"] = sig_val

        company_addr_parts = [
            company.get("address_line1") or profile_settings.get("address", {}).get("line1"),
            company.get("address_line2") or profile_settings.get("address", {}).get("line2"),
            company.get("city") or profile_settings.get("address", {}).get("city"),
            company.get("state_name") or profile_settings.get("address", {}).get("state"),
            company.get("postal_code") or profile_settings.get("address", {}).get("postalCode")
        ]
        company_addr_str = ", ".join([str(p).strip() for p in company_addr_parts if p and str(p).strip()])
        company["address"] = company_addr_str or company.get("address") or ""
        gstin_val = company.get("gstin") or comp_settings.get("tax", {}).get("gstin") or ""
        company["gstin"] = gstin_val
        company["stateWithCode"] = f"{company.get('state_name', '')} ({gstin_val[:2]})" if (company.get('state_name') and len(gstin_val) >= 2) else (company.get('state_name') or "")
        inv["companyAddress"] = company["address"]
        inv["companyGstin"] = gstin_val
        inv["company_gstin"] = gstin_val

        inv["company"] = company
        inv["customer"] = customer

        # Bank details
        settings_bank = comp_settings.get("bank") or comp_settings.get("bankDetails") or {}
        bank_details_dict = company.get("bank_details") or company.get("bankDetails") or settings_bank or {}
        if not bank_details_dict.get("bankName") and not bank_details_dict.get("accountNo") and pf_row:
            bank_details_dict = pf_row.get("bank_details") or pf_row.get("bank") or bank_details_dict
        bank_accounts = company.get("bank_accounts") or []
        selected_bank = None
        if bank_accounts:
            target_id = str(inv.get("bank_account_id") or "")
            for b in bank_accounts:
                if str(b.get("id") or "") == target_id:
                    selected_bank = b
                    break
            if not selected_bank:
                selected_bank = bank_accounts[0]
        if not selected_bank or (not selected_bank.get("bank_name") and not selected_bank.get("account_no")):
            pf_bank = (pf_row.get("bank_details") if pf_row else None) or (pf_row.get("bank") if pf_row else None) or {}
            selected_bank = {
                "bank_name": bank_details_dict.get("bankName") or bank_details_dict.get("bank_name") or company.get("bank_name") or pf_bank.get("bank_name") or pf_bank.get("bankName") or "",
                "branch": bank_details_dict.get("bankAddress") or bank_details_dict.get("branch") or company.get("bank_branch") or pf_bank.get("branch") or pf_bank.get("bankAddress") or "",
                "account_name": bank_details_dict.get("accountName") or bank_details_dict.get("account_name") or pf_bank.get("account_name") or pf_bank.get("accountName") or legal_name or "",
                "account_no": bank_details_dict.get("accountNo") or bank_details_dict.get("account_no") or bank_details_dict.get("accountNumber") or company.get("account_number") or pf_bank.get("account_no") or pf_bank.get("accountNo") or "",
                "ifsc": bank_details_dict.get("ifsc") or bank_details_dict.get("ifsc_code") or company.get("ifsc_code") or pf_bank.get("ifsc") or pf_bank.get("ifsc_code") or "",
                "upi_id": bank_details_dict.get("upi_id") or bank_details_dict.get("upiId") or company.get("upi_id") or pf_bank.get("upi_id") or ""
            }
        inv["bank"] = selected_bank
        inv["bank_details"] = selected_bank

        # Authoritative line item calculation using calculation_service (Decimal math)
        raw_items = [dict(it) for it in inv.get("items", [])]
        # In-memory deduplication of duplicate items if identical line item records exist
        seen_items = set()
        deduped_raw_items = []
        for it in raw_items:
            desc = (it.get("description") or it.get("name") or "").strip().lower()
            qty = float(it.get("qty") or it.get("quantity") or 0.0)
            u_price = float(it.get("unit_price") if it.get("unit_price") is not None else (it.get("rate") or 0.0))
            key = (desc, qty, u_price)
            if key not in seen_items:
                seen_items.add(key)
                deduped_raw_items.append(it)

        company_state = self.get_company_state(organization_id)
        customer_state = inv.get("place_of_supply_state") or inv.get("bill_state") or customer.get("state_name") or ""
        export_type = inv.get("export_type") or (pf_row.get("export_type") if pf_row else None) or "DOMESTIC"

        pf_curr = (pf_row.get("currency_code") if pf_row else None)
        currency_code = str(inv.get("currency_code") or pf_curr or "INR").upper()
        if currency_code == "INR" and pf_curr and str(pf_curr).upper() != "INR":
            currency_code = str(pf_curr).upper()

        pf_roe = (pf_row.get("roe") or pf_row.get("exchange_rate")) if pf_row else None
        inv_roe = inv.get("roe") or inv.get("exchange_rate")
        if (inv_roe is None or float(inv_roe or 1.0) == 1.0) and pf_roe and float(pf_roe or 1.0) != 1.0:
            exchange_rate = float(pf_roe)
        else:
            exchange_rate = float(inv_roe or 1.0)

        discount_type = str(inv.get("discount_type") or (pf_row.get("discount_type") if pf_row else "amount")).strip().lower()
        discount_value = float(inv.get("discount_value") if inv.get("discount_value") is not None else (pf_row.get("discount_value") if pf_row and pf_row.get("discount_value") is not None else inv.get("discount_total", 0.0)))
        amount_paid = float(inv.get("amount_paid") or inv.get("advance_received") or 0.0)

        calc_res = calculate_document_totals(
            deduped_raw_items,
            company_state,
            customer_state,
            exchange_rate=exchange_rate,
            amount_paid=amount_paid,
            export_type=export_type,
            overall_discount_type=discount_type,
            overall_discount_value=discount_value,
            doc_currency=currency_code
        )

        calculated_items = []
        for calc_item in calc_res.items:
            d = calc_item.to_dict()
            d["place_of_supply"] = customer_state
            d["currency"] = currency_code
            d["rate"] = float(calc_item.unit_price)
            d["unit_price"] = float(calc_item.unit_price)
            d["amount_inr"] = float(calc_item.amount_inr)
            d["amountInr"] = float(calc_item.amount_inr)
            d["tax_amount"] = float(calc_item.tax_amount)
            d["gst_total"] = float(calc_item.tax_amount)
            d["line_tax"] = float(calc_item.tax_amount)
            d["taxable_amount"] = float(calc_item.taxable_amount)
            d["taxable_value"] = float(calc_item.taxable_amount)
            d["net"] = float(calc_item.taxable_amount)
            calculated_items.append(d)

        inv["items"] = calculated_items
        inv["lines"] = calculated_items

        # HSN Summary
        inv["hsn_summary"] = self._build_hsn_summary(calculated_items)

        # Currency and Grand total in words
        curr_code = str(currency_code or "INR").upper()
        inv["currency_code"] = curr_code
        inv["currency_symbol"] = "₹" if curr_code == "INR" else ("€" if curr_code == "EUR" else "$")
        inv["roe"] = exchange_rate
        inv["exchange_rate"] = exchange_rate
        prefix = None if curr_code == "INR" else (f"{curr_code} EUROS" if curr_code == "EUR" else f"{curr_code} DOLLARS")
        gt = float(inv.get("grand_total") or calc_res.grand_total)
        inv["grand_total_in_words"] = number_to_words_indian(gt, currency_prefix=prefix)

        adv = float(inv.get("advance_received") or inv.get("amount_paid") or 0.0)
        bal = max(0.0, gt - adv)
        inv["amount_paid"] = adv
        inv["advance_received"] = adv
        inv["balance_due"] = bal
        inv["totals"] = {
            "subTotal": float(inv.get("subtotal") or calc_res.subtotal),
            "taxable_total": float(inv.get("taxable_total") or calc_res.taxable_total),
            "cgst_total": float(inv.get("cgst_total") or calc_res.cgst_total),
            "sgst_total": float(inv.get("sgst_total") or calc_res.sgst_total),
            "igst_total": float(inv.get("igst_total") or calc_res.igst_total),
            "tax_total": float(inv.get("tax_total") or calc_res.tax_total),
            "grand_total": gt,
            "advance_received": adv,
            "amount_paid": adv,
            "balance": bal,
            "balance_due": bal
        }

        if bal <= 0.01 and gt > 0:
            inv["payment_status"] = "Paid"
        elif adv > 0:
            inv["payment_status"] = "Partially Paid"
        else:
            inv["payment_status"] = "Unpaid"

        inv["document_type"] = "TAX_INVOICE"

        # Attach automatic internal verification QR code
        inv_id = str(inv.get("id") or "")
        if inv_id:
            token = generate_invoice_verification_token(inv_id, organization_id)
            frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
            verification_url = f"{frontend_url}/verify/invoice/{token}"

            try:
                qr_image = generate_invoice_qr_image(verification_url)
            except Exception as qre:
                logger.warning(f"Error generating invoice QR image: {qre}")
                qr_image = None

            inv["verification_token"] = token
            inv["verification_url"] = verification_url
            inv["qr_code_url"] = verification_url
            inv["qr_code_data"] = verification_url
            inv["qr_code_image"] = qr_image

        return inv

    def create_invoice(self, organization_id: str, data: InvoiceCreate, user_id: str) -> Dict[str, Any]:
        company_state = self.get_company_state(organization_id)
        target_party_id = data.party_id or getattr(data, "customer_id", None)
        customer_state = data.place_of_supply_state or self.get_customer_state(target_party_id, organization_id)
        
        raw_adv = getattr(data, "advance_received", None) if getattr(data, "advance_received", None) is not None and float(getattr(data, "advance_received", 0) or 0) > 0 else data.amount_paid
        if to_decimal(raw_adv) < Decimal("0.00"):
            raise HTTPException(status_code=422, detail="Advance amount cannot be negative.")

        raw_items = [
            item.model_dump() if hasattr(item, "model_dump") else (item.dict() if hasattr(item, "dict") else dict(item))
            for item in data.items
        ]
        calc_result = calculate_document_totals(raw_items, company_state, customer_state, amount_paid=raw_adv)
        validated_adv = validate_advance_amount(raw_adv, calc_result.grand_total)
        
        invoice_no = data.invoice_no or self.invoice_repo.generate_invoice_no(organization_id)
        
        status_val = "issued"
        if calc_result.amount_paid >= calc_result.grand_total and calc_result.grand_total > 0:
            status_val = "paid"
        elif calc_result.amount_paid > 0:
            status_val = "partial"
            
        header_data = {
            "organization_id": organization_id,
            "invoice_no": invoice_no,
            "invoice_date": str(data.invoice_date),
            "due_date": str(data.due_date) if data.due_date else None,
            "party_id": target_party_id,
            "customer_id": target_party_id,
            "place_of_supply_state": customer_state,
            "currency_code": "INR",
            "subtotal": float(calc_result.subtotal),
            "discount_total": float(calc_result.discount_total),
            "taxable_total": float(calc_result.taxable_total),
            "cgst_total": float(calc_result.cgst_total),
            "sgst_total": float(calc_result.sgst_total),
            "igst_total": float(calc_result.igst_total),
            "tax_total": float(calc_result.tax_total),
            "round_off": float(calc_result.round_off),
            "grand_total": float(calc_result.grand_total),
            "advance_received": float(validated_adv),
            "amount_paid": float(validated_adv),
            "balance_due": float(calc_result.grand_total - validated_adv),
            "status": status_val,
            "notes": data.notes,
            "terms": data.terms,
            "created_by": user_id
        }
        
        items_data = [item.to_dict() for item in calc_result.items]
        created_invoice = self.invoice_repo.create(header_data, items_data)

        # Auto-record payment in payments table if amount_paid > 0
        if calc_result.amount_paid > 0 and data.party_id:
            try:
                from app.repositories.payment_repository import PaymentRepository
                payment_repo = PaymentRepository()
                pmt_no = payment_repo.generate_payment_no(organization_id)
                payment_repo.create_payment(
                    organization_id=organization_id,
                    payment_no=pmt_no,
                    payment_date=str(data.invoice_date),
                    party_id=data.party_id,
                    amount=float(calc_result.amount_paid),
                    amount_received=float(calc_result.amount_paid),
                    tds_amount=0.0,
                    tds_rate=0.0,
                    payment_mode="Bank Transfer",
                    reference_no=invoice_no,
                    notes="Payment received for Tax Invoice",
                    user_id=user_id,
                    allocations=[{
                        "invoice_id": created_invoice["id"],
                        "amount_allocated": float(calc_result.amount_paid)
                    }]
                )
            except Exception as e:
                pass

        return created_invoice

    def get_invoices(self, organization_id: str) -> List[Dict[str, Any]]:
        return self.invoice_repo.get_all(organization_id)

    def get_invoice(self, invoice_id: str, organization_id: str) -> Dict[str, Any]:
        inv = self.invoice_repo.get_by_id(invoice_id, organization_id)
        if not inv:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax Invoice not found")
        return self._build_full_invoice_payload(inv, organization_id)

    def update_invoice(self, invoice_id: str, organization_id: str, data: InvoiceUpdate) -> Dict[str, Any]:
        existing = self.get_invoice(invoice_id, organization_id)
        header_updates = data.model_dump(exclude_unset=True, exclude={"items"}, mode="json")
        items_data = None
        
        if data.items is not None:
            company_state = self.get_company_state(organization_id)
            customer_state = data.place_of_supply_state or existing.get("place_of_supply_state") or self.get_customer_state(existing.get("party_id"), organization_id)
            raw_items = [item.model_dump(mode="json") for item in data.items]
            calc_result = calculate_document_totals(raw_items, company_state, customer_state, amount_paid=existing.get("amount_paid", 0))
            
            header_updates.update({
                "subtotal": float(calc_result.subtotal),
                "discount_total": float(calc_result.discount_total),
                "taxable_total": float(calc_result.taxable_total),
                "cgst_total": float(calc_result.cgst_total),
                "sgst_total": float(calc_result.sgst_total),
                "igst_total": float(calc_result.igst_total),
                "tax_total": float(calc_result.tax_total),
                "round_off": float(calc_result.round_off),
                "grand_total": float(calc_result.grand_total)
            })
            items_data = [item.to_dict() for item in calc_result.items]
            
        return self.invoice_repo.update(invoice_id, organization_id, header_updates, items_data)

    def verify_invoice_by_token(self, token: str, caller_company_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Resolves an opaque verification token into full, authoritative tax invoice verification metadata.
        Enforces tenant isolation: if caller belongs to another organization, cross-tenant access is blocked with 403.
        """
        invoice_id = extract_invoice_id_from_token(token)
        if not invoice_id or not is_valid_uuid(invoice_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid verification token format"
            )

        res = self.admin_db.table("invoices").select("*").eq("id", invoice_id).limit(1).execute()
        if not res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tax Invoice not found or expired"
            )

        invoice_raw = res.data[0]
        organization_id = invoice_raw.get("organization_id")

        if not verify_invoice_verification_token(token, organization_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or forged verification token"
            )

        # Enforce company/tenant isolation
        if caller_company_id and str(caller_company_id).strip():
            if str(caller_company_id).strip() != str(organization_id).strip():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cross-tenant invoice access is blocked"
                )

        full_inv = self.get_invoice(invoice_id, organization_id)
        company = full_inv.get("seller") or self.get_company_details(organization_id)
        customer = full_inv.get("customer") or {}

        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
        verification_url = f"{frontend_url}/verify/invoice/{token}"

        status_text = str(full_inv.get("payment_status") or full_inv.get("status") or "ISSUED").upper()

        return {
            "verified": True,
            "invoice_type": "TAX_INVOICE",
            "invoice_no": full_inv.get("invoice_no") or "",
            "id": invoice_id,
            "organization_id": organization_id,
            "company_name": full_inv.get("company_name") or company.get("name") or company.get("company_name") or "Twite Billing",
            "company_gstin": company.get("gstin") or "",
            "invoice_date": str(full_inv.get("invoice_date") or ""),
            "due_date": str(full_inv.get("due_date")) if full_inv.get("due_date") else None,
            "customer_name": full_inv.get("customer_name") or customer.get("display_name") or "Customer",
            "customer_ref": full_inv.get("customer_ref") or "",
            "currency_code": str(full_inv.get("currency_code") or "INR").upper(),
            "currency_symbol": full_inv.get("currency_symbol") or "₹",
            "grand_total": float(full_inv.get("grand_total") or full_inv.get("totals", {}).get("grand_total") or 0.0),
            "taxable_total": float(full_inv.get("taxable_total") or full_inv.get("totals", {}).get("taxable_total") or 0.0),
            "tax_total": float(full_inv.get("tax_total") or full_inv.get("totals", {}).get("tax_total") or 0.0),
            "advance_received": float(full_inv.get("advance_received") or full_inv.get("totals", {}).get("advance_received") or 0.0),
            "amount_paid": float(full_inv.get("amount_paid") or full_inv.get("totals", {}).get("amount_paid") or 0.0),
            "balance_due": float(full_inv.get("balance_due") or full_inv.get("totals", {}).get("balance_due") or 0.0),
            "status": status_text,
            "items_count": len(full_inv.get("items") or []),
            "items": full_inv.get("items") or [],
            "totals": full_inv.get("totals") or {},
            "seller": company,
            "customer": customer,
            "bank": full_inv.get("bank") or {},
            "qr_code_image": full_inv.get("qr_code_image"),
            "verification_url": verification_url,
            "verification_token": token,
            "is_cancelled": status_text == "CANCELLED",
            "verified_at": datetime.now(timezone.utc).isoformat()
        }

