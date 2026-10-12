import sys
import os
import json

backend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend")
sys.path.insert(0, backend_dir)

from app.core.supabase import get_admin_supabase_client

db = get_admin_supabase_client()

print("=" * 60)
print("TEST DATA SAFETY: INSPECTING ORGANIZATIONS AND TEST ROWS")
print("=" * 60)

orgs = db.table("organizations").select("id, company_name, created_at").execute().data or []
print(f"Total organizations found: {len(orgs)}")
for o in orgs:
    print(f"Org ID: {o['id']} | Name: {o.get('company_name') or 'Unnamed'} | Created: {o.get('created_at')}")

real_org_id = "c595a5a3-" # check any matching or real org
real_orgs = [o for o in orgs if str(o['id']).startswith("c595a5a3") or "demo" in str(o.get('name') or '').lower() or not str(o.get('name') or '').startswith("Org ") and not str(o.get('name') or '').startswith("Tenant ")]

print("\n--- Rows in organizations to inspect for test artifacts ---")
# Check parties created recently or with 'Test' in name
parties = db.table("parties").select("id, organization_id, display_name, created_at").execute().data or []
test_parties = [p for p in parties if "test" in (p.get("display_name") or "").lower() or "recipient" in (p.get("display_name") or "").lower() or "reversal" in (p.get("display_name") or "").lower() or "badges" in (p.get("display_name") or "").lower()]

print(f"Found {len(test_parties)} test parties:")
for p in test_parties:
    print(f"  Party ID: {p['id']} | Org: {p['organization_id']} | Name: {p['display_name']} | Created: {p.get('created_at')}")

# Check proformas created with test names
pfs = db.table("proforma_invoices").select("id, organization_id, proforma_no, bill_name, customer_name, created_at").execute().data or []
test_pfs = [p for p in pfs if any(k in (str(p.get("bill_name") or '') + str(p.get("customer_name") or '')).lower() for k in ["test", "recipient", "reversal", "badges", "secret item", "conv advance"])]

print(f"\nFound {len(test_pfs)} test proformas:")
for p in test_pfs:
    print(f"  PF ID: {p['id']} | Org: {p['organization_id']} | No: {p['proforma_no']} | Name: {p.get('bill_name') or p.get('customer_name')}")

# Check invoices created with test names
invs = db.table("invoices").select("id, organization_id, invoice_no, customer_name, notes, created_at").execute().data or []
test_invs = [i for i in invs if any(k in (str(i.get("customer_name") or '') + str(i.get("notes") or '')).lower() for k in ["test", "recipient", "reversal", "badges"])]

print(f"\nFound {len(test_invs)} test invoices:")
for i in test_invs:
    print(f"  Invoice ID: {i['id']} | Org: {i['organization_id']} | No: {i['invoice_no']} | Cust: {i.get('customer_name')}")

# Check payments created with test reference_nos
pmts = db.table("payments").select("id, organization_id, payment_no, reference_no, notes, amount, created_at").execute().data or []
test_pmts = [p for p in pmts if any(k in (str(p.get("reference_no") or '') + str(p.get("notes") or '')).lower() for k in ["test", "upi-adv", "bank-multi", "overpay", "illegal", "upi-pf-conv", "bank-adv-apply", "upi-rev"])]

print(f"\nFound {len(test_pmts)} test payments:")
for p in test_pmts:
    print(f"  Payment ID: {p['id']} | Org: {p['organization_id']} | No: {p['payment_no']} | Ref: {p.get('reference_no')} | Amt: {p['amount']}")
