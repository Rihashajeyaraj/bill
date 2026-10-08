from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from app.core.auth import get_current_user_context, UserContext
from app.repositories.party_repository import PartyRepository
from app.schemas.party import PartyCreate, PartyUpdate, PartyResponse

router = APIRouter(prefix="/parties", tags=["Parties"])
repo = PartyRepository()

@router.get("", response_model=List[PartyResponse])
def list_parties(
    party_type: Optional[str] = None,
    ctx: UserContext = Depends(get_current_user_context)
):
    return repo.get_all(ctx.company_id, party_type)

@router.get("/{party_id}", response_model=PartyResponse)
def get_party(
    party_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    party = repo.get_by_id(party_id, ctx.company_id)
    if not party:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Party not found")
    return party

@router.post("", response_model=PartyResponse, status_code=status.HTTP_201_CREATED)
def create_party(
    party_data: PartyCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return repo.create(ctx.company_id, party_data, ctx.user_id)

@router.put("/{party_id}", response_model=PartyResponse)
def update_party(
    party_id: str,
    party_data: PartyUpdate,
    ctx: UserContext = Depends(get_current_user_context)
):
    party = repo.update(party_id, ctx.company_id, party_data)
    if not party:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Party not found")
    return party

@router.delete("/{party_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_party(
    party_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    success = repo.delete(party_id, ctx.company_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Party not found")
