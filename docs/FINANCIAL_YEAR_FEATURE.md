# Financial Year Feature

## Database Schema

### `financial_years`

```sql
create table public.financial_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  year_code text not null,
  label text not null,
  is_current boolean not null default false,
  auto_created boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Rules:

- `end_date = start_date + 1 year - 1 day`
- No overlapping financial years in the same company
- Transactions store `financial_year_id`

### Transaction Tables

Added `financial_year_id` to:

- `invoices`
- `purchase_bills`
- `payments`
- `expenses`
- `credit_notes`
- `debit_notes`

The migration is in [add_financial_years.sql](/C:/Users/Public/Twite%20projects/Billing_app/supabase/add_financial_years.sql).

## API Endpoints

The current app writes directly to Supabase. If you expose an Express API, use this shape:

### Financial years

- `POST /api/companies/:companyId/financial-years`
- `GET /api/companies/:companyId/financial-years`
- `GET /api/companies/:companyId/financial-years/current?date=2025-04-01`
- `PATCH /api/companies/:companyId/financial-years/:financialYearId`

Example request:

```json
{
  "start_date": "2025-04-01",
  "end_date": "2026-03-31"
}
```

### Transactions

- `POST /api/invoices`
- `POST /api/purchase-bills`
- `POST /api/payments`
- `POST /api/expenses`

Backend rule:

- Accept the transaction date
- Resolve the matching financial year
- Save `financial_year_id` on the transaction

### Reports

- `GET /api/reports/profit-loss?companyId=:id&financialYearId=:financialYearId`
- `GET /api/reports/sales?companyId=:id&financialYearId=:financialYearId`
- `GET /api/reports/expenses?companyId=:id&financialYearId=:financialYearId`

## Backend Logic

Recommended flow:

1. Validate start and end dates form an exact 12-month range.
2. Reject overlaps for the same company.
3. On transaction create, find the financial year by transaction date.
4. Save `financial_year_id`.
5. Filter reports by the selected financial year date range.

The app-side helper is in [financialYears.service.js](/C:/Users/Public/Twite%20projects/Billing_app/src/services/financialYears.service.js).

## Frontend Form Structure

### Company Setup

- Company name
- Country
- Currency
- Financial year start date
- Financial year end date

### Dashboard

- Current financial year label
- Financial year dropdown switcher

### Reports

- Financial year dropdown
- Date filters auto-reset to the selected financial year
