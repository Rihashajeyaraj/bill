import sys
import os
import argparse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
from app.core.supabase import get_admin_supabase_client

def backfill_converted_invoices(dry_run: bool = True):
    db = get_admin_supabase_client()
    print("=" * 60)
    print(f"BACKFILL CONVERTED INVOICES - {'DRY RUN' if dry_run else 'APPLY MODE'}")
    print("=" * 60)

    pfs = db.table("proforma_invoices").select(
        "id, organization_id, proforma_no, proforma_date, party_id, bill_name, due_date, valid_till, converted_document_id"
    ).not_.is_("converted_document_id", "null").execute().data or []

    invs = db.table("invoices").select(
        "id, organization_id, invoice_no, party_id, due_date, grand_total"
    ).execute().data or []
    inv_map = {i["id"]: i for i in invs}

    affected: List[Dict[str, Any]] = []

    for pf in pfs:
        inv_id = pf.get("converted_document_id")
        inv = inv_map.get(inv_id)
        if not inv:
            continue

        needs_party = False
        needs_due = False
        new_party = None
        new_due = None

        if not inv.get("party_id") and pf.get("party_id"):
            needs_party = True
            new_party = pf.get("party_id")

        if not inv.get("due_date"):
            eff_due = pf.get("due_date") or pf.get("valid_till") or pf.get("proforma_date")
            if eff_due:
                needs_due = True
                new_due = str(eff_due)

        if needs_party or needs_due:
            affected.append({
                "invoice_id": inv["id"],
                "invoice_no": inv["invoice_no"],
                "org_id": inv["organization_id"],
                "source_pf_no": pf.get("proforma_no"),
                "source_pf_id": pf["id"],
                "current_party_id": inv.get("party_id"),
                "new_party_id": new_party,
                "current_due_date": inv.get("due_date"),
                "new_due_date": new_due,
            })

    print(f"Found {len(affected)} converted invoices requiring backfill:")
    print("-" * 60)
    for idx, row in enumerate(affected, 1):
        print(f"{idx}. Invoice {row['invoice_no']} [{row['invoice_id']}] (from Pro Forma {row['source_pf_no']}):")
        if row['new_party_id']:
            print(f"   - party_id: {row['current_party_id']} -> {row['new_party_id']}")
        if row['new_due_date']:
            print(f"   - due_date: {row['current_due_date']} -> {row['new_due_date']}")

    print("-" * 60)
    if dry_run:
        print(f"DRY RUN COMPLETE. {len(affected)} row(s) identified. No changes made.")
    else:
        print(f"APPLYING updates to {len(affected)} invoice(s)...")
        for row in affected:
            updates = {}
            if row["new_party_id"]:
                updates["party_id"] = row["new_party_id"]
            if row["new_due_date"]:
                updates["due_date"] = row["new_due_date"]
            if updates:
                db.table("invoices").update(updates).eq("id", row["invoice_id"]).execute()
        print("APPLY COMPLETE.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill party_id and due_date on converted invoices.")
    parser.add_argument("--apply", action="store_true", help="Apply the backfill changes. If not specified, runs in dry-run mode.")
    args = parser.parse_args()
    backfill_converted_invoices(dry_run=not args.apply)
