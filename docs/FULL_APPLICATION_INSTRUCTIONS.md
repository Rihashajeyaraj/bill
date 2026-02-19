# Billing App - Full Application Instructions

## 1) What this application is

This is a React + Vite billing/accounting web app with:

- Role-based login (`Owner`, `Accounter`, `Staff`)
- Company onboarding and invoice template setup
- Masters: Parties, Items
- Sales: Invoice, Credit Note, Payment In
- Purchases: Purchase Bill, Debit Note, Payment Out, Expense
- Reports and company-level settings

The UI is complete in many modules, but some modules are still local/demo-first and some pages are placeholders.

## 2) Tech stack and architecture

- Frontend: React 18 + Vite + Tailwind
- Routing: `react-router-dom` (`src/routes/index.jsx`)
- Charts: Recharts
- Auth/Data backend: Supabase (optional, via env vars)
- Fallback persistence: `localStorage`

Application boot sequence:

1. `src/main.jsx` loads providers and router.
2. `src/App.jsx` seeds local defaults (`ensureSeeded()`), restores auth session, and loads organization.
3. Routes are rendered with `AuthGuard` and `SetupGuard`.

## 3) Run and setup

### Local run

```bash
npm install
npm run dev
```

### Supabase mode (recommended for multi-user + org flow)

1. Set env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Run `supabase/schema.sql` in Supabase SQL editor.
3. If you get org/RLS recursion errors, run:
   - `supabase/fix_organizations_rls.sql`
   - Optional stability patch: `supabase/fix_stack_depth_membership.sql`

If env vars are missing, app runs in local demo mode.

## 4) Storage modes (important)

### A) Supabase-backed in current code

- Auth/session/profile/org:
  - `profiles`
  - `organizations`
  - `organization_members`
  - `organization_tax_profiles`
  - `organization_invite_codes`
  - RPC: `consume_invite_code`, `get_my_membership_snapshot`, `ensure_owner_membership`
- Masters:
  - `parties`
  - `items`
- Purchases (partial backend integration):
  - `purchase_bills`
  - `purchase_bill_items`

### B) LocalStorage-backed in current code

- Sales invoices (`src/services/invoices.service.js`)
- Legacy credit notes (`src/services/creditNotes.service.js`)
- Premium credit notes (`src/modules/creditNote/store.ts`)
- Premium debit notes (`src/modules/debitNote/store.ts`)
- Premium payment-in (`src/modules/paymentIn/store.ts`)
- Premium payment-out (`src/modules/paymentOut/store.js`)
- Expenses (`src/services/expenses.service.js`)
- Reports page dataset (`src/pages/Reports.jsx`) uses static/mock report content

So DB tables for invoices/payments/credit/debit exist in schema, but current UI writes many of those via local storage stores.

## 5) Route map and page connection

Main routes are in `src/routes/index.jsx`.

Flow:

1. `/login`
2. after login/register:
   - if org not completed -> `/company-setup`
   - else -> `/dashboard`
3. app shell routes under `AppLayout`:
   - `/dashboard`
   - `/app/parties`
   - `/app/items`
   - `/app/sales/invoice`
   - `/app/sales/credit-note`
   - `/app/sales/payment-in`
   - `/app/purchase/bill`
   - `/app/purchase/debit-note`
   - `/app/purchases/payment-out`
   - `/app/purchase/expense`
   - `/app/reports`
   - `/app/company-settings`
   - `/app/backup`
   - `/app/help`

Route guards:

- `AuthGuard`: requires token
- `SetupGuard`: requires company setup completion
- `InvoiceTemplateGuard` exists but is not used in route tree currently

## 6) Page-by-page usage guide

### 6.1 Login/Register (`/login`)

File: `src/pages/Login.jsx`

Purpose:

- Login existing users
- Register owner/accounter/staff
- Enforce register code for non-owner roles

How to use:

1. Choose `Login` or `Register`.
2. For `Accounter`/`Staff`, enter register code from owner.
3. On success:
   - Owner goes to company setup
   - Others go to dashboard (or setup if org incomplete)

