from typing import Dict, Any, List
from app.core.supabase import get_admin_supabase_client

class DashboardService:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def get_dashboard_metrics(self, organization_id: str) -> Dict[str, Any]:
        # Query invoices
        invoices = self.db.table("invoices").select("id, invoice_no, grand_total, amount_paid, status, invoice_date").eq("organization_id", organization_id).execute().data or []
        
        # Query proformas
        proformas = self.db.table("proforma_invoices").select("id, status").eq("organization_id", organization_id).execute().data or []
        
        # Query payments
        payments = self.db.table("payments").select("id, amount, amount_received, direction, payment_date").eq("organization_id", organization_id).eq("direction", "in").execute().data or []
        
        total_sales = sum(float(inv.get("grand_total", 0)) for inv in invoices)
        total_paid = sum(float(inv.get("amount_paid", 0)) for inv in invoices)
        total_outstanding = sum(float(inv.get("grand_total", 0)) - float(inv.get("amount_paid", 0)) for inv in invoices)
        
        invoice_count = len(invoices)
        proforma_count = len(proformas)
        payment_count = len(payments)
        total_payments_received = sum(float(p.get("amount_received") or p.get("amount") or 0) for p in payments)
        
        unpaid_count = sum(1 for inv in invoices if float(inv.get("amount_paid", 0)) == 0)
        partially_paid_count = sum(1 for inv in invoices if 0 < float(inv.get("amount_paid", 0)) < float(inv.get("grand_total", 0)))
        paid_count = sum(1 for inv in invoices if float(inv.get("amount_paid", 0)) >= float(inv.get("grand_total", 0)) and float(inv.get("grand_total", 0)) > 0)
        
        # Recent 5 invoices
        recent_invoices = self.db.table("invoices").select("id, invoice_no, invoice_date, grand_total, status, party_id").eq("organization_id", organization_id).order("created_at", desc=True).limit(5).execute().data or []
        
        for inv in recent_invoices:
            if inv.get("party_id"):
                p_res = self.db.table("parties").select("display_name").eq("id", inv["party_id"]).limit(1).execute()
                if p_res.data:
                    inv["party_name"] = p_res.data[0]["display_name"]

        return {
            "total_sales": float(total_sales),
            "invoice_count": invoice_count,
            "proforma_count": proforma_count,
            "payment_count": payment_count,
            "total_payments_received": float(total_payments_received),
            "total_outstanding": float(total_outstanding),
            "unpaid_count": unpaid_count,
            "partially_paid_count": partially_paid_count,
            "paid_count": paid_count,
            "recent_invoices": recent_invoices
        }
