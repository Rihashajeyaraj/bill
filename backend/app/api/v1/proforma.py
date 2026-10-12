from fastapi import APIRouter, Depends, status, Header
from fastapi.security import HTTPAuthorizationCredentials
from typing import List, Optional
from app.core.auth import get_current_user_context, UserContext, security
from app.services.proforma_service import ProformaService
from app.schemas.proforma import (
    ProFormaCreate, ProFormaUpdate, ProFormaResponse,
    ProformaConvertRequest, ProformaVerificationResponse
)
from app.schemas.invoice import InvoiceResponse

router = APIRouter(prefix="/proforma", tags=["Pro Forma Invoices"])

@router.get("/verify/{token}", response_model=ProformaVerificationResponse)
async def verify_proforma(
    token: str,
    x_organization_id: Optional[str] = Header(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """
    Publicly or authentically resolves a Pro Forma QR verification token.
    Enforces tenant isolation: cross-tenant access from authenticated users of another org is blocked with 403.
    """
    caller_org_id = None
    if credentials and credentials.credentials:
        try:
            ctx = await get_current_user_context(credentials=credentials, x_organization_id=x_organization_id)
            caller_org_id = ctx.company_id
        except Exception:
            pass
    elif x_organization_id:
        caller_org_id = x_organization_id

    service = ProformaService()
    return service.verify_proforma_by_token(token, caller_company_id=caller_org_id)

@router.get("", response_model=List[ProFormaResponse])
def list_proformas(ctx: UserContext = Depends(get_current_user_context)):
    service = ProformaService(token=ctx.token)
    return service.get_proformas(ctx.company_id)

@router.get("/next-number")
def get_next_proforma_number(ctx: UserContext = Depends(get_current_user_context)):
    service = ProformaService(token=ctx.token)
    return {"proforma_no": service.get_next_proforma_no(ctx.company_id)}

@router.get("/{proforma_id}", response_model=ProFormaResponse)
def get_proforma(
    proforma_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = ProformaService(token=ctx.token)
    return service.get_proforma(proforma_id, ctx.company_id)

@router.post("/{proforma_id}/cancel", response_model=ProFormaResponse)
def cancel_proforma(
    proforma_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = ProformaService(token=ctx.token)
    return service.cancel_proforma(proforma_id, ctx.company_id)

@router.post("", response_model=ProFormaResponse, status_code=status.HTTP_201_CREATED)
def create_proforma(
    data: ProFormaCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = ProformaService(token=ctx.token)
    return service.create_proforma(ctx.company_id, data, ctx.user_id)

@router.put("/{proforma_id}", response_model=ProFormaResponse)
def update_proforma(
    proforma_id: str,
    data: ProFormaUpdate,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = ProformaService(token=ctx.token)
    return service.update_proforma(proforma_id, ctx.company_id, data)

@router.post("/{proforma_id}/convert", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def convert_proforma(
    proforma_id: str,
    payload: Optional[ProformaConvertRequest] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    """
    Converts Pro Forma invoice into a official Tax Invoice or EA Invoice.
    Recalculates financial values on FastAPI, generates a new Tax Invoice Number,
    links the conversion, generates EA QR code if applicable, and sets status to CONVERTED.
    """
    service = ProformaService(token=ctx.token)
    inv_type = payload.invoice_type if payload and payload.invoice_type else "TAX_INVOICE"
    inv_date = payload.invoice_date if payload else None
    return service.convert_to_invoice(
        proforma_id, ctx.company_id, ctx.user_id,
        invoice_type=inv_type, invoice_date=inv_date
    )

@router.delete("/all", status_code=status.HTTP_200_OK)
@router.delete("", status_code=status.HTTP_200_OK)
def delete_all_proformas(ctx: UserContext = Depends(get_current_user_context)):
    service = ProformaService(token=ctx.token)
    count = service.delete_all_proformas(ctx.company_id)
    return {"message": "All proforma invoices deleted", "count": count}

@router.delete("/{proforma_id}", status_code=status.HTTP_200_OK)
def delete_proforma(
    proforma_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = ProformaService(token=ctx.token)
    service.delete_proforma(proforma_id, ctx.company_id)
    return {"message": "Proforma invoice deleted"}

