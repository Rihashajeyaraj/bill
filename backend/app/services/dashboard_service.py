from datetime import date
from typing import Dict, Any, List
from app.core.supabase import get_admin_supabase_client

class DashboardService:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def get_dashboard_metrics(self, organization_id: str) -> Dict[str, Any]:
        today_str = str(date.today())

        # Query non-cancelled invoices
        invoices = self.db.table("invoices").select("id, invoice_no, invoice_date, due_date, grand_total, amount_paid, balance_due, status, party_id, created_at").eq("organization_id", organization_id).order("invoice_date", desc=True).execute().data or []

        # Query proformas
        proformas = self.db.table("proforma_invoices").select("id, proforma_no, proforma_date, grand_total, status, party_id, created_at").eq("organization_id", organization_id).order("proforma_date", desc=True).execute().data or []

        # Query payments (direction 'in')
        payments = self.db.table("payments").select("id, payment_no, payment_date, amount, direction, payment_mode, reference_no, party_id, created_at").eq("organization_id", organization_id).eq("direction", "in").order("payment_date", desc=True).execute().data or []

        total_invoiced = 0.0
        total_received = 0.0
        total_outstanding = 0.0
        total_overdue_amount = 0.0
        overdue_count = 0

        unpaid_count = 0
        partially_paid_count = 0
        paid_count = 0

        monthly_map: Dict[str, Dict[str, float]] = {}

        for inv in invoices:
            st = str(inv.get("status") or "").lower()
            if st == "cancelled":
                continue

            gt = float(inv.get("grand_total") or 0.0)
            pd = float(inv.get("amount_paid") or 0.0)
            bal = float(inv.get("balance_due") if inv.get("balance_due") is not None else max(0.0, gt - pd))

            total_invoiced += gt
            total_received += pd
            total_outstanding += bal

            due_dt = str(inv.get("due_date") or inv.get("invoice_date") or today_str)
            if due_dt < today_str and bal > 0.001:
                total_overdue_amount += bal
                overdue_count += 1

            if bal <= 0.001 and gt > 0.0:
                paid_count += 1
            elif pd > 0.0:
                partially_paid_count += 1
            else:
                unpaid_count += 1

            inv_date = str(inv.get("invoice_date") or today_str)[:7] # YYYY-MM
            if inv_date not in monthly_map:
                monthly_map[inv_date] = {"invoiced": 0.0, "received": 0.0}
            monthly_map[inv_date]["invoiced"] += gt
            monthly_map[inv_date]["received"] += pd

        total_payments_received = sum(float(p.get("amount") or 0.0) for p in payments)

        # Batch resolve customer display names
        parties = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute().data or []
        party_name_map = {p["id"]: p["display_name"] for p in parties}

        recent_invoices = invoices[:5]
        for inv in recent_invoices:
            inv["customer_name"] = party_name_map.get(inv.get("party_id"), "Customer")

        recent_proformas = proformas[:5]
        for pf in recent_proformas:
            pf["customer_name"] = party_name_map.get(pf.get("party_id"), "Customer")

        recent_payments = payments[:5]
        for pmt in recent_payments:
            pmt["customer_name"] = party_name_map.get(pmt.get("party_id"), "Customer")

        monthly_chart = [
            {"month": m, "invoiced": monthly_map[m]["invoiced"], "received": monthly_map[m]["received"]}
            for m in sorted(monthly_map.keys())
        ]

        return {
            "total_sales": float(total_invoiced),
            "total_invoiced": float(total_invoiced),
            "total_received": float(total_received),
            "total_payments_received": float(total_payments_received),
            "total_outstanding": float(total_outstanding),
            "total_overdue_amount": float(total_overdue_amount),
            "overdue_count": overdue_count,
            "invoice_count": len(invoices),
            "proforma_count": len(proformas),
            "payment_count": len(payments),
            "unpaid_count": unpaid_count,
            "partially_paid_count": partially_paid_count,
            "paid_count": paid_count,
            "recent_invoices": recent_invoices,
            "recent_proformas": recent_proformas,
            "recent_payments": recent_payments,
            "monthly_chart": monthly_chart
        }
