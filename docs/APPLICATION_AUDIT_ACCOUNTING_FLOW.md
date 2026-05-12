# Billing App Audit And Accounting Flow

Last reviewed: 2026-05-11

## 1. Executive summary

This application is a multi-company billing suite with role-based access, hybrid local-storage plus Supabase persistence, and full operational coverage for:

- company onboarding
- party and item masters
- sales invoicing
- purchase billing
- payment in and payment out
- credit note and debit note adjustments
- expense tracking
- reports, notifications, backup, and audit history

The overall accounting structure is sound:

- receivable flow: `Sales Invoice -> Payment In / Credit Note -> Reports / Statements`
- payable flow: `Purchase Bill -> Payment Out / Debit Note -> Reports / Statements`
- inventory flow: `Purchase -> stock in`, `Sales -> stock out`, `Credit Note returns -> stock/return handling`

The app is already functionally strong, but a few areas are still partial or need cleanup:

- `Cash & Bank` is not a real module yet; it redirects to dashboard
- `Help` is not a real module yet; it redirects to dashboard
- there is a hybrid persistence model that can create consistency risk if remote sync fails
- payment lifecycle is slightly complex for users because `Confirmed` and `Applied` are separate states
- the codebase contains both legacy and premium versions of some modules
- the frontend bundle is large and should be optimized

## 2. Architecture snapshot

Primary route file:

- `src/routes/index.jsx`

Core persistence layers:

- local storage scoped by organization: `src/services/storage.js`
- Supabase sync services: `src/services/*.service.js`
- premium stores for advanced modules:
  - `src/modules/paymentIn/store.ts`
  - `src/modules/paymentOut/store.js`
  - `src/modules/creditNote/store.ts`
  - `src/modules/debitNote/store.ts`
  - `src/modules/parties/store.ts`
  - `src/modules/items/store.js`

Role model:

- Owner: full access, settings, reports, backup, audit
- Accounter: create/edit business data, reports access, approval access, no delete by default
- Staff: create access only, limited edit/delete/report access

Reference:

- `src/services/roles.js`
- `src/services/accessControl.js`
- `src/routes/guards.jsx`

## 3. Page-by-page audit

### Authentication and setup

`/login`, `/forgot-password`, `/reset-password`

- Purpose: authentication and password recovery
- Status: implemented

`/organization-select`

- Purpose: multi-company selection
- Features:
  - owner can create company
  - owner can delete company
  - user can switch active organization
- Status: implemented

`/company-setup`

- Purpose: initial company onboarding
- Features:
  - company profile
  - contact details
  - country and currency
  - tax settings
  - financial year anchor date
  - basic invoice dependency awareness when changing country
- Status: implemented

`/invoice-template-setup`

- Purpose: first-time invoice template selection
- Status: implemented

### Dashboard

`/dashboard`, `/app/dashboard`

- Role-based dashboard switching
  - owner dashboard
  - accounter dashboard
  - staff dashboard
- Features:
  - KPI cards
  - transaction summaries
  - shortcuts into operational pages
  - financial year-aware data loading
- Status: implemented

### Masters

`/app/parties`

- Purpose: customer and supplier master management
- Features:
  - add/edit/archive parties
  - financial summary per party
  - outstanding and credit-risk awareness
  - customer advance visibility
  - statement navigation
- Status: implemented and useful

`/app/items`

- Purpose: item master and stock-oriented item operations
- Features:
  - add/edit/delete items
  - status filters
  - low-stock summary
  - trade summary and history
  - stock history
  - return action linkage
- Status: implemented and relatively rich

`/items/new`

- Purpose: direct item entry route
- Status: available as alternate entry path

### Sales

`/app/sales/invoice`

- Purpose: sales invoice creation and edit
- Features:
  - customer lookup
  - item lookup and barcode support
  - tax calculation
  - due date handling
  - document numbering
  - preview and print
  - direct payment staging
  - credit note awareness
  - financial year tagging
- Status: core module implemented

`/app/sales/invoice/history`

- Purpose: invoice history and action center
- Features:
  - search
  - date/status/customer filters
  - payment action
  - credit note action
  - balance-based status display
- Status: implemented
- Note: status display logic was hardened in this review so paid/partial invoices reflect balance correctly

`/app/sales/payment-in`

- Purpose: customer receipt management
- Features:
  - draft, confirmed, applied lifecycle
  - invoice/proforma allocation
  - TDS support
  - advance wallet support
  - PDF and CSV exports
  - remote sync to `payments`
