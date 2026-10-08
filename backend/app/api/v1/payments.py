from fastapi import APIRouter, Depends, status
from typing import List
from app.core.auth import get_current_user_context, UserContext
from app.services.payment_service import PaymentService
from app.schemas.payment import PaymentCreate, PaymentResponse

router = APIRouter(prefix="/payments", tags=["Payments In"])
service = PaymentService()

@router.get("", response_model=List[PaymentResponse])
def list_payments(ctx: UserContext = Depends(get_current_user_context)):
    return service.get_payments(ctx.company_id)

@router.get("/{payment_id}", response_model=PaymentResponse)
def get_payment(
    payment_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.get_payment(payment_id, ctx.company_id)

@router.post("", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
def create_payment(
    data: PaymentCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return service.create_payment(ctx.company_id, data, ctx.user_id)
