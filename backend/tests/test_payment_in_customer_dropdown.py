import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.schemas.party import PartyCreate, PartyResponse, PartyUpdate
from app.repositories.party_repository import PartyRepository
from app.core.supabase import get_admin_supabase_client
from app.core.auth import invalidate_auth_cache

client = TestClient(app)

def cleanup_org(org_id: str):
    db = get_admin_supabase_client()
    try:
        db.table("parties").delete().eq("organization_id", org_id).execute()
        db.table("organization_members").delete().eq("organization_id", org_id).execute()
        db.table("organizations").delete().eq("id", org_id).execute()
    except Exception as e:
        print(f"Cleanup error: {e}")

@pytest.fixture
def test_tenants():
    invalidate_auth_cache()
    db = get_admin_supabase_client()
    user_id = "127df1f4-2c25-48aa-9c7b-4a4ad23a8e9f"
    tenant_a = str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())

    db.table("organizations").insert([
        {
            "id": tenant_a,
            "owner_user_id": user_id,
            "company_name": f"Isolated Org A {tenant_a[:6]}",
            "country_code": "IN",
            "state_name": "Maharashtra"
        },
        {
            "id": tenant_b,
            "owner_user_id": user_id,
            "company_name": f"Isolated Org B {tenant_b[:6]}",
            "country_code": "IN",
            "state_name": "Karnataka"
        }
    ]).execute()

    db.table("organization_members").insert([
        {"organization_id": tenant_a, "user_id": user_id, "role": "owner", "status": "active"},
        {"organization_id": tenant_b, "user_id": user_id, "role": "owner", "status": "active"}
    ]).execute()

    try:
        yield tenant_a, tenant_b, user_id
    finally:
        cleanup_org(tenant_a)
        cleanup_org(tenant_b)
        invalidate_auth_cache()

def test_party_schema_name_and_display_name_parity():
    """Verify PartyResponse always contains both 'name' and 'display_name'."""
    p_data = {
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "display_name": "Acme Maritime Ltd",
        "party_type": "customer"
    }
    resp = PartyResponse.model_validate(p_data)
    dumped = resp.model_dump()
    assert dumped["display_name"] == "Acme Maritime Ltd"
    assert dumped["name"] == "Acme Maritime Ltd"

    # Also if 'name' was supplied instead of 'display_name'
    p_data2 = {
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "name": "Beta Logistics Inc",
        "party_type": "customer"
    }
    resp2 = PartyResponse.model_validate(p_data2)
    dumped2 = resp2.model_dump()
    assert dumped2["display_name"] == "Beta Logistics Inc"
    assert dumped2["name"] == "Beta Logistics Inc"

def test_party_repository_case_and_both_handling(test_tenants):
    """
    Verify PartyRepository.get_all handles case-insensitive queries ('customer', 'Customer')
    and includes parties marked as 'both' while excluding suppliers.
    """
    tenant_a, tenant_b, user_id = test_tenants
    repo = PartyRepository()

    # Create a regular customer
    c1 = repo.create(
        tenant_a,
        PartyCreate(display_name="Customer Lowercase", party_type="customer"),
        user_id
    )
    assert c1["name"] == "Customer Lowercase"
    assert c1["display_name"] == "Customer Lowercase"

    # Create a customer with 'both' party_type
    c2 = repo.create(
        tenant_a,
        PartyCreate(display_name="Customer Both Role", party_type="both"),
        user_id
    )

    # Create a supplier
    s1 = repo.create(
        tenant_a,
        PartyCreate(display_name="Vendor Only", party_type="supplier"),
        user_id
    )

    # Query with 'customer'
    res_lower = repo.get_all(tenant_a, party_type="customer")
    names_lower = [r["name"] for r in res_lower]
    assert "Customer Lowercase" in names_lower
    assert "Customer Both Role" in names_lower
    assert "Vendor Only" not in names_lower

    # Query with 'Customer' (capitalized)
    res_cap = repo.get_all(tenant_a, party_type="Customer")
    names_cap = [r["name"] for r in res_cap]
    assert "Customer Lowercase" in names_cap
    assert "Customer Both Role" in names_cap
    assert "Vendor Only" not in names_cap

    # All returned rows must have both name and display_name
    for r in res_lower:
        assert r.get("name") is not None
        assert r.get("display_name") is not None
        assert r["name"] == r["display_name"]

def test_tenant_isolation_on_customer_query(test_tenants):
    """Verify Tenant B cannot access Tenant A customers."""
    tenant_a, tenant_b, user_id = test_tenants
    repo = PartyRepository()

    repo.create(
        tenant_a,
        PartyCreate(display_name="Tenant A Secret Customer", party_type="customer"),
        user_id
    )
    repo.create(
        tenant_b,
        PartyCreate(display_name="Tenant B Secret Customer", party_type="customer"),
        user_id
    )

    # Tenant A sees only Tenant A's customer
    a_customers = repo.get_all(tenant_a, party_type="customer")
    a_names = [c["name"] for c in a_customers]
    assert "Tenant A Secret Customer" in a_names
    assert "Tenant B Secret Customer" not in a_names

    # Tenant B sees only Tenant B's customer
    b_customers = repo.get_all(tenant_b, party_type="customer")
    b_names = [c["name"] for c in b_customers]
    assert "Tenant B Secret Customer" in b_names
    assert "Tenant A Secret Customer" not in b_names

def test_api_parties_endpoint_returns_name_and_display_name(test_tenants):
    """Test FastAPI /api/v1/parties?party_type=customer endpoint directly."""
    tenant_a, _, user_id = test_tenants
    repo = PartyRepository()
    repo.create(
        tenant_a,
        PartyCreate(display_name="API Test Client", party_type="customer"),
        user_id
    )

    headers = {"X-Organization-Id": tenant_a}
    response = client.get("/api/v1/parties?party_type=customer", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    matching = [p for p in data if p.get("display_name") == "API Test Client"]
    assert len(matching) == 1
    party = matching[0]
    assert party["name"] == "API Test Client"
    assert party["display_name"] == "API Test Client"
