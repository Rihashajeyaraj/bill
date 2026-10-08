from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals
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
        customer_state = data.place_of_supply_state or self.get_customer_state(data.party_id, organization_id)
        
        raw_items = [item.model_dump() for item in data.items]
        calc_result = calculate_document_totals(raw_items, company_state, customer_state, amount_paid=data.amount_paid)
        
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
            "party_id": data.party_id,
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
            "amount_paid": float(calc_result.amount_paid),
            "status": status_val,
            "notes": data.notes,
            "terms": data.terms,
            "created_by": user_id
        }
        
        items_data = [item.to_dict() for item in calc_result.items]
        return self.invoice_repo.create(header_data, items_data)

    def get_invoices(self, organization_id: str) -> List[Dict[str, Any]]:
        return self.invoice_repo.get_all(organization_id)

    def get_invoice(self, invoice_id: str, organization_id: str) -> Dict[str, Any]:
        inv = self.invoice_repo.get_by_id(invoice_id, organization_id)
        if not inv:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tax Invoice not found")
        return inv

    def update_invoice(self, invoice_id: str, organization_id: str, data: InvoiceUpdate) -> Dict[str, Any]:
        existing = self.get_invoice(invoice_id, organization_id)
        header_updates = data.model_dump(exclude_unset=True, exclude={"items"})
        items_data = None
        
        if data.items is not None:
            company_state = self.get_company_state(organization_id)
            customer_state = data.place_of_supply_state or existing.get("place_of_supply_state") or self.get_customer_state(existing.get("party_id"), organization_id)
            raw_items = [item.model_dump() for item in data.items]
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