Connects to:

- `auth.service.js`
- `companyLoadMyOrganization()`
- Next pages: `Company Setup` or `Dashboard`

---

### 6.2 Company Setup (`/company-setup`)

File: `src/pages/CompanySetup.jsx`

Purpose:

- Create/update organization profile, address, country, tax basics

How to use:

1. Fill company details, address, country, currency.
2. Fill tax details by country:
   - India: GSTIN + GST state
   - VAT countries: VAT number + VAT rate
   - USA/others: Tax ID
3. Click `Save & Continue`.

Connects to:

- `companySaveProfileRemote()`
- Tables: `organizations`, `organization_tax_profiles`, `organization_members`
- Next page: `Dashboard`

---

### 6.3 Invoice Template Setup (`/invoice-template-setup`)

File: `src/pages/InvoiceTemplateSetup.jsx`

Purpose:

- Select invoice template, brand colors, logo, font

How to use:

1. Choose country-specific template style.
2. Set logo, color palette, font, logo position.
3. Use live preview editor.
4. Click `Save & Proceed`.

Connects to:

- `templateStore` (`invoiceTemplateConfig`, completion flag)
- Saves template inside company settings JSON
- Next page: `Dashboard`

---

### 6.4 Dashboard (`/dashboard`)

Files:

- `src/pages/Dashboard.jsx`
- `src/pages/OwnerDashboard.jsx`
- `src/pages/AccounterDashboard.jsx`
- `src/pages/StaffDashboard.jsx`

Purpose:

- Role-specific summary dashboards

Data sources:

- Mostly local invoice/purchase/payment stores

Role behavior:

- Owner: full KPI/charts dashboard
- Accounter: invoice and payment operation focus
- Staff: operational counts and workflow reminders

---

### 6.5 Parties (`/app/parties`)

File: `src/pages/Parties.tsx` (wrapper: `src/pages/Parties.jsx`)

Purpose:

- Manage customers/suppliers
- Track outstanding and credit risk

How to use:

1. Switch tab `Customers` or `Suppliers`.
2. Click `Add Party` or `Edit`.
3. Save party in modal.
4. Use `Statement` action to open ledger view.

Connects to:

- `src/modules/parties/store.ts`
- Supabase table `parties` (with local sync cache)
- Next page: `Party Statement`

---

### 6.6 Party Statement (`/app/parties/:id/statement`)

File: `src/pages/PartyStatement.tsx` (wrapper: `src/pages/PartyStatement.jsx`)

Purpose:

- Party ledger with filters by date and document type

How to use:

1. Open from Parties table.
2. Apply `From`, `To`, `Document Type`.
3. Review opening/closing balance and line-wise ledger.

Data composition:

- Builds ledger from invoices, payments, credit/debit notes (local stores + premium stores)

---

### 6.7 Items (`/app/items`)

File: `src/pages/Items.jsx`

Purpose:

- Manage products/services, rates, tax, stock flags

How to use:

1. Switch tab `Products`/`Services`.
2. `Add Item` or `Edit`.
3. Use filters (status/search).
4. Delete only when item is unused.

Connects to:

- `src/modules/items/store.js`
- Supabase table `items` (with local sync cache)
- Used by invoice/purchase flows

---

### 6.8 Item Create (legacy route) (`/items/new`)

File: `src/pages/ItemCreate.jsx`

Purpose:

- Older item form page

Notes:

- Saves via legacy `itemsUpsert` service (local storage)
- Contains extra form patterns (pricing/stock tabs) not used by main modal flow

---

### 6.9 Sales Invoice (`/app/sales/invoice`)

File: `src/pages/sales/InvoiceCreate.jsx`

Purpose:

- Create sales invoice with tax and preview

How to use:

1. Select customer.
2. Add/edit line items and tax.
3. Review credit limit warnings.
4. Save invoice (local storage).
5. Optional print/send placeholders.

Connects to:

- Reads parties/items
- Writes local invoices via `invoicesCreate()`
- Used by payment-in and credit-note logic later

