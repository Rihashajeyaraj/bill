from fastapi import APIRouter, Depends, status, Query
from typing import List, Dict, Any, Optional
from app.core.auth import get_current_user_context, UserContext
from app.services.payment_service import PaymentService
from app.schemas.payment import (
    PaymentCreate,
    PaymentCreateWizard,
    PaymentResponse,
    PaymentListResponse,
    PaymentReverseRequest,
    CustomerSummaryResponse,
    PendingDocumentItem,
    ReceivableInvoiceItem,
    ReceivablesSummaryResponse,
    CustomerReceivableItem,
    ReceiptHistoryItem,
    ApplyAdvanceRequest
)

router = APIRouter(prefix="/payments", tags=["Payments In"])

@router.get("", response_model=Dict[str, Any])
def list_payments(
    q: Optional[str] = None,
    customer_id: Optional[str] = None,
    mode: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    doc_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    sort: str = Query("payment_date"),
    sort_dir: str = Query("desc"),
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_filtered_payments(
        organization_id=ctx.company_id,
        q=q,
        customer_id=customer_id,
        mode=mode,
        status=status_filter,
        doc_type=doc_type,
        from_date=from_date,
        to_date=to_date,
        page=page,
        page_size=page_size,
        sort=sort,
        sort_dir=sort_dir
    )

@router.get("/summary", response_model=Dict[str, Any])
def get_payment_summary(
    customer_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_summary(ctx.company_id, customer_id=customer_id, from_date=from_date, to_date=to_date)

@router.get("/customer-summary/{customer_id}", response_model=CustomerSummaryResponse)
def get_customer_summary(
    customer_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_customer_summary(customer_id, ctx.company_id)

@router.get("/pending-documents", response_model=List[PendingDocumentItem])
def get_pending_documents(
    customer_id: Optional[str] = None,
    doc_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    q: Optional[str] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_pending_documents(
        customer_id=customer_id,
        organization_id=ctx.company_id,
        doc_type=doc_type,
        from_date=from_date,
        to_date=to_date,
        q=q
    )

@router.get("/tds-history", response_model=List[Dict[str, Any]])
def get_tds_history(
    customer_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    q: Optional[str] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_tds_history(
        organization_id=ctx.company_id,
        customer_id=customer_id,
        from_date=from_date,
        to_date=to_date,
        q=q
    )

@router.get("/receivables/summary", response_model=ReceivablesSummaryResponse)
def get_receivables_summary(
    customer_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_receivables_summary(
        organization_id=ctx.company_id,
        customer_id=customer_id,
        from_date=from_date,
        to_date=to_date
    )

@router.get("/receivables/customers", response_model=List[CustomerReceivableItem])
def get_customer_receivables(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_customer_receivables(
        organization_id=ctx.company_id,
        from_date=from_date,
        to_date=to_date
    )

@router.get("/receivables", response_model=List[ReceivableInvoiceItem])
def list_receivables(
    customer_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    q: Optional[str] = None,
    doc_type: Optional[str] = Query(None, alias="docType"),
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_receivables(
        organization_id=ctx.company_id,
        customer_id=customer_id,
        from_date=from_date,
        to_date=to_date,
        status_filter=status_filter,
        q=q,
        doc_type=doc_type
    )

@router.get("/receipts", response_model=Dict[str, Any])
def list_receipts(
    customer_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    q: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_receipts_history(
        organization_id=ctx.company_id,
        customer_id=customer_id,
        from_date=from_date,
        to_date=to_date,
        q=q,
        page=page,
        page_size=page_size
    )

@router.post("/apply-advance", response_model=Dict[str, Any])
def apply_advance(
    payload: ApplyAdvanceRequest,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.apply_advance(
        organization_id=ctx.company_id,
        customer_id=payload.customer_id,
        invoice_id=payload.invoice_id,
        amount=payload.amount,
        user_id=ctx.user_id
    )

@router.get("/{payment_id}", response_model=PaymentResponse)
def get_payment(
    payment_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.get_payment(payment_id, ctx.company_id)

@router.post("", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
def create_payment(
    data: PaymentCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.create_payment(ctx.company_id, data, ctx.user_id)


@router.post("/{payment_id}/reverse", response_model=PaymentResponse)
def reverse_payment(
    payment_id: str,
    payload: PaymentReverseRequest,
    ctx: UserContext = Depends(get_current_user_context)
):
    service = PaymentService(token=ctx.token)
    return service.reverse_payment(payment_id, ctx.company_id, payload.reason, ctx.user_id)
