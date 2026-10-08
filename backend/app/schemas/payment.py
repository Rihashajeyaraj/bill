from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import date, datetime

class PaymentAllocationItem(BaseModel):
    invoice_id: str
    amount_allocated: float

class PaymentCreate(BaseModel):
    payment_no: Optional[str] = None
    payment_date: date = Field(default_factory=date.today)
    party_id: str
    amount: float
    amount_received: Optional[float] = None
    tds_amount: float = 0.0
    tds_rate: float = 0.0
    payment_mode: str = "Bank Transfer"
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    allocations: List[PaymentAllocationItem] = []

class PaymentResponse(BaseModel):
    id: str
    organization_id: str
    payment_no: str
    payment_date: date
    direction: str = "in"
    party_id: Optional[str] = None
    party_name: Optional[str] = None
    amount: float
    amount_received: float = 0.0
    tds_amount: float = 0.0
    tds_rate: float = 0.0
    payment_mode: Optional[str] = None
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    status: str = "posted"
    allocations: List[PaymentAllocationItem] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
