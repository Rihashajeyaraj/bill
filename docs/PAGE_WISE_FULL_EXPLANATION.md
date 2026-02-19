# Page-Wise Full Explanation (Why Each Page Is Used)

This document explains every main page in this billing application:
- what the page is for,
- why it is important,
- when to use it,
- what input/output it handles,
- and how it connects to other pages.

## 1) Login (`/login`)

Why we use it:
- To securely enter the system with correct user role (Owner, Accountant, Staff).

When to use:
- Every time user starts a new session.

What it controls:
- Access permission and role-based dashboard/menu behavior.

Connects to:
- Company Setup or Dashboard based on profile/setup state.

## 2) Company Setup (`/company-setup`, `/app/company-setup`)

Why we use it:
- To define company identity and legal/tax profile before billing starts.

When to use:
- First-time setup.
- Any time company details change (address, tax, contact, country).

Main input:
- Company name, address, tax IDs, currency, contact details.

Main output:
- Company profile used by invoice, purchase, reports, print templates.

Connects to:
- Invoice Template Setup
- Invoices, Purchases, Reports, Settings

## 3) Invoice Template Setup (`/invoice-template-setup`)

Why we use it:
- To control how invoice documents look (branding/print/PDF consistency).

When to use:
- First-time branding.
- Any time design/logo/color/template changes.

Main output:
- Reusable invoice print/PDF style for sales documents.

Connects to:
- Sales Invoice page (preview + print)
- Document output consistency across team

## 4) Dashboard (`/dashboard`, `/app/dashboard`)

Why we use it:
- To see current business health quickly.

When to use:
- Start of day, mid-day checks, end-of-day review.

Role behavior:
- Owner Dashboard: overall business KPIs.
- Accountant Dashboard: invoicing/payment view.
- Staff Dashboard: operational quick stats.

Connects to:
- All transaction pages through shortcuts and action flow.

## 5) Parties (`/app/parties`)

Why we use it:
- To maintain master records of Customers and Suppliers.

When to use:
- Before creating any invoice/purchase/payment.
- When new customer/supplier is added or details change.

Main output:
- Clean customer/supplier base for all transactions.

Connects to:
- Sales Invoice
- Purchase Bill
- Payment In/Out
- Party Statement
- Reports

## 6) Party Statement (`/app/parties/:id/statement`)

Why we use it:
- To see one party’s full ledger (invoice/payment/credit/debit history).

When to use:
- Follow-up for pending dues.
- Reconciliation with customer/supplier account.

Main output:
- Running balance and transaction trail per party.

Connects to:
- Parties
- Invoices, Payments, Credit/Debit Notes

## 7) Items (`/app/items`)

Why we use it:
- To manage products/services used in billing.

When to use:
- Before sales/purchase entry.
- When price, tax, stock, SKU, or item status changes.

Main output:
- Standardized item rates/tax usage across documents.

Connects to:
- Sales Invoice line items
- Purchase Bill line items
- Item-based reports

## 8) Item Create (legacy quick entry) (`/items/new`)

Why we use it:
- Alternate item creation/edit interface.

When to use:
- When quick single-item setup is needed from direct route.

Connects to:
- Items master
- Sales/Purchase line selection

## 9) Sales Invoice (`/app/sales/invoice`)

Why we use it:
- To create official customer billing documents for sales.

When to use:
- Every sale transaction.

Main input:
- Customer, date, items, quantity, rate, tax, place of supply.

Main output:
- Invoice record + outstanding balance + printable/preview document.

Connects to:
- Payment In (collections against invoice)
- Credit Note (adjustments/returns)
- Reports (sales/receivables)
- Party Statement

## 10) Credit Note (`/app/sales/credit-note`)

Why we use it:
- To reduce customer receivable for returns/discount/price correction.

When to use:
- Sales return
- Post-invoice discount
- Error correction in original invoice

Main output:
- Credit adjustment linked to original invoice.

Connects to:
- Linked Sales Invoice
- Payment In balance behavior
- Reports (net sales/receivables)
- Party Statement

