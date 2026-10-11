from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import date, datetime

class InvoiceItemBase(BaseModel):
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
    cgst_amount: float = 0.0
    sgst_amount: float = 0.0
    igst_amount: float = 0.0
    place_of_supply: Optional[str] = None
    currency: Optional[str] = "INR"
    amount_inr: float = 0.0
    tax_amount: float = 0.0
    line_total: float = 0.0

class InvoiceItemCreate(BaseModel):
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
    currency: Optional[str] = "INR"
    amount_inr: Optional[float] = 0.0
    tax_amount: Optional[float] = 0.0

class InvoiceCreate(BaseModel):
    template_id: Optional[str] = "modern_gst"
    invoice_no: Optional[str] = None  # Generated if None
    invoice_date: date = Field(default_factory=date.today)
    due_date: Optional[date] = None
    party_id: Optional[str] = None
    customer_id: Optional[str] = None
    place_of_supply_state: Optional[str] = None
    notes: Optional[str] = None
    terms: Optional[str] = None
    amount_paid: float = 0.0

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

    items: List[InvoiceItemCreate]

class InvoiceUpdate(BaseModel):
    template_id: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    party_id: Optional[str] = None
    place_of_supply_state: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    terms: Optional[str] = None

    # Customer Snapshot & Manual Entry
    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
    customer_country: Optional[str] = None
    customer_address: Optional[str] = None
    customer_city: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    save_customer_to_master: Optional[bool] = False

    items: Optional[List[InvoiceItemCreate]] = None

from typing import List, Optional, Any, Union

class InvoiceResponse(BaseModel):
    id: str
    organization_id: str
    template_id: Optional[str] = "modern_gst"
    invoice_no: str
    invoice_date: Union[date, str]
    due_date: Optional[Union[date, str]] = None
    party_id: Optional[str] = None
    party_name: Optional[str] = None
    source_proforma_id: Optional[str] = None
    source_proforma_no: Optional[str] = None
    source_proforma_date: Optional[Union[date, str]] = None

    place_of_supply_state: Optional[str] = None
    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
    customer_address: Optional[str] = None
    customer_city: Optional[str] = None
    customer_country: Optional[str] = None
    customer_gstin: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None

    currency_code: str = "INR"
    exchange_rate: Optional[float] = 1.0
    export_type: Optional[str] = None
    lut_number: Optional[str] = None
    lut_bond_no: Optional[str] = None

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
    etd_date: Optional[Union[date, str]] = None
    eta_date: Optional[Union[date, str]] = None

    igm_no: Optional[str] = None
    igm_date: Optional[Union[date, str]] = None
    igm_item_no: Optional[str] = None
    file_no: Optional[str] = None
    sales_rep: Optional[str] = None
    rcm_applicable: Optional[bool] = False
    container_details: Optional[str] = None

    customer_ref: Optional[str] = None
    customer_pincode: Optional[str] = None
    customer_po_date: Optional[Union[date, str]] = None
    bank_details: Optional[Any] = None
    tds_note: Optional[str] = None
    remarks: Optional[str] = None
    grand_total_in_words: Optional[str] = None

    subtotal: float = 0.0
    discount_total: float = 0.0
    taxable_total: float = 0.0
    cgst_total: float = 0.0
    sgst_total: float = 0.0
    igst_total: float = 0.0
    tax_total: float = 0.0
    round_off: float = 0.0
    grand_total: float = 0.0
    amount_paid: float = 0.0
    balance_due: float = 0.0
    status: str = "issued"
    notes: Optional[str] = None
    terms: Optional[str] = None
    metadata: Optional[dict] = Field(default_factory=dict)
    items: List[InvoiceItemBase] = []
    created_at: Optional[Union[datetime, str]] = None
    updated_at: Optional[Union[datetime, str]] = None

    model_config = ConfigDict(from_attributes=True)
