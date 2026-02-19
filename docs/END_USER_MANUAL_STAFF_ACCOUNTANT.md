# Billing Application End-User Manual

This manual is for daily users (Staff and Accountant).  
It explains what to do on each page in simple business steps.

## 1) Who should use this manual

- Staff: day-to-day entry work (parties, items, invoices, payment collection follow-up).
- Accountant: sales/purchase billing, payments, credit/debit adjustments, reports checking.
- Owner/Admin: setup, approvals, settings, final controls.

## 2) Main menu you will use

- `Dashboard`
- `Parties`
- `Items`
- `Invoices`
- `Purchases`
- `Credit Note`
- `Debit Note`
- `Payment In`
- `Payment Out`
- `Reports`
- `Settings`

## 3) First-time use checklist

1. Login to your account.
2. Complete `Company Setup` (company name, country, address, tax details).
3. Complete `Invoice Template` (logo, colors, print design).
4. Add master data:
   - Parties (customers/suppliers)
   - Items (products/services)
5. Start billing operations.

## 4) Daily operating flow (recommended order)

1. Create or update Parties.
2. Create or update Items.
3. Create Sales Invoices.
4. Record customer receipts in Payment In.
5. Create Purchase Bills.
6. Record supplier payments in Payment Out.
7. If needed, pass Credit Note / Debit Note.
8. Enter Expenses.
9. Check Reports at day end.

## 5) Page-by-page SOP

## 5.1 Parties

Use this page to create customers and suppliers.

Steps:
1. Open `Parties`.
2. Click Add.
3. Select type: Customer or Supplier.
4. Fill name, phone, tax number, address, opening balance (if any).
5. Save.

Tips:
- Keep party names clean and unique.
- For credit control, maintain correct credit limit details.

## 5.2 Items

Use this page to create products/services used in invoices and purchase bills.

Steps:
1. Open `Items`.
2. Choose tab: Product or Service.
3. Click Add Item.
4. Fill item name, unit, sales rate, purchase rate, tax rate.
5. Save.

Tips:
- Do not create duplicate item names.
- Keep tax rate correct to avoid report mismatch.

## 5.3 Invoices (Sales Invoice)

Use this page to create customer sales invoices.

Steps:
1. Open `Invoices`.
2. Select customer.
3. Add line items (item, qty, rate, tax).
4. Verify totals and tax split.
5. Save invoice.
6. Share/print invoice if needed.

Result:
- Invoice is saved and available for Payment In and Reports.

## 5.4 Credit Note

Use when sales return/discount/price correction is required.

Steps:
1. Open `Credit Note`.
2. Select country context.
3. Select linked invoice.
4. Enter reason and adjusted lines.
5. Save as Draft or Issued.
6. Apply only after checking values.

Result:
- Credit note reduces customer receivable for linked invoice when applied.

## 5.5 Payment In

Use to record money received from customer.

Steps:
1. Open `Payment In`.
2. Select customer.
3. Enter amount received.
4. Allocate amount to open invoices.
5. Save as Received/Applied.

Result:
- Applied amount reduces invoice pending balance.
- Unallocated amount stays as advance.

## 5.6 Purchases (Purchase Bill)

Use to record supplier purchase bills.

Steps:
1. Open `Purchases`.
2. Select supplier.
3. Enter bill details and item lines.
4. Save.

Result:
- Bill is available for Payment Out and Debit Note flows.

## 5.7 Debit Note

Use for supplier-side adjustments (price increase, shortage, extra charges, etc.).

Steps:
1. Open `Debit Note`.
2. Select country context.
3. Link purchase invoice.
4. Enter adjustment details.
5. Save and apply after verification.

Result:
- Applied debit note updates supplier payable amount on linked bill.

## 5.8 Payment Out

Use to record money paid to suppliers.

Steps:
1. Open `Payment Out`.
2. Select supplier.
3. Enter paid amount and payment mode.
4. Allocate to open bills.
5. Save as Paid/Applied.

Result:
- Applied amount reduces supplier bill pending balance.
- Unallocated amount is treated as supplier advance.

## 5.9 Expense

Use to record non-purchase operational expenses.

Steps:
1. Open Expense entry page.
2. Select date and category.
3. Enter amount and note.
4. Save.

Result:
- Expense is included in reports.

## 5.10 Reports

Use for daily/weekly/monthly review.

Steps:
1. Open `Reports`.
2. Set date range.
3. Review Sales, Purchase, Receivables, Payables, Items, Parties.
4. Open table details for transaction-level view.

Suggested daily checks:
- Today sales
- Pending customer balances
- Supplier due amounts
- Low stock items
- Expense trend

## 6) How pages are logically connected

- `Invoices` -> feeds `Payment In`, `Credit Note`, `Reports`, Party Statement.
- `Credit Note` -> adjusts linked sales invoice balance.
- `Payment In` -> clears customer invoice balances.
- `Purchases` -> feeds `Payment Out`, `Debit Note`, `Reports`.
- `Debit Note` -> adjusts linked purchase bill payable.
- `Payment Out` -> clears supplier bill balances.
- `Expenses` -> visible in business reports.
- `Parties` and `Items` -> master data used by all transaction pages.

## 7) Role-based practical usage

## Staff

- Maintain Parties and Items.
- Create Invoices and Purchase Bills.
- Collect payment details and draft Payment In/Payment Out.
- Do not apply adjustments without accountant/owner approval policy.

## Accountant

- Verify and post Invoices, Credit Notes, Debit Notes.
- Apply Payment In and Payment Out correctly to open documents.
- Record Expenses daily.
- Review Reports and pending balances.

## 8) Daily control checklist

1. No invoice without correct customer and items.
2. No payment without allocation check.
3. No credit/debit note without linked original document.
4. End of day: pending receivable/payable review in Reports.
5. Fix wrong entries on same day.

## 9) Common mistakes to avoid

- Creating duplicate parties/items.
- Posting payment without allocation.
- Applying credit/debit note on wrong invoice/bill.
- Wrong tax rate selection.
- Missing date range checks in reports.

## 10) Quick training plan for your team

Day 1:
1. Parties + Items entry practice.
2. Create 3 sample invoices and 3 sample purchase bills.

Day 2:
1. Payment In allocation practice.
2. Payment Out allocation practice.
3. Credit/Debit note scenario practice.

Day 3:
1. Report reading and daily closing checklist.
2. Role-based approvals and correction process.

---

File purpose: practical operations manual for non-technical users.  
Use together with your detailed technical documentation when needed.

