import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta, date
from fastapi import HTTPException, status
from app.repositories.proforma_repository import ProformaRepository
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals
from app.schemas.proforma import ProFormaCreate, ProFormaUpdate
from app.utils.num2words import number_to_words_indian

logger = logging.getLogger(__name__)

class ProformaService:
    def __init__(self, token: Optional[str] = None):
        self.proforma_repo = ProformaRepository(token=token)
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

    def _ensure_party_id(
        self,
        organization_id: str,
        party_id: Optional[str],
        customer_name: Optional[str],
        customer_company_name: Optional[str] = None,
        customer_email: Optional[str] = None,
        customer_phone: Optional[str] = None,
        state_name: Optional[str] = None,
        country: Optional[str] = None,
        user_id: str = ""
    ) -> str:
        if party_id and str(party_id).strip():
            p = self.party_repo.get_by_id(str(party_id).strip(), organization_id)
            if p:
                return str(party_id).strip()

        display_name = str(customer_name or customer_company_name or "Customer").strip()

        try:
            parties = self.party_repo.get_all(organization_id)
            if parties:
                for m in parties:
                    if str(m.get("display_name", "")).strip().lower() == display_name.lower():
                        return str(m["id"])
                return str(parties[0]["id"])
        except Exception as e:
            logger.warning(f"Error searching party: {e}")

        try:
            from app.schemas.party import PartyCreate
            c_code = "IN"
            country_raw = str(country or "IN").strip().upper()
            if len(country_raw) == 2:
                c_code = country_raw

            party_payload = PartyCreate(
                party_type="customer",
                display_name=display_name,
                legal_name=customer_company_name or display_name,
                contact_person=display_name,
                city=None,
                state_name=state_name or None,
                country_code=c_code,
                phone=customer_phone or None,
                email=customer_email or None
            )
            created_party = self.party_repo.create(organization_id, party_payload, user_id)
            if created_party and created_party.get("id"):
                return str(created_party["id"])
        except Exception as e:
            logger.error(f"Error auto-creating customer party: {e}")

        return ""

    def create_proforma(self, organization_id: str, data: ProFormaCreate, user_id: str) -> Dict[str, Any]:
        company = self.get_company_details(organization_id)
        company_state = company.get("state_name") or company.get("state") or "Maharashtra"
        company_country = company.get("country_name") or company.get("country") or "India"




        data.party_id = self._ensure_party_id(
            organization_id=organization_id,
            party_id=data.party_id,
            customer_name=data.customer_name,
            customer_company_name=data.customer_company_name,
            customer_email=data.customer_email,
            customer_phone=data.customer_phone,
            state_name=data.place_of_supply_state,
            country=data.customer_country or company_country,
            user_id=user_id
        ) or data.party_id
        
        customer = self.get_customer_details(data.party_id, organization_id)
        customer_state = data.place_of_supply_state or customer.get("state_name") or customer.get("state_code") or ""
        customer_country = data.customer_country or customer.get("country_name") or customer.get("country") or company_country

        # Convert Pydantic data into dictionary cleanly to prevent attribute access errors
        payload_dict = data.model_dump(exclude={"items"}, mode="json")
        raw_items = [item.model_dump(mode="json") for item in data.items]

        export_type = payload_dict.get("export_type") or "DOMESTIC"
        discount_type = payload_dict.get("discount_type") or payload_dict.get("additional_discount_type") or "amount"
        discount_value = payload_dict.get("discount_value") if payload_dict.get("discount_value") is not None else payload_dict.get("additional_discount_value", 0.0)

        calc_result = calculate_document_totals(
            raw_items,
            company_state,
            customer_state,
            company_country=company_country,
            customer_country=customer_country,
            exchange_rate=payload_dict.get("exchange_rate", 1.0),
            amount_paid=payload_dict.get("amount_paid", 0.0),
            export_type=export_type,
            overall_discount_type=discount_type,
            overall_discount_value=discount_value,
            doc_currency=payload_dict.get("currency_code", "INR")
        )
        
        proforma_no = payload_dict.get("proforma_no") or self.proforma_repo.generate_proforma_no(organization_id)
        
        header_data = {
            **payload_dict,
            "organization_id": organization_id,
            "created_by": user_id,
            "proforma_no": proforma_no,
            "proforma_date": str(data.proforma_date),
            "valid_till": str(data.valid_till) if data.valid_till else None,
            "due_date": str(data.due_date) if data.due_date else None,
            "etd_date": str(data.etd_date) if data.etd_date else None,
            "eta_date": str(data.eta_date) if data.eta_date else None,
            "customer_po_date": str(data.customer_po_date) if data.customer_po_date else None,
            "party_id": data.party_id,
            "place_of_supply_state": customer_state,
            "customer_country": customer_country,
            
            "subtotal": float(calc_result.subtotal),
            "discount_total": float(calc_result.discount_total),
            "taxable_total": float(calc_result.taxable_total),
            "cgst_total": float(calc_result.cgst_total),
            "sgst_total": float(calc_result.sgst_total),
            "igst_total": float(calc_result.igst_total),
            "total_cgst": float(calc_result.cgst_total),
            "total_sgst": float(calc_result.sgst_total),
            "total_igst": float(calc_result.igst_total),
            "tax_total": float(calc_result.tax_total),

            "round_off": float(calc_result.round_off),
            "grand_total": float(calc_result.grand_total),
            "balance_due": float(calc_result.balance_due),
            "status": payload_dict.get("status") or "DRAFT",
        }
        
        items_data = [item.to_dict() for item in calc_result.items]
        res = self.proforma_repo.create(header_data, items_data)
        res["grand_total_in_words"] = calc_result.grand_total_in_words
        res["customer"] = customer
        return res

    def get_proformas(self, organization_id: str) -> List[Dict[str, Any]]:
        proformas = self.proforma_repo.get_all(organization_id)
        for p in proformas:
            if p.get("party_id"):
                p["customer"] = self.get_customer_details(p["party_id"], organization_id)
        return proformas

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

    def _build_full_proforma_payload(self, proforma: Dict[str, Any], organization_id: str) -> Dict[str, Any]:
        company = self.get_company_details(organization_id)
        party_id = proforma.get("customer_id") or proforma.get("party_id")
        customer = self.get_customer_details(party_id, organization_id) if party_id else {}

        bill_name = (
            proforma.get("bill_name") or
            proforma.get("customer_name") or
            customer.get("display_name") or
            customer.get("legal_name") or
            "Customer"
        )
        bill_address = (
            proforma.get("bill_address_line1") or
            proforma.get("customer_address") or
            customer.get("billing_address_line1") or
            ""
        )
        bill_city = proforma.get("bill_city") or proforma.get("customer_city") or customer.get("city") or ""
        bill_state = proforma.get("bill_state") or proforma.get("place_of_supply_state") or customer.get("state_name") or ""
        bill_gstin = proforma.get("bill_gstin") or proforma.get("customer_gstin") or customer.get("gstin") or ""
        bill_phone = proforma.get("bill_phone") or proforma.get("customer_phone") or customer.get("phone") or ""
        bill_email = proforma.get("bill_email") or proforma.get("customer_email") or customer.get("email") or ""

        proforma["bill_name"] = bill_name
        proforma["bill_address_line1"] = bill_address
        proforma["bill_city"] = bill_city
        proforma["bill_state"] = bill_state
        proforma["bill_gstin"] = bill_gstin
        proforma["bill_phone"] = bill_phone
        proforma["bill_email"] = bill_email
        proforma["customer_name"] = bill_name

        if proforma.get("ship_same_as_bill", True) or not proforma.get("ship_name"):
            proforma["ship_same_as_bill"] = True
            proforma["ship_name"] = bill_name
            proforma["ship_address_line1"] = bill_address
            proforma["ship_city"] = bill_city
            proforma["ship_state"] = bill_state
            proforma["ship_gstin"] = bill_gstin
            proforma["ship_phone"] = bill_phone

        date_str = str(proforma.get("proforma_date") or proforma.get("invoice_date") or datetime.now().date())
        valid_till_str = str(proforma.get("valid_till") or "")
        try:
            vt_dt = datetime.strptime(valid_till_str, "%Y-%m-%d").date()
            if vt_dt.year < 2000 or vt_dt.year > 2100:
                raise ValueError()
        except Exception:
            try:
                base_dt = datetime.strptime(date_str, "%Y-%m-%d").date()
                vt_dt = base_dt + timedelta(days=30)
                valid_till_str = str(vt_dt)
            except Exception:
                valid_till_str = date_str

        proforma["proforma_date"] = date_str
        proforma["invoice_date"] = date_str
        proforma["valid_till"] = valid_till_str

        company_state = company.get("state_name") or company.get("state") or ""
        customer_state = proforma.get("place_of_supply_state") or bill_state or ""
        export_type = proforma.get("export_type") or "DOMESTIC"
        discount_type = proforma.get("discount_type") or proforma.get("additional_discount_type") or "amount"
        discount_value = proforma.get("discount_value") if proforma.get("discount_value") is not None else proforma.get("additional_discount_value", 0.0)

        raw_items_for_calc = [dict(it) for it in proforma.get("items", [])]

        calc_res = calculate_document_totals(
            raw_items_for_calc,
            company_state,
            customer_state,
            exchange_rate=proforma.get("exchange_rate", 1.0),
            amount_paid=proforma.get("amount_paid", 0.0),
            export_type=export_type,
            overall_discount_type=discount_type,
            overall_discount_value=discount_value,
            doc_currency=proforma.get("currency_code", "INR")
        )

        proforma["items"] = [item.to_dict() for item in calc_res.items]
        proforma["subtotal"] = float(calc_res.subtotal)
        proforma["discount_total"] = float(calc_res.discount_total)
        proforma["taxable_total"] = float(calc_res.taxable_total)
        proforma["taxable_subtotal"] = float(calc_res.taxable_total)
        proforma["cgst_total"] = float(calc_res.cgst_total)
        proforma["sgst_total"] = float(calc_res.sgst_total)
        proforma["igst_total"] = float(calc_res.igst_total)
        proforma["total_cgst"] = float(calc_res.cgst_total)
        proforma["total_sgst"] = float(calc_res.sgst_total)
        proforma["total_igst"] = float(calc_res.igst_total)
        proforma["tax_total"] = float(calc_res.tax_total)
        proforma["round_off"] = float(calc_res.round_off)
        proforma["grand_total"] = float(calc_res.grand_total)
        proforma["gross_total"] = float(calc_res.subtotal)

        adv = float(proforma.get("advance_received") or proforma.get("amount_paid") or 0.0)
        proforma["advance_received"] = adv
        proforma["amount_paid"] = adv
        proforma["balance_due"] = max(0.0, float(calc_res.grand_total) - adv)
        proforma["balance_amount"] = proforma["balance_due"]

        norm_company_state = str(company_state).strip().upper()
        norm_customer_state = str(customer_state).strip().upper()
        if norm_company_state and norm_customer_state and norm_company_state == norm_customer_state:
            proforma["supply_type"] = "intra"
        else:
            proforma["supply_type"] = "inter"

        proforma["hsn_summary"] = self._build_hsn_summary(proforma["items"])

        curr_code = str(proforma.get("currency_code") or "INR").upper()
        curr_sym = "₹" if curr_code == "INR" else "$"
        proforma["currency_code"] = curr_code
        proforma["currency_symbol"] = curr_sym
        prefix = None if curr_code == "INR" else f"{curr_code} DOLLARS"
        proforma["grand_total_in_words"] = number_to_words_indian(calc_res.grand_total, currency_prefix=prefix)

        proforma["company"] = company
        proforma["customer"] = customer

        bank_accounts = company.get("bank_accounts") or []
        selected_bank = None
        if bank_accounts:
            target_id = str(proforma.get("bank_account_id") or "")
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
        proforma["bank"] = selected_bank

        return proforma

    def get_proforma(self, proforma_id: str, organization_id: str) -> Dict[str, Any]:
        proforma = self.proforma_repo.get_by_id(proforma_id, organization_id)
        if not proforma:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pro Forma invoice not found")
        
        return self._build_full_proforma_payload(proforma, organization_id)

    def update_proforma(self, proforma_id: str, organization_id: str, data: ProFormaUpdate) -> Dict[str, Any]:
        existing = self.get_proforma(proforma_id, organization_id)
        if existing.get("status") == "CONVERTED":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit a converted Pro Forma invoice")

        data.party_id = self._ensure_party_id(
            organization_id=organization_id,
            party_id=data.party_id or existing.get("party_id"),
            customer_name=data.customer_name or existing.get("customer_name"),
            customer_company_name=data.customer_company_name or existing.get("customer_company_name"),
            customer_email=data.customer_email or existing.get("customer_email"),
            customer_phone=data.customer_phone or existing.get("customer_phone"),
            state_name=data.place_of_supply_state or existing.get("place_of_supply_state"),
            country=data.customer_country or existing.get("customer_country"),
            user_id=existing.get("created_by", "")
        ) or data.party_id
            
        header_updates = data.model_dump(exclude_unset=True, exclude={"items"}, mode="json")
        items_data = None
        
        if data.items is not None:
            company_state = self.get_company_details(organization_id).get("state_name") or ""
            customer_state = data.place_of_supply_state or existing.get("place_of_supply_state") or self.get_customer_details(existing.get("party_id"), organization_id).get("state_name") or ""
            raw_items = [item.model_dump(mode="json") for item in data.items]

            export_type = header_updates.get("export_type") or existing.get("export_type") or "DOMESTIC"
            discount_type = header_updates.get("discount_type") or existing.get("discount_type") or "amount"
            discount_value = header_updates.get("discount_value") if header_updates.get("discount_value") is not None else existing.get("discount_value", 0.0)

            calc_result = calculate_document_totals(
                raw_items,
                company_state,
                customer_state,
                exchange_rate=data.exchange_rate or existing.get("exchange_rate", 1.0),
                amount_paid=header_updates.get("amount_paid", existing.get("amount_paid", 0.0)),
                export_type=export_type,
                overall_discount_type=discount_type,
                overall_discount_value=discount_value
            )
            
            header_updates.update({
                "subtotal": float(calc_result.subtotal),
                "discount_total": float(calc_result.discount_total),
                "taxable_total": float(calc_result.taxable_total),
                "cgst_total": float(calc_result.cgst_total),
                "sgst_total": float(calc_result.sgst_total),
                "igst_total": float(calc_result.igst_total),
                "tax_total": float(calc_result.tax_total),
                "round_off": float(calc_result.round_off),
                "grand_total": float(calc_result.grand_total),
                "balance_due": float(calc_result.balance_due)
            })
            items_data = [item.to_dict() for item in calc_result.items]
            
        return self.proforma_repo.update(proforma_id, organization_id, header_updates, items_data)

    def convert_to_invoice(self, proforma_id: str, organization_id: str, user_id: str, amount_paid: Optional[float] = None) -> Dict[str, Any]:
        proforma = self.get_proforma(proforma_id, organization_id)
        if not proforma:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pro Forma invoice not found")

        if proforma.get("organization_id") and str(proforma["organization_id"]) != str(organization_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Pro Forma belongs to a different organization.")

        pf_status = str(proforma.get("status") or "").upper()
        converted_doc_id = proforma.get("converted_document_id") or proforma.get("convertedDocumentId")
        
        if pf_status == "CONVERTED" or converted_doc_id:
            existing_inv = None
            if converted_doc_id:
                existing_inv = self.invoice_repo.get_by_id(converted_doc_id, organization_id)
            if not existing_inv:
                res = self.db.table("invoices").select("*").eq("organization_id", organization_id).eq("source_proforma_id", proforma_id).limit(1).execute()
                if res.data:
                    existing_inv = res.data[0]
            
            existing_no = existing_inv.get("invoice_no") if existing_inv else "unknown"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Sales Pro Forma {proforma.get('proforma_no')} is already converted to Tax Invoice {existing_no}."
            )

        if pf_status in ["CANCELLED", "REJECTED"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot convert a cancelled or rejected Pro Forma Invoice: {proforma.get('proforma_no')}"
            )        # Execute ONE conversion path: database stored procedure convert_sales_proforma_to_invoice
        try:
            rpc_res = self.admin_db.rpc("convert_sales_proforma_to_invoice", {
                "p_proforma_id": proforma_id
            }).execute()
        except Exception as rpc_err:
            err_str = str(rpc_err)
            if "P0404" in err_str or "not found" in err_str.lower():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Sales Pro Forma not found: {proforma_id}")
            if "P0403" in err_str or "forbidden" in err_str.lower() or "unauthorized" in err_str.lower():
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Pro Forma belongs to a different organization.")
            if "P0409" in err_str or "already converted" in err_str.lower():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Sales Pro Forma {proforma.get('proforma_no')} is already converted.")
            if "P0410" in err_str or "cancelled" in err_str.lower() or "rejected" in err_str.lower():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot convert a cancelled or rejected Pro Forma Invoice: {proforma.get('proforma_no')}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Database conversion error: {err_str}")

        if not rpc_res.data:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored procedure returned empty result.")

        rpc_dict = rpc_res.data if isinstance(rpc_res.data, dict) else {}
        new_inv_id = rpc_dict.get("invoice_id") or (str(rpc_res.data) if isinstance(rpc_res.data, str) else None)
        new_inv_no = rpc_dict.get("invoice_no")

        if not new_inv_id:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored procedure returned no invoice_id.")

        inv = self.invoice_repo.get_by_id(new_inv_id, organization_id)
        if not inv:
            admin_res = self.admin_db.table("invoices").select("*").eq("id", new_inv_id).execute()
            if admin_res.data:
                from app.repositories.invoice_repository import unpack_invoice_header_result
                inv = unpack_invoice_header_result(admin_res.data[0])
        if inv:
            inv["invoice_id"] = new_inv_id
            if new_inv_no:
                inv["invoice_no"] = new_inv_no
            return inv

        return {
            "id": new_inv_id,
            "invoice_id": new_inv_id,
            "invoice_no": new_inv_no or "INV-UNKNOWN",
            "organization_id": organization_id,
            "status": "issued"
        }

    def delete_proforma(self, proforma_id: str, organization_id: str) -> bool:
        proforma = self.proforma_repo.get_by_id(proforma_id, organization_id)
        if not proforma:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pro Forma invoice not found")
        return self.proforma_repo.delete(proforma_id, organization_id)

    def delete_all_proformas(self, organization_id: str) -> int:
        return self.proforma_repo.delete_all(organization_id)
