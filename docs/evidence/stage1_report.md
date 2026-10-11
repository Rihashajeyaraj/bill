# Stage 1: Backend Implementation & Verification Report

## 1. Database & Conversion Path Verification

### Questions Addressed:
1. **Which conversion function does the running app actually use?**
   - The PostgreSQL schema cache exposes `public.convert_proforma_to_invoice(p_proforma_id, p_org_id, p_user_id)`.
   - The stored procedure `convert_sales_proforma_to_invoice` does **not** exist in the live database (`PGRST202` error).
   - In `backend/app/services/proforma_service.py`, there was previously a broken attempt to call `convert_sales_proforma_to_invoice`, which failed and triggered a 230-line Python fallback.
2. **Is the stored procedure deployed in the DB (`pg_proc`)?**
   - Yes, `public.convert_proforma_to_invoice` is deployed and active in the database schema.
3. **Does `public.payment_allocations` exist in the DB?**
   - No. Querying `public.payment_allocations` returns `PGRST205: Could not find the table 'public.payment_allocations' in the schema cache`.
   - Payment allocations are persisted within the `payments.allocations` JSONB array column on `public.payments`.

### Command Output (`docs/evidence/stage1_check.txt`):
```text
--- 1. Testing RPC endpoints via OpenAPI & Direct RPC ---
Deployed RPC Paths in PostgREST:
  /rpc/convert_proforma_to_invoice
  /rpc/is_org_admin
  /rpc/is_org_member
  /rpc/is_super_admin
  /rpc/peek_sales_proforma_no
  /rpc/set_default_invoice_template

--- 2. Checking if public.payment_allocations exists in schema ---
Is 'payment_allocations' in tables? False

--- 3. Testing direct RPC call for convert_proforma_to_invoice ---
convert_proforma_to_invoice error: {'message': 'Pro Forma invoice not found or unauthorized.', 'code': 'P0001', 'hint': None, 'details': None}

--- 4. Testing direct RPC call for convert_sales_proforma_to_invoice ---
convert_sales_proforma_to_invoice error: {'message': 'Could not find the function public.convert_sales_proforma_to_invoice(p_proforma_id) in the schema cache', 'code': 'PGRST202', 'hint': 'Perhaps you meant to call the function public.convert_proforma_to_invoice', 'details': 'Searched for the function public.convert_sales_proforma_to_invoice with parameter p_proforma_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.'}

--- 5. Checking direct query on payment_allocations table ---
payment_allocations query error: {'message': "Could not find the table 'public.payment_allocations' in the schema cache", 'code': 'PGRST205', 'hint': "Perhaps you meant the table 'public.payments'", 'details': None}
```

---

## 2. Conversion Path Unification & Advance Payment Carry-Forward

In `backend/app/services/proforma_service.py`:
- Removed the broken `convert_sales_proforma_to_invoice` invocation and removed the 230-line Python fallback.
- Standardized on ONE conversion path: stored procedure `public.convert_proforma_to_invoice(p_proforma_id, p_org_id, p_user_id)`.
- Verified and ensured preservation of `party_id`, customer details, and `due_date` on the converted invoice.
- Automatically links any proforma advance payments tagged in `notes` with `[proforma:{proforma_id}]` to the newly converted tax invoice (`invoice_id = new_inv_id`) and recalculates `amount_paid`, `balance_due`, and `status`.

---

## 3. Payment Endpoints & Schema Fixes

1. **`GET /api/v1/payments/receivables`**:
   - Added `paid` and `paid_amount` with `AliasChoices` in `ReceivableInvoiceItem`.
   - Returns accurate `grand_total` (total invoice value), `paid` / `paid_amount`, `advance_applied`, `balance_due`, `due_date`, `days_overdue`, and `days_to_due`.
   - Resolves frontend column mapping bug where Total previously displayed `balance_due`.

2. **`GET /api/v1/payments/receivables/summary`**:
   - Fixed 500 error caused by attempting to query non-existent column `status` on `payments`.
   - Correctly queries `amount, payment_date, party_id, notes` and computes unallocated balances accurately.

