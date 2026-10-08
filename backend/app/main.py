from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.auth import router as auth_router
from app.api.v1.parties import router as parties_router
from app.api.v1.items import router as items_router
from app.api.v1.proforma import router as proforma_router
from app.api.v1.invoices import router as invoices_router
from app.api.v1.payments import router as payments_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.reports import router as reports_router

app = FastAPI(
    title="Billing Application API",
    description="FastAPI Backend for Billing Application (Tax Invoices, Pro Forma, Payments & Reports)",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
app.include_router(parties_router, prefix=api_v1_prefix)
app.include_router(items_router, prefix=api_v1_prefix)
app.include_router(proforma_router, prefix=api_v1_prefix)
app.include_router(invoices_router, prefix=api_v1_prefix)
app.include_router(payments_router, prefix=api_v1_prefix)
app.include_router(dashboard_router, prefix=api_v1_prefix)
app.include_router(reports_router, prefix=api_v1_prefix)

@app.get("/")
def read_root():
    return {"status": "online", "message": "Billing Application API service running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
