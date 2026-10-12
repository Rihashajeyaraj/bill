import os
import sys
sys.path.insert(0, os.path.abspath("backend"))
from app.core.supabase import get_admin_supabase_client

db = get_admin_supabase_client()
org_id = "00000000-0000-0000-0000-000000000001"

try:
    res = db.rpc("allocate_tax_invoice_no", {"p_organization_id": org_id}).execute()
    print("Success:", res.data)
except Exception as e:
    print("Error calling allocate_tax_invoice_no:", e)
