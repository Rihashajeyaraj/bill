from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import date, datetime

class ProFormaItemBase(BaseModel):
    id: Optional[str] = None
    item_id: Optional[str] = None
    line_no: int = 1
    sort_order: int = 1
    description: str
    hsn_sac: Optional[str] = ""
    qty: float = 1.0
    unit: str = "PCS"
    unit_price: float = 0.0
    rate: float = 0.0
    discount_type: str = "percent"  # percent | amount
    discount_value: float = 0.0
    discount_percent: float = 0.0
    discount_amount: float = 0.0
    taxable_value: float = 0.0
    taxable_amount: float = 0.0
    tax_rate: float = 0.0
    gst_rate: float = 0.0
    cgst_rate: float = 0.0
    sgst_rate: float = 0.0
    igst_rate: float = 0.0
    cess_rate: float = 0.0
    cgst_amount: float = 0.0
    sgst_amount: float = 0.0
    igst_amount: float = 0.0
    cess_amount: float = 0.0
    place_of_supply: Optional[str] = None
    currency: str = "INR"
    amount_inr: float = 0.0
    tax_amount: float = 0.0
    line_total: float = 0.0

    model_config = ConfigDict(extra="ignore", from_attributes=True)

class ProFormaItemCreate(BaseModel):
    item_id: Optional[str] = None
    line_no: Optional[int] = 1
    sort_order: Optional[int] = 1
    description: str
    hsn_sac: Optional[str] = ""
    qty: float = 1.0
    unit: str = "PCS"
    unit_price: float = 0.0
    rate: Optional[float] = None
    discount_type: Optional[str] = "percent"
    discount_value: Optional[float] = 0.0
    discount_percent: Optional[float] = 0.0
    discount_amount: Optional[float] = 0.0
    taxable_value: Optional[float] = None
    tax_rate: float = 0.0
    gst_rate: Optional[float] = None
    cgst_rate: Optional[float] = 0.0
    sgst_rate: Optional[float] = 0.0
    igst_rate: Optional[float] = 0.0
    cess_rate: Optional[float] = 0.0
    cgst_amount: Optional[float] = 0.0
    sgst_amount: Optional[float] = 0.0
    igst_amount: Optional[float] = 0.0
    cess_amount: Optional[float] = 0.0
    place_of_supply: Optional[str] = None
    currency: Optional[str] = "INR"
    amount_inr: Optional[float] = 0.0
    tax_amount: Optional[float] = 0.0

    model_config = ConfigDict(extra="ignore", from_attributes=True)

class HsnSummaryItem(BaseModel):
    hsn_sac: str
    taxable_value: float = 0.0
    gst_rate: float = 0.0
    cgst_rate: float = 0.0
    cgst_amount: float = 0.0
    sgst_rate: float = 0.0
    sgst_amount: float = 0.0
    igst_rate: float = 0.0
    igst_amount: float = 0.0
    total_tax: float = 0.0

    model_config = ConfigDict(extra="ignore", from_attributes=True)

