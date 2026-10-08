from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import date, datetime

class ProFormaItemBase(BaseModel):
    item_id: Optional[str] = None
    line_no: int = 1
    description: str
    hsn_sac: Optional[str] = ""
    qty: float = 1.0
    unit: str = "PCS"
    unit_price: float = 0.0
    discount_percent: float = 0.0
    discount_amount: float = 0.0
    tax_rate: float = 0.0
    taxable_amount: float = 0.0
    cgst_rate: float = 0.0
    sgst_rate: float = 0.0
    igst_rate: float = 0.0
    cgst_amount: float = 0.0
    sgst_amount: float = 0.0
    igst_amount: float = 0.0
    place_of_supply: Optional[str] = None
    currency: str = "INR"
    line_total: float = 0.0

class ProFormaItemCreate(BaseModel):
    item_id: Optional[str] = None
    description: str
    hsn_sac: Optional[str] = ""
    qty: float = 1.0
    unit: str = "PCS"
    unit_price: float = 0.0
    discount_percent: float = 0.0
    discount_amount: float = 0.0
    tax_rate: float = 0.0
    place_of_supply: Optional[str] = None
    currency: str = "INR"

class ProFormaCreate(BaseModel):
    template_id: Optional[str] = "modern_gst"
    proforma_no: Optional[str] = None
    proforma_date: date = Field(default_factory=date.today)
    valid_till: Optional[date] = None
    due_date: Optional[date] = None
    party_id: Optional[str] = None
    customer_ref: Optional[str] = None
    place_of_supply_state: Optional[str] = None
    currency_code: str = "INR"
    exchange_rate: float = 1.0

    # Customer Snapshot & Manual Entry
    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
    customer_country: Optional[str] = None
    customer_address: Optional[str] = None
    customer_city: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    save_customer_to_master: bool = False
    
    # Shipment & Logistics
    shipper_name: Optional[str] = None
    consignee_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    packs_qty: Optional[str] = None
    weight_kgs: Optional[float] = None
    volume_cbm: Optional[float] = None
    freight_terms: str = "Collect"
    
    # Shipping details
    bl_number: Optional[str] = None
    thbl_number: Optional[str] = None
    mbl_number: Optional[str] = None
    ocean_bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    voyage_no: Optional[str] = None
    etd_date: Optional[date] = None
    eta_date: Optional[date] = None
    
    # Operations & Customs
    igm_no: Optional[str] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: bool = False
    container_details: Optional[str] = None
    
    notes: Optional[str] = None
    terms: Optional[str] = None
    items: List[ProFormaItemCreate]

class ProFormaUpdate(BaseModel):
    template_id: Optional[str] = None
    proforma_date: Optional[date] = None
    valid_till: Optional[date] = None
    due_date: Optional[date] = None
    party_id: Optional[str] = None
    customer_ref: Optional[str] = None
    place_of_supply_state: Optional[str] = None
    currency_code: Optional[str] = None
    exchange_rate: Optional[float] = None
    
    shipper_name: Optional[str] = None
    consignee_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    packs_qty: Optional[str] = None
    weight_kgs: Optional[float] = None
    volume_cbm: Optional[float] = None
    freight_terms: Optional[str] = None
    
    bl_number: Optional[str] = None
    thbl_number: Optional[str] = None
    mbl_number: Optional[str] = None
    ocean_bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    voyage_no: Optional[str] = None
    etd_date: Optional[date] = None
    eta_date: Optional[date] = None
    
    igm_no: Optional[str] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: Optional[bool] = None
    container_details: Optional[str] = None
    
    status: Optional[str] = None
    notes: Optional[str] = None
    terms: Optional[str] = None
    items: Optional[List[ProFormaItemCreate]] = None

class ProFormaResponse(BaseModel):
    id: str
    organization_id: str
    template_id: Optional[str] = "modern_gst"
    proforma_no: str
    proforma_date: date
    valid_till: Optional[date] = None
    due_date: Optional[date] = None
    party_id: Optional[str] = None
    party_name: Optional[str] = None
    customer: Optional[dict] = None
    customer_ref: Optional[str] = None
    place_of_supply_state: Optional[str] = None
    currency_code: str = "INR"
    exchange_rate: float = 1.0
    
    # Shipment & Logistics
    shipper_name: Optional[str] = None
    consignee_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    packs_qty: Optional[str] = None
    weight_kgs: Optional[float] = None
    volume_cbm: Optional[float] = None
    freight_terms: Optional[str] = "Collect"
    
    # Shipping details
    bl_number: Optional[str] = None
    thbl_number: Optional[str] = None
    mbl_number: Optional[str] = None
    ocean_bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    voyage_no: Optional[str] = None
    etd_date: Optional[date] = None
    eta_date: Optional[date] = None
    
    # Operations & Customs
    igm_no: Optional[str] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: bool = False
    container_details: Optional[str] = None
    
    subtotal: float = 0.0
    discount_total: float = 0.0
    taxable_total: float = 0.0
    cgst_total: float = 0.0
    sgst_total: float = 0.0
    igst_total: float = 0.0
    tax_total: float = 0.0
    round_off: float = 0.0
    grand_total: float = 0.0
    grand_total_in_words: str = ""
    status: str = "DRAFT"
    notes: Optional[str] = None
    terms: Optional[str] = None
    converted_document_id: Optional[str] = None
    converted_at: Optional[datetime] = None
    items: List[ProFormaItemBase] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
