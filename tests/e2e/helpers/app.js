import { expect } from "@playwright/test";

export const OWNER_USER = {
  id: "local_owner_demo",
  email: "owner@demo.com",
  name: "Owner User"
};

export const DEFAULT_PARTIES = [
  {
    id: "pty_customer_acme",
    type: "Customer",
    name: "Acme Retail",
    phone: "9876543210",
    email: "accounts@acme.test",
    country: "India",
    state: "Tamil Nadu",
    address: "42 Market Road",
    notes: "",
    openingBalance: 0,
    openingBalanceType: "Receivable",
    creditLimitEnabled: false,
    creditLimitType: "Amount",
    creditLimit: 0,
    creditLimitDays: 0
  },
  {
    id: "pty_supplier_spark",
    type: "Supplier",
    name: "Spark Supplies",
    phone: "9123456780",
    email: "ops@spark.test",
    country: "India",
    state: "Tamil Nadu",
    address: "16 Industrial Estate",
    notes: "",
    openingBalance: 0,
    openingBalanceType: "Payable",
    creditLimitEnabled: false,
    creditLimitType: "Amount",
    creditLimit: 0,
    creditLimitDays: 0
  }
];

export const DEFAULT_ITEMS = [
  {
    id: "itm_widget_a",
    itemCode: "WIDGET-A",
    name: "Widget A",
    type: "Product",
    status: "Active",
    trackInventory: true,
    currentStock: 120,
    stockQty: 120,
    quantity: 120,
    openingStock: 120,
    purchaseRate: 300,
    price: 500,
    unit: "pcs",
    taxRate: 18,
    metadata: {
      currentStock: 120,
      purchasePrice: 300,
      lowStockAlert: 10
    }
  },
  {
    id: "itm_service_install",
    itemCode: "INSTALL-SVC",
    name: "Installation Service",
    type: "Service",
    status: "Active",
    trackInventory: false,
    currentStock: 0,
    stockQty: 0,
    quantity: 0,
    purchaseRate: 0,
    price: 250,
    unit: "service",
    taxRate: 18,
    metadata: {
      currentStock: 0,
      purchasePrice: 0,
      lowStockAlert: 0
    }
  }
];

function mergeProfile(profile = {}) {
  const base = {
    ownerName: OWNER_USER.name,
    ownerEmail: OWNER_USER.email,
    ownerRole: "Owner",
    companyName: "E2E Billing Pvt Ltd",
    logoBase64: "",
    country: "India",
    countryCode: "IN",
    currency: "INR",
    currencies: ["INR"],
    phone: "+91 9876543210",
    email: "billing@e2e.test",
    address: {
      line1: "1 Automation Street",
      line2: "",
      city: "Chennai",
      state: "Tamil Nadu",
      postalCode: "600001"
    },
    tax: {
      gstin: "",
      vatNumber: "",
      vatRate: 18,
      taxId: ""
    },
    settings: {
      invoice_template_selected: true,
      invoiceTemplate: {
        templateId: "india_blue_gst",
        primaryColor: "#1f6b45",
        bgColor: "#ffffff",
        fontFamily: "Inter",
        logoUrl: "",
        logoPosition: "left"
      },
      tax: {
        enableGst: true,
        defaultGstRate: 18
      }
    }
  };

  return {
    ...base,
    ...profile,
    address: {
      ...base.address,
      ...(profile.address || {})
    },
    tax: {
      ...base.tax,
      ...(profile.tax || {})
    },
    settings: {
      ...base.settings,
      ...(profile.settings || {}),
      invoiceTemplate: {
        ...base.settings.invoiceTemplate,
        ...(profile.settings?.invoiceTemplate || {})
      },
      tax: {
        ...base.settings.tax,
        ...(profile.settings?.tax || {})
      }
    }
  };
}