---

### 6.10 Credit Note Premium (`/app/sales/credit-note`)

File: `src/pages/sales/CreditNotePremium.tsx`

Purpose:

- Country-aware credit note workflow with status transitions and exports

How to use:

1. Select country context (if required).
2. Create note from linked invoice.
3. Add/adjust lines.
4. Save as `Draft`, `Issued`, `Applied` (role/status rules apply).
5. Export PDF/Excel summary.

Connects to:

- `src/modules/creditNote/store.ts` (local premium store)
- Updates invoice balance in local invoice store when applied

---

### 6.11 Payment In Premium (`/app/sales/payment-in`)

File: `src/pages/sales/PaymentInPremium.tsx`

Purpose:

- Receive customer payments and allocate against open invoices

How to use:

1. Start `New Payment`.
2. Step 1: select customer.
3. Step 2: enter amount/mode/reference and allocations.
4. Step 3: review and confirm.
5. Save Draft / Confirm / Send Receipt.

Connects to:

- `src/modules/paymentIn/store.ts` (local premium store)
- Adjusts local invoice balances when status becomes `Applied`

---

### 6.12 Purchase Bill (`/app/purchase/bill`)

File: `src/pages/purchases/PurchaseBill.jsx`

Purpose:

- Create purchase bill from supplier with line items

How to use:

1. Select supplier.
2. Enter bill details and lines.
3. Set payment mode and round-off.
4. Save bill.
5. Review in saved bills table below.

Connects to:

- Syncs suppliers/items from modules store
- Writes:
  - Local purchases list
  - Supabase `purchase_bills` + `purchase_bill_items` when configured

---

### 6.13 Debit Note Premium (`/app/purchase/debit-note`)

File: `src/pages/purchases/DebitNotePremium.tsx`

Purpose:

- Supplier-side debit adjustments with country rules

How to use:

1. Select country.
2. Create from linked purchase invoice.
3. Edit lines and debit type.
4. Save by status and export.

Connects to:

- `src/modules/debitNote/store.ts` (local premium store)
- Updates purchase outstanding in local purchases store when applied

---

### 6.14 Payment Out Premium (`/app/purchases/payment-out`)

File: `src/pages/purchases/PaymentOutPremium.jsx`

Purpose:

- Pay suppliers and allocate to open purchase bills

How to use:

1. Open `New Payment`.
2. Step 1: supplier/context.
3. Step 2: amount, mode, allocations.
4. Step 3: review and save as Draft/Paid/Applied.
5. Export PDF or send email placeholder.

Connects to:

- `src/modules/paymentOut/store.js` (local premium store)
- Adjusts local purchase bill balances when applied

---

### 6.15 Expense (`/app/purchase/expense`)

File: `src/pages/purchases/Expense.jsx`

Purpose:

- Simple expense entry page

How to use:

1. Enter date/category/amount/note.
2. Save expense.

Storage:

- Local only (`expensesCreate`)

---

### 6.16 Reports (`/app/reports`)

File: `src/pages/Reports.jsx`

Purpose:

- KPI cards, charts, detail table with filters and sorting

Important note:

- Report content is currently static/mock dataset (`REPORT_CONTENT`) with UI filters.
- Not a full live aggregation from all transactional tables yet.

---

### 6.17 Company Settings (`/app/company-settings`)

File: `src/pages/CompanySettings.jsx`

Purpose:

- Admin configuration across 7 sections:
  - Company Profile
  - Localization
  - Tax Settings
  - Numbering & Documents
  - Theme & Appearance
  - Users & Roles
  - Data & Preferences

Key actions:

- Save section settings to profile + remote
- Generate register code (owner)
- List/copy active register codes
- Invite/manage team members (UI-level)
- Danger zone actions (demo placeholders for some operations)

Connects to:

- `companySaveProfileRemote()`
- `organizationGenerateCode()`
- `organizationListActiveCodes()`

---

### 6.18 Backup / Cash & Bank / Help / Not Found

