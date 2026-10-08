import { expect, test } from "@playwright/test";
import { openApp, seedAuthenticatedState } from "./helpers/app.js";

test("purchase bill flow creates supplier bill successfully", async ({ page }) => {
  await seedAuthenticatedState(page, { parties: [] });
  await openApp(page, "/app/purchase/bill");

  await page.getByPlaceholder("Enter mobile or supplier name/email/address").fill("Spark Supplies");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page.getByText("No supplier found for this search.").first()).toBeVisible();

  await page.locator("input[placeholder='Supplier name']").fill("Spark Supplies");
  await page.locator("input[placeholder='10-digit mobile']").fill("9123456780");
  await page.getByRole("button", { name: "Create Supplier" }).click();
  await expect(page.getByText("Spark Supplies").first()).toBeVisible();
  await expect(page.getByText("Search and select supplier first. Purchase form is visible but disabled until supplier is selected.")).toHaveCount(0);

  await page.getByLabel("Invoice / Bill ID").fill("PB-001");
  await page.getByLabel("Bill Date").fill("170326");
  await page.getByLabel("Bill Date").press("Tab");

  const firstRow = page.locator("tbody tr").first();
  await firstRow.getByRole("textbox", { name: "Search by product name or code" }).fill("Widget A");
  await page.getByRole("button", { name: /WIDGET-A \| Widget A/ }).click();
  await firstRow.getByRole("spinbutton").nth(0).fill("3");
  await firstRow.getByRole("spinbutton").nth(2).fill("300");

  await page.getByRole("button", { name: "Save Purchase Bill" }).click();
  await expect(page.getByText("Purchase bill saved")).toBeVisible();
});

test("payment out supports linked allocation and advance handling", async ({ page }) => {
  await seedAuthenticatedState(page, {
    purchases: [
      {
        id: "bill_seed_001",
        billNumber: "PB-ADV-001",
        billDate: "2026-03-17",
        country: "India",
        partyId: "pty_supplier_spark",
        partyName: "Spark Supplies",
        totals: {
          finalTotal: 300,
          balance: 300
        }
      }
    ]
  });
  await openApp(page, "/app/purchases/payment-out");

  await page.getByRole("button", { name: /New Payment/i }).click();
  await page.getByPlaceholder("Search customer/supplier by name, phone, email, or address").fill("Spark");
  await page.getByRole("button", { name: /^Search$/ }).click();
  await expect(page.getByText("Spark Supplies")).toBeVisible();

  await page.getByRole("button", { name: /Payment Details/ }).click();
  await page.getByLabel("Amount Paid").fill("500");
  await page.getByRole("button", { name: "Yes - Pay against Invoice" }).click();
  await expect(page.getByLabel("Purchase Invoice")).toBeVisible();
  await page.getByLabel("Purchase Invoice").selectOption({ index: 1 });
  await page.getByPlaceholder("Payment reference").fill("PO-ADV-001");

  await page.getByRole("button", { name: /Review & Confirm/ }).click();
  await expect(page.getByText("Advance")).toBeVisible();
  await expect(page.getByText(/200.00|200/)).toBeVisible();

  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText(/saved as Applied/i)).toBeVisible();
  await expect(page.getByText(/Invoice - PB-ADV-001/)).toBeVisible();
});
