import {
  LS_KEYS,
  lsGet,
  lsGetOrganizationScoped,
  lsSet,
  lsSetOrganizationScoped
} from "./storage";
import { authGetOrganizationId, authGetRole, authGetUser, authUsingSupabase } from "./auth.service";
import { canAccessSettings } from "./roles";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import {
  companyGetProfile,
  companyLoadMyOrganization,
  companySaveProfile,
  companySetCompleted
} from "./company.service";
import { invoicesList, invoicesSyncFromRemote } from "./invoices.service";
import { purchasesList, purchasesSyncFromRemote } from "./purchases.service";
import { paymentsList, paymentsSyncFromRemote } from "./payments.service";
import { expensesList, expensesSyncFromRemote } from "./expenses.service";
import { creditNotesList, creditNotesSyncFromRemote } from "./creditNotes.service";
import { salesProformasList, salesProformasSyncFromRemote, purchaseProformasList, purchaseProformasSyncFromRemote } from "./proformas.service";
import { listItemBarcodes, syncItemBarcodesFromRemote } from "./itemBarcodes.service";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { listItems, syncItemsFromRemote } from "../modules/items/store";
import { listCreditNotes } from "../modules/creditNote/store";
import { listDebitNotes } from "../modules/debitNote/store";
import { listPaymentIn } from "../modules/paymentIn/store";
import { listPaymentOut } from "../modules/paymentOut/store";
import {
  getInvoiceTemplateConfig,
  invoiceTemplateIsCompleted,
  setInvoiceTemplateCompleted,
  setInvoiceTemplateConfig
} from "../lib/templateStore";

const BACKUP_SCHEMA_VERSION = 2;
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

function asObject(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

function normalizeError(error) {
  return error?.message || "Unknown sync error";
}

function resolveDataSection(snapshot) {
  const source = asObject(snapshot, {});
  const local = asObject(source.data, null);
  return local || source;
}

function dataCounts(snapshot) {
  const data = resolveDataSection(snapshot);
  return {
    parties: asArray(data.parties).length,
    items: asArray(data.items).length,
    invoices: asArray(data.invoices).length,
    purchases: asArray(data.purchases || data.purchaseBills).length,
    payments: asArray(data.payments).length,
    expenses: asArray(data.expenses).length,
    creditNotes: asArray(data.creditNotesLegacy || data.creditNotes).length,
    creditNotesPremium: asArray(data.creditNotesPremium).length,
    debitNotesPremium: asArray(data.debitNotesPremium).length,
    paymentInPremium: asArray(data.paymentInPremium).length,
    paymentOutPremium: asArray(data.paymentOutPremium).length,
    salesProformas: asArray(data.salesProformas || data.proformaInvoices).length,
    purchaseProformas: asArray(data.purchaseProformas).length,
    itemBarcodes: asArray(data.itemBarcodes).length,
    auditEvents: asArray(data.auditEvents).length
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
    { label: "Credit Notes", run: () => creditNotesSyncFromRemote() },
    { label: "Sales Proformas", run: () => salesProformasSyncFromRemote() },
    { label: "Purchase Proformas", run: () => purchaseProformasSyncFromRemote() },
    { label: "Item Barcodes", run: () => syncItemBarcodesFromRemote() }
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
    itemBarcodes: listItemBarcodes(),
    invoices: invoicesList(),
    purchases: purchasesList(),
    payments: paymentsList(),
    expenses: expensesList(),
    creditNotesLegacy: creditNotesList(),
    creditNotesPremium: listCreditNotes(),
    debitNotesPremium: listDebitNotes(),
    paymentInPremium: listPaymentIn(),
    paymentOutPremium: listPaymentOut(),
    paymentOutLedger: lsGetOrganizationScoped(SUPPORT_KEYS.paymentOutLedger, []),
    paymentOutSequence: lsGetOrganizationScoped(SUPPORT_KEYS.paymentOutSequence, {}),
    salesProformas: salesProformasList(),
    purchaseProformas: purchaseProformasList(),
    invoiceTemplateConfig: getInvoiceTemplateConfig(),
    invoiceTemplateCompleted: invoiceTemplateIsCompleted(),
    supportRequests: lsGet(SUPPORT_KEYS.supportRequests, []),
    notifications: lsGet(LS_KEYS.app_notifications, []),
    activityLogs: lsGet(LS_KEYS.activity_logs, []),
    creditNotifications: lsGetOrganizationScoped(LS_KEYS.credit_notifications, []),
    stockNotifications: lsGetOrganizationScoped(LS_KEYS.stock_notifications, []),
    autoBackupReminder: lsGet(LS_KEYS.auto_backup_reminder, {})
  };
}

function buildLocalSnapshot(options = {}, warnings = []) {
  const user = authGetUser();
  return {
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
      source: "local-export",
      warnings
    },
    data: getSnapshotData()
  };
}

export async function createBackupSnapshot(options = {}) {
  const warnings = options.syncRemote === false ? [] : await syncSourcesFromRemote();
  const snapshot = buildLocalSnapshot(options, warnings);
  return {
    snapshot,
    counts: dataCounts(snapshot),
    warnings
  };
}