## 11) Payment In (`/app/sales/payment-in`)

Why we use it:
- To record money received from customers.

When to use:
- Partial/full customer payment received.

Main output:
- Payment receipt record and allocation to open invoices.

Connects to:
- Sales Invoice balance reduction
- Reports (collections/outstanding)
- Party Statement

## 12) Purchase Bill (`/app/purchase/bill`)

Why we use it:
- To record supplier bills for purchases/stock/services.

When to use:
- Every purchase transaction from supplier.

Main output:
- Purchase bill with supplier payable amount.

Connects to:
- Payment Out
- Debit Note
- Reports (purchases/payables)
- Party Statement

## 13) Debit Note (`/app/purchase/debit-note`)

Why we use it:
- To increase/adjust supplier payable for purchase-side corrections.

When to use:
- Additional charge
- Price increase after bill
- Tax correction
- Shortage/adjustment scenarios per process

Main output:
- Debit adjustment against linked purchase bill.

Connects to:
- Purchase Bill
- Payment Out payable status
- Reports (net purchase/payables)
- Party Statement

## 14) Payment Out (`/app/purchases/payment-out`)

Why we use it:
- To record money paid to suppliers.

When to use:
- Full or partial supplier payment.

Main output:
- Payment out record and bill allocation.

Connects to:
- Purchase Bill balance reduction
- Reports (cash outflow/payables)
- Party Statement

## 15) Expense (`/app/purchase/expense`)

Why we use it:
- To record non-bill operational expenses (office, travel, utilities, etc.).

When to use:
- Any business expense not captured through standard purchase bill flow.

Main output:
- Expense entry available for expense tracking and reporting.

Connects to:
- Reports (expense impact)
- Owner/Accountant daily review

## 16) Reports (`/app/reports`)

Why we use it:
- To analyze business performance and outstanding risk.

When to use:
- Daily closing.
- Weekly/monthly review.
- Audit/reconciliation discussions.

Main sections:
- Sales
- Purchases
- Receivables
- Payables
- Items
- Parties

Connects to:
- All transaction modules (reads aggregated data)

## 17) Company Settings (`/app/company-settings`)

Why we use it:
- To control organization-level behavior and defaults.

When to use:
- Prefix/sequence updates
- Tax behavior updates
- Advanced configuration changes

Connects to:
- Document numbering
- Legal/tax settings used across billing pages

## 18) Cash & Bank (`/app/cash-bank`)

Why we use it:
- Intended for cash/bank ledger operations (current page is basic/placeholder in this build).

When to use:
- Future/extended treasury tracking module.

Connects to:
- Payment modules and financial summaries (conceptually).

## 19) Backup & Utilities (`/app/backup`)

Why we use it:
- For utility/backup operations (current implementation is utility level).

When to use:
- Periodic data hygiene and backup activities.

Connects to:
- Operational safety and data continuity.

## 20) Help & Support (`/app/help`)

Why we use it:
- User guidance and support entry.

When to use:
- When users need process help or troubleshooting support.

Connects to:
- Team training and issue resolution workflow.

## 21) Not Found (`*`)

Why we use it:
- Safe fallback for invalid routes.

When to use:
- Automatically when wrong URL is opened.

Connects to:
- Navigation recovery.

## 22) Full page connection map (business flow)

1. Login
2. Company Setup
3. Invoice Template Setup
4. Masters setup:
   - Parties
   - Items
5. Transactions:
   - Sales Invoice -> Payment In / Credit Note
   - Purchase Bill -> Payment Out / Debit Note
   - Expense
6. Monitoring:
   - Party Statement
   - Reports
7. Administration:
   - Company Settings
   - Backup/Help

## 23) Why this structure is correct for billing operations

- Masters first (Parties, Items) avoids entry errors.
- Sales and Purchase are separated for accounting clarity.
- Credit Note and Debit Note handle legal/financial adjustments cleanly.
- Payment In/Out are separate to keep receivable/payable logic correct.
- Reports consume all transaction outputs for management decisions.

This is the logical lifecycle for a proper billing application.

