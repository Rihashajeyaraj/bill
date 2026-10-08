from typing import Dict, Any, List, Optional
from datetime import date
from app.core.supabase import get_admin_supabase_client

class ReportService:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def get_sales_report(self, organization_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        query = self.db.table("invoices").select("*").eq("organization_id", organization_id)
        if start_date:
            query = query.gte("invoice_date", start_date)
        if end_date:
            query = query.lte("invoice_date", end_date)
            
        invoices = query.order("invoice_date", desc=True).execute().data or []
        
        total_sales = sum(float(inv.get("grand_total", 0)) for inv in invoices)
        total_taxable = sum(float(inv.get("taxable_total", 0)) for inv in invoices)
        total_cgst = sum(float(inv.get("cgst_total", 0)) for inv in invoices)
        total_sgst = sum(float(inv.get("sgst_total", 0)) for inv in invoices)
        total_igst = sum(float(inv.get("igst_total", 0)) for inv in invoices)
        total_tax = sum(float(inv.get("tax_total", 0)) for inv in invoices)
        total_discount = sum(float(inv.get("discount_total", 0)) for inv in invoices)
        
        for inv in invoices:
            if inv.get("party_id"):
                p_res = self.db.table("parties").select("display_name").eq("id", inv["party_id"]).limit(1).execute()
                if p_res.data:
                    inv["party_name"] = p_res.data[0]["display_name"]

        return {
            "report_type": "sales",
            "start_date": start_date,
            "end_date": end_date,
            "summary": {
                "total_sales": total_sales,
                "total_taxable": total_taxable,
                "total_cgst": total_cgst,
                "total_sgst": total_sgst,
                "total_igst": total_igst,
                "total_tax": total_tax,
                "total_discount": total_discount,
                "invoice_count": len(invoices)
            },
            "data": invoices
        }

    def get_proforma_report(self, organization_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        query = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
        if start_date:
            query = query.gte("proforma_date", start_date)
        if end_date:
            query = query.lte("proforma_date", end_date)
            
        proformas = query.order("proforma_date", desc=True).execute().data or []
        
        total_amount = sum(float(p.get("grand_total", 0)) for p in proformas)
        converted_count = sum(1 for p in proformas if p.get("status") == "CONVERTED")
        
        for p in proformas:
            if p.get("party_id"):
                p_res = self.db.table("parties").select("display_name").eq("id", p["party_id"]).limit(1).execute()
                if p_res.data:
                    p["party_name"] = p_res.data[0]["display_name"]

        return {
            "report_type": "proforma",
            "start_date": start_date,
            "end_date": end_date,
            "summary": {
                "total_amount": total_amount,
                "proforma_count": len(proformas),
                "converted_count": converted_count
            },
            "data": proformas
        }

    def get_payments_report(self, organization_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        query = self.db.table("payments").select("*").eq("organization_id", organization_id).eq("direction", "in")
        if start_date:
            query = query.gte("payment_date", start_date)
        if end_date:
            query = query.lte("payment_date", end_date)
            
        payments = query.order("payment_date", desc=True).execute().data or []
        
        total_received = sum(float(p.get("amount_received") or p.get("amount") or 0) for p in payments)
        total_tds = sum(float(p.get("tds_amount", 0)) for p in payments)
        
        for p in payments:
            if p.get("party_id"):
                p_res = self.db.table("parties").select("display_name").eq("id", p["party_id"]).limit(1).execute()
                if p_res.data:
                    p["party_name"] = p_res.data[0]["display_name"]

        return {
            "report_type": "payments",
            "start_date": start_date,
            "end_date": end_date,
            "summary": {
                "total_received": total_received,
                "total_tds": total_tds,
                "payment_count": len(payments)
            },
            "data": payments
        }

    def get_receivables_report(self, organization_id: str) -> Dict[str, Any]:
        invoices = self.db.table("invoices").select("*").eq("organization_id", organization_id).execute().data or []
        parties = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute().data or []
        
        party_map = {p["id"]: p["display_name"] for p in parties}
        receivables_by_party = {}
        
        for inv in invoices:
            pid = inv.get("party_id") or "unassigned"
            pname = party_map.get(pid, "Unassigned Customer")
            
            if pid not in receivables_by_party:
                receivables_by_party[pid] = {
                    "party_id": pid,
                    "party_name": pname,
                    "total_invoiced": 0.0,
                    "total_paid": 0.0,
                    "outstanding_balance": 0.0,
                    "invoice_count": 0
                }
                
            gt = float(inv.get("grand_total", 0))
            pd = float(inv.get("amount_paid", 0))
            
            receivables_by_party[pid]["total_invoiced"] += gt
            receivables_by_party[pid]["total_paid"] += pd
            receivables_by_party[pid]["outstanding_balance"] += (gt - pd)
            receivables_by_party[pid]["invoice_count"] += 1
            
        data = list(receivables_by_party.values())
        total_outstanding = sum(item["outstanding_balance"] for item in data)
        
        return {
            "report_type": "receivables",
            "summary": {
                "total_outstanding": total_outstanding,
                "customer_count": len(data)
            },
            "data": data
        }
