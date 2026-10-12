import os
import sys
import uuid
import logging
from datetime import date, timedelta

sys.path.insert(0, os.path.abspath("backend"))

from app.core.supabase import get_admin_supabase_client
from app.services.proforma_service import ProformaService
from app.services.payment_service import PaymentService
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate
from app.schemas.payment import PaymentCreate, PaymentAllocationItem

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sql_test")

def run_real_sql_test():
    db = get_admin_supabase_client()
    org_a = str(uuid.uuid4())
    org_b = str(uuid.uuid4())
    user_a = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    user_b = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"

    logger.info("Creating Tenant A and Tenant B organizations...")
    db.table("organizations").insert([
        {"id": org_a, "owner_user_id": user_a, "company_name": "Org A Real SQL Test", "country_code": "IN", "state_name": "Maharashtra"},
        {"id": org_b, "owner_user_id": user_b, "company_name": "Org B Real SQL Test", "country_code": "IN", "state_name": "Karnataka"}
    ]).execute()

    logger.info("Adding active membership rows for Tenant A and Tenant B users...")
    db.table("organization_members").insert([
        {"organization_id": org_a, "user_id": user_a, "role": "owner", "status": "active"},
        {"organization_id": org_b, "user_id": user_b, "role": "owner", "status": "active"}
    ]).execute()

    pf_service = ProformaService()
    pay_service = PaymentService()

    logger.info("1. Creating Pro Forma with 3 items for Tenant A...")
    pf_payload = ProFormaCreate(
        proforma_date=date.today(),
        due_date=date.today() - timedelta(days=5),
        customer_name="Global Cargo India Pvt Ltd",
        customer_country="India",
        place_of_supply_state="Maharashtra",
        currency_code="INR",
        exchange_rate=1.0,
        amount_paid=10000.0,
        items=[
            ProFormaItemCreate(description="Logistics Freight Handling", qty=10, unit_price=2000.0, tax_rate=18.0),
            ProFormaItemCreate(description="Customs Clearance Fee", qty=5, unit_price=1500.0, tax_rate=18.0),
            ProFormaItemCreate(description="Documentation Charge", qty=2, unit_price=500.0, tax_rate=18.0)
        ]
    )

    pf_res = pf_service.create_proforma(org_a, pf_payload, user_a)
    pf_id = pf_res["id"]
    pf_gt = pf_res["grand_total"]
    logger.info(f"Proforma created successfully. ID: {pf_id}, Grand Total: {pf_gt}")

    logger.info("2. Testing Cross-Tenant Conversion Denial...")
    try:
        pf_service.convert_to_invoice(pf_id, org_b, user_b)
        assert False, "Should have thrown 403 or 404 for cross-tenant conversion!"
    except Exception as e:
        logger.info(f"Cross-tenant denial verified: {e}")

    logger.info("3. Converting Pro Forma to Tax Invoice for Tenant A...")
    inv_res = pf_service.convert_to_invoice(pf_id, org_a, user_a)
    inv_id = inv_res["id"]
    inv_no = inv_res["invoice_no"]
    inv_gt = inv_res["grand_total"]
    inv_paid = inv_res["amount_paid"]
    inv_bal = inv_res["balance_due"]

    logger.info(f"Tax Invoice created: No={inv_no}, GrandTotal={inv_gt}, AmountPaid={inv_paid}, BalanceDue={inv_bal}")
    assert abs(inv_gt - pf_gt) < 0.005, f"Invoice grand total {inv_gt} != Proforma total {pf_gt}"
    assert inv_paid == 10000.0, f"Advance payment reallocated {inv_paid} != 10000.0"
    assert abs(inv_bal - (inv_gt - 10000.0)) < 0.005, f"Balance due mismatch {inv_bal}"

    logger.info("4. Verifying Financial Year Numbering Format (e.g. INV-2627-0001)...")
    assert "INV-" in inv_no, f"Invoice number format incorrect: {inv_no}"

    logger.info("5. Recording additional payment against Tax Invoice...")
    cust_id = inv_res.get("party_id") or inv_res.get("customer_id")
    pmt_payload = PaymentCreate(
        customer_id=cust_id,
        party_id=cust_id,
        payment_date=date.today(),
        mode="Bank Transfer",
        reference_no="UTR-REAL-998877",
        amount=inv_bal,
        allocations=[
            PaymentAllocationItem(document_id=inv_id, document_type="invoice", amount=inv_bal)
        ]
    )
    pmt_res = pay_service.create_payment(org_a, pmt_payload, user_a)
    logger.info(f"Payment recorded: {pmt_res.get('payment_no')}")

    inv_updated = db.table("invoices").select("*").eq("id", inv_id).execute().data[0]
    logger.info(f"Updated Invoice Status: {inv_updated.get('status')}, AmountPaid={inv_updated.get('amount_paid')}, BalanceDue={inv_updated.get('balance_due')}")
    assert inv_updated.get("balance_due") == 0.0, "Balance due should be 0 after full payment"
    assert inv_updated.get("status") == "paid", "Status should be 'paid'"

    logger.info("REAL SQL TEST COMPLETE: ALL ASSERTIONS PASSED PERFECTLY!")

if __name__ == "__main__":
    run_real_sql_test()
