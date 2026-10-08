from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class PartyBase(BaseModel):
    display_name: str
    party_type: str = "customer"  # customer, supplier, both
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    billing_address_line1: Optional[str] = None
    billing_address_line2: Optional[str] = None
    city: Optional[str] = None
    state_name: Optional[str] = None
    state_code: Optional[str] = None
    country_code: str = "IN"
    postal_code: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    opening_balance: float = 0.0
    credit_limit: Optional[float] = None
    credit_limit_type: str = "amount"
    credit_limit_days: Optional[int] = None
    notes: Optional[str] = None
    is_active: bool = True

class PartyCreate(PartyBase):
    pass

class PartyUpdate(BaseModel):
    display_name: Optional[str] = None
    party_type: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    billing_address_line1: Optional[str] = None
    billing_address_line2: Optional[str] = None
    city: Optional[str] = None
    state_name: Optional[str] = None
    state_code: Optional[str] = None
    postal_code: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    opening_balance: Optional[float] = None
    is_active: Optional[bool] = None

class PartyResponse(PartyBase):
    id: str
    organization_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