- Status: implemented, but UX can be confusing because `Confirmed` and `Applied` are separate user actions

`/app/sales/credit-note`

- Purpose: reduce receivable or handle sales return/adjustment
- Features:
  - multi-country mode
  - invoice linking
  - quantity and amount control
  - applied/issued/draft lifecycle
  - allocation-aware purchase-rate derivation for returns
  - PDF and CSV exports
- Status: implemented and advanced

`/app/sales/proformas/new`, `/app/sales/proformas/history`, `/app/sales/proformas/:id`

- Purpose: sales quotation/proforma flow
- Features:
  - create/edit/history
  - conversion to invoice
  - payment relinking support during conversion
- Status: implemented

### Purchases

`/app/purchase/bill`

- Purpose: purchase bill entry
- Features:
  - supplier lookup
  - item lines
  - free invoice scan import
  - tax calculation
  - payment-out integration
  - debit note linkage
  - stock increase support
- Status: core module implemented

`/app/purchase/history`

- Purpose: purchase bill history
- Status: implemented

`/app/purchases/payment-out`

- Purpose: supplier payment management
- Features:
  - applied vs paid lifecycle
  - bill allocations
  - TDS support
  - remote sync
- Status: implemented

`/app/purchase/debit-note`

- Purpose: purchase-side adjustment or supplier debit handling
- Features:
  - linked purchase bill workflow
  - return reference linkage
  - applied/issued/draft lifecycle
  - PDF and CSV exports
- Status: implemented

`/app/purchase/proformas/new`, `/app/purchase/proformas/history`, `/app/purchase/proformas/:id`

- Purpose: purchase proforma workflow
- Status: implemented

`/app/purchase/expense`

- Purpose: non-bill operating expense entry and history
- Features:
  - category suggestions
  - payment mode
  - search and filters
  - FY-aware history
- Status: implemented

### Reports and analysis

`/app/reports`

- Purpose: central reporting workspace
- Report groups:
  - Sales
  - Purchases
  - Cash Flow
  - All Entries
  - Statement
  - Aging
  - All Parties
  - Profit & Loss
  - GST Report
  - TDS Report
- Features:
  - financial year filters
  - date filters
  - party filters
  - exports: print, PDF, Excel, JSON
- Status: implemented
- Note: initial financial-year filter mismatch for sale report was fixed in this review

`/app/reports/customer-statement`, `/app/reports/party-wise-statement`, `/app/reports/aging-report`

- Purpose: dedicated statement/aging entry points
- Status: implemented as supporting report routes

### Operations and governance

`/app/notifications`

- Purpose: operational alert center
- Features:
  - reminders
  - credit alerts
  - low stock alerts
  - customer/supplier filters
  - direct action navigation
- Status: implemented

`/app/company-settings`

- Purpose: owner-only organization control center
- Features:
  - company profile
  - localization
  - tax settings
  - numbering and document prefixes
  - theme and appearance
  - invoice template configuration
  - users and roles
  - register code generation/invite flow
- Status: implemented and broad

`/app/backup`

- Purpose: backup export/restore and owner backup history
- Features:
  - local JSON export
  - local JSON restore
  - owner backup snapshots
  - dataset counts and warnings
- Status: implemented
- Constraint: restore is device-local replacement, not selective merge

`/app/audit-history`

- Purpose: owner-only change tracking
- Features:
  - filters by table/action/user/date
  - before/after snapshot inspection
- Status: implemented, but best value only when Supabase auditing is available

### Placeholder or redirected pages

`/app/cash-bank`

- Current behavior: redirects to dashboard
- Status: placeholder, not an actual treasury ledger module yet

`/app/help`

- Current behavior: redirects to dashboard
- Status: placeholder, not an actual support/help page yet

## 4. Accounting flow review

### Sales accounting flow

1. Create customer in Parties
2. Create or select item in Items
3. Create Sales Invoice
4. Invoice increases receivable
5. Optional Credit Note reduces receivable
6. Payment In:
   - `Confirmed` means receipt saved
   - `Applied` means receipt allocated to invoice/proforma
7. Reports and statements derive outstanding, paid, unpaid, partial

Observations:

- structure is correct
- payment application is balance-aware
- credit note integration exists
- invoice status depends on balance plus linked settlements

Main caution:

- users may think `Confirmed` means settled, but only `Applied` actually closes invoice balance

