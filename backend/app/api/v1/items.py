from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from app.core.auth import get_current_user_context, UserContext
from app.repositories.item_repository import ItemRepository
from app.schemas.item import ItemCreate, ItemUpdate, ItemResponse

router = APIRouter(prefix="/items", tags=["Items"])
repo = ItemRepository()

@router.get("", response_model=List[ItemResponse])
def list_items(ctx: UserContext = Depends(get_current_user_context)):
    return repo.get_all(ctx.company_id)

@router.get("/{item_id}", response_model=ItemResponse)
def get_item(
    item_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    item = repo.get_by_id(item_id, ctx.company_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item

@router.post("", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
def create_item(
    item_data: ItemCreate,
    ctx: UserContext = Depends(get_current_user_context)
):
    return repo.create(ctx.company_id, item_data, ctx.user_id)

@router.put("/{item_id}", response_model=ItemResponse)
def update_item(
    item_id: str,
    item_data: ItemUpdate,
    ctx: UserContext = Depends(get_current_user_context)
):
    item = repo.update(item_id, ctx.company_id, item_data)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: str,
    ctx: UserContext = Depends(get_current_user_context)
):
    success = repo.delete(item_id, ctx.company_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
