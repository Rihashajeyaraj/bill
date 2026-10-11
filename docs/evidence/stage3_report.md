# Stage 3: Browser Verification Report (Playwright & Console/Network Guard)

## 1. Guard Verifications

- **Console Guard**: All console outputs monitored via `page.on("console")`. Any `console.error` immediately causes the test run to fail. Result: **0 console errors detected**.
- **Network Guard**: All network responses monitored via `page.on("response")`. Any response with HTTP status `>= 400` immediately causes the test run to fail. Result: **0 network failures (0 responses >= 400)**.

---

## 2. Playwright Test Suite Output (`docs/evidence/playwright.txt`)

```text
Running 4 tests using 4 workers

  ok 2 [chromium] › tests\e2e\payment-in-flow.spec.js:492:3 › Payment In End-to-End User Journeys › Journey 6: Customer Statement displays payment with receipt number and running balance (9.6s)
  ok 3 [chromium] › tests\e2e\payment-in-flow.spec.js:409:3 › Payment In End-to-End User Journeys › Journey 5: Delete/edit/reverse payment restores invoice balance (19.9s)
  ok 4 [chromium] › tests\e2e\payment-in-flow.spec.js:312:3 › Payment In End-to-End User Journeys › Journey 3 & 4: Advance payment, unallocated balance, and proforma conversion reduced balance (21.4s)
  ok 1 [chromium] › tests\e2e\payment-in-flow.spec.js:107:3 › Payment In End-to-End User Journeys › Journey 1 & 2: Table columns, grand_total, New Payment modal, auto/manual allocation, balance reduction (22.1s)

  4 passed (25.1s)
```

---

## 3. User Journeys Verified

### Journey 1: Table Rendering & Columns
- Navigated to `/app/sales/payment-in`.
- Invoices rendered in table with correct data:
  - **Total Column**: Displays `grand_total` (₹5,000.00 / ₹3,000.00), fixing the previous bug where Total displayed `balance_due`.
  - **Paid Column**: Displays `paid_amount` / `paid` (₹1,000.00 / ₹500.00).
  - **Balance Column**: Displays `balance_due` (₹4,000.00 / ₹2,500.00).
  - **Overdue Badge**: Correctly displays `26 days overdue` warning badge.
- Screenshot captured: `docs/evidence/payment_in_table.png`.

### Journey 2: New Payment Modal & Multi-Invoice Allocation
- Clicked "+ New Payment" button.
- Selected customer from dropdown and clicked "Next: Details".
- Auto-allocated and filled reference ID `UPI-ALLOC-999`.
- Reviewed and confirmed receipt creation via "Confirm & Create Receipt".
- Verified success confirmation toast and verified invoice balance due decreased to ₹0.00.
- Screenshot captured: `docs/evidence/payment_modal_allocation.png`.

### Journey 3 & 4: Advance Payment & Proforma Conversion Balance
- Advance payment without invoice allocation verified: creates unallocated advance balance for customer (`Adv Avail (₹2,500.00)` banner and card).
- Converted invoice reflects proforma advance carry-forward:
  - Converted tax invoice `INV-CONV-001` renders with total ₹5,000.00 and remaining balance ₹2,500.00.
  - "Adv Applied" badge rendered in status column.
- Screenshot captured: `docs/evidence/converted_invoice_reduced_balance.png`.

### Journey 5: Payment Reversal Restores Document Balances
- Switched to "Payment Receipts History" view.
- Hovered over payment `RCPT-2026-REV` and opened actions menu.
- Clicked "Reverse payment" and confirmed reversal with reason "Cheque bounced or customer cancelled".
- Verified success confirmation toast and restored balances.

### Journey 6: Customer Statement Ledger
- Navigated to `/app/parties/pty_customer_acme/statement`.
- Verified Party Statement header and customer information.
- Verified ledger entries: Tax invoice `INV-2026-001` debit and payment receipt `RCPT-2026-001` credit with running balance.
- Screenshot captured: `docs/evidence/customer_statement_payment.png`.

---

## 4. Evidence Artifacts Saved

| Evidence File | Description | Status |
|---------------|-------------|--------|
| `docs/evidence/playwright.txt` | Raw Playwright CLI execution output | Verified (4 passed) |
| `docs/evidence/payment_in_table.png` | Payment In table with Total (grand_total), Paid, Balance, Badges | Verified |
| `docs/evidence/payment_modal_allocation.png` | New Payment modal Step 2 document allocation | Verified |
| `docs/evidence/converted_invoice_reduced_balance.png` | Converted invoice with Advance Applied badge and reduced balance | Verified |
| `docs/evidence/customer_statement_payment.png` | Customer Statement ledger showing receipt and running balance | Verified |
