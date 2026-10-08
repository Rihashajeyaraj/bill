from fastapi import APIRouter, Depends, Query
from typing import Dict, Any, Optional
from app.core.auth import get_current_user_context, UserContext
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["Reports"])
service = ReportService()

@router.get("/sales", response_model=Dict[str, Any])
def get_sales_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_sales_report(ctx.company_id, start_date, end_date)

@router.get("/tax-invoices", response_model=Dict[str, Any])
def get_tax_invoices_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_sales_report(ctx.company_id, start_date, end_date)

@router.get("/proforma", response_model=Dict[str, Any])
def get_proforma_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_proforma_report(ctx.company_id, start_date, end_date)

@router.get("/payments", response_model=Dict[str, Any])
def get_payments_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_payments_report(ctx.company_id, start_date, end_date)

@router.get("/receivables", response_model=Dict[str, Any])
def get_receivables_report(
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_receivables_report(ctx.company_id)
