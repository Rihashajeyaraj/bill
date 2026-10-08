from fastapi import APIRouter, Depends
from app.core.auth import get_current_user_context, UserContext

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.get("/me", response_model=UserContext)
def get_current_user(context: UserContext = Depends(get_current_user_context)):
    """
    Returns the authenticated user's context, organization ID, and role.
    """
    return context
