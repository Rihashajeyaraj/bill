import pytest
import uuid
from datetime import date
from app.core.supabase import get_admin_supabase_client
from app.services.report_service import ReportService
from app.schemas.invoice import InvoiceCreate, InvoiceItemCreate
from app.services.invoice_service import InvoiceService
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate
from app.services.proforma_service import ProformaService

def test_sale_report_end_to_end():
    """
    Test Sale Report end-to-end:
    1. Create tax invoice WITH customer_id -> appears in report with customer name.
    2. Create tax invoice WITHOUT customer_id -> appears in report with 'Walk-in / Unlinked'.
    3. Create CANCELLED tax invoice -> excluded from report.
    4. Multi-tenant RLS: Tenant B cannot view Tenant A's rows.
    5. Date boundaries inclusive (start_date and end_date).
    6. Include Pro Forma toggle: Pro Forma appears in table but excluded from Sales summary totals.
    """
    db = get_admin_supabase_client()
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    org_user_res = db.table("organizations").select("owner_user_id").not_.is_("owner_user_id", "null").limit(1).execute()
    user_id = org_user_res.data[0]["owner_user_id"] if org_user_res.data and org_user_res.data[0].get("owner_user_id") else "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"

    # Ensure test organizations exist
    org_res = db.table("organizations").select("id").execute()
    existing_orgs = [row["id"] for row in (org_res.data or []) if row.get("id")]
    if len(existing_orgs) >= 2:
        tenant_a = existing_orgs[0]
        tenant_b = existing_orgs[1]
    elif len(existing_orgs) == 1:
        tenant_a = existing_orgs[0]
        try:
            db.table("organizations").insert({"id": tenant_b, "name": "Report Test Org B", "country": "India", "owner_user_id": user_id}).execute()
        except Exception:
            tenant_b = str(uuid.uuid4())
    else:
        try:
            db.table("organizations").insert([
                {"id": tenant_a, "name": "Report Test Org A", "country": "India", "owner_user_id": user_id},
                {"id": tenant_b, "name": "Report Test Org B", "country": "India", "owner_user_id": user_id}
            ]).execute()
        except Exception:
            pass

    try:
        db.table("organization_members").upsert([
            {"organization_id": tenant_a, "user_id": user_id, "role": "owner", "status": "active"},
            {"organization_id": tenant_b, "user_id": user_id, "role": "owner", "status": "active"}
        ]).execute()
    except Exception:
        pass

    # 1. Create a Customer for Tenant A
    customer_id = str(uuid.uuid4())
    customer_name = f"Acme Customer {uuid.uuid4().hex[:6]}"
    p_res = db.table("parties").insert({
        "id": customer_id,
        "organization_id": tenant_a,
        "display_name": customer_name,
        "party_type": "customer"
    }).execute()
    if p_res.data:
        customer_id = p_res.data[0]["id"]

    report_service = ReportService()
    inv_service = InvoiceService()
    pf_service = ProformaService()

    # 2. Create Tax Invoice WITH customer_id for Tenant A (Date: 2026-10-05)
    inv1_create = InvoiceCreate(
        customer_id=customer_id,
        invoice_date=date(2026, 10, 5),
        place_of_supply_state="TAMIL NADU",
        items=[
            InvoiceItemCreate(description="Item A", qty=1, unit_price=1000.0, tax_rate=18.0)
        ]
    )
    inv1 = inv_service.create_invoice(tenant_a, inv1_create, user_id)

    # 3. Create Tax Invoice WITHOUT customer_id for Tenant A (Date: 2026-10-10)
    inv2_create = InvoiceCreate(
        customer_id=None,
        invoice_date=date(2026, 10, 10),
        place_of_supply_state="TAMIL NADU",
        items=[
            InvoiceItemCreate(description="Item B", qty=1, unit_price=500.0, tax_rate=18.0)
        ]
    )
    inv2 = inv_service.create_invoice(tenant_a, inv2_create, user_id)

    # 4. Create CANCELLED Tax Invoice for Tenant A (Date: 2026-10-07)
    inv3_create = InvoiceCreate(
        customer_id=customer_id,
        invoice_date=date(2026, 10, 7),
        place_of_supply_state="TAMIL NADU",
        items=[
            InvoiceItemCreate(description="Cancelled Item", qty=1, unit_price=3000.0, tax_rate=18.0)
        ]
    )
    inv3 = inv_service.create_invoice(tenant_a, inv3_create, user_id)
    # Mark inv3 as cancelled directly in DB
    db.table("invoices").update({"status": "cancelled"}).eq("id", inv3["id"]).execute()

    # 5. Create Tax Invoice for Tenant B (Date: 2026-10-05)
    inv4_create = InvoiceCreate(
        customer_id=None,
        invoice_date=date(2026, 10, 5),
        place_of_supply_state="TAMIL NADU",
        items=[
            InvoiceItemCreate(description="Tenant B Item", qty=1, unit_price=9999.0, tax_rate=18.0)
        ]
    )
    inv4 = inv_service.create_invoice(tenant_b, inv4_create, user_id)

    # 6. Create Pro Forma Invoice for Tenant A (Date: 2026-10-06)
    pf_create = ProFormaCreate(
        customer_name="Proforma Cust",
        place_of_supply_state="TAMIL NADU",
        proforma_date=date(2026, 10, 6),
        items=[
            ProFormaItemCreate(description="PF Item", qty=1, unit_price=700.0, tax_rate=18.0)
        ]
    )
    pf = pf_service.create_proforma(tenant_a, pf_create, user_id)

    # TEST A: Fetch Sale Report for Tenant A within date range 2026-10-05 to 2026-10-10
    report_a = report_service.get_sales_report(
        organization_id=tenant_a,
        start_date="05/10/2026", # testing DD/MM/YYYY parsing
        end_date="2026-10-10",   # testing ISO YYYY-MM-DD parsing
        include_proforma=False
    )

    data_a = report_a["data"]
    data_ids_a = [r["id"] for r in data_a]

    # Verify Inv 1 and Inv 2 are in report
    assert inv1["id"] in data_ids_a, "Invoice 1 with customer_id should be in Sale Report"
    assert inv2["id"] in data_ids_a, "Invoice 2 without customer_id should be in Sale Report"

    # Verify Cancelled Inv 3 is EXCLUDED
    assert inv3["id"] not in data_ids_a, "Cancelled Invoice 3 must NOT appear in Sale Report"

    # Verify Tenant B's Inv 4 is EXCLUDED (Multi-tenant RLS isolation)
    assert inv4["id"] not in data_ids_a, "Tenant B's invoice must NOT appear in Tenant A's Sale Report"

    # Verify Customer Name Resolution
    inv1_row = next(r for r in data_a if r["id"] == inv1["id"])
    assert inv1_row["customer_name"] == customer_name, f"Expected {customer_name}, got {inv1_row['customer_name']}"

    inv2_row = next(r for r in data_a if r["id"] == inv2["id"])
    assert inv2_row["customer_name"] == "Walk-in / Unlinked", f"Expected Walk-in / Unlinked, got {inv2_row['customer_name']}"

    # TEST B: Customer ID Filter
    report_cust = report_service.get_sales_report(
        organization_id=tenant_a,
        customer_id=customer_id
    )
    cust_data_ids = [r["id"] for r in report_cust["data"]]
    assert inv1["id"] in cust_data_ids, "Inv 1 should match customer filter"
    assert inv2["id"] not in cust_data_ids, "Inv 2 (unlinked) should not match specific customer filter"

    # TEST C: Include Pro Forma Toggle
    report_pf = report_service.get_sales_report(
        organization_id=tenant_a,
        start_date="2026-10-01",
        end_date="2026-10-31",
        include_proforma=True
    )

    pf_row = next((r for r in report_pf["data"] if r["id"] == pf["id"]), None)
    assert pf_row is not None, "Pro Forma should appear in table when include_proforma=True"
    assert pf_row["document_type"] == "Pro Forma"

    # Verify Pro Forma amount is NOT mixed into Total Sales summary
    tax_inv_sum = sum(r["grand_total"] for r in report_pf["data"] if not r["is_proforma"])
    assert report_pf["summary"]["total_sales"] == tax_inv_sum, "Pro Forma amounts must NOT be mixed into Total Sales summary"
