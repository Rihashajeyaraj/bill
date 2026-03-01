import {
  LS_KEYS,
  lsGetOrganizationScoped,
  lsSetOrganizationScoped
} from "../../services/storage";
import { authGetRole } from "../../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../../services/roles";
import { countryCodeFromName, normalizeText, parseNumber, toIsoDate } from "./utils";

const PAYMENT_OUT_STORE_KEY = "paymentOutPremiumV1";
const PAYMENT_OUT_SEQUENCE_KEY = "paymentOutPremiumSequenceV1";
const PAYMENT_OUT_LEDGER_KEY = "paymentOutPremiumLedgerV1";

const DEBIT_NOTES_PREMIUM_KEY = "debitNotesPremiumV1";

const STATUS_FLOW = {
  Draft: ["Paid", "Applied"],
  Paid: ["Applied"],
  Applied: ["Applied"]
};

const COUNTRY_CODE_ALIASES = {
  IN: "IN",
  AE: "AE",
  SG: "SG",
  UK: "UK",
  GB: "UK",
  IE: "IE",
  US: "US",
  USA: "US",
  SL: "SL",
  LK: "SL"
};

const COUNTRY_NAME_TO_CODE = {
  india: "IN",
  uae: "AE",
  "united arab emirates": "AE",
  singapore: "SG",
  uk: "UK",
  "united kingdom": "UK",
  ireland: "IE",
  usa: "US",
  "united states": "US",
  "sri lanka": "SL"
};

function nowIso() {
  return new Date().toISOString();
}

function assertPaymentOutWritePermission({ isEdit = false } = {}) {
  const role = authGetRole();
  if (isEdit) {
    if (!canEditEntries(role)) {
      throw new Error("You do not have permission to edit payment out entries.");
    }
    return;
  }
  if (!canCreateEntries(role)) {
    throw new Error("You do not have permission to create payment out entries.");
  }
}

