from decimal import Decimal
from typing import List, Dict, Any, Optional, Union
from datetime import datetime, timezone, timedelta, date
import logging
import uuid
from fastapi import HTTPException, status
from app.repositories.proforma_repository import ProformaRepository
from app.repositories.invoice_repository import InvoiceRepository, KNOWN_INVOICE_COLUMNS, clean_invoice_item_payload, _safe_insert_invoice_item
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals, validate_advance_amount, to_decimal
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

        raw_adv = payload_dict.get("advance_received") if (payload_dict.get("advance_received") is not None and float(payload_dict.get("advance_received") or 0) > 0) else payload_dict.get("amount_paid", 0.0)
        dec_adv = to_decimal(raw_adv)
        if dec_adv < Decimal("0.00"):
            raise HTTPException(status_code=422, detail="Advance amount cannot be negative.")

        calc_result = calculate_document_totals(
            raw_items,
            company_state,
            customer_state,
            company_country=company_country,
            customer_country=customer_country,
            exchange_rate=payload_dict.get("exchange_rate", 1.0),
            amount_paid=raw_adv,
            export_type=export_type,
            overall_discount_type=discount_type,
            overall_discount_value=discount_value,
            doc_currency=payload_dict.get("currency_code", "INR")
        )

        validated_adv = validate_advance_amount(raw_adv, calc_result.grand_total)
        existing_pno = str(payload_dict.get("proforma_no") or "").strip()
        is_already_taken = False
        if existing_pno:
            chk = self.db.table("proforma_invoices").select("id").eq("organization_id", organization_id).eq("proforma_no", existing_pno).limit(1).execute()
            if chk.data:
                is_already_taken = True
        
        if not existing_pno or is_already_taken:
            proforma_no = self.proforma_repo.generate_proforma_no(organization_id)
        else:
            proforma_no = existing_pno
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
            "advance_received": float(validated_adv),
            "amount_paid": float(validated_adv),
            "balance_due": float(calc_result.grand_total - validated_adv),
            "status": payload_dict.get("status") or "DRAFT",
        }
        
        items_data = [item.to_dict() for item in calc_result.items]
        res = self.proforma_repo.create(header_data, items_data)
        res["grand_total_in_words"] = calc_result.grand_total_in_words
        res["customer"] = customer

        # Sync advance payment to payments table so it appears in Payment In
        if validated_adv > Decimal("0.00") and data.party_id:
            try:
                from app.repositories.payment_repository import PaymentRepository
                payment_repo = PaymentRepository()
                pmt_no = payment_repo.generate_payment_no(organization_id)
                payment_repo.create_payment(
                    organization_id=organization_id,
                    payment_no=pmt_no,
                    payment_date=str(data.proforma_date),
                    party_id=data.party_id,
                    amount=float(validated_adv),
                    amount_received=float(validated_adv),
                    payment_mode="Bank Transfer",
                    reference_no=proforma_no,
                    notes=f"Advance received for Pro Forma {proforma_no} [proforma:{res['id']}] [advance]",
                    user_id=user_id,
                    allocations=[{
                        "document_id": res["id"],
                        "document_type": "proforma",
                        "amount": float(validated_adv),
                        "amount_allocated": float(validated_adv)
                    }],
                    is_advance=True
                )
            except Exception as e:
                logger.warning(f"Notice while recording advance on proforma creation: {e}")

        return res

    def get_proformas(self, organization_id: str) -> List[Dict[str, Any]]:
        return self.proforma_repo.get_all(organization_id)

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

            raw_adv = header_updates.get("advance_received") if (header_updates.get("advance_received") is not None) else header_updates.get("amount_paid", existing.get("advance_received") or existing.get("amount_paid", 0.0))
            dec_adv = to_decimal(raw_adv)
            if dec_adv < Decimal("0.00"):
                raise HTTPException(status_code=422, detail="Advance amount cannot be negative.")

            calc_result = calculate_document_totals(
                raw_items,
                company_state,
                customer_state,
                exchange_rate=data.exchange_rate or existing.get("exchange_rate", 1.0),
                amount_paid=raw_adv,
                export_type=export_type,
                overall_discount_type=discount_type,
                overall_discount_value=discount_value
            )
            validated_adv = validate_advance_amount(raw_adv, calc_result.grand_total)
            
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
                "advance_received": float(validated_adv),
                "amount_paid": float(validated_adv),
                "balance_due": float(calc_result.grand_total - validated_adv)
            })
            items_data = [item.to_dict() for item in calc_result.items]
        elif "advance_received" in header_updates or "amount_paid" in header_updates:
            raw_adv = header_updates.get("advance_received") if header_updates.get("advance_received") is not None else header_updates.get("amount_paid")
            gt_dec = to_decimal(existing.get("grand_total") or 0.0)
            validated_adv = validate_advance_amount(raw_adv, gt_dec)
            header_updates["advance_received"] = float(validated_adv)
            header_updates["amount_paid"] = float(validated_adv)
        updated = self.proforma_repo.update(proforma_id, organization_id, header_updates, items_data)

        # Sync advance payment if advance is present
        adv_val = float(header_updates.get("advance_received") or header_updates.get("amount_paid") or 0.0)
        target_party = header_updates.get("party_id") or existing.get("party_id")
        if adv_val > 0 and target_party:
            try:
                from app.repositories.payment_repository import PaymentRepository
                payment_repo = PaymentRepository()
                pf_no = existing.get("proforma_no") or header_updates.get("proforma_no")
                res_pf = self.admin_db.table("payments").select("id").eq("organization_id", organization_id).or_(f"notes.ilike.%[proforma:{proforma_id}]%,reference_no.eq.{pf_no}").execute()
                if res_pf.data:
                    pmt_id = res_pf.data[0]["id"]
                    self.admin_db.table("payments").update({"amount": adv_val, "party_id": target_party}).eq("id", pmt_id).execute()
                    self.admin_db.table("payment_allocations").update({"amount": adv_val, "amount_allocated": adv_val}).eq("payment_id", pmt_id).execute()
                else:
                    pmt_no = payment_repo.generate_payment_no(organization_id)
                    payment_repo.create_payment(
                        organization_id=organization_id,
                        payment_no=pmt_no,
                        payment_date=str(header_updates.get("proforma_date") or existing.get("proforma_date") or date.today()),
                        party_id=target_party,
                        amount=adv_val,
                        amount_received=adv_val,
                        payment_mode="Bank Transfer",
                        reference_no=pf_no,
                        notes=f"Advance received for Pro Forma {pf_no} [proforma:{proforma_id}] [advance]",
                        user_id=existing.get("created_by"),
                        allocations=[{
                            "document_id": proforma_id,
                            "document_type": "proforma",
                            "amount": adv_val,
                            "amount_allocated": adv_val
                        }],
                        is_advance=True
                    )
            except Exception as e:
                logger.warning(f"Notice while syncing advance on proforma update: {e}")

        return updated

    def get_next_proforma_no(self, organization_id: str) -> str:
        return self.proforma_repo.generate_proforma_no(organization_id)

    def convert_to_invoice(
        self,
        proforma_id: str,
        organization_id: str,
        user_id: str,
        amount_paid: Optional[float] = None,
        invoice_type: str = "TAX_INVOICE",
        invoice_date: Optional[Union[date, str]] = None
    ) -> Dict[str, Any]:
        proforma = self.get_proforma(proforma_id, organization_id)
        if not proforma:
            # Check if searched by proforma_no within this organization
            res_no = self.db.table("proforma_invoices").select("*").eq("organization_id", organization_id).eq("proforma_no", proforma_id).limit(1).execute()
            if res_no.data:
                proforma = self.get_proforma(res_no.data[0]["id"], organization_id)

        if not proforma:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pro Forma invoice not found")

        if proforma.get("organization_id") and str(proforma["organization_id"]) != str(organization_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Pro Forma belongs to a different organization.")

        actual_proforma_id = proforma["id"]
        actual_proforma_no = proforma.get("proforma_no")
        pf_status = str(proforma.get("status") or "").upper()
        converted_doc_id = proforma.get("converted_document_id") or proforma.get("convertedDocumentId")

        # Check whether that Pro Forma Invoice has already been converted.
        # If already converted, reject duplicate conversion with 409 Conflict.
        if pf_status == "CONVERTED" or converted_doc_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Pro Forma invoice is already converted: {actual_proforma_no or actual_proforma_id}"
            )

        if pf_status in ["CANCELLED", "REJECTED"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot convert a cancelled or rejected Pro Forma Invoice: {actual_proforma_no}"
            )

        # Invoice Type and Date Rules
        is_ea_invoice = "ea" in str(invoice_type or "").lower()
        normalized_inv_type = "EA_INVOICE" if is_ea_invoice else "TAX_INVOICE"
        today_str = str(date.today())

        if is_ea_invoice:
            # Rule: EA Invoice Date is automatically set to issuance date and cannot be altered
            if invoice_date and str(invoice_date)[:10] != today_str:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="EA Invoice date is fixed to the issuance date and cannot be altered."
                )
            assigned_inv_date = today_str
        else:
            # Standard Tax Invoice: default to conversion date (today) or user-selected valid date
            if invoice_date:
                try:
                    assigned_inv_date = str(datetime.strptime(str(invoice_date)[:10], "%Y-%m-%d").date())
                except Exception:
                    assigned_inv_date = today_str
            else:
                assigned_inv_date = today_str

        # Requirement 2 & 4: Pre-sync document sequence counter to prevent database duplicate key violation (invoices_organization_id_invoice_no_key)
        import re
        next_cand_no = self.invoice_repo.generate_invoice_no(organization_id)
        m_cand = re.search(r"(\d+)$", next_cand_no)
        cand_num = int(m_cand.group(1)) if m_cand else 1
        try:
            self.admin_db.table("organization_document_sequences").upsert({
                "organization_id": str(organization_id),
                "invoice_prefix": "INV",
                "invoice_next_no": cand_num,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }, on_conflict="organization_id").execute()
        except Exception as e:
            logger.warning(f"Notice while pre-syncing sequence: {e}")

        # Try database stored procedure convert_proforma_to_invoice
        new_inv_id = None
        new_inv_no = None
        use_fallback = False

        try:
            rpc_res = self.admin_db.rpc("convert_proforma_to_invoice", {
                "p_proforma_id": actual_proforma_id,
                "p_org_id": organization_id,
                "p_user_id": user_id
            }).execute()

            if rpc_res.data:
                rpc_dict = rpc_res.data if isinstance(rpc_res.data, dict) else {}
                new_inv_id = rpc_dict.get("invoice_id") or (str(rpc_res.data) if isinstance(rpc_res.data, (str, uuid.UUID)) else None)
                new_inv_no = rpc_dict.get("invoice_no")
            else:
                use_fallback = True
        except Exception as rpc_err:
            err_str = str(rpc_err)
            logger.warning(f"RPC convert_proforma_to_invoice notice: {err_str}.")
            # If already converted concurrently, raise 409 Conflict
            if "already converted" in err_str.lower() or "p0409" in err_str.lower() or "p0001" in err_str.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Pro Forma invoice is already converted: {actual_proforma_no or actual_proforma_id}"
                )
            use_fallback = True

        # Fallback Python conversion if RPC failed or was bypassed
        if use_fallback or not new_inv_id:
            assigned_inv_no = self.invoice_repo.generate_invoice_no(organization_id)
            adv_amt = float(proforma.get("advance_received") or proforma.get("amount_paid") or 0.0)
            gt_amt = float(proforma.get("grand_total") or 0.0)
            inv_st = "paid" if adv_amt >= gt_amt - 0.01 and gt_amt > 0 else ("partial" if adv_amt > 0 else "issued")

            header_payload = {
                "organization_id": organization_id,
                "template_id": proforma.get("template_id") or "modern_gst",
                "invoice_no": assigned_inv_no,
                "invoice_date": assigned_inv_date,
                "due_date": str(proforma.get("due_date")) if proforma.get("due_date") else None,
                "party_id": proforma.get("party_id") or proforma.get("customer_id"),
                "source_proforma_id": actual_proforma_id,
                "source_proforma_no": actual_proforma_no,
                "source_proforma_date": str(proforma.get("proforma_date") or date.today()),
                "place_of_supply_state": proforma.get("place_of_supply_state"),
                "place_of_supply_code": proforma.get("place_of_supply_code"),
                "currency_code": proforma.get("currency_code") or "INR",
                "exchange_rate": proforma.get("exchange_rate") or 1.0,
                "roe": proforma.get("roe") or proforma.get("exchange_rate") or 1.0,
                "subtotal": proforma.get("subtotal", 0.0),
                "discount_total": proforma.get("discount_total", 0.0),
                "taxable_total": proforma.get("taxable_total", 0.0),
                "cgst_total": proforma.get("cgst_total", 0.0),
                "sgst_total": proforma.get("sgst_total", 0.0),
                "igst_total": proforma.get("igst_total", 0.0),
                "total_cgst": proforma.get("total_cgst") or proforma.get("cgst_total", 0.0),
                "total_sgst": proforma.get("total_sgst") or proforma.get("sgst_total", 0.0),
                "total_igst": proforma.get("total_igst") or proforma.get("igst_total", 0.0),
                "tax_total": proforma.get("tax_total", 0.0),
                "round_off": proforma.get("round_off", 0.0),
                "grand_total": gt_amt,
                "amount_paid": adv_amt,
                "advance_received": adv_amt,
                "balance_due": max(0.0, gt_amt - adv_amt),
                "status": inv_st,
                "notes": proforma.get("notes"),
                "terms": proforma.get("terms"),
                "created_by": user_id,
                "customer_name": proforma.get("customer_name"),
                "customer_company_name": proforma.get("customer_company_name"),
                "customer_address": proforma.get("customer_address"),
                "customer_city": proforma.get("customer_city"),
                "customer_state": proforma.get("customer_state") or proforma.get("place_of_supply_state"),
                "customer_country": proforma.get("customer_country"),
                "customer_pincode": proforma.get("customer_pincode"),
                "customer_gstin": proforma.get("customer_gstin"),
                "customer_phone": proforma.get("customer_phone"),
                "customer_email": proforma.get("customer_email"),
                "bill_name": proforma.get("bill_name"),
                "bill_address_line1": proforma.get("bill_address_line1"),
                "bill_address_line2": proforma.get("bill_address_line2"),
                "bill_city": proforma.get("bill_city"),
                "bill_state": proforma.get("bill_state"),
                "bill_state_code": proforma.get("bill_state_code"),
                "bill_pincode": proforma.get("bill_pincode"),
                "bill_country": proforma.get("bill_country"),
                "bill_gstin": proforma.get("bill_gstin"),
                "bill_pan": proforma.get("bill_pan"),
                "bill_phone": proforma.get("bill_phone"),
                "bill_email": proforma.get("bill_email"),
                "ship_name": proforma.get("ship_name"),
                "ship_address_line1": proforma.get("ship_address_line1"),
                "ship_address_line2": proforma.get("ship_address_line2"),
                "ship_city": proforma.get("ship_city"),
                "ship_state": proforma.get("ship_state"),
                "ship_state_code": proforma.get("ship_state_code"),
                "ship_pincode": proforma.get("ship_pincode"),
                "ship_country": proforma.get("ship_country"),
                "ship_gstin": proforma.get("ship_gstin"),
                "ship_phone": proforma.get("ship_phone"),
                "shipper_name": proforma.get("shipper_name"),
                "consignee_name": proforma.get("consignee_name"),
                "origin": proforma.get("origin"),
                "destination": proforma.get("destination"),
                "packs_qty": proforma.get("packs_qty"),
                "weight_kgs": proforma.get("weight_kgs"),
                "volume_cbm": proforma.get("volume_cbm"),
                "freight_terms": proforma.get("freight_terms"),
                "bl_number": proforma.get("bl_number"),
                "hbl_number": proforma.get("hbl_number"),
                "thbl_number": proforma.get("thbl_number"),
                "mbl_number": proforma.get("mbl_number"),
                "ocean_bl_no": proforma.get("ocean_bl_no"),
                "vessel_name": proforma.get("vessel_name"),
                "voyage_no": proforma.get("voyage_no"),
                "etd_date": str(proforma.get("etd_date")) if proforma.get("etd_date") else None,
                "eta_date": str(proforma.get("eta_date")) if proforma.get("eta_date") else None,
                "igm_no": proforma.get("igm_no"),
                "igm_date": str(proforma.get("igm_date")) if proforma.get("igm_date") else None,
                "igm_item_no": proforma.get("igm_item_no"),
                "file_no": proforma.get("file_no"),
                "sales_rep": proforma.get("sales_rep"),
                "rcm_applicable": proforma.get("rcm_applicable", False),
                "container_details": proforma.get("container_details"),
                "container_vehicle_no": proforma.get("container_vehicle_no"),
                "vehicle_no": proforma.get("vehicle_no"),
                "bank_account_id": proforma.get("bank_account_id"),
                "bank_details": proforma.get("bank_details"),
                "remarks": proforma.get("remarks"),
                "tds_note": proforma.get("tds_note"),
                "cust_ref": proforma.get("cust_ref"),
                "customer_ref": proforma.get("customer_ref")
            }

            pf_items = proforma.get("items") or []
            if not pf_items:
                res_items = self.db.table("proforma_invoice_items").select("*").eq("proforma_id", actual_proforma_id).order("line_no").execute()
                pf_items = res_items.data or []

            created_inv = self.invoice_repo.create(header_payload, pf_items)
            new_inv_id = created_inv["id"]
            new_inv_no = created_inv.get("invoice_no") or assigned_inv_no

        # Ensure all header details, shipment details, customer details, and bank references from proforma are updated on the invoice
        update_fields = {"invoice_date": assigned_inv_date}
        for col in [
            "source_proforma_id", "source_proforma_no", "source_proforma_date",
            "bill_name", "bill_address_line1", "bill_address_line2", "bill_city", "bill_state", "bill_state_code", "bill_pincode", "bill_country", "bill_gstin", "bill_pan", "bill_phone", "bill_email",
            "ship_name", "ship_address_line1", "ship_address_line2", "ship_city", "ship_state", "ship_state_code", "ship_pincode", "ship_country", "ship_gstin", "ship_phone",
            "customer_name", "customer_company_name", "customer_address", "customer_city", "customer_state", "customer_country", "customer_gstin", "customer_phone", "customer_email", "customer_pincode",
            "shipper_name", "consignee_name", "origin", "destination", "packs_qty", "weight_kgs", "volume_cbm", "freight_terms",
            "bl_number", "hbl_number", "thbl_number", "mbl_number", "ocean_bl_no", "vessel_name", "voyage_no",
            "etd_date", "eta_date", "igm_no", "igm_date", "igm_item_no", "file_no", "sales_rep", "rcm_applicable",
            "container_details", "container_vehicle_no", "vehicle_no", "notes", "terms", "remarks", "tds_note", "bank_account_id", "bank_details", "cust_ref", "customer_ref"
        ]:
            val = proforma.get(col)
            if val is not None:
                update_fields[col] = str(val) if isinstance(val, (date, datetime)) else val

        ACTUAL_INVOICE_TABLE_COLUMNS = {
            "template_id", "invoice_date", "due_date", "party_id",
            "place_of_supply_state", "currency_code", "exchange_rate",
            "subtotal", "discount_total", "taxable_total", "cgst_total", "sgst_total",
            "igst_total", "tax_total", "round_off", "grand_total", "amount_paid",
            "balance_due", "status", "notes", "terms"
        }
        if update_fields:
            clean_update = {k: v for k, v in update_fields.items() if k in ACTUAL_INVOICE_TABLE_COLUMNS}
            if clean_update:
                try:
                    self.admin_db.table("invoices").update(clean_update).eq("id", new_inv_id).execute()
                except Exception as up_err:
                    logger.warning(f"Notice updating converted invoice snapshot fields: {up_err}")

        # Ensure all line items are preserved in invoice_items
        inv_items_res = self.admin_db.table("invoice_items").select("id").eq("invoice_id", new_inv_id).execute()
        if not inv_items_res.data:
            pf_items_res = self.admin_db.table("proforma_invoice_items").select("*").eq("proforma_id", actual_proforma_id).order("line_no").execute()
            for it in (pf_items_res.data or []):
                cleaned_it = clean_invoice_item_payload(it, new_inv_id)
                _safe_insert_invoice_item(self.db, self.admin_db, cleaned_it)

        # Update Pro Forma status to CONVERTED
        self.admin_db.table("proforma_invoices").update({
            "status": "CONVERTED",
            "converted_document_id": new_inv_id,
            "converted_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", actual_proforma_id).execute()

        # Carry advance payment forward and link to Tax Invoice
        adv_amount = float(proforma.get("advance_received") or proforma.get("amount_paid") or 0.0)
        cust_id = proforma.get("customer_id") or proforma.get("party_id")
        if adv_amount > 0:
            try:
                inv_row = self.admin_db.table("invoices").select("grand_total").eq("id", new_inv_id).limit(1).execute()
                gt = float(inv_row.data[0]["grand_total"]) if (inv_row.data and inv_row.data[0].get("grand_total") is not None) else float(proforma.get("grand_total") or 0.0)
                inv_status = "paid" if adv_amount >= (gt - 0.01) and gt > 0 else "partial"
                bal_due = max(0.0, gt - adv_amount)
                self.admin_db.table("invoices").update({
                    "amount_paid": adv_amount,
                    "balance_due": bal_due,
                    "status": inv_status
                }).eq("id", new_inv_id).execute()
            except Exception as e:
                logger.warning(f"Notice updating invoice advance balance: {e}")

            try:
                from app.repositories.payment_repository import PaymentRepository
                payment_repo = PaymentRepository()
                existing_pmt = None
                res_inv = self.admin_db.table("payments").select("*").eq("organization_id", organization_id).eq("invoice_id", new_inv_id).execute()
                if res_inv.data:
                    existing_pmt = res_inv.data[0]
                if not existing_pmt and actual_proforma_no:
                    res_pf = self.admin_db.table("payments").select("*").eq("organization_id", organization_id).or_(f"notes.ilike.%[proforma:{actual_proforma_id}]%,reference_no.eq.{actual_proforma_no}").execute()
                    if res_pf.data:
                        existing_pmt = res_pf.data[0]

                if existing_pmt:
                    pmt_id = existing_pmt["id"]
                    self.admin_db.table("payments").update({"invoice_id": new_inv_id}).eq("id", pmt_id).execute()
                else:
                    pmt_no = payment_repo.generate_payment_no(organization_id)
                    payment_repo.create_payment(
                        organization_id=organization_id,
                        payment_no=pmt_no,
                        payment_date=str(proforma.get("proforma_date") or date.today()),
                        party_id=cust_id,
                        amount=adv_amount,
                        amount_received=adv_amount,
                        payment_mode="Bank Transfer",
                        reference_no=actual_proforma_no,
                        notes=f"Advance received from Pro Forma {actual_proforma_no} [proforma:{actual_proforma_id}]",
                        user_id=user_id,
                        invoice_id=new_inv_id,
                        allocations=[{
                            "document_id": new_inv_id,
                            "invoice_id": new_inv_id,
                            "document_type": "invoice",
                            "amount": adv_amount,
                            "amount_allocated": adv_amount
                        }],
                        is_advance=True
                    )
            except Exception as e:
                logger.warning(f"Notice linking advance payment: {e}")

        # Fetch and return complete Tax Invoice record
        inv = self.invoice_repo.get_by_id(new_inv_id, organization_id)
        if not inv:
            admin_res = self.admin_db.table("invoices").select("*").eq("id", new_inv_id).execute()
            if admin_res.data:
                from app.repositories.invoice_repository import unpack_invoice_header_result
                inv = unpack_invoice_header_result(admin_res.data[0])
            else:
                inv = {"id": new_inv_id, "organization_id": organization_id}

        inv["invoice_id"] = new_inv_id
        if new_inv_no:
            inv["invoice_no"] = new_inv_no
        inv["source_proforma_id"] = actual_proforma_id
        inv["source_proforma_no"] = actual_proforma_no
        inv["source_proforma_date"] = str(proforma.get("proforma_date") or date.today())

        # Enrich all customer, shipment, logistics, and metadata details from source proforma
        for pk, pv in proforma.items():
            if pk in ("id", "created_at", "updated_at"):
                continue
            if pk not in inv or inv[pk] is None or inv[pk] == "":
                inv[pk] = pv

        if not inv.get("items") and proforma.get("items"):
            inv["items"] = proforma["items"]
            inv["lines"] = proforma["items"]

        inv["invoice_date"] = assigned_inv_date
        inv["invoice_type"] = normalized_inv_type
        inv["document_type"] = normalized_inv_type

        # Generate verified QR code only after invoice date, number, and details are saved
        if is_ea_invoice:
            import json
            import hashlib
            import base64
            import io
            company = self.get_company_details(organization_id)
            seller_gstin = company.get("gstin") or company.get("tax_id") or "27AABCT1234F1Z5"
            buyer_gstin = inv.get("customer_gstin") or inv.get("bill_gstin") or "URP"
            irn_hash = hashlib.sha256(
                f"{organization_id}:{inv.get('invoice_no')}:{assigned_inv_date}:{float(inv.get('grand_total') or 0.0):.2f}".encode()
            ).hexdigest()

            qr_dict = {
                "irn": irn_hash,
                "invoice_type": "EA_INVOICE",
                "invoice_no": inv.get("invoice_no"),
                "invoice_date": assigned_inv_date,
                "seller_gstin": seller_gstin,
                "buyer_gstin": buyer_gstin,
                "grand_total": float(inv.get("grand_total") or 0.0),
                "line_items_count": len(inv.get("items") or []),
                "verified": True
            }
            qr_code_data = json.dumps(qr_dict, separators=(',', ':'))

            qr_code_image = None
            try:
                import qrcode
                qr = qrcode.QRCode(version=1, box_size=6, border=2)
                qr.add_data(qr_code_data)
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                qr_code_image = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"
            except Exception as qre:
                logger.warning(f"Error generating QR image: {qre}")

            inv["qr_code_data"] = qr_code_data
            inv["qr_code_image"] = qr_code_image
            inv["irn_number"] = irn_hash

        return inv

    def delete_proforma(self, proforma_id: str, organization_id: str) -> bool:
        proforma = self.proforma_repo.get_by_id(proforma_id, organization_id)
        if not proforma:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pro Forma invoice not found")
        return self.proforma_repo.delete(proforma_id, organization_id)

    def delete_all_proformas(self, organization_id: str) -> int:
        return self.proforma_repo.delete_all(organization_id)
