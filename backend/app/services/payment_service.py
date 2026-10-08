from typing import List, Dict, Any
from fastapi import HTTPException, status
from app.repositories.payment_repository import PaymentRepository
from app.schemas.payment import PaymentCreate

class PaymentService:
    def __init__(self):
        self.payment_repo = PaymentRepository()

    def create_payment(self, organization_id: str, data: PaymentCreate, user_id: str) -> Dict[str, Any]:
        amount = float(data.amount)
        amount_received = float(data.amount_received) if data.amount_received is not None else amount
        tds_amount = float(data.tds_amount or 0.0)
        tds_rate = float(data.tds_rate or 0.0)
        
        allocations = [alloc.model_dump() for alloc in data.allocations]
        total_allocated = sum(float(a.get("amount_allocated", 0)) for a in allocations)
        
        effective_funds = amount_received + tds_amount
        if total_allocated > effective_funds + 0.01:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Total allocated amount (₹{total_allocated:,.2f}) exceeds total payment funds (₹{effective_funds:,.2f})"
            )
            
        payment_no = data.payment_no or self.payment_repo.generate_payment_no(organization_id)
        
        return self.payment_repo.create_payment(
            organization_id=organization_id,
            payment_no=payment_no,
            payment_date=str(data.payment_date),
            party_id=data.party_id,
            amount=amount,
            amount_received=amount_received,
            tds_amount=tds_amount,
            tds_rate=tds_rate,
            payment_mode=data.payment_mode,
            reference_no=data.reference_no,
            notes=data.notes,
            user_id=user_id,
            allocations=allocations
        )

    def get_payments(self, organization_id: str) -> List[Dict[str, Any]]:
        return self.payment_repo.get_all(organization_id)

    def get_payment(self, payment_id: str, organization_id: str) -> Dict[str, Any]:
        payment = self.payment_repo.get_by_id(payment_id, organization_id)
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment record not found")
        return payment
