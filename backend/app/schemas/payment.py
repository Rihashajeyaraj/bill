from pydantic import BaseModel, Field, ConfigDict, AliasChoices, field_validator
from typing import List, Optional, Dict, Any
from datetime import date, datetime
import uuid

class PaymentAllocationItem(BaseModel):
    document_id: str = Field(..., validation_alias=AliasChoices("document_id", "invoice_id"))
    document_type: str = Field(default="invoice", validation_alias=AliasChoices("document_type", "doc_type"))  # "invoice" or "proforma"
    amount: float = Field(..., validation_alias=AliasChoices("amount", "amount_applied", "amount_allocated"))

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

class PaymentCreate(BaseModel):
    customer_id: str = Field(..., validation_alias=AliasChoices("customer_id", "party_id"))
    payment_date: date = Field(default_factory=date.today)
    mode: str = Field(default="Bank Transfer", validation_alias=AliasChoices("mode", "payment_mode"))
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    is_advance: bool = Field(default=False, validation_alias=AliasChoices("is_advance", "receive_as_advance"))
    deposit_account_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("deposit_account_id", "deposit_to_account_id"))
    tds_amount: float = 0.0
    tds_percent: float = Field(default=0.0, validation_alias=AliasChoices("tds_percent", "tds_rate"))
    allocations: List[PaymentAllocationItem] = Field(default_factory=list)
    amount: Optional[float] = Field(default=None, validation_alias=AliasChoices("amount", "amount_received"))
    payment_no: Optional[str] = None
    idempotency_key: Optional[str] = None

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("customer_id")
    @classmethod
    def validate_customer_id(cls, v: str) -> str:
        if not v or not str(v).strip():
            raise ValueError("Customer is required.")
        return str(v).strip()

    @field_validator("payment_date")
    @classmethod
    def validate_payment_date(cls, v: date) -> date:
        today = date.today()
        if v > today.replace(year=today.year + 1):
            raise ValueError("Payment date cannot be in the far future.")
        return v

class CustomerSummaryResponse(BaseModel):
    outstanding: float = 0.0
    last_payment: Dict[str, Any] = Field(default_factory=lambda: {"amount": 0.0, "date": None})
    advance_balance: float = 0.0

class PendingDocumentItem(BaseModel):
    document_type: str  # "invoice" or "proforma"
    document_id: str
    document_no: str
    document_date: str
    due_date: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    grand_total: float = 0.0
    paid_amount: float = 0.0
    balance_due: float = 0.0
    overdue_days: int = 0
    is_overdue: bool = False
    place_of_supply: Optional[str] = None
    bank_details: Optional[Dict[str, Any]] = None
    taxable_value: float = 0.0
    cgst_amount: float = 0.0
    sgst_amount: float = 0.0
    igst_amount: float = 0.0
    vat_amount: float = 0.0
    items: List[Dict[str, Any]] = []

class PaymentReverseRequest(BaseModel):
    reason: str = Field(..., min_length=1)

class PaymentResponse(BaseModel):
    id: str
    organization_id: str
    payment_no: str
    payment_date: date
    direction: str = "in"
    customer_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("customer_id", "party_id"))
    party_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("party_id", "customer_id"))
    party_name: Optional[str] = None
    customer_name: Optional[str] = None
    customer_gstin: Optional[str] = None
    applied_to_documents: List[str] = []
    amount: float
    amount_received: float = 0.0
    tds_amount: float = 0.0
    tds_rate: float = 0.0
    tds_percent: float = 0.0
    applied_amount: float = 0.0
    unapplied_amount: float = 0.0
    payment_mode: Optional[str] = None
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    status: str = "posted"
    is_advance: bool = False
    allocations: List[Dict[str, Any]] = []
    audit_history: List[Dict[str, Any]] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(extra="ignore", from_attributes=True, populate_by_name=True)

class PaymentListTotals(BaseModel):
    received: float = 0.0
    tds: float = 0.0
    applied: float = 0.0
    unapplied: float = 0.0

class PaymentListResponse(BaseModel):
    items: List[Dict[str, Any]] = []
    total: int = 0
    totals: PaymentListTotals = Field(default_factory=PaymentListTotals)

class PaymentKpiSummary(BaseModel):
    total_receipts: int = 0
    amount_received: float = 0.0
    pending_receivable: float = 0.0
    unapplied_balance: float = 0.0
    delta: Dict[str, Any] = Field(default_factory=dict)

class TdsHistoryItem(BaseModel):
    id: str
    payment_id: str
    payment_date: str
    receipt_no: str
    invoice_no: str
    customer_id: Optional[str] = None
    customer_name: str
    tds_rate: float = 0.0
    tds_amount: float = 0.0
    section: str = "194C"
    certificate_status: str = "Pending"

# Backward compatibility alias
PaymentCreateWizard = PaymentCreate

class ReceivableInvoiceItem(BaseModel):
    invoice_id: str
    invoice_no: str
    invoice_date: str
    customer_id: Optional[str] = None
    customer_name: str
    due_date: Optional[str] = None
    grand_total: float
    total_amount: float
    paid: float = Field(default=0.0, validation_alias=AliasChoices("paid", "paid_amount"))
    paid_amount: float = Field(default=0.0, validation_alias=AliasChoices("paid_amount", "paid"))
    advance_applied: float = 0.0
    balance_due: float
    days_overdue: Optional[int] = None
    days_to_due: Optional[int] = None
    status: str  # "unpaid" | "partial" | "paid" | "overdue"
    has_advance_applied: bool = False
    customer_has_advance: bool = False
    available_customer_advance: float = 0.0

    model_config = ConfigDict(extra="ignore", from_attributes=True, populate_by_name=True)

class ReceivablesSummaryResponse(BaseModel):
    total_invoiced: float
    total_received: float
    amount_received: Optional[float] = None
    pending_receivable: float
    overdue_amount: float
    overdue_count: int
    unapplied_advance: float
    unapplied_balance: Optional[float] = None
    total_receipts: Optional[int] = None
    tabs_count: Dict[str, int] = Field(default_factory=dict)

    model_config = ConfigDict(extra="ignore", from_attributes=True, populate_by_name=True)

class CustomerReceivableItem(BaseModel):
    customer_id: str
    customer_name: str
    invoiced: float
    received: float
    advance: float  # unapplied
    balance: float
    overdue_amount: float
    oldest_due_date: Optional[str] = None
    invoices: List[ReceivableInvoiceItem] = []

    model_config = ConfigDict(extra="ignore", from_attributes=True, populate_by_name=True)

class ReceiptHistoryItem(BaseModel):
    payment_id: Optional[str] = None
    receipt_no: str
    date: str
    customer_id: Optional[str] = None
    customer_name: str
    payment_mode: str
    amount: float
    applied: float
    unapplied: float
    reference: Optional[str] = None

    model_config = ConfigDict(extra="ignore", from_attributes=True, populate_by_name=True)

class ApplyAdvanceRequest(BaseModel):
    customer_id: str
    invoice_id: str
    amount: float = Field(..., gt=0)
