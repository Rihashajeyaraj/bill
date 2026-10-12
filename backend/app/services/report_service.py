import logging
from typing import Dict, Any, List, Optional
from datetime import date, datetime
from decimal import Decimal
from app.core.supabase import get_admin_supabase_client

logger = logging.getLogger(__name__)

def _parse_iso_date(d_str: Optional[str]) -> Optional[str]:
    if not d_str or not str(d_str).strip() or str(d_str).strip().lower() in ("all", "null", "undefined", "none"):
        return None
    val = str(d_str).strip()
    if "/" in val:
        parts = val.split("/")
        if len(parts) == 3:
            day, month, year = parts[0].zfill(2), parts[1].zfill(2), parts[2]
            if len(day) == 2 and len(month) == 2 and len(year) == 4:
                return f"{year}-{month}-{day}"
    return val

class ReportService:
    def __init__(self):
        self.db = get_admin_supabase_client()

    def get_sales_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        exclude_drafts: bool = False,
        include_proforma: bool = False
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)

        clean_customer_id = None
        if customer_id and str(customer_id).strip() and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", ""):
            clean_customer_id = str(customer_id).strip()

        # Fetch parties for name resolution (LEFT JOIN logic)
        parties_map = {}
        try:
            p_res = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute()
            for p in (p_res.data or []):
                parties_map[p["id"]] = p.get("display_name") or "Customer"
        except Exception:
            pass

        def resolve_customer_name(row: Dict[str, Any]) -> str:
            cid = row.get("customer_id") or row.get("party_id")
            if cid:
                if cid in parties_map:
                    return parties_map[cid]
                try:
                    p_single = self.db.table("parties").select("display_name").eq("id", cid).limit(1).execute()
                    if p_single.data:
                        name = p_single.data[0].get("display_name")
                        if name:
                            parties_map[cid] = name
                            return name
                except Exception:
                    pass
                try:
                    c_single = self.db.table("customers").select("display_name").eq("id", cid).limit(1).execute()
                    if c_single.data:
                        name = c_single.data[0].get("display_name")
                        if name:
                            parties_map[cid] = name
                            return name
                except Exception:
                    pass

            name = (
                row.get("bill_name") or
                row.get("customer_name") or
                row.get("customer_company_name") or
                row.get("party_name") or
                row.get("bill_to_name")
            )
            if name and str(name).strip() and str(name).strip() != "-":
                return str(name).strip()
            return "Walk-in / Unlinked"

        # Fetch tax invoices
        query = self.db.table("invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            query = query.gte("invoice_date", iso_start)
        if iso_end:
            query = query.lte("invoice_date", iso_end)

        invoices_raw = query.order("invoice_date", desc=True).execute().data or []

        # Batch load payments and allocations to compute non-reversed received totals per invoice
        payments_by_inv = {}
        try:
            alloc_res = self.db.table("payment_allocations").select("document_id, invoice_id, amount, amount_allocated").eq("organization_id", organization_id).execute()
            for a in (alloc_res.data or []):
                doc_id = a.get("document_id") or a.get("invoice_id")
                if doc_id:
                    amt = Decimal(str(a.get("amount_allocated") or a.get("amount") or 0))
                    payments_by_inv[doc_id] = payments_by_inv.get(doc_id, Decimal("0.00")) + amt
        except Exception:
            pass

        try:
            pmt_res = self.db.table("payments").select("invoice_id, amount, amount_received, status, direction").eq("organization_id", organization_id).eq("direction", "in").execute()
            for p in (pmt_res.data or []):
                if str(p.get("status") or "").lower() in ("cancelled", "reversed"):
                    continue
                inv_id = p.get("invoice_id")
                if inv_id:
                    amt = Decimal(str(p.get("amount_received") or p.get("amount") or 0))
                    payments_by_inv[inv_id] = payments_by_inv.get(inv_id, Decimal("0.00")) + amt
        except Exception:
            pass

        tax_invoices = []
        total_sales_dec = Decimal("0.00")
        total_received_dec = Decimal("0.00")
        total_receivable_dec = Decimal("0.00")

        for inv in invoices_raw:
            st = str(inv.get("status") or "").lower()
            if st == "cancelled":
                continue
            if exclude_drafts and st == "draft":
                continue

            inv_cid = inv.get("customer_id") or inv.get("party_id")
            if clean_customer_id and inv_cid != clean_customer_id:
                continue

            gt_dec = Decimal(str(inv.get("grand_total") or inv.get("total") or 0))
            stored_paid_dec = Decimal(str(inv.get("amount_paid") or inv.get("advance_received") or 0))
            allocated_dec = payments_by_inv.get(inv["id"], Decimal("0.00"))

            received_dec = max(allocated_dec, stored_paid_dec)
            if received_dec > gt_dec:
                received_dec = gt_dec

            receivable_dec = max(Decimal("0.00"), gt_dec - received_dec)

            if receivable_dec <= Decimal("0.00") and gt_dec > Decimal("0.00"):
                status_label = "Paid"
            elif received_dec > Decimal("0.00"):
                status_label = "Partial"
            elif st == "draft":
                status_label = "Draft"
            else:
                status_label = "Unpaid"

            total_sales_dec += gt_dec
            total_received_dec += received_dec
            total_receivable_dec += receivable_dec

            cust_name = resolve_customer_name(inv)
            tax_invoices.append({
                "id": inv["id"],
                "invoice_date": str(inv.get("invoice_date") or inv.get("date") or ""),
                "date": str(inv.get("invoice_date") or inv.get("date") or ""),
                "invoice_no": str(inv.get("invoice_no") or inv.get("proforma_no") or inv.get("id")),
                "customer_id": inv_cid,
                "customer_name": cust_name,
                "party_name": cust_name,
                "document_type": "Tax Invoice",
                "grand_total": float(gt_dec),
                "totalAmount": float(gt_dec),
                "received": float(received_dec),
                "paidAmount": float(received_dec),
                "receivable": float(receivable_dec),
                "unpaidAmount": float(receivable_dec),
                "status": status_label,
                "is_proforma": False
            })

        proforma_rows = []
        has_proformas = False

        # Check if proformas exist in DB to guide empty state message
        try:
            check_pf = self.db.table("proforma_invoices").select("id").eq("organization_id", organization_id).limit(1).execute()
            if check_pf.data:
                has_proformas = True
        except Exception:
            pass

        if include_proforma:
            try:
                pf_query = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
                if iso_start:
                    pf_query = pf_query.gte("proforma_date", iso_start)
                if iso_end:
                    pf_query = pf_query.lte("proforma_date", iso_end)

                raw_pfs = pf_query.order("proforma_date", desc=True).execute().data or []
                for pf in raw_pfs:
                    pf_st = str(pf.get("status") or "").upper()
                    if pf_st in ("CONVERTED", "CANCELLED"):
                        continue
                    pf_cid = pf.get("customer_id") or pf.get("party_id")
                    if clean_customer_id and pf_cid != clean_customer_id:
                        continue

                    pf_gt_dec = Decimal(str(pf.get("grand_total") or 0))
                    pf_adv_dec = Decimal(str(pf.get("advance_received") or 0))
                    pf_rec_dec = max(Decimal("0.00"), pf_gt_dec - pf_adv_dec)

                    cust_name = resolve_customer_name(pf)
                    proforma_rows.append({
                        "id": pf["id"],
                        "invoice_date": str(pf.get("proforma_date") or ""),
                        "date": str(pf.get("proforma_date") or ""),
                        "invoice_no": str(pf.get("proforma_no") or pf.get("id")),
                        "customer_id": pf_cid,
                        "customer_name": cust_name,
                        "party_name": cust_name,
                        "document_type": "Pro Forma",
                        "grand_total": float(pf_gt_dec),
                        "totalAmount": float(pf_gt_dec),
                        "received": float(pf_adv_dec),
                        "paidAmount": float(pf_adv_dec),
                        "receivable": float(pf_rec_dec),
                        "unpaidAmount": float(pf_rec_dec),
                        "status": "Draft" if pf_st == "DRAFT" else "Sent",
                        "is_proforma": True
                    })
            except Exception:
                pass

        all_combined_rows = tax_invoices + proforma_rows

        return {
            "report_type": "sales",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "customer_id": clean_customer_id,
            "exclude_drafts": exclude_drafts,
            "include_proforma": include_proforma,
            "has_proformas": has_proformas,
            "summary": {
                "total_sales": float(total_sales_dec),
                "total_received": float(total_received_dec),
                "total_receivable": float(total_receivable_dec),
                "invoice_count": len(tax_invoices),
                "proforma_count": len(proforma_rows)
            },
            "data": all_combined_rows
        }

    def get_customer_wise_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        q: Optional[str] = None
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)
        clean_customer_id = str(customer_id).strip() if customer_id and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        search_term = q.strip().lower() if q and q.strip() else None

        # Fetch parties for this organization
        parties_res = self.db.table("parties").select("*").eq("organization_id", organization_id).execute()
        parties = parties_res.data or []
        party_dict = {p["id"]: p for p in parties}

        # Fetch tax invoices
        inv_query = self.db.table("invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            inv_query = inv_query.gte("invoice_date", iso_start)
        if iso_end:
            inv_query = inv_query.lte("invoice_date", iso_end)
        invoices = [i for i in (inv_query.execute().data or []) if str(i.get("status") or "").lower() != "cancelled"]

        # Fetch proforma invoices
        pf_query = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            pf_query = pf_query.gte("proforma_date", iso_start)
        if iso_end:
            pf_query = pf_query.lte("proforma_date", iso_end)
        proformas = [p for p in (pf_query.execute().data or []) if str(p.get("status") or "").upper() != "CANCELLED"]

        # Track converted proformas to avoid double-counting
        converted_pf_ids = set()
        for pf in proformas:
            if str(pf.get("status") or "").upper() == "CONVERTED" or pf.get("converted_document_id"):
                converted_pf_ids.add(pf["id"])
        for inv in invoices:
            src_pf = inv.get("source_proforma_id") or (inv.get("metadata") or {}).get("source_proforma_id")
            if src_pf:
                converted_pf_ids.add(src_pf)

        # Fetch payments (inward)
        pmt_res = self.db.table("payments").select("*").eq("organization_id", organization_id).eq("direction", "in").execute()
        all_payments = [p for p in (pmt_res.data or []) if not p.get("is_reversed") and "[reversed:" not in str(p.get("notes") or "").lower()]

        # Filter payments by date range if provided
        filtered_payments = []
        for p in all_payments:
            p_date = str(p.get("payment_date") or "")
            if iso_start and p_date < iso_start:
                continue
            if iso_end and p_date > iso_end:
                continue
            filtered_payments.append(p)

        # Group data by customer/party
        all_party_ids = set(party_dict.keys())
        for inv in invoices:
            cid = inv.get("party_id") or inv.get("customer_id")
            if cid:
                all_party_ids.add(cid)
        for pf in proformas:
            cid = pf.get("party_id") or pf.get("customer_id")
            if cid:
                all_party_ids.add(cid)
        for p in filtered_payments:
            cid = p.get("party_id")
            if cid:
                all_party_ids.add(cid)

        rows = []
        total_inv_amount_dec = Decimal("0.00")
        total_received_dec = Decimal("0.00")
        total_outstanding_dec = Decimal("0.00")

        for pid in all_party_ids:
            if clean_customer_id and pid != clean_customer_id:
                continue

            party_info = party_dict.get(pid, {})
            cust_name = party_info.get("display_name") or "Unassigned Customer"
            phone = party_info.get("phone") or "-"
            gstin = party_info.get("gstin") or "-"

            # Filter search
            if search_term:
                match_name = search_term in cust_name.lower()
                match_phone = search_term in str(phone).lower()
                match_gstin = search_term in str(gstin).lower()
                if not (match_name or match_phone or match_gstin):
                    continue

            # Invoices for this customer
            cust_invoices = [i for i in invoices if (i.get("party_id") or i.get("customer_id")) == pid]
            cust_pfs = [p for p in proformas if (p.get("party_id") or p.get("customer_id")) == pid]
            cust_pmts = [p for p in filtered_payments if p.get("party_id") == pid]

            # Avoid double-counting: only add unconverted proformas to invoice amount
            cust_unconverted_pfs = [p for p in cust_pfs if p["id"] not in converted_pf_ids]

            pf_count = len(cust_pfs)
            tax_inv_count = len(cust_invoices)

            if pf_count == 0 and tax_inv_count == 0 and len(cust_pmts) == 0 and not clean_customer_id:
                continue

            tax_inv_total = sum(Decimal(str(i.get("grand_total") or 0)) for i in cust_invoices)
            unconv_pf_total = sum(Decimal(str(p.get("grand_total") or 0)) for p in cust_unconverted_pfs)
            cust_total_inv = tax_inv_total + unconv_pf_total

            # Advances
            pf_adv = sum(Decimal(str(p.get("advance_received") or p.get("amount_paid") or 0)) for p in cust_unconverted_pfs)
            tax_adv = sum(Decimal(str(i.get("advance_received") or 0)) for i in cust_invoices)
            cust_adv_rec = pf_adv + tax_adv

            # Total received from actual payment receipts
            pmt_rec = sum(Decimal(str(p.get("amount_received") or p.get("amount") or 0)) for p in cust_pmts)
            
            # Stored received fallback
            stored_rec = sum(Decimal(str(i.get("amount_paid") or 0)) for i in cust_invoices) + pf_adv
            cust_tot_rec = max(pmt_rec, stored_rec)
            if cust_tot_rec > cust_total_inv and cust_total_inv > Decimal("0.00"):
                cust_tot_rec = cust_total_inv

            cust_add_pmts = max(Decimal("0.00"), cust_tot_rec - cust_adv_rec)
            cust_bal_due = max(Decimal("0.00"), cust_total_inv - cust_tot_rec)

            total_inv_amount_dec += cust_total_inv
            total_received_dec += cust_tot_rec
            total_outstanding_dec += cust_bal_due

            # Detailed invoice and payment history for clicking row
            invoice_history = []
            for i in cust_invoices:
                i_gt = Decimal(str(i.get("grand_total") or 0))
                i_pd = Decimal(str(i.get("amount_paid") or 0))
                i_bal = max(Decimal("0.00"), i_gt - i_pd)
                invoice_history.append({
                    "id": i["id"],
                    "invoice_no": i.get("invoice_no") or i["id"][:8],
                    "document_type": "Tax Invoice",
                    "date": str(i.get("invoice_date") or ""),
                    "grand_total": float(i_gt),
                    "amount_received": float(i_pd),
                    "balance_due": float(i_bal),
                    "status": "Paid" if i_bal <= Decimal("0.01") else ("Partial" if i_pd > Decimal("0.01") else "Unpaid")
                })
            for p in cust_unconverted_pfs:
                p_gt = Decimal(str(p.get("grand_total") or 0))
                p_adv = Decimal(str(p.get("advance_received") or p.get("amount_paid") or 0))
                p_bal = max(Decimal("0.00"), p_gt - p_adv)
                invoice_history.append({
                    "id": p["id"],
                    "invoice_no": p.get("proforma_no") or p["id"][:8],
                    "document_type": "Pro Forma",
                    "date": str(p.get("proforma_date") or ""),
                    "grand_total": float(p_gt),
                    "amount_received": float(p_adv),
                    "balance_due": float(p_bal),
                    "status": "Converted" if p["id"] in converted_pf_ids else (p.get("status") or "Active")
                })
            payment_history = []
            for p in cust_pmts:
                payment_history.append({
                    "id": p["id"],
                    "payment_no": p.get("payment_no") or p["id"][:8],
                    "payment_date": str(p.get("payment_date") or ""),
                    "amount": float(p.get("amount_received") or p.get("amount") or 0),
                    "payment_mode": p.get("payment_mode") or "Bank Transfer",
                    "reference_no": p.get("reference_no") or "-"
                })

            rows.append({
                "customer_id": pid,
                "customer_name": cust_name,
                "phone": phone,
                "gstin": gstin,
                "proforma_count": pf_count,
                "tax_invoice_count": tax_inv_count,
                "total_invoice_amount": float(cust_total_inv),
                "advance_received": float(cust_adv_rec),
                "additional_payments_received": float(cust_add_pmts),
                "total_received": float(cust_tot_rec),
                "balance_due": float(cust_bal_due),
                "invoices": invoice_history,
                "payments": payment_history
            })

        rows.sort(key=lambda r: r["customer_name"])

        return {
            "report_type": "customer-wise",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "summary": {
                "total_customers": len(rows),
                "total_invoice_amount": float(total_inv_amount_dec),
                "total_amount_received": float(total_received_dec),
                "total_outstanding": float(total_outstanding_dec)
            },
            "data": rows
        }

    def get_payments_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        payment_mode: Optional[str] = None,
        q: Optional[str] = None
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)
        clean_customer_id = str(customer_id).strip() if customer_id and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        clean_mode = str(payment_mode).strip().lower() if payment_mode and str(payment_mode).strip().lower() not in ("all", "all modes", "null", "undefined", "none", "") else None
        search_term = q.strip().lower() if q and q.strip() else None

        parties_res = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute()
        parties_map = {p["id"]: (p.get("display_name") or "Customer") for p in (parties_res.data or [])}

        invoices_res = self.db.table("invoices").select("id, invoice_no").eq("organization_id", organization_id).execute()
        invoices_map = {i["id"]: i.get("invoice_no") for i in (invoices_res.data or [])}

        pfs_res = self.db.table("proforma_invoices").select("id, proforma_no").eq("organization_id", organization_id).execute()
        pfs_map = {p["id"]: p.get("proforma_no") for p in (pfs_res.data or [])}

        alloc_by_pmt = {}
        try:
            alloc_res = self.db.table("payment_allocations").select("payment_id, invoice_id, amount, amount_allocated").eq("organization_id", organization_id).execute()
            for a in (alloc_res.data or []):
                pmt_id = a.get("payment_id")
                if pmt_id:
                    if pmt_id not in alloc_by_pmt:
                        alloc_by_pmt[pmt_id] = []
                    inv_id = a.get("invoice_id")
                    inv_no = invoices_map.get(inv_id) or pfs_map.get(inv_id) or (inv_id[:8] if inv_id else "-")
                    amt = float(a.get("amount_allocated") or a.get("amount") or 0)
                    alloc_by_pmt[pmt_id].append({"invoice_id": inv_id, "invoice_no": inv_no, "amount": amt})
        except Exception:
            pass

        query = self.db.table("payments").select("*").eq("organization_id", organization_id).eq("direction", "in")
        if iso_start:
            query = query.gte("payment_date", iso_start)
        if iso_end:
            query = query.lte("payment_date", iso_end)

        payments = query.order("payment_date", desc=True).execute().data or []

        rows = []
        total_received_dec = Decimal("0.00")
        cash_received_dec = Decimal("0.00")
        bank_upi_received_dec = Decimal("0.00")

        for p in payments:
            if p.get("is_reversed") or "[reversed:" in str(p.get("notes") or "").lower():
                continue

            pid = p.get("party_id")
            if clean_customer_id and pid != clean_customer_id:
                continue

            mode = str(p.get("payment_mode") or "Bank Transfer")
            if clean_mode and mode.lower() != clean_mode:
                continue

            cust_name = parties_map.get(pid) or "Customer"
            receipt_no = str(p.get("payment_no") or p.get("id")[:8])
            ref_no = str(p.get("reference_no") or "-")
            notes = str(p.get("notes") or "")

            # Linked invoice numbers
            allocations = alloc_by_pmt.get(p["id"], [])
            if not allocations:
                meta_allocs = (p.get("metadata") or {}).get("allocations") or []
                if isinstance(meta_allocs, list):
                    for a in meta_allocs:
                        inv_id = a.get("document_id") or a.get("invoice_id")
                        inv_no = invoices_map.get(inv_id) or pfs_map.get(inv_id) or (inv_id[:8] if inv_id else "-")
                        amt = float(a.get("amount_allocated") or a.get("amount") or 0)
                        allocations.append({"invoice_id": inv_id, "invoice_no": inv_no, "amount": amt})

            if allocations:
                inv_nos = ", ".join(list(dict.fromkeys(a["invoice_no"] for a in allocations)))
            elif p.get("invoice_id"):
                inv_nos = invoices_map.get(p["invoice_id"]) or pfs_map.get(p["invoice_id"]) or p["invoice_id"][:8]
            else:
                inv_nos = "-"

            if search_term:
                match_cust = search_term in cust_name.lower()
                match_rcpt = search_term in receipt_no.lower()
                match_ref = search_term in ref_no.lower()
                match_inv = search_term in inv_nos.lower()
                if not (match_cust or match_rcpt or match_ref or match_inv):
                    continue

            amt_dec = Decimal(str(p.get("amount_received") or p.get("amount") or 0))
            total_received_dec += amt_dec
            if mode.lower() == "cash":
                cash_received_dec += amt_dec
            else:
                bank_upi_received_dec += amt_dec

            rows.append({
                "id": p["id"],
                "payment_date": str(p.get("payment_date") or ""),
                "receipt_number": receipt_no,
                "customer_name": cust_name,
                "customer_id": pid,
                "invoice_number": inv_nos,
                "payment_method": mode,
                "reference_number": ref_no,
                "amount_received": float(amt_dec),
                "notes": notes,
                "allocations": allocations
            })

        return {
            "report_type": "payments",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "summary": {
                "receipt_count": len(rows),
                "total_payments_received": float(total_received_dec),
                "cash_received": float(cash_received_dec),
                "bank_upi_received": float(bank_upi_received_dec)
            },
            "data": rows
        }

    def get_advance_received_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        q: Optional[str] = None
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)
        clean_customer_id = str(customer_id).strip() if customer_id and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        search_term = q.strip().lower() if q and q.strip() else None

        parties_res = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute()
        parties_map = {p["id"]: (p.get("display_name") or "Customer") for p in (parties_res.data or [])}

        invoices_res = self.db.table("invoices").select("*").eq("organization_id", organization_id).execute()
        invoices = invoices_res.data or []
        inv_by_source_pf = {}
        for inv in invoices:
            spf = inv.get("source_proforma_id") or (inv.get("metadata") or {}).get("source_proforma_id")
            if spf:
                inv_by_source_pf[spf] = inv

        pf_query = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            pf_query = pf_query.gte("proforma_date", iso_start)
        if iso_end:
            pf_query = pf_query.lte("proforma_date", iso_end)

        proformas = [p for p in (pf_query.order("proforma_date", desc=True).execute().data or []) if str(p.get("status") or "").upper() != "CANCELLED"]

        rows = []
        total_adv_received_dec = Decimal("0.00")
        total_adv_applied_dec = Decimal("0.00")

        for pf in proformas:
            meta = pf.get("metadata") or {}
            adv_dec = Decimal(str(pf.get("advance_received") or pf.get("amount_paid") or meta.get("advance_received") or meta.get("amount_paid") or 0))
            if adv_dec <= Decimal("0.00"):
                continue

            pid = pf.get("party_id") or pf.get("customer_id")
            if clean_customer_id and pid != clean_customer_id:
                continue

            cust_name = parties_map.get(pid) or "Customer"
            pf_no = str(pf.get("proforma_no") or pf["id"][:8])

            # Check if converted
            conv_inv = inv_by_source_pf.get(pf["id"])
            if not conv_inv and pf.get("converted_document_id"):
                conv_inv = next((i for i in invoices if i["id"] == pf["converted_document_id"]), None)

            is_converted = bool(conv_inv) or str(pf.get("status") or "").upper() == "CONVERTED"
            conv_inv_no = conv_inv.get("invoice_no") if conv_inv else "-"
            conv_inv_id = conv_inv.get("id") if conv_inv else None

            if search_term:
                match_cust = search_term in cust_name.lower()
                match_pf = search_term in pf_no.lower()
                match_inv = search_term in conv_inv_no.lower()
                if not (match_cust or match_pf or match_inv):
                    continue

            total_dec = Decimal(str(pf.get("grand_total") or 0))
            if is_converted and conv_inv:
                applied_dec = adv_dec
                bal_dec = Decimal(str(conv_inv.get("balance_due") or max(0, total_dec - adv_dec)))
                status_label = "Converted"
            else:
                applied_dec = Decimal("0.00")
                bal_dec = max(Decimal("0.00"), total_dec - adv_dec)
                status_label = "Active"

            total_adv_received_dec += adv_dec
            total_adv_applied_dec += applied_dec

            rows.append({
                "receipt_date": str(pf.get("proforma_date") or ""),
                "proforma_invoice_no": pf_no,
                "proforma_id": pf["id"],
                "customer_name": cust_name,
                "customer_id": pid,
                "invoice_total": float(total_dec),
                "advance_received": float(adv_dec),
                "advance_applied": float(applied_dec),
                "remaining_balance": float(bal_dec),
                "tax_invoice_number": conv_inv_no,
                "tax_invoice_id": conv_inv_id,
                "status": status_label
            })

        unapplied_dec = max(Decimal("0.00"), total_adv_received_dec - total_adv_applied_dec)

        return {
            "report_type": "advances",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "summary": {
                "total_advances_received": float(total_adv_received_dec),
                "advance_receipts_count": len(rows),
                "advances_applied_to_tax_invoices": float(total_adv_applied_dec),
                "unapplied_advance_balance": float(unapplied_dec)
            },
            "data": rows
        }

    def get_balance_due_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        invoice_type: Optional[str] = None,
        status: Optional[str] = None,
        include_paid: bool = False,
        q: Optional[str] = None
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)
        clean_customer_id = str(customer_id).strip() if customer_id and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        clean_type = str(invoice_type).strip().lower() if invoice_type and str(invoice_type).strip().lower() not in ("all", "null", "undefined", "none", "") else None
        clean_status = str(status).strip().lower() if status and str(status).strip().lower() not in ("all", "null", "undefined", "none", "") else None
        search_term = q.strip().lower() if q and q.strip() else None

        today = date.today()

        parties_res = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute()
        parties_map = {p["id"]: (p.get("display_name") or "Customer") for p in (parties_res.data or [])}

        # Tax Invoices
        inv_query = self.db.table("invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            inv_query = inv_query.gte("invoice_date", iso_start)
        if iso_end:
            inv_query = inv_query.lte("invoice_date", iso_end)
        invoices = [i for i in (inv_query.execute().data or []) if str(i.get("status") or "").lower() != "cancelled"]

        # Proforma Invoices (exclude converted ones to prevent duplicate debt entries!)
        pf_query = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            pf_query = pf_query.gte("proforma_date", iso_start)
        if iso_end:
            pf_query = pf_query.lte("proforma_date", iso_end)
        proformas = [p for p in (pf_query.execute().data or []) if str(p.get("status") or "").upper() not in ("CONVERTED", "CANCELLED") and not p.get("converted_document_id")]

        rows = []
        total_outstanding_dec = Decimal("0.00")
        overdue_amount_dec = Decimal("0.00")
        unpaid_count = 0
        partially_paid_count = 0

        # Process Tax Invoices
        if clean_type != "proforma":
            for inv in invoices:
                pid = inv.get("party_id") or inv.get("customer_id")
                if clean_customer_id and pid != clean_customer_id:
                    continue

                cust_name = parties_map.get(pid) or "Customer"
                inv_no = str(inv.get("invoice_no") or inv["id"][:8])

                if search_term and not (search_term in cust_name.lower() or search_term in inv_no.lower()):
                    continue

                gt_dec = Decimal(str(inv.get("grand_total") or 0))
                adv_dec = Decimal(str(inv.get("advance_received") or 0))
                paid_dec = Decimal(str(inv.get("amount_paid") or 0))
                add_pmts_dec = max(Decimal("0.00"), paid_dec - adv_dec)
                tot_rec_dec = paid_dec
                bal_dec = Decimal(str(inv.get("balance_due") or max(0, gt_dec - tot_rec_dec)))

                if not include_paid and bal_dec <= Decimal("0.01"):
                    continue

                # Due date and overdue check
                due_date_str = str(inv.get("due_date") or "")
                days_overdue = 0
                is_overdue = False
                if due_date_str and bal_dec > Decimal("0.01"):
                    try:
                        dt = datetime.strptime(due_date_str[:10], "%Y-%m-%d").date()
                        if dt < today:
                            days_overdue = (today - dt).days
                            is_overdue = True
                    except Exception:
                        pass

                if bal_dec <= Decimal("0.01"):
                    st_label = "Paid"
                elif is_overdue:
                    st_label = "Overdue"
                elif tot_rec_dec > Decimal("0.01"):
                    st_label = "Partially Paid"
                else:
                    st_label = "Unpaid"

                if clean_status and clean_status != st_label.lower().replace(" ", "_"):
                    continue

                total_outstanding_dec += bal_dec
                if is_overdue:
                    overdue_amount_dec += bal_dec
                if st_label in ("Unpaid", "Overdue") and tot_rec_dec <= Decimal("0.01"):
                    unpaid_count += 1
                elif st_label == "Partially Paid" or (is_overdue and tot_rec_dec > Decimal("0.01")):
                    partially_paid_count += 1

                rows.append({
                    "invoice_date": str(inv.get("invoice_date") or ""),
                    "invoice_number": inv_no,
                    "invoice_id": inv["id"],
                    "invoice_type": "Tax Invoice",
                    "customer_name": cust_name,
                    "customer_id": pid,
                    "invoice_total": float(gt_dec),
                    "advance_received": float(adv_dec),
                    "additional_payments_received": float(add_pmts_dec),
                    "total_received": float(tot_rec_dec),
                    "balance_due": float(bal_dec),
                    "due_date": due_date_str or "-",
                    "days_overdue": days_overdue,
                    "payment_status": st_label
                })

        # Process Unconverted Proforma Invoices
        if clean_type != "invoice":
            for pf in proformas:
                pid = pf.get("party_id") or pf.get("customer_id")
                if clean_customer_id and pid != clean_customer_id:
                    continue

                cust_name = parties_map.get(pid) or "Customer"
                pf_no = str(pf.get("proforma_no") or pf["id"][:8])

                if search_term and not (search_term in cust_name.lower() or search_term in pf_no.lower()):
                    continue

                gt_dec = Decimal(str(pf.get("grand_total") or 0))
                adv_dec = Decimal(str(pf.get("advance_received") or pf.get("amount_paid") or 0))
                tot_rec_dec = adv_dec
                bal_dec = Decimal(str(pf.get("balance_due") or max(0, gt_dec - tot_rec_dec)))

                if not include_paid and bal_dec <= Decimal("0.01"):
                    continue

                # Note: Do not treat Pro Forma Valid Till as payment due date unless explicitly defined
                due_date_str = str(pf.get("valid_till") or "")
                days_overdue = 0
                is_overdue = False

                if bal_dec <= Decimal("0.01"):
                    st_label = "Paid"
                elif tot_rec_dec > Decimal("0.01"):
                    st_label = "Partially Paid"
                else:
                    st_label = "Unpaid"

                if clean_status and clean_status != st_label.lower().replace(" ", "_"):
                    continue

                total_outstanding_dec += bal_dec
                if st_label == "Unpaid":
                    unpaid_count += 1
                elif st_label == "Partially Paid":
                    partially_paid_count += 1

                rows.append({
                    "invoice_date": str(pf.get("proforma_date") or ""),
                    "invoice_number": pf_no,
                    "invoice_id": pf["id"],
                    "invoice_type": "Pro Forma",
                    "customer_name": cust_name,
                    "customer_id": pid,
                    "invoice_total": float(gt_dec),
                    "advance_received": float(adv_dec),
                    "additional_payments_received": 0.0,
                    "total_received": float(tot_rec_dec),
                    "balance_due": float(bal_dec),
                    "due_date": due_date_str or "-",
                    "days_overdue": days_overdue,
                    "payment_status": st_label
                })

        rows.sort(key=lambda r: (r["payment_status"] != "Overdue", r["invoice_date"]), reverse=False)

        return {
            "report_type": "balance-due",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "summary": {
                "total_outstanding": float(total_outstanding_dec),
                "overdue_amount": float(overdue_amount_dec),
                "unpaid_invoices_count": unpaid_count,
                "partially_paid_invoices_count": partially_paid_count
            },
            "data": rows
        }

    def get_proforma_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)
        clean_customer_id = str(customer_id).strip() if customer_id and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        clean_status = str(status).strip().lower() if status and str(status).strip().lower() not in ("all", "null", "undefined", "none", "") else None
        search_term = q.strip().lower() if q and q.strip() else None

        parties_res = self.db.table("parties").select("id, display_name").eq("organization_id", organization_id).execute()
        parties_map = {p["id"]: (p.get("display_name") or "Customer") for p in (parties_res.data or [])}

        invoices_res = self.db.table("invoices").select("id, invoice_no").eq("organization_id", organization_id).execute()
        inv_by_id = {i["id"]: i.get("invoice_no") for i in (invoices_res.data or [])}

        query = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            query = query.gte("proforma_date", iso_start)
        if iso_end:
            query = query.lte("proforma_date", iso_end)

        proformas = [p for p in (query.order("proforma_date", desc=True).execute().data or []) if str(p.get("status") or "").upper() != "CANCELLED"]

        rows = []
        total_value_dec = Decimal("0.00")
        total_adv_dec = Decimal("0.00")
        converted_count = 0
        pending_count = 0

        for pf in proformas:
            pid = pf.get("party_id") or pf.get("customer_id")
            if clean_customer_id and pid != clean_customer_id:
                continue

            cust_name = parties_map.get(pid) or "Customer"
            pf_no = str(pf.get("proforma_no") or pf["id"][:8])

            conv_doc_id = pf.get("converted_document_id")
            conv_inv_no = inv_by_id.get(conv_doc_id) if conv_doc_id else "-"
            is_converted = bool(conv_doc_id and conv_doc_id in inv_by_id) or str(pf.get("status") or "").upper() == "CONVERTED"

            st_val = "Converted" if is_converted else (pf.get("status") or "Pending Conversion")
            if clean_status and clean_status != st_val.lower().replace(" ", "_"):
                continue

            if search_term:
                match_cust = search_term in cust_name.lower()
                match_pf = search_term in pf_no.lower()
                match_inv = search_term in conv_inv_no.lower()
                if not (match_cust or match_pf or match_inv):
                    continue

            taxable_dec = Decimal(str(pf.get("taxable_total") or pf.get("subtotal") or 0))
            gst_dec = Decimal(str(pf.get("tax_total") or 0))
            gt_dec = Decimal(str(pf.get("grand_total") or 0))
            adv_dec = Decimal(str(pf.get("advance_received") or pf.get("amount_paid") or 0))
            bal_dec = max(Decimal("0.00"), gt_dec - adv_dec)

            total_value_dec += gt_dec
            total_adv_dec += adv_dec
            if is_converted:
                converted_count += 1
            else:
                pending_count += 1

            rows.append({
                "proforma_number": pf_no,
                "proforma_id": pf["id"],
                "invoice_date": str(pf.get("proforma_date") or ""),
                "valid_till": str(pf.get("valid_till") or "-"),
                "customer_name": cust_name,
                "customer_id": pid,
                "total_before_tax": float(taxable_dec),
                "gst_amount": float(gst_dec),
                "invoice_total": float(gt_dec),
                "advance_received": float(adv_dec),
                "balance_payable": float(bal_dec),
                "conversion_status": st_val,
                "converted_tax_invoice_number": conv_inv_no
            })

        return {
            "report_type": "proforma",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "summary": {
                "total_proforma_invoices": len(rows),
                "total_proforma_value": float(total_value_dec),
                "total_advances_received": float(total_adv_dec),
                "converted_count": converted_count,
                "pending_conversion_count": pending_count
            },
            "data": rows
        }

    def get_tax_invoices_report(
        self,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        customer_id: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None
    ) -> Dict[str, Any]:
        iso_start = _parse_iso_date(start_date)
        iso_end = _parse_iso_date(end_date)
        clean_customer_id = str(customer_id).strip() if customer_id and str(customer_id).strip().lower() not in ("all", "all customers", "null", "undefined", "none", "") else None
        clean_status = str(status).strip().lower() if status and str(status).strip().lower() not in ("all", "null", "undefined", "none", "") else None
        search_term = q.strip().lower() if q and q.strip() else None

        today = date.today()

        parties_res = self.db.table("parties").select("*").eq("organization_id", organization_id).execute()
        parties_map = {p["id"]: p for p in (parties_res.data or [])}

        query = self.db.table("invoices").select("*").eq("organization_id", organization_id)
        if iso_start:
            query = query.gte("invoice_date", iso_start)
        if iso_end:
            query = query.lte("invoice_date", iso_end)

        invoices = [i for i in (query.order("invoice_date", desc=True).execute().data or []) if str(i.get("status") or "").lower() != "cancelled"]

        rows = []
        total_taxable_dec = Decimal("0.00")
        total_gst_dec = Decimal("0.00")
        total_inv_value_dec = Decimal("0.00")
        total_received_dec = Decimal("0.00")
        total_outstanding_dec = Decimal("0.00")

        for inv in invoices:
            pid = inv.get("party_id") or inv.get("customer_id")
            if clean_customer_id and pid != clean_customer_id:
                continue

            party_info = parties_map.get(pid, {})
            cust_name = party_info.get("display_name") or "Customer"
            cust_gstin = inv.get("customer_gstin") or inv.get("bill_gstin") or party_info.get("gstin") or "-"
            inv_no = str(inv.get("invoice_no") or inv["id"][:8])

            if search_term:
                match_cust = search_term in cust_name.lower()
                match_inv = search_term in inv_no.lower()
                match_gst = search_term in str(cust_gstin).lower()
                if not (match_cust or match_inv or match_gst):
                    continue

            taxable_dec = Decimal(str(inv.get("taxable_total") or inv.get("subtotal") or 0))
            cgst_dec = Decimal(str(inv.get("cgst_total") or 0))
            sgst_dec = Decimal(str(inv.get("sgst_total") or 0))
            igst_dec = Decimal(str(inv.get("igst_total") or 0))
            gst_dec = Decimal(str(inv.get("tax_total") or (cgst_dec + sgst_dec + igst_dec)))
            gt_dec = Decimal(str(inv.get("grand_total") or 0))

            adv_dec = Decimal(str(inv.get("advance_received") or 0))
            paid_dec = Decimal(str(inv.get("amount_paid") or 0))
            add_pmts_dec = max(Decimal("0.00"), paid_dec - adv_dec)
            bal_dec = Decimal(str(inv.get("balance_due") or max(0, gt_dec - paid_dec)))

            # Due date and status
            due_date_str = str(inv.get("due_date") or "")
            is_overdue = False
            if due_date_str and bal_dec > Decimal("0.01"):
                try:
                    dt = datetime.strptime(due_date_str[:10], "%Y-%m-%d").date()
                    if dt < today:
                        is_overdue = True
                except Exception:
                    pass

            if bal_dec <= Decimal("0.01") and gt_dec > Decimal("0.00"):
                st_label = "Paid"
            elif is_overdue:
                st_label = "Overdue"
            elif paid_dec > Decimal("0.01"):
                st_label = "Partially Paid"
            else:
                st_label = "Unpaid"

            if clean_status and clean_status != st_label.lower().replace(" ", "_"):
                continue

            total_taxable_dec += taxable_dec
            total_gst_dec += gst_dec
            total_inv_value_dec += gt_dec
            total_received_dec += paid_dec
            total_outstanding_dec += bal_dec

            rows.append({
                "invoice_number": inv_no,
                "invoice_id": inv["id"],
                "invoice_date": str(inv.get("invoice_date") or ""),
                "customer_name": cust_name,
                "customer_id": pid,
                "customer_gstin": cust_gstin,
                "taxable_amount": float(taxable_dec),
                "cgst": float(cgst_dec),
                "sgst": float(sgst_dec),
                "igst": float(igst_dec),
                "total_gst": float(gst_dec),
                "invoice_total": float(gt_dec),
                "advance_received": float(adv_dec),
                "additional_payments": float(add_pmts_dec),
                "balance_due": float(bal_dec),
                "due_date": due_date_str or "-",
                "payment_status": st_label
            })

        return {
            "report_type": "tax-invoices",
            "start_date": iso_start or start_date,
            "end_date": iso_end or end_date,
            "summary": {
                "total_tax_invoices": len(rows),
                "total_taxable_value": float(total_taxable_dec),
                "total_gst": float(total_gst_dec),
                "total_invoice_value": float(total_inv_value_dec),
                "total_received": float(total_received_dec),
                "total_outstanding": float(total_outstanding_dec)
            },
            "data": rows
        }

    def get_receivables_report(self, organization_id: str) -> Dict[str, Any]:
        return self.get_balance_due_report(organization_id=organization_id)
