from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from app.repositories.proforma_repository import ProformaRepository
from app.repositories.invoice_repository import InvoiceRepository
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.services.calculation_service import calculate_document_totals
from app.schemas.proforma import ProFormaCreate, ProFormaUpdate

class ProformaService:
    def __init__(self):
        self.proforma_repo = ProformaRepository()
        self.invoice_repo = InvoiceRepository()
        self.party_repo = PartyRepository()
        self.db = get_admin_supabase_client()

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

    def create_proforma(self, organization_id: str, data: ProFormaCreate, user_id: str) -> Dict[str, Any]:
        company = self.get_company_details(organization_id)
        company_state = company.get("state_name") or company.get("state") or ""
        company_country = company.get("country_name") or company.get("country") or "India"

        # Auto-create Customer Master record if requested
        if getattr(data, "save_customer_to_master", False) and getattr(data, "customer_name", None) and not data.party_id:
            try:
                from app.schemas.party import PartyCreate
                party_payload = PartyCreate(
                    party_type="customer",
                    name=data.customer_name,
                    display_name=data.customer_company_name or data.customer_name,
                    billing_address_line1=data.customer_address or "",
                    city=data.customer_city or "",
                    state_name=data.place_of_supply_state or "",
                    country_name=data.customer_country or company_country,
                    gstin=data.customer_gstin or "",
                    phone=data.customer_phone or "",
                    email=data.customer_email or ""
                )
                created_party = self.party_repo.create(organization_id, party_payload, user_id)
                if created_party and created_party.get("id"):
                    data.party_id = created_party["id"]
            except Exception:
                pass
        
        customer = self.get_customer_details(data.party_id, organization_id)
        customer_state = data.place_of_supply_state or customer.get("state_name") or customer.get("state_code") or ""
        customer_country = data.customer_country or customer.get("country_name") or customer.get("country") or company_country

        raw_items = [item.model_dump() for item in data.items]
        calc_result = calculate_document_totals(
            raw_items,
            company_state,
            customer_state,
            company_country=company_country,
            customer_country=customer_country,
            exchange_rate=data.exchange_rate
        )
        
        proforma_no = data.proforma_no or self.proforma_repo.generate_proforma_no(organization_id)
        
        header_data = {
            "organization_id": organization_id,
            "created_by": user_id,
            "proforma_no": proforma_no,
            "proforma_date": str(data.proforma_date),
            "valid_till": str(data.valid_till) if data.valid_till else None,
            "due_date": str(data.due_date) if data.due_date else None,
            "party_id": data.party_id,
            "customer_ref": data.customer_ref,
            "place_of_supply_state": customer_state,
            "customer_name": data.customer_name,
            "customer_company_name": data.customer_company_name,
            "customer_country": customer_country,
            "customer_address": data.customer_address,
            "customer_city": data.customer_city,
            "customer_gstin": data.customer_gstin,
            "customer_phone": data.customer_phone,
            "customer_email": data.customer_email,
            "currency_code": data.currency_code or "INR",
            "exchange_rate": float(data.exchange_rate or 1.0),
            
            # Logistics
            "shipper_name": data.shipper_name,
            "consignee_name": data.consignee_name,
            "origin": data.origin,
            "destination": data.destination,
            "packs_qty": data.packs_qty,
            "weight_kgs": float(data.weight_kgs) if data.weight_kgs is not None else None,
            "volume_cbm": float(data.volume_cbm) if data.volume_cbm is not None else None,
            "freight_terms": data.freight_terms or "Collect",
            
            # Shipping
            "bl_number": data.bl_number,
            "thbl_number": data.thbl_number,
            "mbl_number": data.mbl_number,
            "ocean_bl_no": data.ocean_bl_no,
            "vessel_name": data.vessel_name,
            "voyage_no": data.voyage_no,
            "etd_date": str(data.etd_date) if data.etd_date else None,
            "eta_date": str(data.eta_date) if data.eta_date else None,
            
            # Customs & Ops
            "igm_no": data.igm_no,
            "igm_item_no": data.igm_item_no,
            "file_no": data.file_no,
            "sales_rep": data.sales_rep,
            "rcm_applicable": data.rcm_applicable,
            "container_details": data.container_details,
            
            "subtotal": float(calc_result.subtotal),
            "discount_total": float(calc_result.discount_total),
            "taxable_total": float(calc_result.taxable_total),
            "cgst_total": float(calc_result.cgst_total),
            "sgst_total": float(calc_result.sgst_total),
            "igst_total": float(calc_result.igst_total),
            "tax_total": float(calc_result.tax_total),
            "round_off": float(calc_result.round_off),
            "grand_total": float(calc_result.grand_total),
            "status": "DRAFT",
            "notes": data.notes,
            "terms": data.terms,
            "created_by": user_id
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

    def get_proforma(self, proforma_id: str, organization_id: str) -> Dict[str, Any]:
        proforma = self.proforma_repo.get_by_id(proforma_id, organization_id)
        if not proforma:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pro Forma invoice not found")
        if proforma.get("party_id"):
            proforma["customer"] = self.get_customer_details(proforma["party_id"], organization_id)
        
        calc_res = calculate_document_totals(
            proforma.get("items", []),
            self.get_company_details(organization_id).get("state_name") or "",
            proforma.get("place_of_supply_state") or "",
            exchange_rate=proforma.get("exchange_rate", 1.0)
        )
        proforma["grand_total_in_words"] = calc_res.grand_total_in_words
        return proforma

    def update_proforma(self, proforma_id: str, organization_id: str, data: ProFormaUpdate) -> Dict[str, Any]:
        existing = self.get_proforma(proforma_id, organization_id)
        if existing.get("status") == "CONVERTED":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit a converted Pro Forma invoice")
            
        header_updates = data.model_dump(exclude_unset=True, exclude={"items"})
        items_data = None
        
        if data.items is not None:
            company_state = self.get_company_details(organization_id).get("state_name") or ""
            customer_state = data.place_of_supply_state or existing.get("place_of_supply_state") or self.get_customer_details(existing.get("party_id"), organization_id).get("state_name") or ""
            raw_items = [item.model_dump() for item in data.items]
            calc_result = calculate_document_totals(
                raw_items,
                company_state,
                customer_state,
                exchange_rate=data.exchange_rate or existing.get("exchange_rate", 1.0)
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
                "grand_total": float(calc_result.grand_total)
            })
            items_data = [item.to_dict() for item in calc_result.items]
            
        return self.proforma_repo.update(proforma_id, organization_id, header_updates, items_data)

    def convert_to_invoice(self, proforma_id: str, organization_id: str, user_id: str) -> Dict[str, Any]:
        proforma = self.get_proforma(proforma_id, organization_id)
        if proforma.get("status") == "CONVERTED" or proforma.get("converted_document_id"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Pro Forma invoice {proforma.get('proforma_no')} is already converted to Tax Invoice"
            )
            
        company_state = self.get_company_details(organization_id).get("state_name") or ""
        customer_state = proforma.get("place_of_supply_state") or self.get_customer_details(proforma.get("party_id"), organization_id).get("state_name") or ""
        
        pf_items = proforma.get("items", [])
        raw_items = []
        for item in pf_items:
            raw_items.append({
                "item_id": item.get("item_id"),
                "description": item.get("description"),
                "hsn_sac": item.get("hsn_sac"),
                "qty": item.get("qty"),
                "unit": item.get("unit"),
                "unit_price": item.get("unit_price"),
                "discount_percent": item.get("discount_percent"),
                "discount_amount": item.get("discount_amount"),
                "tax_rate": item.get("tax_rate")
            })
            
        calc_result = calculate_document_totals(
            raw_items,
            company_state,
            customer_state,
            exchange_rate=proforma.get("exchange_rate", 1.0)
        )
        new_invoice_no = self.invoice_repo.generate_invoice_no(organization_id)
        
        inv_header = {
            "organization_id": organization_id,
            "invoice_no": new_invoice_no,
            "invoice_date": proforma.get("proforma_date"),
            "due_date": proforma.get("due_date"),
            "party_id": proforma.get("party_id"),
            "customer_ref": proforma.get("customer_ref"),
            "place_of_supply_state": customer_state,
            "customer_name": proforma.get("customer_name"),
            "customer_company_name": proforma.get("customer_company_name"),
            "customer_country": proforma.get("customer_country"),
            "customer_address": proforma.get("customer_address"),
            "customer_city": proforma.get("customer_city"),
            "customer_gstin": proforma.get("customer_gstin"),
            "customer_phone": proforma.get("customer_phone"),
            "customer_email": proforma.get("customer_email"),
            "currency_code": proforma.get("currency_code", "INR"),
            "exchange_rate": proforma.get("exchange_rate", 1.0),
            
            "shipper_name": proforma.get("shipper_name"),
            "consignee_name": proforma.get("consignee_name"),
            "origin": proforma.get("origin"),
            "destination": proforma.get("destination"),
            "packs_qty": proforma.get("packs_qty"),
            "weight_kgs": proforma.get("weight_kgs"),
            "volume_cbm": proforma.get("volume_cbm"),
            "freight_terms": proforma.get("freight_terms"),
            
            "bl_number": proforma.get("bl_number"),
            "thbl_number": proforma.get("thbl_number"),
            "mbl_number": proforma.get("mbl_number"),
            "ocean_bl_no": proforma.get("ocean_bl_no"),
            "vessel_name": proforma.get("vessel_name"),
            "voyage_no": proforma.get("voyage_no"),
            "etd_date": proforma.get("etd_date"),
            "eta_date": proforma.get("eta_date"),
            
            "igm_no": proforma.get("igm_no"),
            "igm_item_no": proforma.get("igm_item_no"),
            "file_no": proforma.get("file_no"),
            "sales_rep": proforma.get("sales_rep"),
            "rcm_applicable": proforma.get("rcm_applicable"),
            "container_details": proforma.get("container_details"),
            
            "subtotal": float(calc_result.subtotal),
            "discount_total": float(calc_result.discount_total),
            "taxable_total": float(calc_result.taxable_total),
            "cgst_total": float(calc_result.cgst_total),
            "sgst_total": float(calc_result.sgst_total),
            "igst_total": float(calc_result.igst_total),
            "tax_total": float(calc_result.tax_total),
            "round_off": float(calc_result.round_off),
            "grand_total": float(calc_result.grand_total),
            "amount_paid": 0.0,
            "status": "issued",
            "notes": proforma.get("notes"),
            "terms": proforma.get("terms"),
            "created_by": user_id
        }
        
        inv_items = [item.to_dict() for item in calc_result.items]
        created_invoice = self.invoice_repo.create(inv_header, inv_items)
        
        self.proforma_repo.update(
            proforma_id,
            organization_id,
            {
                "status": "CONVERTED",
                "converted_document_id": created_invoice["id"],
                "converted_at": "now()"
            }
        )
        
        return created_invoice
