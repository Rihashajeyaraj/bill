from fastapi import APIRouter, Depends, Query
from typing import Dict, Any, Optional
from app.core.auth import get_current_user_context, UserContext
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["Reports"])
service = ReportService()

@router.get("/customer-wise", response_model=Dict[str, Any])
def get_customer_wise_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_customer_wise_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        q=q
    )

@router.get("/payments", response_model=Dict[str, Any])
def get_payments_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    payment_mode: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_payments_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        payment_mode=payment_mode,
        q=q
    )

@router.get("/advances", response_model=Dict[str, Any])
def get_advance_received_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_advance_received_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        q=q
    )

@router.get("/balance-due", response_model=Dict[str, Any])
def get_balance_due_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    invoice_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    include_paid: bool = Query(False),
    q: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_balance_due_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        invoice_type=invoice_type,
        status=status,
        include_paid=include_paid,
        q=q
    )

@router.get("/proforma", response_model=Dict[str, Any])
def get_proforma_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_proforma_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        status=status,
        q=q
    )

@router.get("/tax-invoices", response_model=Dict[str, Any])
def get_tax_invoices_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_tax_invoices_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        status=status,
        q=q
    )

@router.get("/sales", response_model=Dict[str, Any])
def get_sales_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    party_id: Optional[str] = Query(None),
    exclude_drafts: bool = Query(False),
    include_proforma: bool = Query(False),
    ctx: UserContext = Depends(get_current_user_context)
):
    selected_customer = customer_id or party_id
    return service.get_sales_report(
        organization_id=ctx.company_id,
        start_date=start_date,
        end_date=end_date,
        customer_id=selected_customer,
        exclude_drafts=exclude_drafts,
        include_proforma=include_proforma
    )

@router.get("/receivables", response_model=Dict[str, Any])
def get_receivables_report(
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_receivables_report(ctx.company_id)

