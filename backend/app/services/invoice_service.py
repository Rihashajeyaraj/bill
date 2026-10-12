from decimal import Decimal
from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals, validate_advance_amount, to_decimal
from app.schemas.invoice import InvoiceCreate, InvoiceUpdate

class InvoiceService:
    def __init__(self):
        self.invoice_repo = InvoiceRepository()
        self.party_repo = PartyRepository()
        self.db = get_admin_supabase_client()

    def get_company_state(self, organization_id: str) -> str:
        res = self.db.table("organizations").select("state_name").eq("id", organization_id).limit(1).execute()
        if res.data:
            return res.data[0].get("state_name") or ""
        return ""

    def get_customer_state(self, party_id: Optional[str], organization_id: str) -> str:
        if not party_id:
            return ""
        party = self.party_repo.get_by_id(party_id, organization_id)
        if party:
            return party.get("state_name") or party.get("state_code") or ""
        return ""

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
        return inv

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