export function buildSeed(overrides = {}) {
  return {
    role: "Owner",
    organizationId: "org_e2e_suite",
    user: OWNER_USER,
    profile: mergeProfile(overrides.profile),
    templateConfig: {
      templateId: "india_blue_gst",
      primaryColor: "#1f6b45",
      bgColor: "#ffffff",
      fontFamily: "Inter",
      logoUrl: "",
      logoPosition: "left",
      ...(overrides.templateConfig || {})
    },
    companyProfileCompleted:
      overrides.companyProfileCompleted === undefined ? true : overrides.companyProfileCompleted,
    invoiceTemplateCompleted:
      overrides.invoiceTemplateCompleted === undefined ? true : overrides.invoiceTemplateCompleted,
    parties: overrides.parties === undefined ? DEFAULT_PARTIES : overrides.parties,
    items: overrides.items === undefined ? DEFAULT_ITEMS : overrides.items,
    invoices: overrides.invoices || [],
    purchases: overrides.purchases || [],
    salesProformas: overrides.salesProformas || [],
    purchaseProformas: overrides.purchaseProformas || [],
    payments: overrides.payments || [],
    expenses: overrides.expenses || [],
    paymentInPremium: overrides.paymentInPremium || [],
    paymentOutPremium: overrides.paymentOutPremium || [],
    paymentOutLedger: overrides.paymentOutLedger || [],
    paymentOutSequence: overrides.paymentOutSequence || {},
    creditNotesPremium: overrides.creditNotesPremium || [],
    debitNotesPremium: overrides.debitNotesPremium || [],
    itemBarcodes: overrides.itemBarcodes || [],
    notifications: overrides.notifications || [],
    activityLogs: overrides.activityLogs || [],
    creditNotifications: overrides.creditNotifications || [],
    stockNotifications: overrides.stockNotifications || [],
    autoBackupReminder: overrides.autoBackupReminder || {}
  };
}

function writeSeedToStorage(config) {
  const normalizeScopeValue = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_");

  const setJson = (storage, key, value) => {
    storage.setItem(key, JSON.stringify(value));
  };

  const orgScope = normalizeScopeValue(config.organizationId);
  const userScope = normalizeScopeValue(config.user.id);
  const orgKey = (key) => `${key}__org_${orgScope}`;
  const userKey = (key) => `${key}__user_${userScope}`;
  const { localStorage, sessionStorage } = window;

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
  setJson(localStorage, orgKey("item_barcodes"), config.itemBarcodes);
  setJson(localStorage, orgKey("credit_notifications"), config.creditNotifications);
  setJson(localStorage, orgKey("stock_notifications"), config.stockNotifications);
  setJson(localStorage, orgKey("paymentInPremiumV1"), config.paymentInPremium);
  setJson(localStorage, orgKey("paymentOutPremiumV1"), config.paymentOutPremium);
  setJson(localStorage, orgKey("paymentOutPremiumLedgerV1"), config.paymentOutLedger);
  setJson(localStorage, orgKey("paymentOutPremiumSequenceV1"), config.paymentOutSequence);
  setJson(localStorage, orgKey("creditNotesPremiumV1"), config.creditNotesPremium);
  setJson(localStorage, orgKey("debitNotesPremiumV1"), config.debitNotesPremium);
  setJson(localStorage, orgKey("paymentInSelectedCountryV1"), "IN");

  setJson(localStorage, "app_notifications", config.notifications);
  setJson(localStorage, "activity_logs", config.activityLogs);
  setJson(localStorage, "auto_backup_reminder", config.autoBackupReminder);
}

export async function seedAuthenticatedState(page, overrides = {}) {
  const seed = buildSeed(overrides);
  await page.goto("/login");
  await page.evaluate(writeSeedToStorage, seed);
  await page.getByRole("textbox", { name: "Email" }).fill(OWNER_USER.email);
  await page.getByRole("textbox", { name: "Password" }).fill("owner123");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("main")).toBeVisible();
}

export async function openApp(page, route = "/dashboard") {
  await page.goto(route);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Application Error")).toHaveCount(0);
}

export async function fillDateInput(locator, digits) {
  await locator.click();
  await locator.fill("");
  await locator.type(String(digits));
  await locator.press("Tab");
}

export async function acceptNextDialog(page) {
  const dialogPromise = page.waitForEvent("dialog");
  return {
    async accept() {
      const dialog = await dialogPromise;
      const message = dialog.message();
      await dialog.accept();
      return message;
    }
  };
}

export async function dismissNextDialog(page) {
  const dialogPromise = page.waitForEvent("dialog");
  return {
    async dismiss() {
      const dialog = await dialogPromise;
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    }
  };
}

export async function assertHealthyRoute(page, route) {
  await page.goto(route);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Application Error")).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveText(/^Loading\.\.\.$/);
}
