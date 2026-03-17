import { expect, test } from "@playwright/test";
import {
  fillDateInput,
  openApp,
  seedAuthenticatedState
} from "./helpers/app.js";

test("invoice validation prevents saving empty data", async ({ page }) => {
  await seedAuthenticatedState(page, { parties: [] });
  await openApp(page, "/app/sales/invoice");

  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("This field is required").first()).toBeVisible();
  await expect(page.getByText("Search and select customer first.")).toBeVisible();
});

test("sales invoice full flow works with inline customer creation and payment capture", async ({ page }) => {
  await seedAuthenticatedState(page, { parties: [] });
  await openApp(page, "/app/sales/invoice");

  await page.getByPlaceholder("Enter mobile or customer name/email/address").fill("Apex Retail");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page.getByText("No customer found for this search.")).toBeVisible();

  await page.locator("input[placeholder='Customer name']").fill("Apex Retail");
  await page.locator("input[placeholder='10-digit mobile']").fill("9876543210");
  await page.getByRole("button", { name: "Create Customer" }).click();
  await expect(page.getByText("Apex Retail").first()).toBeVisible();

  await fillDateInput(page.getByLabel("Invoice Date"), "170326");

  await page.getByPlaceholder("Search by product ID or name...").fill("Widget A");
  await page.getByRole("button", { name: /WIDGET-A \| Widget A/ }).click();

  const lineRow = page.locator("input[value='WIDGET-A | Widget A']").locator("xpath=ancestor::div[contains(@class,'px-3 py-2.5')][1]");
  await lineRow.locator("input").nth(1).fill("2");

  await page.getByRole("button", { name: "Received", exact: true }).click();
  await page.getByLabel("Amount Received").fill("2000");
  await fillDateInput(page.getByLabel("Payment Date"), "170326");
  await page.getByLabel("Reference No").fill("PAY-INV-001");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save Invoice" }).click();

  await expect(page.getByRole("button", { name: "Record Payment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Credit Note" })).toBeVisible();
});

test("proforma payment stays unpaid until applied, then survives conversion", async ({ page }) => {
  await seedAuthenticatedState(page);
  await openApp(page, "/app/sales/proformas/new");

  await fillDateInput(page.getByLabel("Pro Forma Date"), "170326");
  await page.getByLabel("Search Customer").fill("Acme");
  await page.getByRole("button", { name: /Acme Retail/ }).click();

  const proformaRow = page.locator("tbody tr").first();
  await proformaRow.locator("input[id^='sales-proforma-item-input-']").fill("Widget A");
  await page.getByRole("button", { name: /WIDGET-A \| Widget A/ }).click();
  await proformaRow.locator("input").nth(1).fill("2");
  await proformaRow.locator("input").nth(3).fill("100");
  await proformaRow.locator("input").nth(6).fill("0");

  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Pro Forma Invoice saved")).toBeVisible();

  await openApp(page, "/app/sales/proformas/history");
  let historyRow = page.locator("tbody tr").first();
  const proformaNo = ((await historyRow.locator("td").first().textContent()) || "").trim();
  await expect(historyRow.locator("td").nth(5)).toContainText(/^0(?:\.00)?$/);

  await openApp(page, "/app/sales/payment-in");
  await page.getByRole("button", { name: /New Payment/i }).click();
  await page.getByPlaceholder("Search customer/supplier by name, phone, email, or address").fill("Acme");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page.getByText("Acme Retail")).toBeVisible();
  await page.getByRole("button", { name: /Payment Details/ }).click();
  await page.getByLabel("Amount Received").fill("50");
  await page.getByRole("button", { name: /Yes - Pay against Invoice/ }).click();
  await page.getByRole("combobox").nth(0).selectOption({ index: 1 });
  await fillDateInput(page.getByLabel("Payment Date"), "170326");
  await page.getByRole("button", { name: /Review & Confirm/ }).click();
  await page.getByRole("button", { name: "Save Confirmed" }).click();
  await expect(page.getByText(/saved as Confirmed/i)).toBeVisible();

  await openApp(page, "/app/sales/proformas/history");
  historyRow = page.locator("tbody tr", { hasText: proformaNo });
  await expect(historyRow.locator("td").nth(5)).toContainText(/^0(?:\.00)?$/);

  await openApp(page, "/app/sales/payment-in");
  const paymentRow = page.locator("tr", { hasText: "Acme Retail" }).first();
  await paymentRow.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: /Review & Confirm/ }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/saved as Applied/i)).toBeVisible();

  await openApp(page, "/app/sales/proformas/history");
  historyRow = page.locator("tbody tr", { hasText: proformaNo });
  await expect(historyRow.locator("td").nth(5)).toContainText(/^50(?:\.00)?$/);
  await expect(historyRow.locator("td").nth(6)).toContainText(/^150(?:\.00)?$/);

  await historyRow.getByRole("button", { name: "Edit" }).click();
  await expect(page).not.toHaveURL(/\/history$/);
  await expect(page.getByRole("button", { name: "Convert to Invoice" })).toBeVisible();
  await page.getByRole("button", { name: "Convert to Invoice" }).click();
  await expect(page.getByText(/Converted to invoice/i)).toBeVisible();

  await openApp(page, "/app/sales/proformas/history");
  historyRow = page.locator("tbody tr", { hasText: proformaNo });
  await expect(historyRow.locator("td").nth(5)).toContainText(/^50(?:\.00)?$/);
  await expect(historyRow.locator("td").nth(6)).toContainText(/^150(?:\.00)?$/);
});