function assertPaymentOutDeletePermission() {
  const role = authGetRole();
  if (!canDeleteEntries(role)) {
    throw new Error("You do not have permission to delete payment out entries.");
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCountry(value) {
  if (!value) return "";
  const clean = String(value).trim();
  if (!clean) return "";
  const upper = clean.toUpperCase();
  if (COUNTRY_CODE_ALIASES[upper]) return COUNTRY_CODE_ALIASES[upper];
  const mapped = COUNTRY_NAME_TO_CODE[clean.toLowerCase()];
  if (mapped) return mapped;
  if (clean.length === 2) return upper;
  return clean;
}

function getAllPayments() {
  return ensureArray(lsGetOrganizationScoped(PAYMENT_OUT_STORE_KEY, []));
}

function setAllPayments(list) {
  lsSetOrganizationScoped(PAYMENT_OUT_STORE_KEY, list);
}

function getLedgerEntries() {
  return ensureArray(lsGetOrganizationScoped(PAYMENT_OUT_LEDGER_KEY, []));
}

function setLedgerEntries(list) {
  lsSetOrganizationScoped(PAYMENT_OUT_LEDGER_KEY, list);
}

function getSequenceStore() {
  return lsGetOrganizationScoped(PAYMENT_OUT_SEQUENCE_KEY, {});
}

function setSequenceStore(value) {
  lsSetOrganizationScoped(PAYMENT_OUT_SEQUENCE_KEY, value);
}

function inferSequence(country, list) {
  const prefix = `PO-${countryCodeFromName(country)}-`;
  return list
    .filter((note) => note.paymentNo?.startsWith(prefix))
    .reduce((max, note) => {
      const chunk = String(note.paymentNo || "").replace(prefix, "");
      const n = Number(chunk);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
}

function nextPaymentNumber(country) {
  const list = getAllPayments();
  const store = getSequenceStore();
  const key = normalizeCountry(country) || "GLOBAL";
  const inferred = inferSequence(country, list);
  const current = Math.max(store[key] || 0, inferred);
  const next = current + 1;
  setSequenceStore({ ...store, [key]: next });
  return `PO-${countryCodeFromName(country)}-${String(next).padStart(5, "0")}`;
}

function ensureTransition(previous, next) {
  const allowed = STATUS_FLOW[previous] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid status transition: ${previous} -> ${next}`);
  }
}

function computeTotals(payload) {
  const amountPaid = Math.max(0, parseNumber(payload.amountPaid));
  const allocations = payload.allocations.map((line) => ({
    ...line,
    billAmount: Math.max(0, parseNumber(line.billAmount)),
    balanceDue: Math.max(0, parseNumber(line.balanceDue)),
    applyAmount: Math.max(0, parseNumber(line.applyAmount))
  }));

  allocations.forEach((line) => {
    if (line.applyAmount > line.balanceDue) {
      throw new Error(`Applied amount exceeds balance due for ${line.billNo}.`);
    }
  });

  const amountApplied = allocations.reduce((sum, line) => sum + line.applyAmount, 0);
  if (amountApplied > amountPaid) {
    throw new Error("Applied amount cannot exceed amount paid.");
  }

  const supplierOutstandingBefore = Math.max(0, parseNumber(payload.supplierOutstandingBefore));
  const unappliedAmount = Math.max(0, amountPaid - amountApplied);
  const supplierOutstandingAfter = Math.max(0, supplierOutstandingBefore - amountApplied);

  return {
    allocations,
    totals: {
      amountPaid,
      amountApplied,
      unappliedAmount,
      supplierOutstandingBefore,
      supplierOutstandingAfter
    }
  };
}

function appliedPaymentOutForBill(billId) {
  if (!billId) return 0;
  const legacy = ensureArray(lsGetOrganizationScoped(LS_KEYS.payments, []))
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "OUT")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PO:"))
    .filter((entry) => String(entry?.billId || entry?.bill_id || "") === String(billId))
    .reduce((sum, entry) => sum + Math.max(0, parseNumber(entry?.amount)), 0);

  const premium = getAllPayments()
    .filter((entry) => String(entry?.status || "") === "Applied")
    .reduce(
      (sum, entry) =>
        sum +
        ensureArray(entry?.allocations)
          .filter((line) => String(line?.billId || "") === String(billId))
          .reduce((lineSum, line) => lineSum + Math.max(0, parseNumber(line?.applyAmount)), 0),
      0
    );

  return legacy + premium;
}

function appliedDebitForBill(billId) {
  if (!billId) return 0;
  return ensureArray(lsGetOrganizationScoped(DEBIT_NOTES_PREMIUM_KEY, []))
    .filter((entry) => String(entry?.status || "") === "Applied")
    .filter((entry) => String(entry?.linkedPurchaseInvoiceId || "") === String(billId))
    .reduce((sum, entry) => sum + Math.max(0, parseNumber(entry?.totals?.total)), 0);
}

function postLedgerEntry(note, actor) {
  if (note.status === "Draft") return;
  const ledger = getLedgerEntries();
  const alreadyPosted = ledger.some((entry) => entry.noteId === note.id && entry.status === note.status);
  if (alreadyPosted) return;

  const entry = {
    id: `plg_${Date.now().toString(16)}`,
    noteId: note.id,
    country: note.country,
    supplierId: note.supplierId,
    supplierName: note.supplierName,
    account: "Accounts Payable",
    amountPaid: note.totals.amountPaid,
    amountApplied: note.totals.amountApplied,
    unappliedAmount: note.totals.unappliedAmount,
    status: note.status,
    postedBy: actor,
    postedAt: nowIso()
  };
  setLedgerEntries([entry, ...ledger]);
}

export function listPaymentOut(country) {
  const list = getAllPayments();
  if (!country) return list;
  return list.filter((entry) => normalizeCountry(entry.country) === normalizeCountry(country));
}

export function getPaymentOut(id) {
  return getAllPayments().find((entry) => entry.id === id) || null;
}

export function listPaymentOutLedger(country) {
  const ledger = getLedgerEntries();
  if (!country) return ledger;
  return ledger.filter((entry) => normalizeCountry(entry.country) === normalizeCountry(country));
}

export function mapSuppliersByCountry(country) {
  const target = normalizeCountry(country);
  const parties = ensureArray(lsGetOrganizationScoped(LS_KEYS.parties, []));

  const fromParties = parties
    .map((party) => {
      const type = String(party?.type || "").toLowerCase();
      if (type !== "supplier") return null;
      return {
        id: party.id,
        name: party.name,
        email: party.email || "",
        phone: party.phone || "",
        address: party.address || "",
        state: party.state || "",
        country: normalizeCountry(party.country) || target || ""
      };
    })
    .filter(Boolean);

  const byId = new Map();
  fromParties.forEach((entry) => {
    if (!entry?.id || !entry.name) return;
    const existing = byId.get(entry.id);
    byId.set(entry.id, { ...(existing || {}), ...entry });
  });

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function mapOpenBillsByCountry(country) {
  const target = normalizeCountry(country);
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));

  return purchases
    .map((bill) => {
      const mapped = normalizeCountry(bill?.country);
      if (mapped && target && mapped !== target) return null;
      const billAmount = parseNumber(
        bill?.totals?.finalTotal ??
          bill?.totals?.grandTotal ??
          bill?.totals?.total ??
          bill?.totals?.subTotal ??
          bill?.grandTotal ??
          bill?.total
      );
      const paymentApplied = appliedPaymentOutForBill(bill?.id);
      const debitApplied = appliedDebitForBill(bill?.id);
      const storedBalance = Math.max(
        0,
        parseNumber(
          bill?.totals?.balance ??
            bill?.remainingBalance ??
            bill?.totals?.grandTotal ??
            bill?.totals?.total ??
            bill?.totals?.finalTotal
        )
      );
      const hasLinkedActivity = paymentApplied > 0 || debitApplied > 0;
      const balanceDue = Math.max(
        0,
        hasLinkedActivity ? billAmount - debitApplied - paymentApplied : storedBalance
      );
      if (balanceDue <= 0) return null;
      return {
        id: bill.id,
        billNo: bill.billNumber || bill.invoiceNo || bill.id,
        billDate: bill.billDate || bill.invoiceDate || bill.date || "",
        country: target || bill.country || "",
        supplierId: bill.partyId || bill.supplierId || bill.vendorId || bill.partyName || "unknown_supplier",
        supplierName: bill.partyName || bill.supplierName || bill.vendorName || "Supplier",
        billAmount,
        balanceDue
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.billDate < b.billDate ? 1 : -1));
}

export function outstandingBySupplier(country, supplierId) {
  if (!supplierId) return 0;
  return mapOpenBillsByCountry(country)
    .filter((bill) => String(bill.supplierId) === String(supplierId))
    .reduce((sum, bill) => sum + parseNumber(bill.balanceDue), 0);
}

export function savePaymentOut(payload) {
  assertPaymentOutWritePermission({ isEdit: !!payload?.id });
  const list = getAllPayments();
  const existing = payload.id ? list.find((entry) => entry.id === payload.id) : undefined;
  if (existing && String(existing.supplierId) !== String(payload.supplierId)) {
    throw new Error("Supplier cannot be changed for an existing payment.");
  }

  const existingAppliedByBill = new Map();
  ensureArray(existing?.allocations).forEach((line) => {
    const billId = String(line?.billId || "");
    if (!billId) return;
    const current = existingAppliedByBill.get(billId) || 0;
    existingAppliedByBill.set(billId, current + Math.max(0, parseNumber(line?.applyAmount)));
  });

  const openBills = mapOpenBillsByCountry(payload.country).filter(
    (bill) => String(bill.supplierId) === String(payload.supplierId)
  );
  const openBillMap = new Map(openBills.map((bill) => [String(bill.id), bill]));
  payload.allocations.forEach((line) => {
    if (parseNumber(line?.applyAmount) <= 0) return;
    const billId = String(line?.billId || "");
    const linked = openBillMap.get(billId);
    const existingApplied = existingAppliedByBill.get(billId) || 0;
    const maxAllowed = Math.max(0, parseNumber(linked?.balanceDue) + existingApplied);
    if (!linked && existingApplied <= 0) {
      throw new Error(`Bill ${line?.billNo || line?.billId || ""} is not valid for selected supplier.`);
    }
    if (parseNumber(line?.applyAmount) > maxAllowed) {
      const billNo = linked?.billNo || line?.billNo || billId;
      throw new Error(`Applied amount exceeds live balance due for ${billNo}.`);
    }
  });

  const now = nowIso();
  const previousStatus = existing?.status || "Draft";
  const nextStatus = payload.desiredStatus;
  ensureTransition(previousStatus, nextStatus);

  const calculated = computeTotals(payload);
  const paymentNo = existing?.paymentNo || nextPaymentNumber(payload.country);
  const id = existing?.id || `pout_${Date.now().toString(16)}`;

  const note = {
    id,
    country: payload.country,
    paymentNo,
    paymentDate: payload.paymentDate,
    supplierId: payload.supplierId,
    supplierName: payload.supplierName,
    currency: payload.currency || "",
    paymentMode: payload.paymentMode,
    referenceNo: payload.referenceNo || "",
    chequeNo: payload.chequeNo || "",
    bankName: payload.bankName || "",
    transactionId: payload.transactionId || "",
    paymentReference: payload.paymentReference || "",
    internalNotes: payload.internalNotes || "",
    attachment: payload.attachment || null,
    status: nextStatus,
    allocations: calculated.allocations,
    totals: calculated.totals,
    audit: {
      createdBy: existing?.audit?.createdBy || payload.actor,
      createdAt: existing?.audit?.createdAt || now,
      modifiedBy: payload.actor,
      modifiedAt: now
    },
    history: [
      ...(existing?.history || []),
      { status: nextStatus, at: now, by: payload.actor, note: `Status moved to ${nextStatus}` }
    ]
  };

  postLedgerEntry(note, payload.actor);
  const next = existing ? list.map((entry) => (entry.id === existing.id ? note : entry)) : [note, ...list];
  setAllPayments(next);
  return note;
}

export function removePaymentOut(id) {
  assertPaymentOutDeletePermission();
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    throw new Error("Payment out id is required.");
  }
  const list = getAllPayments();
  const existing = list.find((entry) => String(entry?.id || "") === normalizedId);
  if (!existing) {
    throw new Error("Payment out record not found.");
  }
  if (String(existing?.status || "") === "Applied") {
    throw new Error("Applied payment out records cannot be deleted.");
  }
  setAllPayments(list.filter((entry) => String(entry?.id || "") !== normalizedId));
  setLedgerEntries(getLedgerEntries().filter((entry) => String(entry?.noteId || "") !== normalizedId));
  return existing;
}

export function summarizePaymentOut(country) {
  const list = listPaymentOut(country);
  const totalPaid = list.reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountPaid), 0);
  const totalUnapplied = list.reduce((sum, entry) => sum + parseNumber(entry?.totals?.unappliedAmount), 0);
  return {
    count: list.length,
    totalPaid,
    totalUnapplied
  };
}

export function allocationsFromBills(bills) {
  return bills.map((bill) => ({
    billId: bill.id,
    billNo: bill.billNo,
    billDate: bill.billDate,
    billAmount: bill.billAmount,
    balanceDue: bill.balanceDue,
    applyAmount: 0
  }));
}

export function updateAllocationAmount(allocations, billId, nextAmount, maxAllowed) {
  return allocations.map((line) => {
    if (line.billId !== billId) return line;
    const capped = Math.min(Math.max(0, parseNumber(nextAmount)), maxAllowed, line.balanceDue);
    return { ...line, applyAmount: capped };
  });
}

export function buildPaymentOutPayload(form, supplierOutstandingBefore, actor) {
  return {
    id: form.id,
    country: form.country,
    paymentDate: form.paymentDate,
    supplierId: form.supplierId,
    supplierName: form.supplierName,
    currency: form.currency,
    paymentMode: form.paymentMode,
    referenceNo: form.referenceNo,
    chequeNo: form.chequeNo,
    bankName: form.bankName,
    transactionId: form.transactionId,
    paymentReference: form.paymentReference,
    internalNotes: form.internalNotes,
    attachment: form.attachment,
    desiredStatus: form.desiredStatus,
    amountPaid: form.amountPaid,
    allocations: form.allocations,
    supplierOutstandingBefore,
    actor
  };
}

export function defaultPaymentForm(country, currency) {
  return {
    id: "",
    country,
    currency: currency || "",
    paymentDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    paymentMode: "Cash",
    referenceNo: "",
    chequeNo: "",
    bankName: "",
    transactionId: "",
    paymentReference: "",
    internalNotes: "",
    attachment: null,
    amountPaid: 0,
    allocations: [],
    desiredStatus: "Draft"
  };
}
