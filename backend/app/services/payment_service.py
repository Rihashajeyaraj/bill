from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from app.repositories.payment_repository import PaymentRepository
from app.schemas.payment import PaymentCreate, PaymentCreateWizard

class PaymentService:
    def __init__(self, token: Optional[str] = None):
        self.payment_repo = PaymentRepository(token=token)

    def get_customer_summary(self, customer_id: str, organization_id: str) -> Dict[str, Any]:
        return self.payment_repo.get_customer_summary(customer_id, organization_id)

    def get_summary(self, organization_id: str, customer_id: Optional[str] = None, from_date: Optional[str] = None, to_date: Optional[str] = None) -> Dict[str, Any]:
        return self.payment_repo.get_summary(organization_id, customer_id=customer_id, from_date=from_date, to_date=to_date)

    def get_pending_documents(
        self,
        customer_id: Optional[str] = None,
        organization_id: str = "",
        doc_type: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        q: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self.payment_repo.get_pending_documents(
            customer_id=customer_id,
            organization_id=organization_id,
            doc_type=doc_type,
            from_date=from_date,
            to_date=to_date,
            q=q
        )

    def get_filtered_payments(
        self,
        organization_id: str,
        q: Optional[str] = None,
        customer_id: Optional[str] = None,
        mode: Optional[str] = None,
        status: Optional[str] = None,
        doc_type: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        page: int = 1,
        page_size: int = 25,
        sort: str = "payment_date",
        sort_dir: str = "desc"
    ) -> Dict[str, Any]:
        return self.payment_repo.get_filtered_payments(
            organization_id=organization_id,
            q=q,
            customer_id=customer_id,
            mode=mode,
            status=status,
            doc_type=doc_type,
            from_date=from_date,
            to_date=to_date,
            page=page,
            page_size=page_size,
            sort=sort,
            sort_dir=sort_dir
        )

    def get_tds_history(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        q: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self.payment_repo.get_tds_history(
            organization_id=organization_id,
            customer_id=customer_id,
            from_date=from_date,
            to_date=to_date,
            q=q
        )

    def reverse_payment(self, payment_id: str, organization_id: str, reason: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        return self.payment_repo.reverse_payment(payment_id, organization_id, reason, user_id)

    def create_wizard_payment(self, organization_id: str, data: PaymentCreateWizard, user_id: str) -> Dict[str, Any]:
        pending_docs = self.payment_repo.get_pending_documents(data.customer_id, organization_id)
        doc_map = {d["document_id"]: d for d in pending_docs}

        # Check overpayment per document
        for alloc in data.allocations:
            doc = doc_map.get(alloc.document_id)
            if doc:
                bal = float(doc.get("balance_due", 0))
                if alloc.amount > bal + 0.01 and not data.is_advance:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Allocated amount ₹{alloc.amount:,.2f} exceeds remaining balance ₹{bal:,.2f} for document {doc.get('document_no')}"
                    )

        allocations_payload = [
            {
                "document_id": alloc.document_id,
                "invoice_id": alloc.document_id,
                "document_type": alloc.document_type,
                "amount": float(alloc.amount),
                "amount_allocated": float(alloc.amount)
            }
            for alloc in data.allocations
        ]
        total_allocated = sum(a["amount"] for a in allocations_payload)

        payment_no = self.payment_repo.generate_payment_no(organization_id)
        return self.payment_repo.create_payment(
            organization_id=organization_id,
            payment_no=payment_no,
            payment_date=str(data.payment_date),
            party_id=data.customer_id,
            amount=total_allocated,
            amount_received=total_allocated,
            tds_amount=0.0,
            tds_rate=0.0,
            payment_mode=data.mode,
            reference_no=data.reference_no,
            notes=data.notes,
            user_id=user_id,
            allocations=allocations_payload
        )

    def create_payment(self, organization_id: str, data: PaymentCreate, user_id: str) -> Dict[str, Any]:
        if not data.customer_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Customer is required.")

        mode_clean = str(data.mode or "Bank Transfer").strip()
        if mode_clean in ["UPI", "Bank Transfer", "Cheque", "Card"] and not (data.reference_no and data.reference_no.strip()):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Reference number is required for {mode_clean}.")

        sum_allocations = sum(float(alloc.amount) for alloc in data.allocations)
        tds_amount = float(data.tds_amount or 0.0)
        tds_rate = float(data.tds_percent or 0.0)

        # Verified amount calculation
        if data.amount is not None and data.amount > 0:
            verified_amount = float(data.amount)
        else:
            verified_amount = sum_allocations

        if verified_amount <= 0:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Amount received must be greater than 0.")

        # Check allocations vs amount
        if not data.is_advance:
            if not data.allocations and sum_allocations == 0:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payment must include document allocations or be marked as an advance payment.")
            if data.amount is not None and abs(verified_amount - sum_allocations) > 0.01:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Total amount (₹{verified_amount:,.2f}) does not match sum of allocated documents (₹{sum_allocations:,.2f}).")
        else:
            if sum_allocations > verified_amount + 0.01:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Sum of document allocations (₹{sum_allocations:,.2f}) exceeds total payment amount (₹{verified_amount:,.2f}).")

        # Overpayment check against pending documents
        if data.allocations:
            pending_docs = self.payment_repo.get_pending_documents(customer_id=data.customer_id, organization_id=organization_id)
            doc_map = {d["document_id"]: d for d in pending_docs}
            for alloc in data.allocations:
                doc = doc_map.get(alloc.document_id)
                if not doc:
                    inv_check = self.admin_db.table("invoices").select("*").eq("id", alloc.document_id).eq("organization_id", organization_id).limit(1).execute()
                    if inv_check.data:
                        inv_row = inv_check.data[0]
                        gt = float(inv_row.get("grand_total") or 0.0)
                        pd = float(inv_row.get("amount_paid") or 0.0)
                        bal = max(0.0, gt - pd)
                        doc = {
                            "document_id": inv_row["id"],
                            "document_no": inv_row.get("invoice_no"),
                            "balance_due": bal
                        }
                    else:
                        pf_check = self.admin_db.table("proforma_invoices").select("*").eq("id", alloc.document_id).eq("organization_id", organization_id).limit(1).execute()
                        if pf_check.data:
                            pf_row = pf_check.data[0]
                            gt = float(pf_row.get("grand_total") or 0.0)
                            pd = float(pf_row.get("amount_paid") or pf_row.get("advance_received") or 0.0)
                            bal = max(0.0, gt - pd)
                            doc = {
                                "document_id": pf_row["id"],
                                "document_no": pf_row.get("proforma_no"),
                                "balance_due": bal
                            }

                if doc:
                    bal = float(doc.get("balance_due", 0))
                    if alloc.amount > bal + 0.01:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=f"Allocated amount ₹{alloc.amount:,.2f} exceeds remaining balance ₹{bal:,.2f} for document {doc.get('document_no')}"
                        )
                else:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Pending document {alloc.document_id} not found or does not belong to this customer."
                    )

        allocations_payload = [
            {
                "document_id": alloc.document_id,
                "invoice_id": alloc.document_id,
                "document_type": alloc.document_type,
                "amount": float(alloc.amount),
                "amount_allocated": float(alloc.amount)
            }
            for alloc in data.allocations
        ]

        payment_no = data.payment_no or self.payment_repo.generate_payment_no(organization_id)

        return self.payment_repo.create_payment(
            organization_id=organization_id,
            payment_no=payment_no,
            payment_date=str(data.payment_date),
            party_id=data.customer_id,
            amount=verified_amount,
            amount_received=verified_amount,
            tds_amount=tds_amount,
            tds_rate=tds_rate,
            payment_mode=mode_clean,
            reference_no=data.reference_no,
            notes=data.notes,
            user_id=user_id,
            allocations=allocations_payload,
            is_advance=data.is_advance
        )


    def get_payments(self, organization_id: str) -> List[Dict[str, Any]]:
        return self.payment_repo.get_all(organization_id)

    def get_payment(self, payment_id: str, organization_id: str) -> Dict[str, Any]:
        payment = self.payment_repo.get_by_id(payment_id, organization_id)
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment record not found")
        return payment

    def get_receivables(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        status_filter: Optional[str] = None,
        q: Optional[str] = None,
        doc_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self.payment_repo.get_receivables(
            organization_id=organization_id,
            customer_id=customer_id,
            from_date=from_date,
            to_date=to_date,
            status_filter=status_filter,
            q=q,
            doc_type=doc_type
        )

    def get_receivables_summary(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> Dict[str, Any]:
        return self.payment_repo.get_receivables_summary(
            organization_id=organization_id,
            customer_id=customer_id,
            from_date=from_date,
            to_date=to_date
        )

    def get_customer_receivables(
        self,
        organization_id: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self.payment_repo.get_customer_receivables(
            organization_id=organization_id,
            from_date=from_date,
            to_date=to_date
        )

    def get_receipts_history(
        self,
        organization_id: str,
        customer_id: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        q: Optional[str] = None,
        page: int = 1,
        page_size: int = 50
    ) -> Dict[str, Any]:
        return self.payment_repo.get_receipts_history(
            organization_id=organization_id,
            customer_id=customer_id,
            from_date=from_date,
            to_date=to_date,
            q=q,
            page=page,
            page_size=page_size
        )

    def apply_advance(
        self,
        organization_id: str,
        customer_id: str,
        invoice_id: str,
        amount: float,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        return self.payment_repo.apply_advance(
            organization_id=organization_id,
            customer_id=customer_id,
            invoice_id=invoice_id,
            amount=amount,
            user_id=user_id
        )

    def get_customer_ledger(
        self,
        customer_id: str,
        organization_id: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> Dict[str, Any]:
        return self.payment_repo.get_customer_ledger(
            customer_id=customer_id,
            organization_id=organization_id,
            from_date=from_date,
            to_date=to_date
        )