export async function createOwnerOrganizationBackup(options = {}) {
  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    throw new Error("Organization is required for owner backup.");
  }
  if (!canAccessSettings(authGetRole())) {
    throw new Error("Only owner can create organization backup.");
  }

  if (!isSupabaseConfigured || !supabase) {
    const fallback = await createBackupSnapshot({ syncRemote: true });
    return {
      ...fallback,
      backupId: "",
      checksumSha256: "",
      generatedAt: fallback.snapshot?.meta?.generatedAt || new Date().toISOString(),
      mode: "local-fallback"
    };
  }

  const { data, error } = await supabase.rpc("create_organization_backup", {
    p_organization_id: organizationId,
    p_reason: String(options.reason || "manual").trim() || "manual",
    p_store_snapshot: options.storeSnapshot !== false
  });

  if (error) {
    throw new Error(normalizeError(error));
  }

  const payload = asObject(data, {});
  const snapshot = asObject(payload.snapshot, null) || asObject(payload, null);
  if (!snapshot) {
    throw new Error("Backup RPC did not return a snapshot.");
  }

  return {
    snapshot,
    counts: dataCounts(snapshot),
    warnings: asArray(snapshot?.meta?.warnings),
    backupId: String(payload.backupId || payload.backup_id || ""),
    checksumSha256: String(payload.checksumSha256 || payload.checksum_sha256 || ""),
    generatedAt: String(payload.generatedAt || payload.generated_at || new Date().toISOString()),
    mode: "remote-owner"
  };
}

export async function listOwnerOrganizationBackups(limit = 20) {
  if (!canAccessSettings(authGetRole())) return [];
  if (!isSupabaseConfigured || !supabase) return [];

  const organizationId = authGetOrganizationId();
  if (!organizationId) return [];

  const safeLimit = Math.min(100, Math.max(1, Number(limit || 20)));
  const { data, error } = await supabase
    .from("organization_backup_runs")
    .select("id,reason,schema_version,checksum_sha256,generated_at,created_by")
    .eq("organization_id", organizationId)
    .order("generated_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(normalizeError(error));
  }

  return asArray(data).map((row) => ({
    id: row?.id || "",
    reason: row?.reason || "manual",
    schemaVersion: Number(row?.schema_version || 1),
    checksumSha256: row?.checksum_sha256 || "",
    generatedAt: row?.generated_at || "",
    createdBy: row?.created_by || ""
  }));
}

export async function fetchOwnerOrganizationBackupSnapshot(backupId) {
  const id = String(backupId || "").trim();
  if (!id) {
    throw new Error("Backup id is required.");
  }
  if (!canAccessSettings(authGetRole())) {
    throw new Error("Only owner can access organization backups.");
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    throw new Error("Organization is required.");
  }

  const { data, error } = await supabase
    .from("organization_backup_runs")
    .select("snapshot")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(normalizeError(error));
  }
  const snapshot = asObject(data?.snapshot, null);
  if (!snapshot) {
    throw new Error("Backup snapshot not found.");
  }
  return snapshot;
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

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Backup format is invalid.");
  }

  return parsed;
}

export function restoreBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Backup format is invalid.");
  }

  const data = snapshot.data;
  if (!data || typeof data !== "object") {
    throw new Error("This backup is not a local restore format. Use local export backup file.");
  }

  if (data.companyProfile) {
    companySaveProfile(data.companyProfile);
    companySetCompleted(true);
  }

  lsSetOrganizationScoped(LS_KEYS.parties, asArray(data.parties));
  lsSetOrganizationScoped(LS_KEYS.items, asArray(data.items));
  lsSetOrganizationScoped(LS_KEYS.item_barcodes, asArray(data.itemBarcodes));
  lsSetOrganizationScoped(LS_KEYS.invoices, asArray(data.invoices));
  lsSetOrganizationScoped(LS_KEYS.purchases, asArray(data.purchases));
  lsSetOrganizationScoped(LS_KEYS.payments, asArray(data.payments));
  lsSetOrganizationScoped(LS_KEYS.expenses, asArray(data.expenses));
  lsSetOrganizationScoped(LS_KEYS.creditNotes, asArray(data.creditNotesLegacy));
  lsSetOrganizationScoped(LS_KEYS.sales_proformas, asArray(data.salesProformas));
  lsSetOrganizationScoped(LS_KEYS.purchase_proformas, asArray(data.purchaseProformas));

  lsSetOrganizationScoped(SUPPORT_KEYS.creditNotesPremium, asArray(data.creditNotesPremium));
  lsSetOrganizationScoped(SUPPORT_KEYS.debitNotesPremium, asArray(data.debitNotesPremium));
  lsSetOrganizationScoped(SUPPORT_KEYS.paymentInPremium, asArray(data.paymentInPremium));
  lsSetOrganizationScoped(SUPPORT_KEYS.paymentOutPremium, asArray(data.paymentOutPremium));
  lsSetOrganizationScoped(SUPPORT_KEYS.paymentOutLedger, asArray(data.paymentOutLedger));
  lsSetOrganizationScoped(SUPPORT_KEYS.paymentOutSequence, data.paymentOutSequence || {});
  lsSetOrganizationScoped(LS_KEYS.credit_notifications, asArray(data.creditNotifications));
  lsSetOrganizationScoped(LS_KEYS.stock_notifications, asArray(data.stockNotifications));

  lsSet(SUPPORT_KEYS.supportRequests, asArray(data.supportRequests));
  lsSet(LS_KEYS.app_notifications, asArray(data.notifications));
  lsSet(LS_KEYS.activity_logs, asArray(data.activityLogs));
  lsSet(LS_KEYS.auto_backup_reminder, asObject(data.autoBackupReminder, {}));

  if (data.invoiceTemplateConfig) {
    setInvoiceTemplateConfig(data.invoiceTemplateConfig);
  }
  setInvoiceTemplateCompleted(!!data.invoiceTemplateCompleted);

  return {
    counts: dataCounts(snapshot),
    restoredAt: new Date().toISOString()
  };
}

export function summarizeBackupCounts(snapshot) {
  return dataCounts(snapshot);
}
