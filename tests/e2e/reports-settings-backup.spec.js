import { expect, test } from "@playwright/test";
import { openApp, seedAuthenticatedState } from "./helpers/app.js";

const REPORT_SEED = {
  invoices: [
    {
      id: "inv_report_001",
      invoiceNo: "INV-2026-0001",
      invoiceDate: "2026-03-17",
      partyId: "pty_customer_acme",
      partyName: "Acme Retail",
      country: "India",
      totals: {
        subTotal: 100,
        grandTotal: 118,
        balance: 118,
        tax: {
          totalTax: 18,
          cgst: 9,
          sgst: 9,
          igst: 0,
          vat: 0,
          cess: 0
        }
      }
    }
  ],
  purchases: [
    {
      id: "bill_report_001",
      billNumber: "PB-2026-0001",
      billDate: "2026-03-17",
      partyId: "pty_supplier_spark",
      partyName: "Spark Supplies",
      country: "India",
      totals: {
        finalTotal: 300,
        grandTotal: 300,
        balance: 300,
        subTotal: 300,
        taxTotal: 0
      }
    }
  ]
};

test("reports page exports PDF, Excel, and print views", async ({ page }) => {
  await seedAuthenticatedState(page, REPORT_SEED);
  await openApp(page, "/app/reports");

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/);

  const excelDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel" }).click();
  expect((await excelDownload).suggestedFilename()).toMatch(/\.xls$/);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await popup.close();
});

test("company settings save and backup export/restore work", async ({ page }) => {
  await seedAuthenticatedState(page);
  await openApp(page, "/app/company-settings");

  await page.getByLabel("Company Email").fill("settings-updated@e2e.test");
  await page.getByRole("button", { name: /Save Company Profile/i }).click();
  await expect(page.getByText(/Settings saved/i)).toBeVisible();

  await openApp(page, "/app/backup");

  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const download = await exportDownload;
  expect(download.suggestedFilename()).toMatch(/billing-backup-.*\.json$/);

  const tempPath = await download.path();
  await expect(page.getByText(/Export includes core records/i)).toBeVisible();

  await page.getByRole("button", { name: "Restore JSON" }).click();
  await page.locator("input[type='file']").setInputFiles(tempPath);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText(/Backup restored/i)).toBeVisible();
});
