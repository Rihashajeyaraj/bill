import sys
import os

backend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend")
sys.path.insert(0, backend_dir)

from app.core.supabase import get_admin_supabase_client

db = get_admin_supabase_client()
real_org_id = "c595a5a3-3114-4d7a-8d12-1b34c80d0137"

print("=" * 60)
print(f"DETAILED AUDIT OF REAL ORG: {real_org_id}")
print("=" * 60)

# Check org details
org_data = db.table("organizations").select("*").eq("id", real_org_id).execute().data
print("Org:", org_data)

# Parties
parties = db.table("parties").select("id, display_name, created_at").eq("organization_id", real_org_id).execute().data or []
test_parties = [p for p in parties if any(k in p["display_name"].lower() for k in ["test", "recipient", "reversal", "badges", "advance"])]
print(f"\nParties in real org ({len(parties)} total, {len(test_parties)} test):")
for p in test_parties:
    print(f"  DELETE CANDIDATE: party {p['id']} - '{p['display_name']}' created {p.get('created_at')}")

# Proformas
pfs = db.table("proforma_invoices").select("id, proforma_no, bill_name, created_at").eq("organization_id", real_org_id).execute().data or []
test_pfs = [p for p in pfs if any(k in str(p.get("bill_name") or '').lower() for k in ["test", "recipient", "reversal", "badges", "advance"])]
print(f"\nProformas in real org ({len(pfs)} total, {len(test_pfs)} test):")
for p in test_pfs:
    print(f"  DELETE CANDIDATE: proforma {p['id']} - {p['proforma_no']} '{p.get('bill_name') or p.get('customer_name')}' created {p.get('created_at')}")

# Invoices
invs = db.table("invoices").select("id, invoice_no, notes, party_id, created_at").eq("organization_id", real_org_id).execute().data or []
test_invs = [i for i in invs if any(k in str(i.get("notes") or '').lower() for k in ["test", "recipient", "reversal", "badges", "advance"])]
print(f"\nInvoices in real org ({len(invs)} total, {len(test_invs)} test):")
for i in test_invs:
    print(f"  DELETE CANDIDATE: invoice {i['id']} - {i['invoice_no']} notes: '{i.get('notes')}' created {i.get('created_at')}")

# Payments
pmts = db.table("payments").select("id, payment_no, reference_no, notes, amount, created_at").eq("organization_id", real_org_id).execute().data or []
test_pmts = [p for p in pmts if any(k in (str(p.get("reference_no") or '') + str(p.get("notes") or '')).lower() for k in ["test", "upi-adv", "bank-multi", "overpay", "illegal", "upi-pf-conv", "bank-adv-apply", "upi-rev"])]
print(f"\nPayments in real org ({len(pmts)} total, {len(test_pmts)} test):")
for p in test_pmts:
    print(f"  DELETE CANDIDATE: payment {p['id']} - {p['payment_no']} ref: '{p.get('reference_no')}' amt: {p['amount']} created {p.get('created_at')}")