class ProFormaCreate(BaseModel):
    template_id: Optional[str] = "modern_gst"
    proforma_no: Optional[str] = None
    proforma_date: date = Field(default_factory=date.today)
    invoice_date: Optional[date] = None
    valid_till: Optional[date] = None
    due_date: Optional[date] = None
    
    party_id: Optional[str] = None
    customer_id: Optional[str] = None
    needs_customer_link: bool = False
    
    # Bill-to Snapshot
    bill_name: Optional[str] = None
    bill_address_line1: Optional[str] = None
    bill_address_line2: Optional[str] = None
    bill_city: Optional[str] = None
    bill_state: Optional[str] = None
    bill_state_code: Optional[str] = None
    bill_pincode: Optional[str] = None
    bill_country: Optional[str] = None
    bill_gstin: Optional[str] = None
    bill_pan: Optional[str] = None
    bill_phone: Optional[str] = None
    bill_email: Optional[str] = None
    bill_contact_person: Optional[str] = None

    # Ship-to Snapshot
    ship_same_as_bill: bool = True
    ship_name: Optional[str] = None
    ship_address_line1: Optional[str] = None
    ship_address_line2: Optional[str] = None
    ship_city: Optional[str] = None
    ship_state: Optional[str] = None
    ship_state_code: Optional[str] = None
    ship_pincode: Optional[str] = None
    ship_country: Optional[str] = None
    ship_gstin: Optional[str] = None
    ship_phone: Optional[str] = None
    ship_contact_person: Optional[str] = None

    # Place of supply & tax details
    place_of_supply_state: Optional[str] = None
    place_of_supply_code: Optional[str] = None
    supply_type: str = "intra"
    reverse_charge: bool = False
    export_type: Optional[str] = "DOMESTIC"  # DOMESTIC | LUT | TAX_PAYMENT
    lut_number: Optional[str] = None
    lut_bond_no: Optional[str] = None

    # Customer Order references & Dates
    customer_po_no: Optional[str] = None
    customer_po_date: Optional[date] = None
    customer_ref: Optional[str] = None
    salesperson: Optional[str] = None
    payment_terms: Optional[str] = None

    # Legacy Customer fields
    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
    customer_country: Optional[str] = None
    customer_address: Optional[str] = None
    customer_city: Optional[str] = None
    customer_pincode: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    save_customer_to_master: bool = False

    # Shipment & Logistics
    freight_terms: str = "Collect"
    transporter_name: Optional[str] = None
    vehicle_no: Optional[str] = None
    lr_no: Optional[str] = None
    dispatch_from: Optional[str] = None
    shipping_method: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    incoterms: Optional[str] = None

    shipper_name: Optional[str] = None
    consignee_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    packs_qty: Optional[str] = None
    weight_kgs: Optional[float] = None
    volume_cbm: Optional[float] = None

    # Export & BL Details
    bl_number: Optional[str] = None
    hbl_number: Optional[str] = None
    thbl_number: Optional[str] = None
    mbl_number: Optional[str] = None
    ocean_bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    voyage_no: Optional[str] = None
    vessel_voyage: Optional[str] = None
    etd_date: Optional[date] = None
    eta_date: Optional[date] = None

    # Operations & Customs
    igm_no: Optional[str] = None
    igm_date: Optional[date] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: bool = False
    container_details: Optional[str] = None
    container_vehicle_no: Optional[str] = None
    tds_note: Optional[str] = None
    remarks: Optional[str] = None
    grand_total_in_words: Optional[str] = None

    # Currency & Pricing Mode
    currency_code: str = "INR"
    currency_symbol: str = "₹"
    exchange_rate: float = 1.0
    roe: Optional[float] = 1.0
    price_mode: str = "exclusive"

    # Additional Charges & Discounts
    discount_type: Optional[str] = "amount"
    discount_value: Optional[float] = 0.0
    additional_discount_type: str = "amount"
    additional_discount_value: float = 0.0
    freight_charge: float = 0.0
    packing_charge: float = 0.0
    insurance_charge: float = 0.0
    other_charge: float = 0.0
    advance_received: float = 0.0
    amount_paid: float = 0.0
    bank_account_id: Optional[str] = None

    notes: Optional[str] = None
    terms: Optional[str] = None
    items: List[ProFormaItemCreate]

    model_config = ConfigDict(extra="ignore", from_attributes=True)

