import logging
import json
from typing import List, Optional, Dict, Any
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from fastapi import HTTPException
from app.core.supabase import get_admin_supabase_client, get_supabase_client
from app.core.auth import is_valid_uuid

logger = logging.getLogger(__name__)

def get_kolkata_today() -> date:
    kolkata_tz = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(kolkata_tz).date()

KNOWN_PAYMENT_COLUMNS = {
    "id", "organization_id", "payment_no", "payment_date",
    "direction", "party_id", "invoice_id", "amount",
    "payment_mode", "reference_no", "notes", "created_by",
    "is_advance", "amount_received", "tds_amount", "tds_rate", "status"
}

import time
from typing import Tuple

_pmt_parties_cache: Dict[str, Tuple[Dict[str, Dict[str, Any]], float]] = {}
_pmt_doc_no_cache: Dict[str, Tuple[Dict[str, str], float]] = {}

def invalidate_payment_repo_cache(organization_id: Optional[str] = None):
    if organization_id:
        _pmt_parties_cache.pop(str(organization_id), None)
        _pmt_doc_no_cache.pop(str(organization_id), None)
    else:
        _pmt_parties_cache.clear()
        _pmt_doc_no_cache.clear()

class PaymentRepository:
    def __init__(self, token: Optional[str] = None):
        self.db = get_supabase_client(token) if token and token != "dev-token" else get_admin_supabase_client()
        self.admin_db = get_admin_supabase_client()

    def generate_payment_no(self, organization_id: str) -> str:
        try:
            res = self.admin_db.table("document_counters").select("current_number, prefix").eq("organization_id", organization_id).eq("document_type", "payment").limit(1).execute()
            if res.data and len(res.data) > 0:
                cur_num = res.data[0].get("current_number", 0) + 1
                prefix = res.data[0].get("prefix", "RCPT-")
                self.admin_db.table("document_counters").update({"current_number": cur_num}).eq("organization_id", organization_id).eq("document_type", "payment").execute()
                return f"{prefix}{cur_num:04d}"
            else:
                cnt_res = self.admin_db.table("payments").select("id").eq("organization_id", organization_id).execute()
                count = len(cnt_res.data or []) + 1
                prefix = "RCPT-"
                try:
                    self.admin_db.table("document_counters").insert({
                        "organization_id": organization_id,
                        "document_type": "payment",
                        "current_number": count,
                        "prefix": prefix
                    }).execute()
                except Exception:
                    pass
                return f"{prefix}{count:04d}"
        except Exception:
            cnt_res = self.admin_db.table("payments").select("id").eq("organization_id", organization_id).execute()
            count = len(cnt_res.data or []) + 1
            return f"RCPT-{count:04d}"


    def get_tenant_bank_details(self, organization_id: str) -> Dict[str, Any]:
        try:
            res = self.admin_db.table("organizations").select("settings").eq("id", organization_id).limit(1).execute()
            if res.data and res.data[0].get("settings"):
                settings = res.data[0]["settings"]
                if isinstance(settings, dict) and settings.get("bankDetails"):
                    return settings["bankDetails"]
        except Exception:
            pass
        return {}

    def _get_parties_map(self, organization_id: str) -> Dict[str, Dict[str, Any]]:
        now = time.time()
        org_key = str(organization_id)
        if org_key in _pmt_parties_cache:
            cached_data, ts = _pmt_parties_cache[org_key]
            if (now - ts) < 30.0:
                return cached_data

        parties_map = {}
        try:
            res = self.admin_db.table("parties").select("id, display_name, gstin, phone").eq("organization_id", organization_id).execute()
            for p in (res.data or []):
                parties_map[p["id"]] = {
                    "display_name": p.get("display_name") or "Customer",
                    "gstin": p.get("gstin") or "",
                    "phone": p.get("phone") or ""
                }
            _pmt_parties_cache[org_key] = (parties_map, now)
        except Exception:
            pass
        return parties_map

    def _get_doc_no_map(self, organization_id: str) -> Dict[str, str]:
        now = time.time()
        org_key = str(organization_id)
        if org_key in _pmt_doc_no_cache:
            cached_data, ts = _pmt_doc_no_cache[org_key]
            if (now - ts) < 30.0:
                return cached_data

        doc_no_map = {}
        try:
            inv_res = self.admin_db.table("invoices").select("id, invoice_no").eq("organization_id", organization_id).execute()
            for r in (inv_res.data or []):
                doc_no_map[r["id"]] = r["invoice_no"]
            pf_res = self.admin_db.table("proforma_invoices").select("id, proforma_no").eq("organization_id", organization_id).execute()
            for r in (pf_res.data or []):
                doc_no_map[r["id"]] = r["proforma_no"]
            _pmt_doc_no_cache[org_key] = (doc_no_map, now)
        except Exception:
            pass
        return doc_no_map

    def get_all(self, organization_id: str) -> List[Dict[str, Any]]:
        try:
            payments = self.admin_db.table("payments").select("*").eq("organization_id", organization_id).eq("direction", "in").order("payment_date", desc=True).execute().data or []
        except Exception:
            payments = []
        parties = self._get_parties_map(organization_id)
        for p in payments:
            pid = p.get("party_id")
            if pid and pid in parties:
                p["party_name"] = parties[pid]["display_name"]
                p["customer_name"] = parties[pid]["display_name"]
                p["customer_gstin"] = parties[pid]["gstin"]
        return payments

    def get_by_id(self, payment_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        try:
            res = self.admin_db.table("payments").select("*").eq("id", payment_id).eq("organization_id", organization_id).limit(1).execute()
        except Exception:
            return None
        if not res.data:
            return None
        payment = res.data[0]
        parties = self._get_parties_map(organization_id)
        pid = payment.get("party_id")
        if pid and pid in parties:
            payment["party_name"] = parties[pid]["display_name"]
            payment["customer_name"] = parties[pid]["display_name"]
            payment["customer_gstin"] = parties[pid]["gstin"]

        # Allocations
        allocations = []
        try:
            a_res = self.admin_db.table("payment_allocations").select("*").eq("payment_id", payment_id).execute()
            allocations = a_res.data or []
        except Exception:
            pass
        payment["allocations"] = allocations

        # Audit logs
        audit_history = []
        try:
            aud_res = self.admin_db.table("audit_logs").select("*").eq("organization_id", organization_id).eq("entity_id", payment_id).order("created_at", desc=True).execute()
            audit_history = aud_res.data or []
        except Exception:
            pass
        payment["audit_history"] = audit_history

        return payment

    def get_filtered_payments(
        self,
        organization_id: str,
        q: Optional[str] = None,
        customer_id: Optional[str] = None,
        mode: Optional[str] = None,
        status: Optional[str] = None,
        doc_type: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        page: int = 1,
        page_size: int = 25,
        sort: str = "payment_date",
        sort_dir: str = "desc"
    ) -> Dict[str, Any]:
        all_payments = self.get_all(organization_id)
        parties_map = self._get_parties_map(organization_id)

        # Pre-fetch allocations for document references & totals
        alloc_by_pmt = {}
        try:
            a_res = self.admin_db.table("payment_allocations").select("*").eq("organization_id", organization_id).execute()
            for a in (a_res.data or []):
                pmt_id = a.get("payment_id")
                if pmt_id:
                    alloc_by_pmt.setdefault(pmt_id, []).append(a)
        except Exception:
            pass

        # Document number lookup cache (cached with 30s TTL)
        doc_no_map = self._get_doc_no_map(organization_id)

        filtered = []
        clean_cust_id = customer_id.strip() if customer_id and customer_id.strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        clean_q = q.strip().lower() if q and q.strip() else None
        clean_mode = mode.strip().upper().replace(" ", "_") if mode and mode.strip().lower() != "all" else None
        clean_status = status.strip().lower() if status and status.strip().lower() != "all" else None

        for p in all_payments:
            pmt_id = p["id"]
            allocs = alloc_by_pmt.get(pmt_id, [])
            p["allocations"] = allocs

            # Derived customer info
            pid = p.get("party_id")
            cust_info = parties_map.get(pid, {})
            p_cust_name = p.get("customer_name") or cust_info.get("display_name") or p.get("party_name") or "Walk-in / Unlinked"
            p["customer_name"] = p_cust_name
            p["customer_gstin"] = cust_info.get("gstin") or ""

            # Documents applied to
            doc_nos = []
            for a in allocs:
                did = a.get("document_id") or a.get("invoice_id")
                if did and did in doc_no_map:
                    doc_nos.append(doc_no_map[did])
                elif a.get("document_no"):
                    doc_nos.append(a["document_no"])
            if not doc_nos and p.get("invoice_id") and p["invoice_id"] in doc_no_map:
                doc_nos.append(doc_no_map[p["invoice_id"]])
            p["applied_to_documents"] = doc_nos

            # Amounts
            amt_received = float(p.get("amount_received") or p.get("amount") or 0.0)
            tds_amt = float(p.get("tds_amount") or 0.0)
            applied_amt = sum(float(a.get("amount_allocated") or a.get("amount") or 0.0) for a in allocs)
            unapplied_amt = max(0.0, amt_received - applied_amt)

            p["amount_received"] = amt_received
            p["tds_amount"] = tds_amt
            p["applied_amount"] = applied_amt
            p["unapplied_amount"] = unapplied_amt

            # Status resolution
            raw_st = str(p.get("status") or "posted").lower()
            if raw_st in ("reversed", "cancelled"):
                st_label = "Reversed"
            elif unapplied_amt <= 0.01 and amt_received > 0:
                st_label = "Fully Applied"
            elif applied_amt > 0.01:
                st_label = "Partially Applied"
            else:
                st_label = "Received"
            p["status"] = st_label

            # Filters
            p_date = str(p.get("payment_date") or "")
            if from_date and p_date and p_date < from_date:
                continue
            if to_date and p_date and p_date > to_date:
                continue
            if clean_cust_id and pid != clean_cust_id:
                continue
            if clean_mode:
                pm_norm = str(p.get("payment_mode") or "").upper().replace(" ", "_")
                if pm_norm != clean_mode and not (clean_mode == "BANK_TRANSFER" and pm_norm in ("BANK", "NEFT", "RTGS", "IMPS", "BANK_TRANSFER")):
                    continue
            if clean_status:
                if clean_status == "received" and st_label != "Received":
                    continue
                if clean_status == "partially_applied" and st_label != "Partially Applied":
                    continue
                if clean_status == "fully_applied" and st_label != "Fully Applied":
                    continue
                if clean_status in ("reversed", "cancelled") and st_label != "Reversed":
                    continue

            if clean_q:
                haystack = f"{p.get('payment_no')} {p_cust_name} {p.get('reference_no')} {' '.join(doc_nos)}".lower()
                if clean_q not in haystack:
                    continue

            filtered.append(p)

        # Totals over filtered result set
        t_rec = sum(p["amount_received"] for p in filtered if p["status"] != "Reversed")
        t_tds = sum(p["tds_amount"] for p in filtered if p["status"] != "Reversed")
        t_app = sum(p["applied_amount"] for p in filtered if p["status"] != "Reversed")
        t_unapp = sum(p["unapplied_amount"] for p in filtered if p["status"] != "Reversed")

        # Sorting
        reverse_dir = (sort_dir.lower() == "desc")
        if sort == "customer":
            filtered.sort(key=lambda x: str(x.get("customer_name") or "").lower(), reverse=reverse_dir)
        elif sort in ("amount", "received"):
            filtered.sort(key=lambda x: x.get("amount_received", 0.0), reverse=reverse_dir)
        else: # date
            filtered.sort(key=lambda x: str(x.get("payment_date") or ""), reverse=reverse_dir)

        total_count = len(filtered)
        start_idx = (page - 1) * page_size
        paged_items = filtered[start_idx : start_idx + page_size]

        return {
            "items": paged_items,
            "total": total_count,
            "totals": {
                "received": round(t_rec, 2),
                "tds": round(t_tds, 2),
                "applied": round(t_app, 2),
                "unapplied": round(t_unapp, 2)
            }
        }

    def get_summary(self, organization_id: str, customer_id: Optional[str] = None, from_date: Optional[str] = None, to_date: Optional[str] = None) -> Dict[str, Any]:
        all_pmts = self.get_filtered_payments(organization_id, customer_id=customer_id, from_date=from_date, to_date=to_date, page_size=10000)
        items = all_pmts["items"]

        non_reversed = [p for p in items if p["status"] != "Reversed"]
        total_receipts = len(non_reversed)
        amount_received = sum(p["amount_received"] for p in non_reversed)
        unapplied_balance = sum(p["unapplied_amount"] for p in non_reversed)

        # Pending receivables across open tax invoices + proformas
        pending_docs = self.get_pending_documents(customer_id=customer_id, organization_id=organization_id, from_date=from_date, to_date=to_date)
        pending_receivable = sum(d["balance_due"] for d in pending_docs)

        # Compute current month delta
        today_str = date.today().isoformat()
        month_start = today_str[:7] + "-01"
        month_pmts = [p for p in non_reversed if str(p.get("payment_date") or "") >= month_start]
        month_cnt = len(month_pmts)
        month_amt = sum(p["amount_received"] for p in month_pmts)

        return {
            "total_receipts": total_receipts,
            "amount_received": round(amount_received, 2),
            "pending_receivable": round(pending_receivable, 2),
            "unapplied_balance": round(unapplied_balance, 2),
            "delta": {
                "total_receipts": f"+{month_cnt} this month" if month_cnt > 0 else "0 this month",
                "amount_received": f"+₹{month_amt:,.2f} this month" if month_amt > 0 else "₹0.00 this month",
                "pending_receivable": f"{len(pending_docs)} open documents",
                "unapplied_balance": "Available for allocation"
            }
        }

    def get_pending_documents(
        self,
        customer_id: Optional[str] = None,
        organization_id: str = "",
        doc_type: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        q: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        pending: List[Dict[str, Any]] = []
        bank_details = self.get_tenant_bank_details(organization_id)
        parties_map = self._get_parties_map(organization_id)

        clean_cid = customer_id.strip() if customer_id and customer_id.strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        clean_q = q.strip().lower() if q and q.strip() else None
        today_iso = date.today().isoformat()

        try:
            try:
                inv_query = self.admin_db.table("invoices").select("*").eq("organization_id", organization_id)
                if clean_cid:
                    inv_query = inv_query.or_(f"party_id.eq.{clean_cid},customer_id.eq.{clean_cid}")
                invoices = inv_query.execute().data or []
            except Exception:
                inv_query = self.admin_db.table("invoices").select("*").eq("organization_id", organization_id)
                if clean_cid:
                    inv_query = inv_query.eq("party_id", clean_cid)
                invoices = inv_query.execute().data or []
        except Exception:
            invoices = []

        for inv in invoices:
            status = str(inv.get("status") or "unpaid").lower()
            if status in ("paid", "cancelled"):
                continue

            grand_total = float(inv.get("grand_total") or 0.0)
            paid_amount = float(inv.get("amount_paid") or (inv.get("metadata") or {}).get("amount_paid") or 0.0)

            try:
                alloc_res = self.admin_db.table("payment_allocations").select("amount, amount_allocated").eq("organization_id", organization_id).eq("document_id", inv["id"]).execute()
                if alloc_res.data:
                    alloc_sum = sum(float(a.get("amount") or a.get("amount_allocated") or 0.0) for a in alloc_res.data)
                    paid_amount = max(paid_amount, alloc_sum)
            except Exception:
                pass

            balance_due = max(0.0, grand_total - paid_amount)
            if balance_due > 0.01:
                inv_date = str(inv.get("invoice_date") or "")
                due_date = str(inv.get("due_date") or "") if inv.get("due_date") else None
                
                overdue_days = 0
                is_overdue = False
                if due_date and due_date < today_iso:
                    is_overdue = True
                    try:
                        d_due = date.fromisoformat(due_date)
                        d_today = date.today()
                        overdue_days = (d_today - d_due).days
                    except Exception:
                        overdue_days = 1

                pid = inv.get("customer_id") or inv.get("party_id")
                cust_name = (parties_map.get(pid, {}).get("display_name") or inv.get("bill_name") or inv.get("customer_name") or "Walk-in / Unlinked")

                if from_date and inv_date and inv_date < from_date:
                    continue
                if to_date and inv_date and inv_date > to_date:
                    continue
                if clean_q:
                    haystack = f"{inv.get('invoice_no')} {cust_name}".lower()
                    if clean_q not in haystack:
                        continue

                pending.append({
                    "document_type": "invoice",
                    "document_id": str(inv["id"]),
                    "document_no": str(inv.get("invoice_no") or ""),
                    "document_date": inv_date,
                    "due_date": due_date,
                    "customer_id": pid,
                    "customer_name": cust_name,
                    "grand_total": grand_total,
                    "paid_amount": paid_amount,
                    "balance_due": round(balance_due, 2),
                    "overdue_days": overdue_days,
                    "is_overdue": is_overdue,
                    "place_of_supply": str(inv.get("place_of_supply_state") or ""),
                    "bank_details": inv.get("bank_details") or bank_details,
                    "taxable_value": float(inv.get("taxable_total") or 0.0),
                    "cgst_amount": float(inv.get("cgst_total") or 0.0),
                    "sgst_amount": float(inv.get("sgst_total") or 0.0),
                    "igst_amount": float(inv.get("igst_total") or 0.0),
                    "vat_amount": float(inv.get("vat_total") or 0.0),
                    "items": []
                })

        # 2. Unconverted Proforma Invoices
        try:
            pf_query = self.admin_db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
            if clean_cid:
                pf_query = pf_query.or_(f"party_id.eq.{clean_cid},customer_id.eq.{clean_cid}")
            proformas = pf_query.execute().data or []
        except Exception:
            proformas = []

        for pf in proformas:
            status = str(pf.get("status") or "DRAFT").lower()
            converted_id = pf.get("converted_document_id")
            if status in ("converted", "cancelled") or converted_id:
                continue

            grand_total = float(pf.get("grand_total") or 0.0)
            meta = pf.get("metadata") or {}
            paid_amount = float(pf.get("amount_paid") or pf.get("advance_paid") or meta.get("amount_paid") or 0.0)

            try:
                alloc_res = self.admin_db.table("payment_allocations").select("amount, amount_allocated").eq("organization_id", organization_id).eq("document_id", pf["id"]).execute()
                if alloc_res.data:
                    alloc_sum = sum(float(a.get("amount") or a.get("amount_allocated") or 0.0) for a in alloc_res.data)
                    paid_amount = max(paid_amount, alloc_sum)
            except Exception:
                pass

            balance_due = max(0.0, grand_total - paid_amount)
            if balance_due > 0.01:
                pf_date = str(pf.get("proforma_date") or "")
                due_date = str(pf.get("due_date") or "") if pf.get("due_date") else None
                
                overdue_days = 0
                is_overdue = False
                if due_date and due_date < today_iso:
                    is_overdue = True
                    try:
                        d_due = date.fromisoformat(due_date)
                        d_today = date.today()
                        overdue_days = (d_today - d_due).days
                    except Exception:
                        overdue_days = 1

                pid = pf.get("customer_id") or pf.get("party_id")
                cust_name = (parties_map.get(pid, {}).get("display_name") or pf.get("bill_name") or pf.get("customer_name") or "Walk-in / Unlinked")

                if from_date and pf_date and pf_date < from_date:
                    continue
                if to_date and pf_date and pf_date > to_date:
                    continue
                if clean_q:
                    haystack = f"{pf.get('proforma_no')} {cust_name}".lower()
                    if clean_q not in haystack:
                        continue

                pending.append({
                    "document_type": "proforma",
                    "document_id": str(pf["id"]),
                    "document_no": str(pf.get("proforma_no") or ""),
                    "document_date": pf_date,
                    "due_date": due_date,
                    "customer_id": pid,
                    "customer_name": cust_name,
                    "grand_total": grand_total,
                    "paid_amount": paid_amount,
                    "balance_due": round(balance_due, 2),
                    "overdue_days": overdue_days,
                    "is_overdue": is_overdue,
                    "place_of_supply": str(pf.get("place_of_supply_state") or ""),
                    "bank_details": pf.get("bank_details") or bank_details,
                    "taxable_value": float(pf.get("taxable_total") or 0.0),
                    "cgst_amount": float(pf.get("cgst_total") or 0.0),
                    "sgst_amount": float(pf.get("sgst_total") or 0.0),
                    "igst_amount": float(pf.get("igst_total") or 0.0),
                    "vat_amount": float(pf.get("vat_total") or 0.0),
                    "items": []
                })

        # Filter by doc_type if specified
        if doc_type and doc_type.lower() != "all":
            clean_dt = doc_type.lower()
            if clean_dt == "overdue":
                pending = [d for d in pending if d["is_overdue"]]
            elif clean_dt in ("tax_invoice", "invoice"):
                pending = [d for d in pending if d["document_type"] == "invoice"]
            elif clean_dt in ("proforma", "advance"):
                pending = [d for d in pending if d["document_type"] == "proforma"]

        pending.sort(key=lambda x: x["document_date"] or "")
        return pending

    def get_tds_history(self, organization_id: str, customer_id: Optional[str] = None, from_date: Optional[str] = None, to_date: Optional[str] = None, q: Optional[str] = None) -> List[Dict[str, Any]]:
        all_pmts = self.get_filtered_payments(organization_id, q=q, customer_id=customer_id, from_date=from_date, to_date=to_date, page_size=10000)["items"]
        tds_items = []
        for p in all_pmts:
            if p.get("tds_amount", 0) > 0 and p.get("status") != "Reversed":
                doc_no = p.get("applied_to_documents", ["-"])[0] if p.get("applied_to_documents") else "-"
                tds_items.append({
                    "id": p["id"],
                    "payment_id": p["id"],
                    "payment_date": str(p.get("payment_date") or ""),
                    "receipt_no": str(p.get("payment_no") or ""),
                    "invoice_no": doc_no,
                    "customer_id": p.get("party_id"),
                    "customer_name": p.get("customer_name") or "Customer",
                    "tds_rate": float(p.get("tds_rate") or 0.0),
                    "tds_amount": float(p.get("tds_amount") or 0.0),
                    "section": "194C",
                    "certificate_status": "Pending"
                })
        return tds_items

    def reverse_payment(self, payment_id: str, organization_id: str, reason: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        pmt = self.get_by_id(payment_id, organization_id)
        if not pmt:
            raise Exception("Payment record not found")
        if pmt.get("status") == "Reversed":
            raise Exception("Payment has already been reversed")

        # 1. Update payment notes with reversal tag (payments table has no status column)
        self.admin_db.table("payments").update({"notes": f"{pmt.get('notes') or ''} [Reversed: {reason}]".strip()}).eq("id", payment_id).eq("organization_id", organization_id).execute()

        # 2. Revert document paid_amount / balance_due
        allocations = pmt.get("allocations", [])
        if not allocations and pmt.get("invoice_id"):
            allocations = [{"invoice_id": pmt["invoice_id"], "amount": pmt.get("amount", 0.0), "document_type": "invoice"}]

        for a in allocations:
            doc_id = a.get("document_id") or a.get("invoice_id")
            alloc_amt = float(a.get("amount_allocated") or a.get("amount") or 0)
            doc_type = a.get("document_type", "invoice")
            if doc_id and alloc_amt > 0:
                if doc_type == "proforma":
                    pf_res = self.admin_db.table("proforma_invoices").select("grand_total, balance_due").eq("id", doc_id).limit(1).execute()
                    if pf_res.data:
                        pf = pf_res.data[0]
                        gt = float(pf.get("grand_total") or 0)
                        self.admin_db.table("proforma_invoices").update({
                            "balance_due": gt,
                            "status": "sent"
                        }).eq("id", doc_id).execute()
                else:
                    inv_res = self.admin_db.table("invoices").select("grand_total, amount_paid").eq("id", doc_id).limit(1).execute()
                    if inv_res.data:
                        inv = inv_res.data[0]
                        gt = float(inv.get("grand_total") or 0)
                        curr_paid = float(inv.get("amount_paid") or 0)
                        new_paid = max(0.0, curr_paid - alloc_amt)
                        self.admin_db.table("invoices").update({
                            "amount_paid": new_paid,
                            "balance_due": max(0.0, gt - new_paid),
                            "status": "issued" if new_paid <= 0 else "partial"
                        }).eq("id", doc_id).execute()

        # 3. Insert Audit Log
        try:
            self.admin_db.table("audit_logs").insert({
                "organization_id": organization_id,
                "user_id": user_id,
                "action": "PAYMENT_REVERSED",
                "entity_type": "payment",
                "entity_id": payment_id,
                "details": {"reason": reason, "reversed_at": datetime.now(timezone.utc).isoformat()}
            }).execute()
        except Exception:
            pass

        return {
            "id": payment_id,
            "status": "reversed",
            "reason": reason,
            "reversed_at": datetime.now(timezone.utc).isoformat()
        }

    def get_customer_summary(self, customer_id: str, organization_id: str) -> Dict[str, Any]:
        pending = self.get_pending_documents(customer_id=customer_id, organization_id=organization_id)
        outstanding = sum(doc["balance_due"] for doc in pending)

        last_payment = {"amount": 0.0, "date": None}
        try:
            pmt_res = self.admin_db.table("payments").select("amount, payment_date").eq("organization_id", organization_id).eq("party_id", customer_id).eq("direction", "in").order("payment_date", desc=True).limit(1).execute()
            if pmt_res.data and len(pmt_res.data) > 0:
                p = pmt_res.data[0]
                last_payment = {
                    "amount": float(p.get("amount") or 0.0),
                    "date": str(p.get("payment_date")) if p.get("payment_date") else None
                }
        except Exception:
            pass

        advance_balance = 0.0
        try:
            adv_res = self.admin_db.table("payments").select("amount").eq("organization_id", organization_id).eq("party_id", customer_id).eq("is_advance", True).execute()
            if adv_res.data:
                advance_balance = sum(float(p.get("amount") or 0.0) for p in adv_res.data)
        except Exception:
            pass

        return {
            "outstanding": round(outstanding, 2),
            "last_payment": last_payment,
            "advance_balance": round(advance_balance, 2)
        }

    def create_payment(
        self,
        organization_id: str,
        payment_no: str,
        payment_date: str,
        party_id: str,
        amount: float,
        amount_received: Optional[float] = None,
        tds_amount: Optional[float] = 0.0,
        tds_rate: Optional[float] = 0.0,
        payment_mode: str = "CASH",
        reference_no: Optional[str] = None,
        notes: Optional[str] = None,
        user_id: Optional[str] = None,
        allocations: Optional[List[Dict[str, Any]]] = None,
        invoice_id: Optional[str] = None,
        is_advance: bool = False
    ) -> Dict[str, Any]:
        target_inv_id = invoice_id
        alloc_proforma_id = None
        if not target_inv_id and allocations and len(allocations) > 0:
            first_alloc = allocations[0]
            if str(first_alloc.get("document_type", "")).lower() == "proforma":
                alloc_proforma_id = first_alloc.get("document_id") or first_alloc.get("invoice_id")
            else:
                target_inv_id = first_alloc.get("invoice_id") or first_alloc.get("document_id")

        # Verify target_inv_id actually exists in invoices table to satisfy FK constraint payments_invoice_id_fkey
        if target_inv_id:
            try:
                chk = self.admin_db.table("invoices").select("id").eq("id", str(target_inv_id)).execute()
                if not chk.data:
                    target_inv_id = None
            except Exception:
                target_inv_id = None

        payment_notes = notes or ""
        if alloc_proforma_id and f"[proforma:{alloc_proforma_id}]" not in payment_notes:
            payment_notes = f"{payment_notes} [proforma:{alloc_proforma_id}]".strip()

        payment_data = {
            "organization_id": organization_id,
            "payment_no": payment_no,
            "payment_date": str(payment_date),
            "direction": "in",
            "party_id": party_id,
            "customer_id": party_id,
            "invoice_id": target_inv_id,
            "amount": amount_received or amount,
            "amount_received": amount_received or amount,
            "tds_amount": tds_amount or 0.0,
            "tds_rate": tds_rate or 0.0,
            "payment_mode": payment_mode,
            "reference_no": reference_no,
            "notes": payment_notes,
            "is_advance": is_advance
        }
        if user_id and is_valid_uuid(str(user_id)):
            try:
                u_res = self.admin_db.table("users").select("id").eq("id", user_id).limit(1).execute()
                if u_res.data:
                    payment_data["created_by"] = user_id
            except Exception:
                pass

        clean_data = {k: v for k, v in payment_data.items() if k in KNOWN_PAYMENT_COLUMNS and v is not None}
        import re
        res = None
        for _ in range(10):
            try:
                res = self.admin_db.table("payments").insert(clean_data).execute()
                break
            except Exception as err:
                err_str = str(err)
                m = re.search(r"Could not find the '([^']+)' column", err_str, re.IGNORECASE)
                if m:
                    missing_col = m.group(1)
                    if missing_col in clean_data:
                        clean_data.pop(missing_col, None)
                        continue
                raise err

        payment = res.data[0]
        payment_id = payment["id"]

        saved_allocations = []
        if allocations:
            for alloc in allocations:
                doc_id = alloc.get("invoice_id") or alloc.get("document_id")
                alloc_amt = float(alloc.get("amount_allocated") or alloc.get("amount") or 0)
                doc_type = alloc.get("document_type", "invoice")
                if doc_id and alloc_amt > 0:
                    alloc_record = {
                        "payment_id": payment_id,
                        "document_id": doc_id,
                        "document_type": doc_type,
                        "organization_id": organization_id,
                        "amount": alloc_amt,
                        "amount_allocated": alloc_amt,
                        "allocated_at": str(payment_date)
                    }
                    try:
                        self.admin_db.table("payment_allocations").insert(alloc_record).execute()
                    except Exception:
                        pass
                    saved_allocations.append(alloc_record)

                    if doc_type == "proforma":
                        pf_res = self.admin_db.table("proforma_invoices").select("*").eq("id", doc_id).eq("organization_id", organization_id).limit(1).execute()
                        if pf_res.data:
                            pf = pf_res.data[0]
                            grand_total = float(pf.get("grand_total", 0))
                            curr_paid = float(pf.get("amount_paid") or pf.get("advance_paid") or 0)
                            new_paid = curr_paid + alloc_amt
                            new_status = "partial" if new_paid < grand_total - 0.01 else "paid"
                            pf_update = {"status": new_status}
                            if "amount_paid" in pf:
                                pf_update["amount_paid"] = new_paid
                            if "advance_paid" in pf:
                                pf_update["advance_paid"] = new_paid
                            try:
                                self.admin_db.table("proforma_invoices").update(pf_update).eq("id", doc_id).execute()
                            except Exception:
                                pass
                    else:
                        inv_res = self.admin_db.table("invoices").select("*").eq("id", doc_id).eq("organization_id", organization_id).limit(1).execute()
                        if inv_res.data:
                            inv = inv_res.data[0]
                            grand_total = float(inv.get("grand_total", 0))
                            curr_paid = float(inv.get("amount_paid") or 0)
                            new_paid = curr_paid + alloc_amt
                            new_status = "paid" if new_paid >= grand_total - 0.01 else "partial"
                            self.admin_db.table("invoices").update({
                                "status": new_status,
                                "amount_paid": new_paid,
                                "balance_due": max(0.0, grand_total - new_paid)
                            }).eq("id", doc_id).execute()

        # Audit log creation
        try:
            self.admin_db.table("audit_logs").insert({
                "organization_id": organization_id,
                "user_id": user_id,
                "action": "PAYMENT_CREATED",
                "entity_type": "payment",
                "entity_id": payment_id,
                "details": {
                    "payment_no": payment_no,
                    "amount": amount_received or amount,
                    "customer_id": party_id,
                    "is_advance": is_advance,
                    "allocations_count": len(saved_allocations)
                }
            }).execute()
        except Exception:
            pass

        result_payment = self.get_by_id(payment_id, organization_id)
        if result_payment:
            result_payment["allocations"] = saved_allocations
        return result_payment or payment

    def get_receivables(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        status_filter: Optional[str] = None,
        q: Optional[str] = None,
        doc_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        import re
        # Fetch parties for customer names and details
        parties_res = self.admin_db.table("parties").select("id, display_name, legal_name, gstin, phone").eq("organization_id", organization_id).execute()
        parties_map = {p["id"]: p for p in (parties_res.data or [])}

        # Fetch non-reversed incoming payments (payments table has no status column, tracked via notes)
        try:
            payments_res = self.admin_db.table("payments").select("id, party_id, invoice_id, amount, notes, payment_date").eq("organization_id", organization_id).eq("direction", "in").execute()
            all_payments = payments_res.data or []
        except Exception:
            all_payments = []
        valid_payments = [p for p in all_payments if not ("[reversed:" in str(p.get("notes") or "").lower() or "[cancelled:" in str(p.get("notes") or "").lower())]

        inv_alloc_map: Dict[str, float] = {}
        inv_advance_alloc_map: Dict[str, float] = {}
        inv_regular_alloc_map: Dict[str, float] = {}
        inv_advance_direct_map: Dict[str, float] = {}
        inv_regular_direct_map: Dict[str, float] = {}
        customer_advances: Dict[str, float] = {}
        payment_adv_map: Dict[str, bool] = {}

        for p in valid_payments:
            pid = p.get("id")
            amt = float(p.get("amount_received") or p.get("amount") or 0.0)
            inv_id = str(p.get("invoice_id") or "").strip()
            cid = p.get("party_id")
            notes_str = str(p.get("notes") or "").lower()
            is_adv = bool(p.get("is_advance")) or "[advance]" in notes_str or "[proforma:" in notes_str or "[applied advance]" in notes_str
            if pid:
                payment_adv_map[pid] = is_adv

            if inv_id:
                inv_alloc_map[inv_id] = inv_alloc_map.get(inv_id, 0.0) + amt
                if is_adv:
                    inv_advance_direct_map[inv_id] = inv_advance_direct_map.get(inv_id, 0.0) + amt
                else:
                    inv_regular_direct_map[inv_id] = inv_regular_direct_map.get(inv_id, 0.0) + amt
            else:
                if cid:
                    customer_advances[cid] = customer_advances.get(cid, 0.0) + amt

            pf_match = re.search(r"\[proforma:([a-f0-9\-]+)\]", notes_str)
            if pf_match:
                pf_uuid = pf_match.group(1).strip()
                if is_adv:
                    inv_advance_direct_map[pf_uuid] = inv_advance_direct_map.get(pf_uuid, 0.0) + amt
                else:
                    inv_regular_direct_map[pf_uuid] = inv_regular_direct_map.get(pf_uuid, 0.0) + amt

        # Also inspect payment_allocations table
        try:
            alloc_res = self.admin_db.table("payment_allocations").select("payment_id, document_id, invoice_id, amount, amount_allocated").eq("organization_id", organization_id).execute()
            for a in (alloc_res.data or []):
                doc_id = str(a.get("document_id") or a.get("invoice_id") or "").strip()
                amt = float(a.get("amount_allocated") or a.get("amount") or 0.0)
                pmt_id = a.get("payment_id")
                is_adv = payment_adv_map.get(pmt_id, False)
                if doc_id:
                    inv_alloc_map[doc_id] = inv_alloc_map.get(doc_id, 0.0) + amt
                    if is_adv:
                        inv_advance_alloc_map[doc_id] = inv_advance_alloc_map.get(doc_id, 0.0) + amt
                    else:
                        inv_regular_alloc_map[doc_id] = inv_regular_alloc_map.get(doc_id, 0.0) + amt
        except Exception:
            pass

        # 1. Fetch non-cancelled Tax Invoices
        inv_res = self.admin_db.table("invoices").select("*").eq("organization_id", organization_id).execute()
        raw_invoices = inv_res.data or []

        today = get_kolkata_today()
        clean_q = str(q).strip().lower() if q else None
        clean_status = str(status_filter).strip().lower() if status_filter else None

        items: List[Dict[str, Any]] = []

        for inv in raw_invoices:
            inv_st = str(inv.get("status") or "").lower()
            if inv_st == "cancelled":
                continue

            inv_id = str(inv["id"])
            cid = inv.get("party_id") or inv.get("customer_id")
            if customer_id and str(cid) != str(customer_id):
                continue

            inv_date = str(inv.get("invoice_date") or "")
            if from_date and inv_date and inv_date < str(from_date):
                continue
            if to_date and inv_date and inv_date > str(to_date):
                continue

            due_date = str(inv["due_date"]) if inv.get("due_date") else None
            grand_total = round(float(inv.get("grand_total") or 0.0), 2)
            header_adv = round(float(inv.get("advance_received") or 0.0), 2)
            header_pd = round(float(inv.get("amount_paid") or 0.0), 2)

            # Advance Received (from payment allocations, direct payments, or invoice header)
            adv_from_records = max(inv_advance_alloc_map.get(inv_id, 0.0), inv_advance_direct_map.get(inv_id, 0.0))
            advance_received = round(adv_from_records if adv_from_records > 0 else (header_adv if header_adv > 0 else header_pd), 2)

            # Additional Payments (non-advance payments)
            additional_payments = round(max(inv_regular_alloc_map.get(inv_id, 0.0), inv_regular_direct_map.get(inv_id, 0.0)), 2)

            # Total Received = Advance Received + Additional Payments Received (no double-counting)
            total_received = round(advance_received + additional_payments, 2)
            if total_received < header_pd:
                total_received = header_pd
            if total_received < advance_received:
                total_received = advance_received
            additional_payments = max(0.0, round(total_received - advance_received, 2))

            balance_due = max(0.0, round(grand_total - total_received, 2))

            days_overdue = None
            days_to_due = None
            if balance_due > 0.01 and due_date:
                try:
                    d_due = date.fromisoformat(due_date[:10])
                    if today > d_due:
                        days_overdue = (today - d_due).days
                    else:
                        days_to_due = (d_due - today).days
                except Exception:
                    pass

            # Calculate Payment Status:
            # - UNPAID: Total received is zero.
            # - PARTIALLY_PAID: Total received is greater than zero but less than invoice total.
            # - PAID: Total received equals invoice total.
            if balance_due <= 0.01 and grand_total > 0:
                payment_status = "PAID"
                computed_status = "paid"
            elif total_received > 0.01:
                payment_status = "PARTIALLY_PAID"
                computed_status = "partial"
            else:
                payment_status = "UNPAID"
                computed_status = "unpaid"

            if computed_status != "paid" and days_overdue is not None and days_overdue > 0:
                computed_status = "overdue"

            if clean_status and clean_status != "all":
                if clean_status in ("overdue",) and computed_status != "overdue":
                    continue
                elif clean_status in ("partial", "partially paid", "partially_paid") and (computed_status != "partial" and payment_status != "PARTIALLY_PAID"):
                    continue
                elif clean_status in ("unpaid",) and (computed_status != "unpaid" and payment_status != "UNPAID"):
                    continue
                elif clean_status in ("paid",) and (computed_status != "paid" and payment_status != "PAID"):
                    continue

            c_info = parties_map.get(cid, {})
            cname = (
                c_info.get("display_name") or
                c_info.get("legal_name") or
                inv.get("bill_name") or
                inv.get("customer_name") or
                "Walk-in / Unlinked"
            )
            cphone = inv.get("customer_phone") or c_info.get("phone") or ""
            cgstin = inv.get("customer_gstin") or c_info.get("gstin") or ""

            inv_no = str(inv.get("invoice_no") or "")
            if clean_q:
                haystack = f"{inv_no} {cname} {cphone} {cgstin}".lower()
                if clean_q not in haystack:
                    continue

            cust_adv = round(customer_advances.get(cid, 0.0), 2) if cid else 0.0

            items.append({
                "invoice_id": inv_id,
                "invoice_no": inv_no,
                "invoice_date": inv_date,
                "invoice_type": "invoice",
                "customer_id": cid,
                "customer_name": cname,
                "customer_phone": cphone,
                "customer_gstin": cgstin,
                "due_date": due_date,
                "grand_total": grand_total,
                "total_amount": grand_total,
                "invoice_total": grand_total,
                "advance_received": advance_received,
                "advance_applied": advance_received,
                "additional_payments_received": additional_payments,
                "additional_payments": additional_payments,
                "total_received": total_received,
                "amount_received": total_received,
                "paid": total_received,
                "paid_amount": total_received,
                "balance_due": balance_due,
                "balance_amount": balance_due,
                "days_overdue": days_overdue,
                "days_to_due": days_to_due,
                "status": computed_status,
                "payment_status": payment_status,
                "has_advance_applied": advance_received > 0.01,
                "customer_has_advance": cust_adv > 0.01,
                "available_customer_advance": cust_adv
            })

        # 2. Fetch active unconverted Pro Forma Invoices
        try:
            pf_res = self.admin_db.table("proforma_invoices").select("*").eq("organization_id", organization_id).execute()
            raw_proformas = pf_res.data or []
        except Exception:
            raw_proformas = []

        for pf in raw_proformas:
            pf_st = str(pf.get("status") or "DRAFT").upper()
            converted_id = pf.get("converted_document_id")
            # Converted or cancelled proformas are excluded to avoid duplicate rows/balances
            if pf_st in ("CONVERTED", "CANCELLED", "REJECTED") or converted_id:
                continue

            pf_id = str(pf["id"])
            cid = pf.get("party_id") or pf.get("customer_id")
            if customer_id and str(cid) != str(customer_id):
                continue

            pf_date = str(pf.get("proforma_date") or "")
            if from_date and pf_date and pf_date < str(from_date):
                continue
            if to_date and pf_date and pf_date > str(to_date):
                continue

            due_date = str(pf.get("due_date") or pf.get("valid_till") or "") or None
            grand_total = round(float(pf.get("grand_total") or 0.0), 2)
            meta = pf.get("metadata") or {}
            header_adv = round(float(pf.get("advance_received") or pf.get("amount_paid") or meta.get("advance_received") or meta.get("amount_paid") or 0.0), 2)

            adv_from_records = max(inv_advance_alloc_map.get(pf_id, 0.0), inv_advance_direct_map.get(pf_id, 0.0))
            advance_received = round(adv_from_records if adv_from_records > 0 else header_adv, 2)

            additional_payments = round(max(inv_regular_alloc_map.get(pf_id, 0.0), inv_regular_direct_map.get(pf_id, 0.0)), 2)

            total_received = round(advance_received + additional_payments, 2)
            if total_received < header_adv:
                total_received = header_adv
            if total_received < advance_received:
                total_received = advance_received
            additional_payments = max(0.0, round(total_received - advance_received, 2))

            balance_due = max(0.0, round(grand_total - total_received, 2))

            days_overdue = None
            days_to_due = None
            if balance_due > 0.01 and due_date:
                try:
                    d_due = date.fromisoformat(due_date[:10])
                    if today > d_due:
                        days_overdue = (today - d_due).days
                    else:
                        days_to_due = (d_due - today).days
                except Exception:
                    pass

            if balance_due <= 0.01 and grand_total > 0:
                payment_status = "PAID"
                computed_status = "paid"
            elif total_received > 0.01:
                payment_status = "PARTIALLY_PAID"
                computed_status = "partial"
            else:
                payment_status = "UNPAID"
                computed_status = "unpaid"

            if computed_status != "paid" and days_overdue is not None and days_overdue > 0:
                computed_status = "overdue"

            if clean_status and clean_status != "all":
                if clean_status in ("overdue",) and computed_status != "overdue":
                    continue
                elif clean_status in ("partial", "partially paid", "partially_paid") and (computed_status != "partial" and payment_status != "PARTIALLY_PAID"):
                    continue
                elif clean_status in ("unpaid",) and (computed_status != "unpaid" and payment_status != "UNPAID"):
                    continue
                elif clean_status in ("paid",) and (computed_status != "paid" and payment_status != "PAID"):
                    continue

            c_info = parties_map.get(cid, {})
            cname = (
                c_info.get("display_name") or
                c_info.get("legal_name") or
                pf.get("bill_name") or
                pf.get("customer_name") or
                "Walk-in / Unlinked"
            )
            cphone = pf.get("customer_phone") or pf.get("bill_phone") or c_info.get("phone") or ""
            cgstin = pf.get("customer_gstin") or pf.get("bill_gstin") or c_info.get("gstin") or ""

            inv_no = str(pf.get("proforma_no") or "")
            if clean_q:
                haystack = f"{inv_no} {cname} {cphone} {cgstin}".lower()
                if clean_q not in haystack:
                    continue

            cust_adv = round(customer_advances.get(cid, 0.0), 2) if cid else 0.0

            items.append({
                "invoice_id": pf_id,
                "invoice_no": inv_no,
                "invoice_date": pf_date,
                "invoice_type": "proforma",
                "customer_id": cid,
                "customer_name": cname,
                "customer_phone": cphone,
                "customer_gstin": cgstin,
                "due_date": due_date,
                "grand_total": grand_total,
                "total_amount": grand_total,
                "invoice_total": grand_total,
                "advance_received": advance_received,
                "advance_applied": advance_received,
                "additional_payments_received": additional_payments,
                "additional_payments": additional_payments,
                "total_received": total_received,
                "amount_received": total_received,
                "paid": total_received,
                "paid_amount": total_received,
                "balance_due": balance_due,
                "balance_amount": balance_due,
                "days_overdue": days_overdue,
                "days_to_due": days_to_due,
                "status": computed_status,
                "payment_status": payment_status,
                "has_advance_applied": advance_received > 0.01,
                "customer_has_advance": cust_adv > 0.01,
                "available_customer_advance": cust_adv
            })

        # Filter by doc_type if specified
        if doc_type and doc_type.lower() != "all":
            clean_dt = doc_type.lower()
            if clean_dt in ("proforma", "pi"):
                items = [i for i in items if i.get("invoice_type") == "proforma"]
            elif clean_dt in ("invoice", "tax_invoice", "tax"):
                items = [i for i in items if i.get("invoice_type") == "invoice"]

        # Sort descending by invoice_date
        items.sort(key=lambda x: str(x.get("invoice_date") or ""), reverse=True)
        return items

    def get_receivables_summary(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> Dict[str, Any]:
        all_items = self.get_receivables(organization_id, customer_id=customer_id, from_date=from_date, to_date=to_date)
        
        total_invoiced = round(sum(i["grand_total"] for i in all_items), 2)
        pending_receivable = round(sum(i["balance_due"] for i in all_items if i["balance_due"] > 0), 2)
        
        overdue_items = [i for i in all_items if i["status"] == "overdue"]
        overdue_amount = round(sum(i["balance_due"] for i in overdue_items), 2)
        overdue_count = len(overdue_items)

        pmts_query = self.admin_db.table("payments").select("amount, payment_date, party_id, notes").eq("organization_id", organization_id).eq("direction", "in")
        if customer_id:
            pmts_query = pmts_query.eq("party_id", customer_id)
        pmts_res = pmts_query.execute()
        valid_pmts = [p for p in (pmts_res.data or []) if "[reversed" not in str(p.get("notes") or "").lower()]
        
        period_pmts = []
        for p in valid_pmts:
            p_date = str(p.get("payment_date") or "")
            if from_date and p_date and p_date < str(from_date):
                continue
            if to_date and p_date and p_date > str(to_date):
                continue
            period_pmts.append(p)

        total_received = round(sum(float(p.get("amount_received") or p.get("amount") or 0.0) for p in period_pmts), 2)

        customer_adv_seen: Dict[str, float] = {}
        for it in all_items:
            cid = it.get("customer_id")
            if cid and cid not in customer_adv_seen:
                customer_adv_seen[cid] = it.get("available_customer_advance", 0.0)
        unapplied_advance = round(sum(customer_adv_seen.values()), 2)

        if not customer_adv_seen:
            adv_res = self.get_customer_summary(customer_id, organization_id) if customer_id else self.get_summary(organization_id, from_date=from_date, to_date=to_date)
            unapplied_advance = round(float(adv_res.get("unapplied_balance") or adv_res.get("advance_balance") or 0.0), 2)

        tabs_count = {
            "all": len(all_items),
            "overdue": overdue_count,
            "partial": len([i for i in all_items if i["status"] == "partial"]),
            "unpaid": len([i for i in all_items if i["status"] == "unpaid"]),
            "paid": len([i for i in all_items if i["status"] == "paid"]),
        }

        return {
            "total_invoiced": total_invoiced,
            "total_received": total_received,
            "amount_received": total_received,
            "pending_receivable": pending_receivable,
            "overdue_amount": overdue_amount,
            "overdue_count": overdue_count,
            "unapplied_advance": unapplied_advance,
            "unapplied_balance": unapplied_advance,
            "total_receipts": len(period_pmts),
            "tabs_count": tabs_count
        }

    def get_customer_receivables(
        self,
        organization_id: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        all_items = self.get_receivables(organization_id, from_date=from_date, to_date=to_date)
        
        cust_map: Dict[str, Dict[str, Any]] = {}
        for it in all_items:
            cid = str(it.get("customer_id") or "unlinked")
            if cid not in cust_map:
                cust_map[cid] = {
                    "customer_id": it.get("customer_id") or "",
                    "customer_name": it["customer_name"],
                    "invoiced": 0.0,
                    "received": 0.0,
                    "advance": it.get("available_customer_advance", 0.0),
                    "balance": 0.0,
                    "overdue_amount": 0.0,
                    "oldest_due_date": None,
                    "invoices": []
                }
            entry = cust_map[cid]
            entry["invoiced"] = round(entry["invoiced"] + it["grand_total"], 2)
            entry["received"] = round(entry["received"] + it["paid_amount"], 2)
            entry["balance"] = round(entry["balance"] + it["balance_due"], 2)
            if it["status"] == "overdue":
                entry["overdue_amount"] = round(entry["overdue_amount"] + it["balance_due"], 2)
            if it.get("due_date") and it["balance_due"] > 0.01:
                if not entry["oldest_due_date"] or it["due_date"] < entry["oldest_due_date"]:
                    entry["oldest_due_date"] = it["due_date"]
            entry["invoices"].append(it)

        result = list(cust_map.values())
        result.sort(key=lambda x: (x["balance"], x["overdue_amount"]), reverse=True)
        return result

    def get_receipts_history(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        q: Optional[str] = None,
        page: int = 1,
        page_size: int = 50
    ) -> Dict[str, Any]:
        raw_res = self.get_filtered_payments(
            organization_id=organization_id,
            q=q,
            customer_id=customer_id,
            from_date=from_date,
            to_date=to_date,
            page=page,
            page_size=page_size
        )
        items = []
        for p in raw_res.get("items", []):
            amt = float(p.get("amount_received") or p.get("amount") or 0.0)
            applied = float(p.get("amount_applied") or 0.0)
            unapplied = float(p.get("unapplied_amount") or max(0.0, amt - applied))
            items.append({
                "payment_id": p.get("id"),
                "receipt_no": str(p.get("receipt_no") or p.get("payment_no") or ""),
                "date": str(p.get("payment_date") or ""),
                "customer_id": p.get("customer_id") or p.get("party_id"),
                "customer_name": str(p.get("customer_name") or "Customer"),
                "payment_mode": str(p.get("payment_mode") or "Cash"),
                "amount": round(amt, 2),
                "applied": round(applied, 2),
                "unapplied": round(unapplied, 2),
                "reference": p.get("reference_no"),
                "status": str(p.get("status") or "posted")
            })
        return {
            "items": items,
            "total": raw_res.get("total", len(items)),
            "page": page,
            "page_size": page_size
        }

    def apply_advance(
        self,
        organization_id: str,
        customer_id: str,
        invoice_id: str,
        amount: float,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be greater than zero")

        inv_res = self.admin_db.table("invoices").select("*").eq("id", invoice_id).eq("organization_id", organization_id).limit(1).execute()
        if not inv_res.data:
            raise HTTPException(status_code=404, detail="Invoice not found")
        inv = inv_res.data[0]

        grand_total = float(inv.get("grand_total") or 0.0)
        curr_paid = float(inv.get("amount_paid") or 0.0)
        balance_due = max(0.0, grand_total - curr_paid)

        if amount > balance_due + 0.01:
            raise HTTPException(status_code=400, detail=f"Allocation amount exceeds document balance due (₹{balance_due:.2f})")

        pmts_res = self.admin_db.table("payments").select("*").eq("organization_id", organization_id).eq("party_id", customer_id).eq("direction", "in").execute()
        valid_pmts = [p for p in (pmts_res.data or []) if str(p.get("status") or "").lower() not in ("reversed", "cancelled")]

        # Available advances for customer are incoming payments with no invoice_id
        available_advances = []
        total_available = 0.0
        for p in valid_pmts:
            if not p.get("invoice_id"):
                p_amt = float(p.get("amount") or 0.0)
                if p_amt > 0.001:
                    available_advances.append({"payment": p, "unapplied": p_amt})
                    total_available += p_amt

        if total_available < amount - 0.01:
            raise HTTPException(status_code=400, detail=f"Insufficient unapplied advance: available ₹{total_available:.2f}, requested ₹{amount:.2f}")

        remaining_to_apply = amount
        created_allocations = []
        today_str = str(get_kolkata_today())

        for adv in available_advances:
            if remaining_to_apply <= 0.001:
                break
            p = adv["payment"]
            can_take = min(adv["unapplied"], remaining_to_apply)
            
            if abs(adv["unapplied"] - can_take) < 0.01:
                # Fully consumed advance payment: associate directly to invoice
                self.admin_db.table("payments").update({
                    "invoice_id": invoice_id,
                    "notes": f"{p.get('notes') or ''} [Applied Advance]"
                }).eq("id", p["id"]).execute()
            else:
                # Partially consumed: reduce advance payment, create applied payment row
                rem = round(adv["unapplied"] - can_take, 2)
                self.admin_db.table("payments").update({"amount": rem}).eq("id", p["id"]).execute()
                new_no = self.generate_payment_no(organization_id)
                self.admin_db.table("payments").insert({
                    "organization_id": organization_id,
                    "payment_no": new_no,
                    "payment_date": today_str,
                    "direction": "in",
                    "party_id": customer_id,
                    "invoice_id": invoice_id,
                    "amount": can_take,
                    "payment_mode": p.get("payment_mode") or "Bank Transfer",
                    "reference_no": p.get("reference_no"),
                    "notes": f"Advance applied from {p.get('payment_no')} [Applied Advance]"
                }).execute()

            alloc_record = {
                "payment_id": p["id"],
                "document_id": invoice_id,
                "invoice_id": invoice_id,
                "document_type": "invoice",
                "organization_id": organization_id,
                "amount": can_take,
                "amount_allocated": can_take,
                "allocated_at": today_str
            }
            created_allocations.append(alloc_record)
            remaining_to_apply -= can_take

        new_paid = round(curr_paid + amount, 2)
        new_bal = round(max(0.0, grand_total - new_paid), 2)
        new_status = "paid" if new_bal <= 0.01 else "partial"
        self.admin_db.table("invoices").update({
            "amount_paid": new_paid,
            "balance_due": new_bal,
            "status": new_status
        }).eq("id", invoice_id).execute()

        try:
            self.admin_db.table("audit_logs").insert({
                "organization_id": organization_id,
                "user_id": user_id,
                "action": "ADVANCE_APPLIED",
                "entity_type": "invoice",
                "entity_id": invoice_id,
                "details": {
                    "customer_id": customer_id,
                    "applied_amount": amount,
                    "new_balance": new_bal,
                    "allocations_count": len(created_allocations)
                }
            }).execute()
        except Exception:
            pass

        return {
            "invoice_id": invoice_id,
            "invoice_no": inv.get("invoice_no"),
            "applied_amount": amount,
            "new_paid_amount": new_paid,
            "new_balance_due": new_bal,
            "status": new_status,
            "allocations": created_allocations
        }

    def get_customer_ledger(
        self,
        customer_id: str,
        organization_id: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Consolidated chronological Customer Ledger with strict invoice-wise payment allocation,
        advance tracking, and double-counting prevention between Pro Formas and converted Tax Invoices.
        """
        # 1. Fetch Party Information
        party_info: Dict[str, Any] = {
            "id": customer_id,
            "name": "Customer",
            "display_name": "Customer",
            "legal_name": "",
            "gstin": "",
            "phone": "",
            "email": "",
            "address": ""
        }
        try:
            p_res = self.admin_db.table("parties").select("*").eq("id", customer_id).limit(1).execute()
            if p_res.data:
                p = p_res.data[0]
                party_info = {
                    "id": customer_id,
                    "name": p.get("display_name") or p.get("legal_name") or "Customer",
                    "display_name": p.get("display_name") or "Customer",
                    "legal_name": p.get("legal_name") or "",
                    "gstin": p.get("gstin") or "",
                    "phone": p.get("phone") or "",
                    "email": p.get("email") or "",
                    "address": p.get("billing_address_line1") or p.get("address") or ""
                }
        except Exception:
            pass

        # 2. Fetch Invoices
        invoices = []
        try:
            inv_query = self.admin_db.table("invoices").select("*").eq("organization_id", organization_id).eq("party_id", customer_id)
            inv_res = inv_query.execute()
            invoices = [inv for inv in (inv_res.data or []) if str(inv.get("status") or "").lower() != "cancelled"]
        except Exception:
            pass

        inv_map = {str(inv["id"]): inv for inv in invoices}

        # 3. Fetch Pro Forma Invoices
        proformas = []
        try:
            pf_query = self.admin_db.table("proforma_invoices").select("*").eq("organization_id", organization_id).eq("party_id", customer_id)
            pf_res = pf_query.execute()
            proformas = [pf for pf in (pf_res.data or []) if str(pf.get("status") or "").lower() != "cancelled"]
        except Exception:
            pass

        pf_map = {str(pf["id"]): pf for pf in proformas}
        pf_to_inv: Dict[str, str] = {}
        inv_to_pf: Dict[str, str] = {}
        for pf in proformas:
            conv_id = str(pf.get("converted_document_id") or "").strip()
            if conv_id:
                pf_to_inv[str(pf["id"])] = conv_id
                inv_to_pf[conv_id] = str(pf.get("proforma_no") or "Pro Forma")

        # 4. Fetch Payments and Allocations
        payments = []
        try:
            pmt_res = self.admin_db.table("payments").select("*").eq("organization_id", organization_id).eq("party_id", customer_id).eq("direction", "in").execute()
            all_pmts = pmt_res.data or []
            payments = [
                p for p in all_pmts
                if not ("[reversed:" in str(p.get("notes") or "").lower() or "[cancelled:" in str(p.get("notes") or "").lower())
            ]
        except Exception:
            pass

        allocations_by_payment: Dict[str, List[Dict[str, Any]]] = {}
        try:
            alloc_res = self.admin_db.table("payment_allocations").select("*").eq("organization_id", organization_id).execute()
            for a in (alloc_res.data or []):
                pmt_id = str(a.get("payment_id") or "")
                doc_id = str(a.get("document_id") or a.get("invoice_id") or "")
                amt = float(a.get("amount_allocated") or a.get("amount") or 0.0)
                doc_type = str(a.get("document_type") or "invoice").lower()

                doc_no = "-"
                if doc_type == "proforma" and doc_id in pf_map:
                    doc_no = pf_map[doc_id].get("proforma_no") or "Pro Forma"
                elif doc_id in inv_map:
                    doc_no = inv_map[doc_id].get("invoice_no") or "Invoice"

                alloc_entry = {
                    "document_id": doc_id,
                    "document_no": doc_no,
                    "document_type": doc_type,
                    "amount": round(amt, 2)
                }
                allocations_by_payment.setdefault(pmt_id, []).append(alloc_entry)
        except Exception:
            pass

        # 5. Build Timeline Entries
        timeline = []
        today = get_kolkata_today()

        # Invoices (Debits)
        for inv in invoices:
            inv_date = str(inv.get("invoice_date") or inv.get("created_at") or "")[:10]
            if from_date and inv_date < str(from_date):
                continue
            if to_date and inv_date > str(to_date):
                continue

            inv_id = str(inv["id"])
            grand_total = round(float(inv.get("grand_total") or 0.0), 2)
            balance_due = round(float(inv.get("balance_due") or 0.0), 2)
            due_date = str(inv.get("due_date") or "")[:10] if inv.get("due_date") else None
            is_overdue = False
            if due_date and balance_due > 0.01:
                try:
                    is_overdue = today > date.fromisoformat(due_date)
                except Exception:
                    pass

            conv_pf_no = inv_to_pf.get(inv_id)
            inv_type_badge = "EA Invoice" if str(inv.get("invoice_type") or "").upper() == "EA_INVOICE" else "Tax Invoice"
            desc = f"{inv_type_badge} #{inv.get('invoice_no')}"
            if conv_pf_no:
                desc += f" (Converted from Pro Forma {conv_pf_no})"

            timeline.append({
                "id": f"inv-{inv_id}",
                "date": inv_date,
                "order_priority": 1,
                "entry_type": "TAX_INVOICE",
                "document_id": inv_id,
                "document_no": str(inv.get("invoice_no") or "-"),
                "reference_no": None,
                "description": desc,
                "debit": grand_total,
                "credit": 0.0,
                "running_balance": 0.0,
                "due_date": due_date,
                "is_overdue": is_overdue,
                "is_converted": False,
                "converted_document_id": None,
                "converted_document_no": None,
                "status": str(inv.get("status") or "issued").capitalize(),
                "allocations": []
            })

        # Pro Formas (Informational / Converted tracking, DEBIT = 0 to PREVENT DOUBLE COUNTING)
        for pf in proformas:
            pf_date = str(pf.get("proforma_date") or pf.get("created_at") or "")[:10]
            if from_date and pf_date < str(from_date):
                continue
            if to_date and pf_date > str(to_date):
                continue

            pf_id = str(pf["id"])
            pf_no = str(pf.get("proforma_no") or "-")
            grand_total = round(float(pf.get("grand_total") or 0.0), 2)
            due_date = str(pf.get("due_date") or pf.get("valid_till") or "")[:10] if (pf.get("due_date") or pf.get("valid_till")) else None
            is_converted = pf_id in pf_to_inv or str(pf.get("status") or "").upper() == "CONVERTED"
            conv_inv_id = pf_to_inv.get(pf_id)
            conv_inv_no = inv_map.get(conv_inv_id, {}).get("invoice_no") if conv_inv_id else None

            if is_converted:
                desc = f"Pro Forma #{pf_no} (Converted & Superseded -> Tax Invoice #{conv_inv_no or 'INV'})"
                status_label = "Converted"
            else:
                desc = f"Pro Forma #{pf_no} Issued (Pre-Tax Estimate)"
                status_label = str(pf.get("status") or "Sent").capitalize()

            # RULE: A Pro Forma and converted Tax Invoice represent the SAME transaction.
            # To strictly prevent double counting, Pro Forma debit is 0.0 in legal financial ledger.
            timeline.append({
                "id": f"pf-{pf_id}",
                "date": pf_date,
                "order_priority": 0,
                "entry_type": "PROFORMA",
                "document_id": pf_id,
                "document_no": pf_no,
                "reference_no": None,
                "description": desc,
                "debit": 0.0,  # Never double counts against tax invoice
                "credit": 0.0,
                "running_balance": 0.0,
                "due_date": due_date,
                "is_overdue": False,
                "is_converted": is_converted,
                "converted_document_id": conv_inv_id,
                "converted_document_no": conv_inv_no,
                "status": status_label,
                "allocations": []
            })

        # Payments (Credits)
        for p in payments:
            pmt_date = str(p.get("payment_date") or p.get("created_at") or "")[:10]
            if from_date and pmt_date < str(from_date):
                continue
            if to_date and pmt_date > str(to_date):
                continue

            pmt_id = str(p["id"])
            pmt_no = str(p.get("payment_no") or "-")
            pmt_amt = round(float(p.get("amount_received") or p.get("amount") or 0.0), 2)
            ref_no = p.get("reference_no")
            mode = p.get("payment_mode") or "Bank Transfer"
            allocs = allocations_by_payment.get(pmt_id, [])

            # Direct fallback if single invoice_id was linked
            if not allocs and p.get("invoice_id"):
                direct_inv_id = str(p["invoice_id"])
                allocs = [{
                    "document_id": direct_inv_id,
                    "document_no": inv_map.get(direct_inv_id, {}).get("invoice_no") or "Invoice",
                    "document_type": "invoice",
                    "amount": pmt_amt
                }]

            total_alloc_amt = sum(a["amount"] for a in allocs)
            is_adv = bool(p.get("is_advance")) or "[advance]" in str(p.get("notes") or "").lower() or total_alloc_amt < pmt_amt - 0.01

            if is_adv and total_alloc_amt <= 0.01:
                desc = f"Advance Payment received via {mode}"
            elif allocs:
                alloc_details = ", ".join(f"{a['document_no']} (₹{a['amount']:,.2f})" for a in allocs)
                desc = f"Payment received via {mode} [Allocated to: {alloc_details}]"
            else:
                desc = f"Payment received via {mode}"

            if ref_no:
                desc += f" (Ref: {ref_no})"

            timeline.append({
                "id": f"pmt-{pmt_id}",
                "date": pmt_date,
                "order_priority": 2,
                "entry_type": "PAYMENT",
                "document_id": pmt_id,
                "document_no": pmt_no,
                "reference_no": ref_no,
                "description": desc,
                "debit": 0.0,
                "credit": pmt_amt,
                "running_balance": 0.0,
                "due_date": None,
                "is_overdue": False,
                "is_converted": False,
                "converted_document_id": None,
                "converted_document_no": None,
                "status": "Advance" if is_adv and total_alloc_amt <= 0.01 else ("Partially Applied" if total_alloc_amt < pmt_amt - 0.01 else "Fully Applied"),
                "allocations": allocs
            })

        # 6. Chronological Order & Running Balance
        timeline.sort(key=lambda x: (x["date"] or "", x["order_priority"]))

        running_bal = 0.0
        for entry in timeline:
            running_bal += entry["debit"] - entry["credit"]
            entry["running_balance"] = round(running_bal, 2)

        # 7. Aggregate Summary
        total_tax_inv_amt = round(sum(inv.get("grand_total") or 0.0 for inv in invoices), 2)
        total_open_pf_amt = round(sum(pf.get("grand_total") or 0.0 for pf in proformas if str(pf["id"]) not in pf_to_inv and str(pf.get("status") or "").upper() != "CONVERTED"), 2)
        total_pmts = round(sum(p.get("amount_received") or p.get("amount") or 0.0 for p in payments), 2)
        total_alloc = round(sum(sum(a["amount"] for a in allocations_by_payment.get(str(p["id"]), [])) for p in payments), 2)
        unalloc_credits = round(max(0.0, total_pmts - total_alloc), 2)
        net_outstanding = round(max(0.0, total_tax_inv_amt - total_alloc), 2)

        overdue_amt = 0.0
        for inv in invoices:
            due_date = str(inv.get("due_date") or "")[:10] if inv.get("due_date") else None
            bal = float(inv.get("balance_due") or 0.0)
            if due_date and bal > 0.01:
                try:
                    if today > date.fromisoformat(due_date):
                        overdue_amt += bal
                except Exception:
                    pass

        summary_data = {
            "total_tax_invoices_amount": total_tax_inv_amt,
            "total_open_proformas_amount": total_open_pf_amt,
            "total_payments_received": total_pmts,
            "total_allocated_payments": total_alloc,
            "unallocated_credits": unalloc_credits,
            "net_outstanding_balance": net_outstanding,
            "overdue_amount": round(overdue_amt, 2),
            "invoices_count": len(invoices),
            "proformas_count": len(proformas),
            "payments_count": len(payments)
        }

        return {
            "customer": party_info,
            "summary": summary_data,
            "timeline": timeline
        }


