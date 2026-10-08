from fastapi import APIRouter, Depends, status
from typing import List
from app.core.auth import get_current_user_context, UserContext
from app.services.proforma_service import ProformaService
from app.schemas.proforma import ProFormaCreate, ProFormaUpdate, ProFormaResponse
from app.schemas.invoice import InvoiceResponse

router = APIRouter(prefix="/proforma", tags=["Pro Forma Invoices"])
service = ProformaService()

@router.get("", response_model=List[ProFormaResponse])
def list_proformas(ctx: UserContext = Depends(get_current_user_context)):
    return service.get_proformas(ctx.company_id)

@router.get("/{proforma_id}", response_model=ProFormaResponse)
def get_proforma(
    proforma_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_proforma(proforma_id, ctx.company_id)

@router.post("", response_model=ProFormaResponse, status_code=status.HTTP_201_CREATED)
def create_proforma(
    data: ProFormaCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.create_proforma(ctx.company_id, data, ctx.user_id)

@router.put("/{proforma_id}", response_model=ProFormaResponse)
def update_proforma(
    proforma_id: str,
    data: ProFormaUpdate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.update_proforma(proforma_id, ctx.company_id, data)

@router.post("/{proforma_id}/convert", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def convert_proforma(
    proforma_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    """
    Converts Pro Forma invoice into a official Tax Invoice.
    Recalculates financial values on FastAPI, generates a new Tax Invoice Number,
    links the conversion, and sets status to CONVERTED.
    """
    return service.convert_to_invoice(proforma_id, ctx.company_id, ctx.user_id)
