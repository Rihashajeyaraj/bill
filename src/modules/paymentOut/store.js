import { LS_KEYS, lsGet, lsSet } from "../../services/storage";
import { countryCodeFromName, normalizeText, parseNumber, toIsoDate } from "./utils";

const PAYMENT_OUT_STORE_KEY = "paymentOutPremiumV1";
const PAYMENT_OUT_SEQUENCE_KEY = "paymentOutPremiumSequenceV1";
const PAYMENT_OUT_LEDGER_KEY = "paymentOutPremiumLedgerV1";

const DEBIT_NOTES_PREMIUM_KEY = "debitNotesPremiumV1";
const CREDIT_NOTES_PREMIUM_KEY = "creditNotesPremiumV1";

const STATUS_FLOW = {
  Draft: ["Paid", "Applied"],
  Paid: ["Applied"],
  Applied: ["Applied"]
};

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCountry(value) {
  if (!value) return "";
  const clean = String(value).trim();
  if (!clean) return "";
  if (clean.length === 2) return clean.toUpperCase();
  return clean;
}

function getAllPayments() {
  return ensureArray(lsGet(PAYMENT_OUT_STORE_KEY, []));
}

function setAllPayments(list) {
  lsSet(PAYMENT_OUT_STORE_KEY, list);
}

function getLedgerEntries() {
  return ensureArray(lsGet(PAYMENT_OUT_LEDGER_KEY, []));
}

function setLedgerEntries(list) {
  lsSet(PAYMENT_OUT_LEDGER_KEY, list);
}

function getSequenceStore() {
  return lsGet(PAYMENT_OUT_SEQUENCE_KEY, {});
}

function setSequenceStore(value) {
  lsSet(PAYMENT_OUT_SEQUENCE_KEY, value);
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

  const unappliedAmount = Math.max(0, amountPaid - amountApplied);
  const supplierOutstandingAfter = parseNumber(payload.supplierOutstandingBefore) - amountApplied;

  return {
    allocations,
    totals: {
      amountPaid,
      amountApplied,
      unappliedAmount,
      supplierOutstandingBefore: parseNumber(payload.supplierOutstandingBefore),
      supplierOutstandingAfter
    }
  };
}

function adjustBillsBalance(allocations, direction) {
  const purchases = ensureArray(lsGet(LS_KEYS.purchases, []));
  if (!purchases.length) return;

  const applyMap = new Map();
  allocations.forEach((line) => {
    const amount = parseNumber(line.applyAmount);
    if (amount > 0) applyMap.set(line.billId, amount);
  });

  if (!applyMap.size) return;

  const next = purchases.map((bill) => {
    const applyAmount = applyMap.get(bill.id) || 0;
    if (!applyAmount) return bill;
    const currentBalance = Math.max(
      0,
      parseNumber(
        bill?.totals?.balance ??
          bill?.remainingBalance ??
          bill?.totals?.grandTotal ??
          bill?.totals?.total ??
          bill?.totals?.finalTotal
      )
    );
    const nextBalance =
      direction === "apply"
        ? Math.max(0, currentBalance - applyAmount)
        : Math.max(0, currentBalance + applyAmount);
    return {
      ...bill,
      remainingBalance: nextBalance,
      totals: { ...(bill.totals || {}), balance: nextBalance },
      updated_at: nowIso()
    };
  });

  lsSet(LS_KEYS.purchases, next);
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
  const parties = ensureArray(lsGet(LS_KEYS.parties, []));
  const purchases = ensureArray(lsGet(LS_KEYS.purchases, []));

  const fromParties = parties
    .map((party) => {
      const type = String(party?.type || "").toLowerCase();
      if (type && type !== "supplier") return null;
      const mapped = normalizeCountry(party.country);
      if (mapped && target && mapped !== target) return null;
      return {
        id: party.id,
        name: party.name,
        email: party.email || "",
        state: party.state || "",
        country: target || party.country || ""
      };
    })
    .filter(Boolean);

  const fromBills = purchases.map((bill) => ({
    id: bill.partyId || bill.supplierId || bill.vendorId || bill.partyName || bill.supplierName,
    name: bill.partyName || bill.supplierName || bill.vendorName || "Supplier",
    country: target || bill.country || ""
  }));

  const byId = new Map();
  [...fromParties, ...fromBills].forEach((entry) => {
    if (!entry?.id || !entry.name) return;
    const existing = byId.get(entry.id);
    byId.set(entry.id, { ...(existing || {}), ...entry });
  });

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function mapOpenBillsByCountry(country) {
  const target = normalizeCountry(country);
  const purchases = ensureArray(lsGet(LS_KEYS.purchases, []));

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
      const balanceDue = Math.max(
        0,
        parseNumber(
          bill?.totals?.balance ??
            bill?.remainingBalance ??
            bill?.totals?.grandTotal ??
            bill?.totals?.total ??
            bill?.totals?.finalTotal
        )
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
  const purchases = ensureArray(lsGet(LS_KEYS.purchases, []))
    .filter((bill) => {
      const mapped = normalizeCountry(bill?.country);
      if (country && mapped && mapped !== normalizeCountry(country)) return false;
      const id = bill.partyId || bill.supplierId || bill.vendorId || bill.partyName;
      return String(id) === String(supplierId);
    })
    .reduce((sum, bill) => {
      const total = parseNumber(
        bill?.totals?.finalTotal ??
          bill?.totals?.grandTotal ??
          bill?.totals?.total ??
          bill?.totals?.subTotal ??
          bill?.grandTotal ??
          bill?.total
      );
      return sum + total;
    }, 0);

  const payments = listPaymentOut(country)
    .filter((entry) => entry.supplierId === supplierId && entry.status !== "Draft")
    .reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountPaid), 0);

  const debitNotes = ensureArray(lsGet(DEBIT_NOTES_PREMIUM_KEY, []))
    .filter((entry) => entry?.status === "Applied" && String(entry?.supplierId) === String(supplierId))
    .reduce((sum, entry) => sum + parseNumber(entry?.totals?.total), 0);

  const creditNotes = ensureArray(lsGet(CREDIT_NOTES_PREMIUM_KEY, []))
    .filter((entry) => entry?.status === "Applied" && String(entry?.supplierId) === String(supplierId))
    .reduce((sum, entry) => sum + parseNumber(entry?.totals?.total), 0);

  return purchases - payments - debitNotes + creditNotes;
}

export function savePaymentOut(payload) {
  const list = getAllPayments();
  const existing = payload.id ? list.find((entry) => entry.id === payload.id) : undefined;
  const now = nowIso();
  const previousStatus = existing?.status || "Draft";
  const nextStatus = payload.desiredStatus;
  ensureTransition(previousStatus, nextStatus);

  const calculated = computeTotals(payload);
  const paymentNo = existing?.paymentNo || nextPaymentNumber(payload.country);
  const id = existing?.id || `pout_${Date.now().toString(16)}`;

  if (previousStatus === "Applied" && nextStatus !== "Applied" && existing) {
    adjustBillsBalance(existing.allocations, "revert");
  }

  if (nextStatus === "Applied" && previousStatus !== "Applied") {
    adjustBillsBalance(calculated.allocations, "apply");
  }

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
