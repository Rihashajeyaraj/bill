from fastapi import APIRouter, Depends, status
from typing import List
from app.core.auth import get_current_user_context, UserContext
from app.services.invoice_service import InvoiceService
from app.schemas.invoice import InvoiceCreate, InvoiceUpdate, InvoiceResponse

router = APIRouter(prefix="/invoices", tags=["Tax Invoices"])
service = InvoiceService()

@router.get("", response_model=List[InvoiceResponse])
def list_invoices(ctx: UserContext = Depends(get_current_user_context)):
    return service.get_invoices(ctx.company_id)

@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_invoice(invoice_id, ctx.company_id)

@router.post("", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_invoice(
    data: InvoiceCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.create_invoice(ctx.company_id, data, ctx.user_id)

@router.put("/{invoice_id}", response_model=InvoiceResponse)
def update_invoice(
    invoice_id: str,
    data: InvoiceUpdate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.update_invoice(invoice_id, ctx.company_id, data)
