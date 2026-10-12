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

logger = logging.getLogger(__name__)

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
        bill_gstin = inv.get("bill_gstin") or inv.get("customer_gstin") or customer.get("gstin") or ""
        bill_phone = inv.get("bill_phone") or inv.get("customer_phone") or customer.get("phone") or ""
        bill_email = inv.get("bill_email") or inv.get("customer_email") or customer.get("email") or ""

        inv["bill_name"] = bill_name
        inv["bill_address_line1"] = bill_address
        inv["bill_city"] = bill_city
        inv["bill_state"] = bill_state
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
            inv["ship_gstin"] = bill_gstin
            inv["ship_phone"] = bill_phone

        inv["company"] = company
        inv["customer"] = customer

        # Bank details
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
        else:
            selected_bank = {
                "bank_name": company.get("bank_name") or "",
                "branch": company.get("bank_branch") or "",
                "account_name": company.get("account_name") or company.get("name") or company.get("legal_name") or "",
                "account_no": company.get("account_number") or "",
                "ifsc": company.get("ifsc_code") or "",
                "upi_id": company.get("upi_id") or ""
            }
        inv["bank"] = selected_bank

        # HSN Summary
        inv["hsn_summary"] = self._build_hsn_summary(inv.get("items", []))

        # Currency and Grand total in words
        curr_code = str(inv.get("currency_code") or "INR").upper()
        inv["currency_code"] = curr_code
        inv["currency_symbol"] = "₹" if curr_code == "INR" else "$"
        prefix = None if curr_code == "INR" else f"{curr_code} DOLLARS"
        gt = float(inv.get("grand_total") or 0.0)
        inv["grand_total_in_words"] = number_to_words_indian(gt, currency_prefix=prefix)

        adv = float(inv.get("advance_received") or inv.get("amount_paid") or 0.0)
        bal = max(0.0, gt - adv)
        inv["amount_paid"] = adv
        inv["advance_received"] = adv
        inv["balance_due"] = bal
        inv["totals"] = {
            "subTotal": float(inv.get("subtotal") or 0.0),
            "taxable_total": float(inv.get("taxable_total") or 0.0),
            "cgst_total": float(inv.get("cgst_total") or 0.0),
            "sgst_total": float(inv.get("sgst_total") or 0.0),
            "igst_total": float(inv.get("igst_total") or 0.0),
            "tax_total": float(inv.get("tax_total") or 0.0),
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
        inv["lines"] = inv.get("items", [])
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
