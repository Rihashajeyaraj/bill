import { LS_KEYS, lsGet, lsSet } from "./storage";
import { authGetOrganizationId, authGetRole, authGetUser, authUsingSupabase } from "./auth.service";
import { companyGetProfile, companyLoadMyOrganization } from "./company.service";
import { invoicesList, invoicesSyncFromRemote } from "./invoices.service";
import { purchasesList, purchasesSyncFromRemote } from "./purchases.service";
import { paymentsList, paymentsSyncFromRemote } from "./payments.service";
import { expensesList, expensesSyncFromRemote } from "./expenses.service";
import { creditNotesList, creditNotesSyncFromRemote } from "./creditNotes.service";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { listItems, syncItemsFromRemote } from "../modules/items/store";
import { listCreditNotes } from "../modules/creditNote/store";
import { listDebitNotes } from "../modules/debitNote/store";
import { listPaymentIn } from "../modules/paymentIn/store";
import { listPaymentOut } from "../modules/paymentOut/store";

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_APP_NAME = "BillJoy";
const SUPPORT_KEYS = {
  creditNotesPremium: "creditNotesPremiumV1",
  debitNotesPremium: "debitNotesPremiumV1",
  paymentInPremium: "paymentInPremiumV1",
  paymentOutPremium: "paymentOutPremiumV1",
  paymentOutLedger: "paymentOutPremiumLedgerV1",
  paymentOutSequence: "paymentOutPremiumSequenceV1",
  supportRequests: "helpSupportRequestsV1"
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeError(error) {
  return error?.message || "Unknown sync error";
}

function dataCounts(snapshot) {
  const data = snapshot?.data || {};
  return {
    parties: asArray(data.parties).length,
    items: asArray(data.items).length,
    invoices: asArray(data.invoices).length,
    purchases: asArray(data.purchases).length,
    payments: asArray(data.payments).length,
    expenses: asArray(data.expenses).length,
    creditNotes: asArray(data.creditNotesLegacy).length,
    creditNotesPremium: asArray(data.creditNotesPremium).length,
    debitNotesPremium: asArray(data.debitNotesPremium).length,
    paymentInPremium: asArray(data.paymentInPremium).length,
    paymentOutPremium: asArray(data.paymentOutPremium).length
  };
}

async function syncSourcesFromRemote() {
  const steps = [
    { label: "Organization", run: () => companyLoadMyOrganization() },
    { label: "Parties", run: () => syncPartiesFromRemote() },
    { label: "Items", run: () => syncItemsFromRemote() },
    { label: "Invoices", run: () => invoicesSyncFromRemote() },
    { label: "Purchases", run: () => purchasesSyncFromRemote() },
    { label: "Payments", run: () => paymentsSyncFromRemote() },
    { label: "Expenses", run: () => expensesSyncFromRemote() },
    { label: "Credit Notes", run: () => creditNotesSyncFromRemote() }
  ];

  const results = await Promise.allSettled(steps.map((step) => step.run()));
  return results
    .map((result, index) => {
      if (result.status === "fulfilled") return "";
      return `${steps[index].label}: ${normalizeError(result.reason)}`;
    })
    .filter(Boolean);
}

function getSnapshotData() {
  return {
    companyProfile: companyGetProfile(),
    parties: listParties(),
    items: listItems(),
    invoices: invoicesList(),
    purchases: purchasesList(),
    payments: paymentsList(),
    expenses: expensesList(),
    creditNotesLegacy: creditNotesList(),
    creditNotesPremium: listCreditNotes(),
    debitNotesPremium: listDebitNotes(),
    paymentInPremium: listPaymentIn(),
    paymentOutPremium: listPaymentOut(),
    paymentOutLedger: lsGet(SUPPORT_KEYS.paymentOutLedger, []),
    paymentOutSequence: lsGet(SUPPORT_KEYS.paymentOutSequence, {}),
    invoiceTemplateConfig: lsGet(LS_KEYS.invoiceTemplateConfig, null),
    invoiceTemplateCompleted: !!lsGet(LS_KEYS.invoiceTemplateCompleted, false),
    supportRequests: lsGet(SUPPORT_KEYS.supportRequests, [])
  };
}

export async function createBackupSnapshot(options = {}) {
  const warnings = options.syncRemote === false ? [] : await syncSourcesFromRemote();
  const user = authGetUser();

  const snapshot = {
    meta: {
      app: BACKUP_APP_NAME,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      generatedBy: {
        id: user?.id || "",
        email: user?.email || "",
        name: user?.name || ""
      },
      role: authGetRole(),
      organizationId: authGetOrganizationId(),
      usesSupabase: authUsingSupabase(),
      syncRemote: options.syncRemote !== false,
      warnings
    },
    data: getSnapshotData()
  };

  return {
    snapshot,
    counts: dataCounts(snapshot),
    warnings
  };
}

export function downloadBackupSnapshot(snapshot, filename = "") {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Backup snapshot is invalid.");
  }

  const generatedAt = String(snapshot?.meta?.generatedAt || new Date().toISOString()).slice(0, 10);
  const safeOrg = String(snapshot?.meta?.organizationId || "local").slice(0, 8) || "local";
  const defaultName = `billing-backup-${generatedAt}-${safeOrg}.json`;
  const fileName = filename || defaultName;

  const payload = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return fileName;
}

export async function parseBackupFile(file) {
  if (!file) throw new Error("Backup file is required.");
  const text = await file.text();
  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file.");
  }

  if (!parsed || typeof parsed !== "object" || !parsed.data) {
    throw new Error("Backup format is invalid.");
  }

  return parsed;
}

export function restoreBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.data) {
    throw new Error("Backup format is invalid.");
  }

  const data = snapshot.data;
  if (data.companyProfile) {
    lsSet(LS_KEYS.company_profile, data.companyProfile);
    lsSet(LS_KEYS.companyProfileCompleted, true);
  }

  lsSet(LS_KEYS.parties, asArray(data.parties));
  lsSet(LS_KEYS.items, asArray(data.items));
  lsSet(LS_KEYS.invoices, asArray(data.invoices));
  lsSet(LS_KEYS.purchases, asArray(data.purchases));
  lsSet(LS_KEYS.payments, asArray(data.payments));
  lsSet(LS_KEYS.expenses, asArray(data.expenses));
  lsSet(LS_KEYS.creditNotes, asArray(data.creditNotesLegacy));

  lsSet(SUPPORT_KEYS.creditNotesPremium, asArray(data.creditNotesPremium));
  lsSet(SUPPORT_KEYS.debitNotesPremium, asArray(data.debitNotesPremium));
  lsSet(SUPPORT_KEYS.paymentInPremium, asArray(data.paymentInPremium));
  lsSet(SUPPORT_KEYS.paymentOutPremium, asArray(data.paymentOutPremium));
  lsSet(SUPPORT_KEYS.paymentOutLedger, asArray(data.paymentOutLedger));
  lsSet(SUPPORT_KEYS.paymentOutSequence, data.paymentOutSequence || {});
  lsSet(SUPPORT_KEYS.supportRequests, asArray(data.supportRequests));

  if (data.invoiceTemplateConfig) {
    lsSet(LS_KEYS.invoiceTemplateConfig, data.invoiceTemplateConfig);
  }
  lsSet(LS_KEYS.invoiceTemplateCompleted, !!data.invoiceTemplateCompleted);

  return {
    counts: dataCounts(snapshot),
    restoredAt: new Date().toISOString()
  };
}

export function summarizeBackupCounts(snapshot) {
  return dataCounts(snapshot);
}
