from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
from datetime import date

class DateRangeFilter(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class SalesReportSummary(BaseModel):
    total_sales: float = 0.0
    total_taxable: float = 0.0
    total_cgst: float = 0.0
    total_sgst: float = 0.0
    total_igst: float = 0.0
    total_tax: float = 0.0
    total_discount: float = 0.0
    invoice_count: int = 0

class ReceivablesReportItem(BaseModel):
    party_id: str
    party_name: str
    total_invoiced: float = 0.0
    total_paid: float = 0.0
    outstanding_balance: float = 0.0
    invoice_count: int = 0

class GenericReportResponse(BaseModel):
    report_type: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    summary: Dict[str, Any]
    data: List[Dict[str, Any]] = []

# 1. Customer-wise Report Schemas
class CustomerWiseReportSummary(BaseModel):
    total_customers: int = 0
    total_invoice_amount: float = 0.0
    total_amount_received: float = 0.0
    total_outstanding: float = 0.0

class CustomerWiseReportItem(BaseModel):
    customer_id: str
    customer_name: str
    phone: Optional[str] = None
    gstin: Optional[str] = None
    proforma_count: int = 0
    tax_invoice_count: int = 0
    total_invoice_amount: float = 0.0
    advance_received: float = 0.0
    additional_payments_received: float = 0.0
    total_received: float = 0.0
    balance_due: float = 0.0
    invoices: List[Dict[str, Any]] = []
    payments: List[Dict[str, Any]] = []

# 2. Payment-wise Report Schemas
class PaymentWiseReportSummary(BaseModel):
    receipt_count: int = 0
    total_payments_received: float = 0.0
    cash_received: float = 0.0
    bank_upi_received: float = 0.0

class PaymentWiseReportItem(BaseModel):
    id: str
    payment_date: str
    receipt_number: str
    customer_name: str
    customer_id: Optional[str] = None
    invoice_number: str
    payment_method: str
    reference_number: Optional[str] = None
    amount_received: float = 0.0
    notes: Optional[str] = None
    allocations: List[Dict[str, Any]] = []

# 3. Advance Amount Received Report Schemas
class AdvanceReceivedReportSummary(BaseModel):
    total_advances_received: float = 0.0
    advance_receipts_count: int = 0
    advances_applied_to_tax_invoices: float = 0.0
    unapplied_advance_balance: float = 0.0

class AdvanceReceivedReportItem(BaseModel):
    receipt_date: str
    proforma_invoice_no: str
    proforma_id: str
    customer_name: str
    customer_id: Optional[str] = None
    invoice_total: float = 0.0
    advance_received: float = 0.0
    advance_applied: float = 0.0
    remaining_balance: float = 0.0
    tax_invoice_number: str = "-"
    tax_invoice_id: Optional[str] = None
    status: str

# 4. Balance Due Report Schemas
class BalanceDueReportSummary(BaseModel):
    total_outstanding: float = 0.0
    overdue_amount: float = 0.0
    unpaid_invoices_count: int = 0
    partially_paid_invoices_count: int = 0

class BalanceDueReportItem(BaseModel):
    invoice_date: str
    invoice_number: str
    invoice_id: str
    invoice_type: str
    customer_name: str
    customer_id: Optional[str] = None
    invoice_total: float = 0.0
    advance_received: float = 0.0
    additional_payments_received: float = 0.0
    total_received: float = 0.0
    balance_due: float = 0.0
    due_date: Optional[str] = None
    days_overdue: int = 0
    payment_status: str

# 5. Pro Forma Report Schemas
class ProformaReportSummary(BaseModel):
    total_proforma_invoices: int = 0
    total_proforma_value: float = 0.0
    total_advances_received: float = 0.0
    converted_count: int = 0
    pending_conversion_count: int = 0

class ProformaReportItem(BaseModel):
    proforma_number: str
    proforma_id: str
    invoice_date: str
    valid_till: Optional[str] = None
    customer_name: str
    customer_id: Optional[str] = None
    total_before_tax: float = 0.0
    gst_amount: float = 0.0
    invoice_total: float = 0.0
    advance_received: float = 0.0
    balance_payable: float = 0.0
    conversion_status: str
    converted_tax_invoice_number: str = "-"

# 6. Tax Invoice Report Schemas
class TaxInvoiceReportSummary(BaseModel):
    total_tax_invoices: int = 0
    total_taxable_value: float = 0.0
    total_gst: float = 0.0
    total_invoice_value: float = 0.0
    total_received: float = 0.0
    total_outstanding: float = 0.0

class TaxInvoiceReportItem(BaseModel):
    invoice_number: str
    invoice_id: str
    invoice_date: str
    customer_name: str
    customer_id: Optional[str] = None
    customer_gstin: Optional[str] = None
    taxable_amount: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0
    total_gst: float = 0.0
    invoice_total: float = 0.0
    advance_received: float = 0.0
    additional_payments: float = 0.0
    balance_due: float = 0.0
    due_date: Optional[str] = None
    payment_status: str

