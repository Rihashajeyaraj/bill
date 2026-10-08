from pydantic import BaseModel
from typing import List, Optional, Any
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
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    summary: dict
    data: List[dict] = []
