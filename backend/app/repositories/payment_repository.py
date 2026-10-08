from typing import List, Optional, Dict, Any
from app.core.supabase import get_admin_supabase_client

class PaymentRepository:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def generate_payment_no(self, organization_id: str) -> str:
        count = len(self.db.table("payments").select("id", count="exact").eq("organization_id", organization_id).execute().data or [])
        next_no = count + 1
        return f"RCPT-{next_no:04d}"

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        payments = self.db.table("payments").select("*").eq("organization_id", organization_id).eq("direction", "in").order("payment_date", desc=True).execute().data or []
        for p in payments:
            if p.get("party_id"):
                party_res = self.db.table("parties").select("display_name").eq("id", p["party_id"]).limit(1).execute()
                if party_res.data:
                    p["party_name"] = party_res.data[0]["display_name"]
        return payments

    def get_by_id(self, payment_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        res = self.db.table("payments").select("*").eq("id", payment_id).eq("organization_id", organization_id).limit(1).execute()
        if not res.data:
            return None
        payment = res.data[0]
        if payment.get("party_id"):
            party_res = self.db.table("parties").select("display_name").eq("id", payment["party_id"]).limit(1).execute()
            if party_res.data:
                payment["party_name"] = party_res.data[0]["display_name"]
        return payment

    def create_payment(
        self,
        organization_id: str,
        payment_no: str,
        payment_date: str,
        party_id: str,
        amount: float,
        amount_received: float,
        tds_amount: float,
        tds_rate: float,
        payment_mode: str,
        reference_no: Optional[str],
        notes: Optional[str],
        user_id: str,
        allocations: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        payment_data = {
            "organization_id": organization_id,
            "payment_no": payment_no,
            "payment_date": str(payment_date),
            "direction": "in",
            "party_id": party_id,
            "amount": amount,
            "amount_received": amount_received or amount,
            "tds_amount": tds_amount,
            "tds_rate": tds_rate,
            "payment_mode": payment_mode,
            "reference_no": reference_no,
            "notes": notes,
            "status": "posted",
            "created_by": user_id
        }
        res = self.db.table("payments").insert(payment_data).execute()
        payment = res.data[0]
        
        # Apply allocations to invoices
        for alloc in allocations:
            inv_id = alloc.get("invoice_id")
            alloc_amt = float(alloc.get("amount_allocated", 0))
            if inv_id and alloc_amt > 0:
                inv_res = self.db.table("invoices").select("grand_total, amount_paid").eq("id", inv_id).eq("organization_id", organization_id).limit(1).execute()
                if inv_res.data:
                    inv = inv_res.data[0]
                    grand_total = float(inv.get("grand_total", 0))
                    curr_paid = float(inv.get("amount_paid", 0))
                    new_paid = curr_paid + alloc_amt
                    
                    if new_paid >= grand_total:
                        new_status = "paid"
                    elif new_paid > 0:
                        new_status = "partial"
                    else:
                        new_status = "issued"
                        
                    self.db.table("invoices").update({
                        "amount_paid": new_paid,
                        "status": new_status
                    }).eq("id", inv_id).execute()
                    
        return self.get_by_id(payment["id"], organization_id)