class ProFormaUpdate(BaseModel):
    template_id: Optional[str] = None
    proforma_no: Optional[str] = None
    proforma_date: Optional[date] = None
    invoice_date: Optional[date] = None
    valid_till: Optional[date] = None
    due_date: Optional[date] = None

    party_id: Optional[str] = None
    customer_id: Optional[str] = None
    needs_customer_link: Optional[bool] = None

    bill_name: Optional[str] = None
    bill_address_line1: Optional[str] = None
    bill_address_line2: Optional[str] = None
    bill_city: Optional[str] = None
    bill_state: Optional[str] = None
    bill_state_code: Optional[str] = None
    bill_pincode: Optional[str] = None
    bill_country: Optional[str] = None
    bill_gstin: Optional[str] = None
    bill_pan: Optional[str] = None
    bill_phone: Optional[str] = None
    bill_email: Optional[str] = None
    bill_contact_person: Optional[str] = None

    ship_same_as_bill: Optional[bool] = None
    ship_name: Optional[str] = None
    ship_address_line1: Optional[str] = None
    ship_address_line2: Optional[str] = None
    ship_city: Optional[str] = None
    ship_state: Optional[str] = None
    ship_state_code: Optional[str] = None
    ship_pincode: Optional[str] = None
    ship_country: Optional[str] = None
    ship_gstin: Optional[str] = None
    ship_phone: Optional[str] = None
    ship_contact_person: Optional[str] = None

    place_of_supply_state: Optional[str] = None
    place_of_supply_code: Optional[str] = None
    supply_type: Optional[str] = None
    reverse_charge: Optional[bool] = None
    export_type: Optional[str] = None
    lut_number: Optional[str] = None
    lut_bond_no: Optional[str] = None

    customer_po_no: Optional[str] = None
    customer_po_date: Optional[date] = None
    customer_ref: Optional[str] = None
    salesperson: Optional[str] = None
    payment_terms: Optional[str] = None

    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
    customer_country: Optional[str] = None
    customer_address: Optional[str] = None
    customer_city: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    save_customer_to_master: Optional[bool] = False

    freight_terms: Optional[str] = None
    transporter_name: Optional[str] = None
    vehicle_no: Optional[str] = None
    lr_no: Optional[str] = None
    dispatch_from: Optional[str] = None
    shipping_method: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    incoterms: Optional[str] = None

    shipper_name: Optional[str] = None
    consignee_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    packs_qty: Optional[str] = None
    weight_kgs: Optional[float] = None
    volume_cbm: Optional[float] = None

    bl_number: Optional[str] = None
    hbl_number: Optional[str] = None
    thbl_number: Optional[str] = None
    mbl_number: Optional[str] = None
    ocean_bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    voyage_no: Optional[str] = None
    vessel_voyage: Optional[str] = None
    etd_date: Optional[date] = None
    eta_date: Optional[date] = None

    igm_no: Optional[str] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: Optional[bool] = None
    container_details: Optional[str] = None
    container_vehicle_no: Optional[str] = None

    currency_code: Optional[str] = None
    currency_symbol: Optional[str] = None
    exchange_rate: Optional[float] = None
    roe: Optional[float] = None
    price_mode: Optional[str] = None

    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    additional_discount_type: Optional[str] = None
    additional_discount_value: Optional[float] = None
    freight_charge: Optional[float] = None
    packing_charge: Optional[float] = None
    insurance_charge: Optional[float] = None
    other_charge: Optional[float] = None
    advance_received: Optional[float] = None
    amount_paid: Optional[float] = None
    bank_account_id: Optional[str] = None

    status: Optional[str] = None
    notes: Optional[str] = None
    terms: Optional[str] = None
    items: Optional[List[ProFormaItemCreate]] = None

    model_config = ConfigDict(extra="ignore", from_attributes=True)

