from fastapi import APIRouter, Depends
from typing import Dict, Any
from app.core.auth import get_current_user_context, UserContext
from app.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
service = DashboardService()

@router.get("", response_model=Dict[str, Any])
def get_dashboard(ctx: UserContext = Depends(get_current_user_context)):
    """
    Returns dynamically calculated metrics for dashboard:
    total sales, invoice count, pro forma count, total payments received,
    outstanding balance, unpaid/partial/paid invoice breakdown, and recent transactions.
    """
    return service.get_dashboard_metrics(ctx.company_id)
