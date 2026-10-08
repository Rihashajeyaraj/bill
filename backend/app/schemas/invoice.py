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

class InvoiceCreate(BaseModel):
    template_id: Optional[str] = "modern_gst"
    invoice_no: Optional[str] = None  # Generated if None
    invoice_date: date = Field(default_factory=date.today)
    due_date: Optional[date] = None
    party_id: Optional[str] = None
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

class InvoiceResponse(BaseModel):
    id: str
    organization_id: str
    template_id: Optional[str] = "modern_gst"
    invoice_no: str
    invoice_date: date
    due_date: Optional[date] = None
    party_id: Optional[str] = None
    party_name: Optional[str] = None
    place_of_supply_state: Optional[str] = None
    currency_code: str = "INR"
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
    items: List[InvoiceItemBase] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
