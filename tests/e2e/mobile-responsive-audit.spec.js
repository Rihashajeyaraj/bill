import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, devices } from "@playwright/test";
import { buildSeed, openApp } from "./helpers/app.js";

test.use({
  ...devices["iPhone 12"]
});

const ROUTES = [
  "/dashboard",
  "/app/parties",
  "/app/items",
  "/items/new",
  "/app/sales/invoice",
  "/app/sales/invoice/history",
  "/app/sales/proformas/new",
  "/app/sales/proformas/history",
  "/app/sales/credit-note",
  "/app/sales/payment-in",
  "/app/purchase/bill",
  "/app/purchase/history",
  "/app/purchase/proformas/new",
  "/app/purchase/proformas/history",
  "/app/purchase/debit-note",
  "/app/purchases/payment-out",
  "/app/purchase/expense",
  "/app/reports",
  "/app/notifications",
  "/app/company-settings",
  "/app/backup",
  "/app/audit-history"
];

test("audit major routes for mobile responsiveness", async ({ page }, testInfo) => {
  test.setTimeout(300_000);

  const seed = buildSeed({});
  await page.goto("/login");
  await page.evaluate((config) => {
    const normalizeScopeValue = (value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_");
    const setJson = (storage, key, value) => storage.setItem(key, JSON.stringify(value));
    const orgScope = normalizeScopeValue(config.organizationId);
    const userScope = normalizeScopeValue(config.user.id);
    const orgKey = (key) => `${key}__org_${orgScope}`;
    const userKey = (key) => `${key}__user_${userScope}`;

    localStorage.clear();
    sessionStorage.clear();

    setJson(localStorage, userKey("organization_id"), config.organizationId);
    setJson(localStorage, userKey("companyProfileCompleted"), config.companyProfileCompleted);
    setJson(localStorage, userKey("invoiceTemplateCompleted"), config.invoiceTemplateCompleted);
    setJson(localStorage, userKey("company_profile"), config.profile);
    setJson(localStorage, userKey("invoiceTemplateConfig"), config.templateConfig);
    setJson(localStorage, orgKey("company_profile"), config.profile);
    setJson(localStorage, orgKey("companyProfileCompleted"), config.companyProfileCompleted);
    setJson(localStorage, orgKey("invoiceTemplateCompleted"), config.invoiceTemplateCompleted);
    setJson(localStorage, orgKey("invoiceTemplateConfig"), config.templateConfig);
    setJson(localStorage, orgKey("parties"), config.parties);
    setJson(localStorage, orgKey("items"), config.items);
    setJson(localStorage, orgKey("invoices"), config.invoices);
    setJson(localStorage, orgKey("sales_proformas"), config.salesProformas);
    setJson(localStorage, orgKey("purchase_proformas"), config.purchaseProformas);
    setJson(localStorage, orgKey("purchases"), config.purchases);
    setJson(localStorage, orgKey("payments"), config.payments);
    setJson(localStorage, orgKey("expenses"), config.expenses);
    setJson(localStorage, orgKey("creditNotesPremiumV1"), config.creditNotesPremium);
    setJson(localStorage, orgKey("debitNotesPremiumV1"), config.debitNotesPremium);
    setJson(localStorage, orgKey("paymentInPremiumV1"), config.paymentInPremium);
    setJson(localStorage, orgKey("paymentOutPremiumV1"), config.paymentOutPremium);
    setJson(localStorage, orgKey("paymentOutPremiumLedgerV1"), config.paymentOutLedger);
    setJson(localStorage, orgKey("paymentOutPremiumSequenceV1"), config.paymentOutSequence);
    setJson(localStorage, orgKey("paymentInSelectedCountryV1"), "IN");

    setJson(sessionStorage, "auth_token", "mock_mobile_audit");
    setJson(sessionStorage, "auth_user", config.user);
    setJson(sessionStorage, "role", config.role);
    setJson(sessionStorage, "organization_id", config.organizationId);
    setJson(sessionStorage, "companyProfileCompleted", config.companyProfileCompleted);
    setJson(sessionStorage, "invoiceTemplateCompleted", config.invoiceTemplateCompleted);
    sessionStorage.setItem("auth:tab_session_active", "1");
  }, seed);
  await page.goto("/dashboard");
  await expect(page.locator("main")).toBeVisible();

  const screenshotsDir = testInfo.outputPath("mobile-audit");
  await fs.mkdir(screenshotsDir, { recursive: true });
  const results = [];

  for (const route of ROUTES) {
    await openApp(page, route);
    await page.waitForTimeout(500);

    const metrics = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const bodyOverflow = document.documentElement.scrollWidth - viewportWidth;
      const overflowing = Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          const style = window.getComputedStyle(el);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.position === "fixed"
          ) {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.right > viewportWidth + 1 &&
            !el.closest('[data-table-scroll="true"], .overflow-x-auto, .overflow-auto')
          );
        })
        .slice(0, 12)
        .map((el) => ({
          tag: el.tagName,
          className: String(el.className || ""),
          text: String(el.textContent || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 90)
        }));

      return {
        viewportWidth,
        bodyOverflow,
        overflowing
      };
    });

    const fileName =
      route.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "root";
    await page.screenshot({
      path: path.join(screenshotsDir, `${fileName}.png`),
      fullPage: true
    });

    results.push({
      route,
      ...metrics
    });
  }

  const resultsPath = testInfo.outputPath("mobile-audit-results.json");
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify(results, null, 2));

  expect(results.every((entry) => entry.bodyOverflow <= 4)).toBeTruthy();
});
