from pydantic import BaseModel, ConfigDict, model_validator
from typing import Optional, Any
from datetime import datetime

class PartyBase(BaseModel):
    display_name: str
    legal_name: Optional[str] = None
    name: Optional[str] = None
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

    @model_validator(mode="before")
    @classmethod
    def set_name_alias(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("name") and data.get("display_name"):
                data["name"] = data["display_name"]
            elif not data.get("display_name") and data.get("name"):
                data["display_name"] = data["name"]
        return data

    @model_validator(mode="after")
    def ensure_name_and_display_name(self) -> "PartyBase":
        if not self.name and self.display_name:
            self.name = self.display_name
        elif not self.display_name and self.name:
            self.display_name = self.name
        return self

class PartyCreate(PartyBase):
    pass

class PartyUpdate(BaseModel):
    display_name: Optional[str] = None
    name: Optional[str] = None
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

    @model_validator(mode="before")
    @classmethod
    def set_name_alias(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("name") and data.get("display_name"):
                data["name"] = data["display_name"]
            elif not data.get("display_name") and data.get("name"):
                data["display_name"] = data["name"]
        return data

class PartyResponse(PartyBase):
    id: str
    organization_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