class ProFormaResponse(BaseModel):
    id: str
    organization_id: str
    template_id: Optional[str] = "modern_gst"
    proforma_no: str
    proforma_date: date
    invoice_date: Optional[date] = None
    valid_till: Optional[date] = None
    due_date: Optional[date] = None

    party_id: Optional[str] = None
    customer_id: Optional[str] = None
    needs_customer_link: bool = False
    party_name: Optional[str] = None
    customer: Optional[dict] = None

    # Bill-to Snapshot
    bill_name: Optional[str] = None
    bill_address_line1: Optional[str] = None
    bill_address_line2: Optional[str] = None
    bill_city: Optional[str] = None
    bill_state: Optional[str] = None
    bill_state_code: Optional[str] = None
    bill_pincode: Optional[str] = None
    bill_country: Optional[str] = None
    bill_gstin: Optional[str] = None
    bill_pan: Optional[str] = None
    bill_phone: Optional[str] = None
    bill_email: Optional[str] = None
    bill_contact_person: Optional[str] = None

    # Ship-to Snapshot
    ship_same_as_bill: bool = True
    ship_name: Optional[str] = None
    ship_address_line1: Optional[str] = None
    ship_address_line2: Optional[str] = None
    ship_city: Optional[str] = None
    ship_state: Optional[str] = None
    ship_state_code: Optional[str] = None
    ship_pincode: Optional[str] = None
    ship_country: Optional[str] = None
    ship_gstin: Optional[str] = None
    ship_phone: Optional[str] = None
    ship_contact_person: Optional[str] = None

    # Place of supply & Tax mode
    place_of_supply_state: Optional[str] = None
    place_of_supply_code: Optional[str] = None
    supply_type: str = "intra"
    reverse_charge: bool = False
    export_type: Optional[str] = "DOMESTIC"
    lut_number: Optional[str] = None
    lut_bond_no: Optional[str] = None

    # Order details & Customer snapshot
    customer_po_no: Optional[str] = None
    customer_po_date: Optional[date] = None
    customer_ref: Optional[str] = None
    salesperson: Optional[str] = None
    payment_terms: Optional[str] = None

    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
    customer_country: Optional[str] = None
    customer_address: Optional[str] = None
    customer_city: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None

    # Logistics
    freight_terms: Optional[str] = "Collect"
    transporter_name: Optional[str] = None
    vehicle_no: Optional[str] = None
    lr_no: Optional[str] = None
    dispatch_from: Optional[str] = None
    shipping_method: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    incoterms: Optional[str] = None

    shipper_name: Optional[str] = None
    consignee_name: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    packs_qty: Optional[str] = None
    weight_kgs: Optional[float] = None
    volume_cbm: Optional[float] = None

    bl_number: Optional[str] = None
    hbl_number: Optional[str] = None
    thbl_number: Optional[str] = None
    mbl_number: Optional[str] = None
    ocean_bl_no: Optional[str] = None
    vessel_name: Optional[str] = None
    voyage_no: Optional[str] = None
    vessel_voyage: Optional[str] = None
    etd_date: Optional[date] = None
    eta_date: Optional[date] = None

    igm_no: Optional[str] = None
    igm_date: Optional[date] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: bool = False
    container_details: Optional[str] = None
    container_vehicle_no: Optional[str] = None
    tds_note: Optional[str] = None
    remarks: Optional[str] = None
    customer_pincode: Optional[str] = None

    # Currency & Price Mode
    currency_code: str = "INR"
    currency_symbol: str = "₹"
    exchange_rate: float = 1.0
    roe: Optional[float] = 1.0
    price_mode: str = "exclusive"

    # Financial Totals & Breakdown
    gross_total: float = 0.0
    total_line_discount: float = 0.0
    discount_type: Optional[str] = "amount"
    discount_value: float = 0.0
    additional_discount_type: str = "amount"
    additional_discount_value: float = 0.0
    additional_discount_amount: float = 0.0
    freight_charge: float = 0.0
    packing_charge: float = 0.0
    insurance_charge: float = 0.0
    other_charge: float = 0.0
    taxable_subtotal: float = 0.0
    subtotal: float = 0.0
    discount_total: float = 0.0
    taxable_total: float = 0.0
    total_cgst: float = 0.0
    total_sgst: float = 0.0
    total_utgst: float = 0.0
    total_igst: float = 0.0
    total_cess: float = 0.0
    cgst_total: float = 0.0
    sgst_total: float = 0.0
    igst_total: float = 0.0
    tax_total: float = 0.0
    round_off: float = 0.0
    grand_total: float = 0.0
    advance_received: float = 0.0
    amount_paid: float = 0.0
    balance_due: float = 0.0
    balance_amount: float = 0.0
    grand_total_in_words: str = ""

    status: str = "DRAFT"
    notes: Optional[str] = None
    terms: Optional[str] = None
    bank_account_id: Optional[str] = None
    converted_document_id: Optional[str] = None
    converted_at: Optional[datetime] = None

    # Nested Complete Payloads for Single Source of Truth
    company: Optional[Dict[str, Any]] = None
    bank: Optional[Dict[str, Any]] = None
    hsn_summary: List[HsnSummaryItem] = []
    items: List[ProFormaItemBase] = []

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(extra="ignore", from_attributes=True)
