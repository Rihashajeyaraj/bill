from fastapi import APIRouter, Depends, status, HTTPException
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

@router.post("", response_model=InvoiceResponse, status_code=status.HTTP_403_FORBIDDEN)
def create_invoice(
    data: InvoiceCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Direct creation of tax invoices is disabled. Tax invoices must be converted from Pro Forma Invoices."
    )

@router.put("/{invoice_id}", response_model=InvoiceResponse)
def update_invoice(
    invoice_id: str,
    data: InvoiceUpdate,
    ctx: UserContext = Depends(get_current_user_context)
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tax Invoices are strictly read-only. Content edits and updates are prohibited. Corrections must be made via Credit Note or Debit Note."
    )

@router.patch("/{invoice_id}", response_model=InvoiceResponse)
def patch_invoice(
    invoice_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tax Invoices are strictly read-only. Content edits and updates are prohibited. Corrections must be made via Credit Note or Debit Note."
    )

@router.delete("/{invoice_id}", status_code=status.HTTP_403_FORBIDDEN)
def delete_invoice(
    invoice_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tax Invoices are strictly read-only. Deletions are prohibited. Cancellations or corrections must be made via Credit Note or Debit Note."
    )

