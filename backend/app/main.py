# Trigger uvicorn hot reload
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.auth import router as auth_router
from app.api.v1.companies import router as companies_router
from app.api.v1.parties import router as parties_router
from app.api.v1.items import router as items_router
from app.api.v1.proforma import router as proforma_router
from app.api.v1.invoices import router as invoices_router
from app.api.v1.payments import router as payments_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.reports import router as reports_router
from app.api.v1.super_admin import router as super_admin_router
from app.api.v1.users import router as users_router

app = FastAPI(
    title="Billing Application API",
    description="FastAPI Backend for Billing Application (Tax Invoices, Pro Forma, Payments & Reports)",
    version="1.0.0"
)

import time
import logging

perf_logger = logging.getLogger("performance")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def performance_timing_middleware(request: Request, call_next):
    start_time = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start_time) * 1000
    response.headers["X-Process-Time"] = f"{duration_ms:.2f}ms"
    perf_logger.info(f"{request.method} {request.url.path} took {duration_ms:.2f}ms (status {response.status_code})")
    return response

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={"Access-Control-Allow-Origin": "*"}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    error_msgs = []
    for err in errors:
        loc = " -> ".join([str(x) for x in err.get("loc", []) if x != "body"])
        msg = err.get("msg", "Invalid value")
        error_msgs.append(f"{loc}: {msg}" if loc else msg)
    clean_msg = "; ".join(error_msgs) or "Invalid request parameters"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": f"Validation Error: {clean_msg}"},
        headers={"Access-Control-Allow-Origin": "*"}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"},
        headers={"Access-Control-Allow-Origin": "*"}
    )

# Include API v1 Routers
api_v1_prefix = "/api/v1"
app.include_router(auth_router, prefix=api_v1_prefix)
app.include_router(companies_router, prefix=api_v1_prefix)
app.include_router(parties_router, prefix=api_v1_prefix)
app.include_router(items_router, prefix=api_v1_prefix)
app.include_router(proforma_router, prefix=api_v1_prefix)
app.include_router(proforma_router, prefix="/api/v1/proformas")
app.include_router(proforma_router, prefix="/api")
app.include_router(invoices_router, prefix=api_v1_prefix)
app.include_router(invoices_router, prefix="/api/v1/invoices")
app.include_router(invoices_router, prefix="/api")
app.include_router(payments_router, prefix=api_v1_prefix)
app.include_router(dashboard_router, prefix=api_v1_prefix)
app.include_router(reports_router, prefix=api_v1_prefix)
app.include_router(super_admin_router, prefix=api_v1_prefix)
app.include_router(users_router, prefix=api_v1_prefix)

@app.get("/")
def read_root():
    return {"status": "online", "message": "Billing Application API service running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