### Purchase accounting flow

1. Create supplier in Parties
2. Create Purchase Bill
3. Bill increases payable and stock
4. Optional Debit Note adjusts payable
5. Payment Out reduces bill balance
6. Reports and statements derive pending/paid position

Observations:

- structure is correct
- bill-linked payments are supported
- debit note flow exists
- expense flow is kept separate from purchase bill flow, which is good

### Inventory and return flow

1. Purchase creates stock context
2. Sales consumes stock
3. Credit Note can reference invoice allocations and return conditions
4. Non-reusable returns can be tracked for supplier-side or stock-side follow-up

Observations:

- inventory logic is more advanced than a simple billing app
- there is clear intent to preserve batch/allocation detail

## 5. What looks good right now

- page coverage is broad for a billing app
- accounting direction is correct for receivables and payables
- financial year support is present across major modules
- role access control is present
- multi-country tax handling is built in
- backup and audit features are included, which is a strong operational advantage
- reports module is rich and export-ready
- item, payment, and note modules have relatively mature workflows

## 6. Gaps, risks, and improvement areas

### High priority

- Simplify Payment In UX:
  - make it visually obvious that `Confirmed` is not yet settled
  - consider one-click `Save and Apply`

- Simplify Payment Out UX similarly:
  - clarify `Paid` vs `Applied`

- Reduce hybrid consistency risk:
  - many modules save locally first and sync remotely later
  - if sync fails, local and remote may diverge
  - add stronger reconciliation indicators and retry tools

- Add a real `Cash & Bank` ledger module:
  - current route is placeholder only

- Add a real `Help / Support` module:
  - current route is placeholder only

### Medium priority

- Consolidate legacy vs premium modules:
  - there are parallel old and premium flows in the repo
  - this increases maintenance complexity and developer confusion

- Standardize all page implementations to either TS or JS:
  - the current mixed style is workable but harder to maintain

- Add a reconciliation dashboard:
  - unapplied receipts
  - unapplied supplier payments
  - invoice vs payment mismatches
  - sync-failed records

- Strengthen report regression coverage:
  - sales report
  - payment allocation
  - financial year filters
  - credit/debit note effects

### Lower priority but important

- Optimize build size:
  - Vite build currently reports a very large main bundle
  - reporting/export libraries should be split more aggressively

- Create selective restore tools:
  - restore only parties
  - restore only items
  - restore only transactions in a date range

- Expand owner settings into explicit approval policies:
  - payment approval thresholds
  - credit note approval thresholds
  - delete restrictions by document state

## 7. Items that are already fixed during this review

- `sale-report` now initializes with the selected financial year range instead of defaulting to current month
- invoice history status resolution was hardened so paid and partial statuses reflect live balance more reliably
- shared `DateInput` styling and icon/text layout were standardized so date fields render with normal input sizing across the app
- `Company Setup`, `Company Settings`, and purchase proforma date fields were aligned to use the corrected shared date-input behavior
- purchase supplier creation now falls back to the typed supplier search text, preventing false `Supplier name is required` errors after entering a name
- sales invoice customer search no longer triggers the browser `Please fill Customer Search` validation popup after a customer is already selected
- purchase bill `Not Paid` flow no longer auto-applies supplier advance wallet by default
- payment-out bill selection now shows advance-covered bills instead of hiding them, with clear `Covered by Advance` labeling for non-payable entries

## 8. Suggested next actions

Recommended order:

1. implement a clear payment settlement UX cleanup
2. build a real cash/bank ledger page
3. add regression tests for invoice/payment/report flows
4. consolidate duplicate legacy and premium modules
5. optimize bundle size and lazy-load heavy export/import features

## 9. Files most useful for future review

- Routes: `src/routes/index.jsx`
- Guards: `src/routes/guards.jsx`
- Role rules: `src/services/roles.js`
- Access rules: `src/services/accessControl.js`
- Invoices: `src/services/invoices.service.js`
- Purchases: `src/services/purchases.service.js`
- Payments remote sync: `src/services/payments.service.js`
- Payment In store: `src/modules/paymentIn/store.ts`
- Payment Out store: `src/modules/paymentOut/store.js`
- Reports: `src/pages/Reports.jsx`, `src/services/reports.service.js`
- Backup: `src/pages/BackupUtilities.jsx`, `src/services/backup.service.js`
- Audit: `src/pages/AuditHistory.jsx`, `src/services/audit.service.js`
