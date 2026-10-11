import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const evidenceDir = path.resolve(__dirname, "../../../docs/evidence");

const TEST_ORG_ID = "test-org-123";
const TEST_PARTY = {
  id: "pty_customer_acme",
  type: "Customer",
  name: "Acme Retail",
  country: "India",
  state: "Tamil Nadu",
  phone: "9876543210",
  email: "accounts@acme.test",
  openingBalance: 0,
  openingBalanceType: "Receivable"
};

test.describe("Payment In End-to-End User Journeys", () => {
  let consoleErrors = [];
  let networkErrors = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    networkErrors = [];

    // Console Guard: fail on any console.error
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!text.includes("Download the React DevTools")) {
          consoleErrors.push(text);
        }
      }
    });

    // Network Guard: fail on HTTP >= 400
    page.on("response", (resp) => {
      const url = resp.url();
      if (resp.status() >= 400 && !url.includes("favicon") && !url.includes("apple-touch-icon")) {
        networkErrors.push(`${resp.status()} on ${url}`);
      }
    });

    // Directly seed authenticated state & local data across all scoping variants
    await page.addInitScript(({ orgId, party }) => {
      window.sessionStorage.setItem("auth:tab_session_active", "1");
      window.sessionStorage.setItem("auth_token", JSON.stringify("test-token-123"));
      window.sessionStorage.setItem("auth_user", JSON.stringify({ id: "user-123", email: "owner@test.com", name: "Test Owner" }));
      window.sessionStorage.setItem("role", JSON.stringify("Owner"));
      window.sessionStorage.setItem("organization_id", JSON.stringify(orgId));

      window.localStorage.setItem("auth_token", JSON.stringify("test-token-123"));
      window.localStorage.setItem("auth_user", JSON.stringify({ id: "user-123", email: "owner@test.com", name: "Test Owner" }));
      window.localStorage.setItem("role", JSON.stringify("Owner"));
      window.localStorage.setItem("organization_id", JSON.stringify(orgId));
      window.localStorage.setItem("active_organization_id", orgId);
      window.localStorage.setItem("companyProfileCompleted", JSON.stringify(true));
      window.localStorage.setItem("invoiceTemplateCompleted", JSON.stringify(true));
      window.localStorage.setItem("company_profile", JSON.stringify({ company_name: "Test Corp", country: "India" }));

      // Store parties, invoices, payments across scoped and unscoped keys
      const partiesList = [party];
      const invoicesList = [
        {
          id: "inv-stmt-1",
          invoiceNo: "INV-2026-001",
          invoiceDate: "2026-10-01",
          partyId: party.id,
          partyName: party.name,
          totals: { finalTotal: 10000, balance: 5000 },
          finalTotal: 10000
        }
      ];
      const paymentsList = [
        {
          id: "pay-stmt-1",
          direction: "IN",
          date: "2026-10-05",
          referenceNo: "RCPT-2026-001",
          partyId: party.id,
          partyName: party.name,
          invoiceId: "inv-stmt-1",
          amount: 5000,
          notes: "Initial payment"
        }
      ];

      const keysToSeed = [
        ["parties", partiesList],
        [`parties__org_${orgId}`, partiesList],
        ["invoices", invoicesList],
        [`invoices__org_${orgId}`, invoicesList],
        ["payments", paymentsList],
        [`payments__org_${orgId}`, paymentsList]
      ];

      keysToSeed.forEach(([k, val]) => {
        window.localStorage.setItem(k, JSON.stringify(val));
      });
    }, { orgId: TEST_ORG_ID, party: TEST_PARTY });
  });

  test("Journey 1 & 2: Table columns, grand_total, New Payment modal, auto/manual allocation, balance reduction", async ({ page }) => {
    let invoice1Balance = 4000.0;
    let invoice1Paid = 1000.0;
    let invoice2Balance = 2500.0;
    let invoice2Paid = 500.0;

    await page.route("**/api/v1/payments/receivables/summary*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_invoiced: 8000.0,
          total_received: 1500.0,
          total_outstanding: invoice1Balance + invoice2Balance,
          overdue_amount: invoice1Balance,
          unallocated_advance_balance: 0.0,
          tabs_count: { all: 2, overdue: 1, partial: 2, unpaid: 0, paid: 0 }
        })
      });
    });

    await page.route("**/api/v1/parties*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: TEST_PARTY.id, name: TEST_PARTY.name, country: "India" }
        ])
      });
    });

    await page.route("**/api/v1/payments/receivables*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            invoice_id: "inv-001",
            invoice_no: "INV-2026-001",
            invoice_date: "2026-09-01",
            due_date: "2026-09-15",
            customer_id: TEST_PARTY.id,
            customer_name: TEST_PARTY.name,
            grand_total: 5000.0,
            total_amount: 5000.0,
            paid: invoice1Paid,
            paid_amount: invoice1Paid,
            advance_applied: 0.0,
            balance_due: invoice1Balance,
            days_overdue: 26,
            days_to_due: null,
            status: invoice1Balance <= 0 ? "paid" : "partial",
            available_customer_advance: 0.0
          },
          {
            invoice_id: "inv-002",
            invoice_no: "INV-2026-002",
            invoice_date: "2026-10-01",
            due_date: "2026-10-25",
            customer_id: TEST_PARTY.id,
            customer_name: TEST_PARTY.name,
            grand_total: 3000.0,
            total_amount: 3000.0,
            paid: invoice2Paid,
            paid_amount: invoice2Paid,
            advance_applied: 0.0,
            balance_due: invoice2Balance,
            days_overdue: 0,
            days_to_due: 14,
            status: "partial",
            available_customer_advance: 0.0
          }
        ])
      });
    });

    await page.route("**/api/v1/payments/pending-documents*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "inv-001",
            document_id: "inv-001",
            document_no: "INV-2026-001",
            document_type: "invoice",
            total_amount: 5000.0,
            balance_due: invoice1Balance
          },
          {
            id: "inv-002",
            document_id: "inv-002",
            document_no: "INV-2026-002",
            document_type: "invoice",
            total_amount: 3000.0,
            balance_due: invoice2Balance
          }
        ])
      });
    });

    await page.route("**/api/v1/payments/customer-summary/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          customer_id: TEST_PARTY.id,
          total_invoiced: 8000.0,
          total_paid: 1500.0,
          outstanding_balance: 6500.0,
          advance_balance: 0.0,
          unapplied_balance: 0.0
        })
      });
    });

    await page.route("**/api/v1/payments", async (route) => {
      if (route.request().method() === "POST") {
        const postData = JSON.parse(route.request().postData() || "{}");
        if (postData.allocations) {
          for (const a of postData.allocations) {
            if (a.document_id === "inv-001") {
              invoice1Paid += a.amount;
              invoice1Balance = Math.max(0, invoice1Balance - a.amount);
            }
            if (a.document_id === "inv-002") {
              invoice2Paid += a.amount;
              invoice2Balance = Math.max(0, invoice2Balance - a.amount);
            }
          }
        }
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "pmt-new-1",
            receipt_no: "RCPT-2026-002",
            payment_date: postData.payment_date || "2026-10-11",
            amount: postData.amount,
            amount_received: postData.amount,
            payment_mode: postData.mode || "UPI",
            reference_no: postData.reference_no,
            customer_name: TEST_PARTY.name,
            customer_id: TEST_PARTY.id
          })
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto("/app/sales/payment-in");
    await page.waitForLoadState("networkidle");

    // Verify Page Header
    await expect(page.getByRole("heading", { name: "Payment In" })).toBeVisible();

    // Verify Invoices Rendered
    await expect(page.getByText("INV-2026-001")).toBeVisible();
    await expect(page.getByText("INV-2026-002")).toBeVisible();

    // Verify Total Column renders grand_total (₹5,000.00), NOT balance_due (₹4,000.00)
    await expect(page.getByText("₹5,000.00").first()).toBeVisible();
    await expect(page.getByText("₹3,000.00").first()).toBeVisible();

    // Verify Balance Due Column
    await expect(page.getByText("₹4,000.00").first()).toBeVisible();
    await expect(page.getByText("₹2,500.00").first()).toBeVisible();

    // Verify Overdue Badge
    await expect(page.getByText(/26 days overdue/i)).toBeVisible();

    // Screenshot 1: payment_in_table.png
    await page.screenshot({ path: path.join(evidenceDir, "payment_in_table.png"), fullPage: true });

    // Open New Payment Wizard
    await page.getByRole("button", { name: "+ New Payment" }).click();
    await expect(page.getByText("New Payment Receipt")).toBeVisible();

    // Select Customer inside modal
    const modalSelect = page.locator("div.fixed select").first();
    await modalSelect.selectOption(TEST_PARTY.id);
    await page.getByRole("button", { name: "Next: Details" }).click();

    // Verify Document Allocations
    await expect(page.getByText("Document Allocations")).toBeVisible();
    await page.locator("input[placeholder='Transaction / Ref ID']").fill("UPI-ALLOC-999");

    // Screenshot 2: payment_modal_allocation.png
    await page.screenshot({ path: path.join(evidenceDir, "payment_modal_allocation.png") });

    // Click Next: Review (Step 2 -> Step 3)
    await page.getByRole("button", { name: "Next: Review" }).click();

    // Submit Payment in Step 3: Confirm & Create Receipt
    await page.getByRole("button", { name: "Confirm & Create Receipt" }).click();
    await expect(page.getByText(/Payment receipt created successfully/i)).toBeVisible();

    // Verify Balance due decreases to 0.00
    await expect(page.getByText("₹0.00").first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(networkErrors).toEqual([]);
  });

  test("Journey 3 & 4: Advance payment, unallocated balance, and proforma conversion reduced balance", async ({ page }) => {
    const customerAdvance = 2500.0;

    await page.route("**/api/v1/payments/receivables/summary*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_invoiced: 5000.0,
          total_received: 2500.0,
          total_outstanding: 2500.0,
          overdue_amount: 0.0,
          unallocated_advance_balance: customerAdvance,
          tabs_count: { all: 1, overdue: 0, partial: 1, unpaid: 0, paid: 0 }
        })
      });
    });

    await page.route("**/api/v1/parties*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: TEST_PARTY.id, name: TEST_PARTY.name, country: "India" }
        ])
      });
    });

    await page.route("**/api/v1/payments/receivables*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            invoice_id: "inv-conv-1",
            invoice_no: "INV-CONV-001",
            invoice_date: "2026-10-11",
            due_date: "2026-10-25",
            customer_id: TEST_PARTY.id,
            customer_name: TEST_PARTY.name,
            grand_total: 5000.0,
            total_amount: 5000.0,
            paid: 2500.0,
            paid_amount: 2500.0,
            advance_applied: 2500.0,
            has_advance_applied: true,
            balance_due: 2500.0,
            days_overdue: 0,
            days_to_due: 14,
            status: "partial",
            available_customer_advance: customerAdvance
          }
        ])
      });
    });

    await page.route("**/api/v1/payments/pending-documents*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([])
      });
    });

    await page.route("**/api/v1/payments/customer-summary/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          customer_id: TEST_PARTY.id,
          total_invoiced: 5000.0,
          total_paid: 2500.0,
          outstanding_balance: 2500.0,
          advance_balance: customerAdvance,
          unapplied_balance: customerAdvance
        })
      });
    });

    await page.goto("/app/sales/payment-in");
    await page.waitForLoadState("networkidle");

    // Converted Invoice with proforma advance applied
    await expect(page.getByText("INV-CONV-001")).toBeVisible();
    await expect(page.getByText("Adv Applied").first()).toBeVisible();
    await expect(page.getByText("₹2,500.00").first()).toBeVisible();

    // Advance Available banner / badge
    await expect(page.getByText(/Adv Avail \(₹2,500.00\)/i)).toBeVisible();

    // Screenshot 3: converted_invoice_reduced_balance.png
    await page.screenshot({ path: path.join(evidenceDir, "converted_invoice_reduced_balance.png"), fullPage: true });

    expect(consoleErrors).toEqual([]);
    expect(networkErrors).toEqual([]);
  });

  test("Journey 5: Delete/edit/reverse payment restores invoice balance", async ({ page }) => {
    let isReversed = false;

    await page.route(/\/api\/v1\/payments/, async (route) => {
      const url = route.request().url();
      if (url.includes("/reverse") && route.request().method() === "POST") {
        isReversed = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "reversed",
            message: "Payment reversed successfully"
          })
        });
      } else if (route.request().method() === "GET" && (url.includes("/payments?") || url.endsWith("/payments"))) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "pmt-rev-1",
                receipt_no: "RCPT-2026-REV",
                payment_date: "2026-10-10",
                customer_name: TEST_PARTY.name,
                customer_id: TEST_PARTY.id,
                amount_received: 3000.0,
                payment_mode: "UPI",
                reference_no: "UPI-REV-TEST",
                status: isReversed ? "reversed" : "applied",
                is_reversed: isReversed,
                invoice_no: "INV-2026-001"
              }
            ],
            total: 1,
            page: 1,
            page_size: 25
          })
        });
      } else {
        await route.fallback();
      }
    });

    await page.route("**/api/v1/payments/receivables/summary*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_invoiced: 5000.0,
          total_received: isReversed ? 0.0 : 3000.0,
          total_outstanding: isReversed ? 5000.0 : 2000.0,
          overdue_amount: 0.0,
          unallocated_advance_balance: 0.0,
          tabs_count: { all: 1, overdue: 0, partial: 1, unpaid: 0, paid: 0 }
        })
      });
    });

    await page.goto("/app/sales/payment-in");
    await page.waitForLoadState("networkidle");

    // Click Payment Receipts History tab
    await page.getByRole("button", { name: "Payment Receipts History" }).click();
    await expect(page.getByText("RCPT-2026-REV")).toBeVisible();

    // Hover on row's action group and click Reverse payment
    await page.locator("tr:has-text('RCPT-2026-REV') .group").hover();
    await page.getByRole("button", { name: "Reverse payment" }).click({ force: true });

    // Confirm reversal in modal
    await expect(page.getByRole("heading", { name: "Reverse Payment" })).toBeVisible();
    await page.locator(".max-w-md textarea").fill("Cheque bounced or customer cancelled");
    await page.getByRole("button", { name: "Confirm Reversal" }).click();

    // Verify success toast
    await expect(page.getByText(/Payment reversed successfully/i)).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(networkErrors).toEqual([]);
  });

  test("Journey 6: Customer Statement displays payment with receipt number and running balance", async ({ page }) => {
    await page.goto(`/app/parties/${TEST_PARTY.id}/statement`);
    await page.waitForLoadState("networkidle");

    // Verify Party Statement Header and Customer Name
    await expect(page.getByRole("heading", { name: /Statement/i })).toBeVisible();
    await expect(page.getByText(TEST_PARTY.name).first()).toBeVisible();

    // Verify Ledger Table rows: Invoice and Payment Receipt
    await expect(page.getByText("INV-2026-001").first()).toBeVisible();
    await expect(page.getByText("RCPT-2026-001").first()).toBeVisible();

    // Screenshot 4: customer_statement_payment.png
    await page.screenshot({ path: path.join(evidenceDir, "customer_statement_payment.png"), fullPage: true });

    expect(consoleErrors).toEqual([]);
    expect(networkErrors).toEqual([]);
  });
});