3. **`POST /api/v1/payments`**:
   - Accepts both `document_id` and `invoice_id` in allocation payloads.
   - Handles advance payments (unallocated amounts) seamlessly without foreign key constraint violations against `invoices.id`.

4. **`POST /api/v1/payments/{payment_id}/reverse`**:
   - Fixed status handling when balance is restored: PostgreSQL `document_status` enum accepts `'issued'`, not `'unpaid'`.

---

## 4. Backfill Script Dry-Run

The script `scripts/backfill_converted_invoices.py` was executed in DRY RUN mode (`--dry-run`). It identified 176 converted invoices requiring `due_date` alignment.

### Command Output (`docs/evidence/dry_run_backfill.txt` - Head):
```text
============================================================
BACKFILL CONVERTED INVOICES - DRY RUN
============================================================
Found 176 converted invoices requiring backfill:
------------------------------------------------------------
1. Invoice INV-0001 [62865b46-aa93-4632-921a-be3fd94fdbf9] (from Pro Forma PI-0001):
   - due_date: None -> 2026-10-11
2. Invoice INV-0005 [d5e46575-8a3a-4329-82f2-5cda0584397b] (from Pro Forma PI-0008):
   - due_date: None -> 2026-11-09
3. Invoice INV-0006 [ecb52614-8608-4c07-b3ee-08fa65f23975] (from Pro Forma PI-0009):
   - due_date: None -> 2026-11-09
...
Total backfill candidates identified: 176
No database updates performed in dry-run mode.
```

---

## 5. Test Suite Verification (100% Pass)

An isolated pytest suite `backend/tests/test_payment_flow.py` was implemented with full fixture teardown cleanup (generating isolated tenant IDs and deleting all created rows during teardown).

### Command Output (`docs/evidence/pytest_payment_in.txt`):
```text
============================= test session starts =============================
platform win32 -- Python 3.12.9, pytest-9.1.1, pluggy-1.6.0 -- C:\Users\RIHASHA\OneDrive\Desktop\bill-riha\backend\venv\Scripts\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\RIHASHA\OneDrive\Desktop\bill-riha
plugins: anyio-4.15.1
collecting ... collected 11 items

backend/tests/test_payment_flow.py::test_advance_payment_without_allocations PASSED [  9%]
backend/tests/test_payment_flow.py::test_payment_with_allocations_across_two_documents PASSED [ 18%]
backend/tests/test_payment_flow.py::test_overpayment_rejected PASSED     [ 27%]
backend/tests/test_payment_flow.py::test_partial_payment PASSED          [ 36%]
backend/tests/test_payment_flow.py::test_advance_on_proforma_and_conversion_balance PASSED [ 45%]
backend/tests/test_payment_flow.py::test_converted_invoice_keeps_party_and_due_date PASSED [ 54%]
backend/tests/test_payment_flow.py::test_apply_unapplied_advance_to_invoice PASSED [ 63%]
backend/tests/test_payment_flow.py::test_delete_or_edit_payment_restores_balance PASSED [ 72%]
backend/tests/test_payment_flow.py::test_tenant_b_cannot_pay_tenant_a_invoice PASSED [ 81%]
backend/tests/test_payment_flow.py::test_receivables_total_column_and_badges PASSED [ 90%]
backend/tests/test_payment_flow.py::test_reconciliation_balance PASSED   [100%]

============================== warnings summary ===============================
backend/tests/test_payment_flow.py: 97 warnings
  C:\Users\RIHASHA\OneDrive\Desktop\bill-riha\backend\venv\Lib\site-packages\supabase\_sync\client.py:309: DeprecationWarning: The 'timeout' parameter is deprecated. Please configure it in the http client instead.
    return SyncPostgrestClient(

backend/tests/test_payment_flow.py: 97 warnings
  C:\Users\RIHASHA\OneDrive\Desktop\bill-riha\backend\venv\Lib\site-packages\supabase\_sync\client.py:309: DeprecationWarning: The 'verify' parameter is deprecated. Please configure it in the http client instead.
    return SyncPostgrestClient(

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
================ 11 passed, 194 warnings in 233.69s (0:03:53) =================
```
