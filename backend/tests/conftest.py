import os
import re
import pytest
from app.core.config import settings
from app.core.supabase import get_admin_supabase_client

@pytest.fixture(scope="session", autouse=True)
def guard_test_database_execution():
    """
    Test Safety Guard: Deny by default.
    Only allows test execution when:
    1. TEST_DB_CONFIRMED=1 is set explicitly in the environment.
    2. Target Supabase URL reference matches an allowed test project in ALLOWED_TEST_PROJECT_REFS.
    Never prints the actual project reference to protect sensitive credentials.
    """
    confirmed = os.environ.get("TEST_DB_CONFIRMED", "0")
    if str(confirmed).strip() != "1":
        pytest.exit("Aborting pytest: TEST_DB_CONFIRMED=1 is not set explicitly. Denying test execution by default to protect database.")

    # Extract target project reference from Supabase URL
    url_match = re.search(r"https?://([^.]+)\.supabase\.(?:co|in)", str(settings.SUPABASE_URL))
    project_ref = url_match.group(1) if url_match else ""

    raw_allowed = os.environ.get("ALLOWED_TEST_PROJECT_REFS", "tczrxkmdhbsfbjxzlvav")
    allowed_refs = {r.strip() for r in raw_allowed.split(",") if r.strip()}

    if not project_ref or project_ref not in allowed_refs:
        pytest.exit("Aborting pytest: Target database project reference is not authorized in ALLOWED_TEST_PROJECT_REFS.")


@pytest.fixture
def test_data_cleaner():
    """
    Per-test cleanup fixture:
    Tracks entities created during each test and performs cascaded deletion upon test completion.
    """
    tracked = {
        "orgs": [],
        "invoices": [],
        "proformas": [],
        "payments": [],
        "parties": []
    }

    yield tracked

    db = get_admin_supabase_client()

    # 1. Clean up payments and allocations
    for pay_id in tracked["payments"]:
        try:
            db.table("payments").delete().eq("id", str(pay_id)).execute()
        except Exception:
            pass

    # 2. Clean up invoices and invoice items
    for inv_id in tracked["invoices"]:
        try:
            db.table("invoice_items").delete().eq("invoice_id", str(inv_id)).execute()
            db.table("invoices").delete().eq("id", str(inv_id)).execute()
        except Exception:
            pass

    # 3. Clean up proformas and proforma items
    for pf_id in tracked["proformas"]:
        try:
            db.table("proforma_invoice_items").delete().eq("proforma_id", str(pf_id)).execute()
            db.table("proforma_invoices").delete().eq("id", str(pf_id)).execute()
        except Exception:
            pass

    # 4. Clean up parties
    for party_id in tracked["parties"]:
        try:
            db.table("parties").delete().eq("id", str(party_id)).execute()
        except Exception:
            pass

    # 5. Clean up organizations and memberships
    for org_id in tracked["orgs"]:
        try:
            db.table("organization_document_sequences").delete().eq("organization_id", str(org_id)).execute()
            db.table("organization_members").delete().eq("organization_id", str(org_id)).execute()
            db.table("organizations").delete().eq("id", str(org_id)).execute()
        except Exception:
            pass