Files:

- `src/pages/BackupUtilities.jsx`
- `src/pages/CashBank.jsx`
- `src/pages/HelpSupport.jsx`
- `src/pages/NotFound.jsx`

Status:

- Backup, Cash/Bank, Help are currently placeholder pages.
- NotFound redirects users back to dashboard.

## 7) Database tables explained

Defined in `supabase/schema.sql`.

### Identity and organization

- `profiles`: user profile synced from auth user
- `organizations`: company/org master
- `organization_members`: user membership + role
- `organization_invite_codes`: register/join codes for staff/accounter
- `organization_tax_profiles`: tax configuration per org
- `organization_document_sequences`: document numbering state

### Masters

- `parties`: customers/suppliers
- `items`: products/services with tax and stock fields

### Sales

- `invoices`: sales headers
- `invoice_items`: invoice lines
- `credit_notes`: credit note headers
- `credit_note_items`: credit note lines

### Purchases

- `purchase_bills`: purchase headers
- `purchase_bill_items`: purchase lines
- `debit_notes`: debit note headers
- `debit_note_items`: debit note lines

### Finance and audit

- `payments`: payment in/out entries
- `expenses`: expense entries
- `activity_logs`: audit/activity stream

### Enums and core business types

- `organization_role`, `member_status`, `tax_regime`, `party_type`, `item_type`
- `document_status`, `note_status`, `payment_direction`, `entry_status`

## 8) Table usage matrix (current implementation)

- Actively used from frontend with Supabase writes/reads:
  - `profiles`, `organizations`, `organization_members`, `organization_invite_codes`, `organization_tax_profiles`, `parties`, `items`, `purchase_bills`, `purchase_bill_items`
- Present in schema but mostly not yet wired to Supabase writes in current UI:
  - `invoices`, `invoice_items`, `credit_notes`, `credit_note_items`, `debit_notes`, `debit_note_items`, `payments`, `expenses`, `activity_logs`, `organization_document_sequences`

## 9) End-to-end page workflow

### Owner onboarding

1. Register as Owner in `/login`
2. Complete `/company-setup`
3. Optional: configure `/invoice-template-setup`
4. Open `/app/company-settings` and generate register codes for team

### Master setup

1. Create customers/suppliers in `/app/parties`
2. Create products/services in `/app/items`

### Sales cycle

1. Create invoice in `/app/sales/invoice`
2. Record customer receipts in `/app/sales/payment-in`
3. If returns/adjustments, create `/app/sales/credit-note`
4. Monitor summaries in `/dashboard` and `/app/reports`

### Purchase cycle

1. Create bill in `/app/purchase/bill`
2. Record supplier payments in `/app/purchases/payment-out`
3. Apply debit adjustments in `/app/purchase/debit-note`
4. Add direct expenses in `/app/purchase/expense`

## 10) Current limitations and notes

- Several modules are still localStorage-first even in Supabase mode.
- Reports page currently uses hardcoded dataset + UI filtering.
- Backup, Cash/Bank, Help are placeholders.
- `InvoiceTemplateGuard` exists but is not currently enforced in route chain.
- Some legacy pages still exist but routed premium versions are used for credit/debit/payment flows.

## 11) Useful file map for maintenance

- Routing: `src/routes/index.jsx`
- Guards: `src/routes/guards.jsx`
- Auth: `src/services/auth.service.js`
- Company/org: `src/services/company.service.js`
- Supabase client: `src/services/supabaseClient.js`
- Schema: `supabase/schema.sql`
- Parties store: `src/modules/parties/store.ts`
- Items store: `src/modules/items/store.js`
- Payment In store: `src/modules/paymentIn/store.ts`
- Payment Out store: `src/modules/paymentOut/store.js`
- Credit Note store: `src/modules/creditNote/store.ts`
- Debit Note store: `src/modules/debitNote/store.ts`
- Purchases service: `src/services/purchases.service.js`

---

If you want, next step can be creating a second document with only **end-user manual steps** (non-technical) for your staff and accountant team.
