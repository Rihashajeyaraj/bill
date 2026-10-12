import os
import sys
import uuid
import concurrent.futures

sys.path.insert(0, os.path.abspath("backend"))

from app.core.supabase import get_admin_supabase_client
from app.services.proforma_service import ProformaService
from app.schemas.proforma import ProFormaCreate, ProFormaItemCreate

def test_20_parallel():
    db = get_admin_supabase_client()
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    org_id = str(uuid.uuid4())
    
    print(f"Creating organization {org_id}...")
    db.table("organizations").insert({
        "id": org_id,
        "owner_user_id": user_id,
        "company_name": f"Parallel 20 Org {uuid.uuid4().hex[:6]}",
        "country_code": "IN",
        "state_name": "Maharashtra"
    }).execute()
    
    db.table("organization_members").insert({
        "organization_id": org_id,
        "user_id": user_id,
        "role": "owner",
        "status": "active"
    }).execute()

    # Pre-seed sequence row to ensure FOR UPDATE locking
    try:
        db.table("organization_document_sequences").insert({
            "organization_id": org_id,
            "invoice_prefix": "INV",
            "invoice_next_no": 1,
            "sales_proforma_prefix": "PI",
            "sales_proforma_next_no": 1
        }).execute()
    except Exception as e:
        print("Sequence seed:", e)

    pf_service = ProformaService()

    # Create 20 proformas
    print("Creating 20 proformas...")
    pf_ids = []
    for i in range(20):
        pf_payload = ProFormaCreate(
            customer_name=f"Customer {i+1}",
            items=[ProFormaItemCreate(description=f"Item {i+1}", qty=1, unit_price=100.0 * (i+1))]
        )
        created = pf_service.create_proforma(org_id, pf_payload, user_id)
        pf_ids.append(created["id"])

    print(f"Created 20 proformas. Now running 20 parallel conversions...")

    def do_convert(pf_id):
        import time
        for attempt in range(5):
            try:
                svc = ProformaService()
                return svc.convert_to_invoice(pf_id, org_id, user_id)
            except Exception as e:
                if ("disconnect" in str(e).lower() or "connection" in str(e).lower()) and attempt < 4:
                    time.sleep(0.3 * (attempt + 1))
                    continue
                raise

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(do_convert, pid) for pid in pf_ids]
        for f in concurrent.futures.as_completed(futures):
            res = f.result()
            results.append(res)

    invoice_numbers = [r["invoice_no"] for r in results]
    print(f"Total converted: {len(invoice_numbers)}")
    print(f"Distinct numbers: {len(set(invoice_numbers))}")
    print(f"Invoice numbers: {sorted(invoice_numbers)}")

    assert len(invoice_numbers) == 20
    assert len(set(invoice_numbers)) == 20

    # Check gap-free sequence
    import re
    seqs = sorted([int(re.search(r"(\d+)$", ino).group(1)) for ino in invoice_numbers])
    print(f"Sequence numbers: {seqs}")
    assert seqs == list(range(1, 21)), f"Expected 1..20 gap-free, got {seqs}"
    print("SUCCESS! 20 distinct, gap-free invoice numbers produced in parallel.")

if __name__ == "__main__":
    test_20_parallel()
