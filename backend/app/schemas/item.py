from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class ItemBase(BaseModel):
    item_name: str
    item_type: str = "product"  # product, service
    item_code: Optional[str] = None
    sku: Optional[str] = None
    hsn_sac: Optional[str] = None
    unit: str = "PCS"
    sale_price: float = 0.0
    purchase_price: float = 0.0
    tax_rate: float = 0.0
    tax_inclusive: bool = False
    opening_stock: float = 0.0
    current_stock: float = 0.0
    reorder_level: Optional[float] = None
    category_id: Optional[str] = None
    is_active: bool = True

class ItemCreate(ItemBase):
    pass

class ItemUpdate(BaseModel):
    item_name: Optional[str] = None
    item_type: Optional[str] = None
    item_code: Optional[str] = None
    hsn_sac: Optional[str] = None
    unit: Optional[str] = None
    sale_price: Optional[float] = None
    purchase_price: Optional[float] = None
    tax_rate: Optional[float] = None
    current_stock: Optional[float] = None
    is_active: Optional[bool] = None

class ItemResponse(ItemBase):
    id: str
    organization_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
