import { test } from "@playwright/test";
import { assertHealthyRoute, openApp, seedAuthenticatedState } from "./helpers/app.js";

const MAJOR_ROUTES = [
  "/dashboard",
  "/app/notifications",
  "/app/parties",
  "/app/items",
  "/app/sales/invoice",
  "/app/sales/proformas/history",
  "/app/sales/payment-in",
  "/app/purchase/bill",
  "/app/purchases/payment-out",
  "/app/reports",
  "/app/company-settings",
  "/app/backup",
  "/app/audit-history"
];

test("all major routes load without crashing for a configured owner", async ({ page }) => {
  test.setTimeout(120000);
  await seedAuthenticatedState(page);
  for (const route of MAJOR_ROUTES) {
    await assertHealthyRoute(page, route);
  }
});

test("sidebar navigation buttons open the expected major sections", async ({ page }) => {
  await seedAuthenticatedState(page);
  await openApp(page);

  await page.getByRole("link", { name: "Parties", exact: true }).click();
  await assertHealthyRoute(page, "/app/parties");

  await page.getByRole("link", { name: "Items", exact: true }).click();
  await assertHealthyRoute(page, "/app/items");

  await page.getByRole("button", { name: "Sales" }).click();
  await page.getByRole("link", { name: "Invoice", exact: true }).click();
  await assertHealthyRoute(page, "/app/sales/invoice");

  await page.getByRole("button", { name: "Payments" }).click();
  await page.getByRole("link", { name: "Payment In", exact: true }).click();
  await assertHealthyRoute(page, "/app/sales/payment-in");

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await assertHealthyRoute(page, "/app/reports");

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await assertHealthyRoute(page, "/app/company-settings");

  await page.getByRole("link", { name: "Backup", exact: true }).click();
  await assertHealthyRoute(page, "/app/backup");
});

test("core pages still load when business data is empty", async ({ page }) => {
  await seedAuthenticatedState(page, {
    parties: [],
    items: [],
    invoices: [],
    purchases: [],
    salesProformas: [],
    paymentInPremium: [],
    paymentOutPremium: []
  });

  await assertHealthyRoute(page, "/app/parties");
  await assertHealthyRoute(page, "/app/sales/invoice");
  await assertHealthyRoute(page, "/app/sales/proformas/history");
  await assertHealthyRoute(page, "/app/sales/payment-in");
  await assertHealthyRoute(page, "/app/purchases/payment-out");
});

