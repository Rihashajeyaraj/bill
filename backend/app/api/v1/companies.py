import base64
import logging
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from app.core.auth import get_current_user_context, UserContext
from app.repositories.company_repository import CompanyRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/companies", tags=["Companies & Organizations"])
repo = CompanyRepository()

class CompanyCreate(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    country_code: str = "IN"
    state_name: Optional[str] = "Tamil Nadu"
    city: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    postal_code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    cin: Optional[str] = None
    tax_regime: str = "gst"
    base_currency: str = "INR"
    bank_details: Optional[Dict[str, Any]] = None

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    state_name: Optional[str] = None
    city: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    postal_code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None

class AssetUploadRequest(BaseModel):
    image_data: Optional[str] = None
    mime_type: Optional[str] = "image/png"

@router.get("", response_model=List[Dict[str, Any]])
def list_companies(ctx: UserContext = Depends(get_current_user_context)):
    return repo.list_user_companies(ctx.user_id)

@router.get("/{company_id}", response_model=Dict[str, Any])
def get_company(company_id: str, ctx: UserContext = Depends(get_current_user_context)):
    company = repo.get_by_id(company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company

@router.post("", response_model=Dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_company(data: CompanyCreate, ctx: UserContext = Depends(get_current_user_context)):
    comp_name = data.name or data.company_name or "My New Company"
    payload = data.model_dump()
    payload["company_name"] = comp_name
    company = repo.create(company_name=comp_name, owner_user_id=ctx.user_id, payload=payload)
    return company

@router.put("/{company_id}", response_model=Dict[str, Any])
def update_company(company_id: str, data: CompanyUpdate, ctx: UserContext = Depends(get_current_user_context)):
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload and "company_name" not in payload:
        payload["company_name"] = payload.pop("name")
    updated = repo.update(company_id, payload)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return updated

@router.post("/{company_id}/logo")
async def upload_company_logo(
    company_id: str,
    request: Request,
    ctx: UserContext = Depends(get_current_user_context)
):
    if not repo.user_has_company_access(ctx.user_id, company_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this company")

    content_type = request.headers.get("content-type", "").lower()
    file_bytes = b""
    mime_type = "image/png"

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload_file = form.get("file")
        if upload_file and hasattr(upload_file, "read"):
            file_bytes = await upload_file.read()
            mime_type = upload_file.content_type or "image/png"
        else:
            data_str = str(form.get("image_data") or "")
            if data_str:
                if data_str.startswith("data:"):
                    header, b64_data = data_str.split(",", 1)
                    mime_type = header.split(";")[0].replace("data:", "")
                    file_bytes = base64.b64decode(b64_data)
                else:
                    mime_type = str(form.get("mime_type") or "image/png")
                    file_bytes = base64.b64decode(data_str)
    else:
        try:
            body = await request.json()
        except Exception:
            body = {}
        data_str = str(body.get("image_data") or "")
        if data_str:
            if data_str.startswith("data:"):
                header, b64_data = data_str.split(",", 1)
                mime_type = header.split(";")[0].replace("data:", "")
                file_bytes = base64.b64decode(b64_data)
            else:
                mime_type = str(body.get("mime_type") or "image/png")
                file_bytes = base64.b64decode(data_str)

    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file or image data provided")

    try:
        result = repo.upload_company_asset(company_id, "logo", file_bytes, mime_type)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to upload logo: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to upload logo: {str(e)}")

@router.delete("/{company_id}/logo")
def delete_company_logo(company_id: str, ctx: UserContext = Depends(get_current_user_context)):
    if not repo.user_has_company_access(ctx.user_id, company_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this company")
    try:
        return repo.delete_company_asset(company_id, "logo")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete logo: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete logo")

@router.post("/{company_id}/signature")
async def upload_company_signature(
    company_id: str,
    request: Request,
    ctx: UserContext = Depends(get_current_user_context)
):
    if not repo.user_has_company_access(ctx.user_id, company_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this company")

    content_type = request.headers.get("content-type", "").lower()
    file_bytes = b""
    mime_type = "image/png"

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload_file = form.get("file")
        if upload_file and hasattr(upload_file, "read"):
            file_bytes = await upload_file.read()
            mime_type = upload_file.content_type or "image/png"
        else:
            data_str = str(form.get("image_data") or "")
            if data_str:
                if data_str.startswith("data:"):
                    header, b64_data = data_str.split(",", 1)
                    mime_type = header.split(";")[0].replace("data:", "")
                    file_bytes = base64.b64decode(b64_data)
                else:
                    mime_type = str(form.get("mime_type") or "image/png")
                    file_bytes = base64.b64decode(data_str)
    else:
        try:
            body = await request.json()
        except Exception:
            body = {}
        data_str = str(body.get("image_data") or "")
        if data_str:
            if data_str.startswith("data:"):
                header, b64_data = data_str.split(",", 1)
                mime_type = header.split(";")[0].replace("data:", "")
                file_bytes = base64.b64decode(b64_data)
            else:
                mime_type = str(body.get("mime_type") or "image/png")
                file_bytes = base64.b64decode(data_str)

    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file or image data provided")

    try:
        result = repo.upload_company_asset(company_id, "signature", file_bytes, mime_type)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to upload signature: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to upload signature: {str(e)}")

@router.delete("/{company_id}/signature")
def delete_company_signature(company_id: str, ctx: UserContext = Depends(get_current_user_context)):
    if not repo.user_has_company_access(ctx.user_id, company_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this company")
    try:
        return repo.delete_company_asset(company_id, "signature")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete signature: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete signature")
