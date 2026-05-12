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

function getLegacyPayments() {
  const legacy = ensureArray(lsGetOrganizationScoped(LS_KEYS.payments, []));
  return legacy
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "OUT")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PO:"))
    .map((entry, index) => {
      const amountPaid = Math.max(0, parseNumber(entry?.amountPaid ?? entry?.amount));
      const tdsAmount = Math.max(0, parseNumber(entry?.tdsAmount ?? entry?.tds_amount));
      const totalSettled = amountPaid + tdsAmount;
      const applyAmount = Math.max(0, parseNumber(entry?.appliedAmount ?? entry?.amountApplied ?? entry?.amount));
      const billId = String(entry?.billId || entry?.bill_id || "").trim();
      const billNo = String(entry?.billNo || entry?.bill_no || billId || "").trim();
      return {
        id: `legacy_po_${String(entry?.id || entry?.paymentNo || entry?.referenceNo || index + 1)}`,
        country: normalizeCountry(entry?.country) || "IN",
        paymentNo: String(entry?.paymentNo || entry?.referenceNo || `LEGACY-PO-${index + 1}`),
        paymentDate: String(entry?.paymentDate || entry?.payment_date || entry?.date || "").trim(),
        supplierId: String(entry?.partyId || entry?.party_id || entry?.supplierId || entry?.supplier_id || "").trim(),
        supplierName: String(entry?.partyName || entry?.supplierName || entry?.supplier_name || "Supplier"),
        currency: String(entry?.currency || ""),
        paymentMode: normalizePaymentMode(entry?.mode || entry?.paymentMode || entry?.payment_mode),
        referenceNo: String(entry?.referenceNo || entry?.reference_no || ""),
        chequeNo: String(entry?.chequeNo || entry?.cheque_no || ""),
        bankName: String(entry?.bankName || entry?.bank_name || ""),
        transactionId: String(entry?.transactionId || entry?.transaction_id || ""),
        paymentReference: String(entry?.paymentReference || ""),
        internalNotes: String(entry?.note || entry?.notes || ""),
        attachment: null,
        status: String(entry?.status || "").toLowerCase() === "applied" ? "Applied" : String(entry?.status || "").toLowerCase() === "paid" ? "Paid" : "Draft",
        allocations: billId
          ? [
              {
                billId,
                billNo: billNo || billId,
                billDate: String(entry?.billDate || entry?.bill_date || ""),
                billAmount: totalSettled,
                balanceDue: totalSettled,
                applyAmount
              }
            ]
          : [],
        totals: {
          amountPaid,
          tdsAmount,
          totalSettled,
          amountApplied: applyAmount,
          unappliedAmount: Math.max(0, totalSettled - applyAmount)
        },
        audit: {
          createdBy: String(entry?.createdBy || "Legacy Import"),
          createdAt: String(entry?.created_at || nowIso()),
          modifiedBy: String(entry?.modifiedBy || entry?.createdBy || "Legacy Import"),
          modifiedAt: String(entry?.modifiedAt || entry?.created_at || nowIso())
        },
        history: [
          {
            status: String(entry?.status || "").toLowerCase() === "applied" ? "Applied" : String(entry?.status || "").toLowerCase() === "paid" ? "Paid" : "Draft",
            at: String(entry?.created_at || nowIso()),
            by: String(entry?.createdBy || "Legacy Import"),
            note: "Imported from legacy payments"
          }
        ]
      };
    });
}

function getMergedPayments() {
  return [...getAllPayments(), ...getLegacyPayments()].sort((a, b) => {
    const left = String(a?.paymentDate || a?.audit?.modifiedAt || "");
    const right = String(b?.paymentDate || b?.audit?.modifiedAt || "");
    if (left !== right) return right.localeCompare(left);
    return String(b?.paymentNo || "").localeCompare(String(a?.paymentNo || ""));
  });
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

export function paymentOutAllocationTdsShare(record, line) {
  const totalTdsAmount = Math.max(0, parseNumber(record?.totals?.tdsAmount));
  if (totalTdsAmount <= 0) return 0;

  const allocations = ensureArray(record?.allocations);
  const positiveAllocations = allocations.filter((entry) => Math.max(0, parseNumber(entry?.applyAmount)) > 0);
  if (!positiveAllocations.length) return 0;

  const totalApplied = positiveAllocations.reduce(
    (sum, entry) => sum + Math.max(0, parseNumber(entry?.applyAmount)),
    0
  );
  const lineBillId = String(line?.billId || "").trim();
  const positiveIndex = positiveAllocations.findIndex(
    (entry) => String(entry?.billId || "").trim() === lineBillId
  );
  if (positiveIndex < 0) return 0;

  const appliedAmount = Math.max(0, parseNumber(line?.applyAmount));
  if (appliedAmount <= 0 || totalApplied <= 0) return 0;

  if (positiveAllocations.length === 1) {
    return totalTdsAmount;
  }

  const rawShare = (appliedAmount / totalApplied) * totalTdsAmount;
  if (positiveIndex === positiveAllocations.length - 1) {
    const allocatedBefore = positiveAllocations
      .slice(0, positiveIndex)
      .reduce((sum, entry) => sum + paymentOutAllocationTdsShare(record, entry), 0);
    return Math.max(0, totalTdsAmount - allocatedBefore);
  }

  return Math.max(0, Number(rawShare.toFixed(2)));
}

export function paymentOutAllocationSettledAmount(record, line) {
  return Math.max(0, parseNumber(line?.applyAmount)) + paymentOutAllocationTdsShare(record, line);
}

export function listBillTdsHistory(country, billId) {
  const normalizedBillId = String(billId || "").trim();
  if (!normalizedBillId) return [];

  return listPaymentOut(country)
    .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
    .flatMap((entry) => {
      const allocations = ensureArray(entry?.allocations);
      return allocations
        .filter((line) => String(line?.billId || "").trim() === normalizedBillId)
        .map((line) => {
          const tdsAmount = paymentOutAllocationTdsShare(entry, line);
          if (tdsAmount <= 0) return null;
          return {
            paymentId: entry?.id || "",
            paymentNo: entry?.paymentNo || "",
            billId: normalizedBillId,
            billNo: line?.billNo || "",
            supplierId: entry?.supplierId || "",
            supplierName: entry?.supplierName || "",
            date: entry?.paymentDate || "",
            tdsAmount,
            tdsRate: Math.max(0, parseNumber(entry?.tdsRate)),
            category: entry?.tdsCategory || ""
          };
        })
        .filter(Boolean);
    })
    .sort((left, right) => {
      const leftDate = String(left?.date || "");
      const rightDate = String(right?.date || "");
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right?.paymentNo || "").localeCompare(String(left?.paymentNo || ""));
    });
}

export function summarizeBillTdsByBill(country) {
  return listPaymentOut(country)
    .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
    .reduce((map, entry) => {
      const allocations = ensureArray(entry?.allocations);
      allocations.forEach((line) => {
        const billId = String(line?.billId || "").trim();
        if (!billId) return;
        const tdsAmount = paymentOutAllocationTdsShare(entry, line);
        if (tdsAmount <= 0) return;

        const existing = map[billId] || {
          billId,
          billNo: line?.billNo || "",
          supplierId: entry?.supplierId || "",
          supplierName: entry?.supplierName || "",
          lastTdsDate: "",
          totalTdsAmount: 0,
          entriesCount: 0
        };
        const paymentDate = String(entry?.paymentDate || "").trim();

        map[billId] = {
          ...existing,
          billNo: existing.billNo || line?.billNo || "",
          supplierId: existing.supplierId || entry?.supplierId || "",
          supplierName: existing.supplierName || entry?.supplierName || "",
          lastTdsDate:
            paymentDate && (!existing.lastTdsDate || paymentDate > existing.lastTdsDate)
              ? paymentDate
              : existing.lastTdsDate,
          totalTdsAmount: Math.max(0, parseNumber(existing.totalTdsAmount)) + tdsAmount,
          entriesCount: Math.max(0, parseNumber(existing.entriesCount)) + 1
        };
      });
      return map;
    }, {});
}

export function listSupplierTdsHistory(country, supplierId) {
  const normalizedSupplierId = String(supplierId || "").trim();
  if (!normalizedSupplierId) return [];

  return listPaymentOut(country)
    .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
    .filter((entry) => String(entry?.supplierId || "").trim() === normalizedSupplierId)
    .flatMap((entry) =>
      ensureArray(entry?.allocations)
        .map((line, index) => {
          const tdsAmount = paymentOutAllocationTdsShare(entry, line);
          if (tdsAmount <= 0) return null;
          return {
            id: `supplier_tds_${entry?.id || entry?.paymentNo || "payment"}_${line?.billId || index}`,
            date: entry?.paymentDate || "",
            paymentNo: entry?.paymentNo || "",
            supplierId: normalizedSupplierId,
            supplierName: entry?.supplierName || "Supplier",
            billId: line?.billId || "",
            billNo: line?.billNo || "",
            tdsRate: Math.max(0, parseNumber(entry?.tdsRate)),
            tdsAmount,
            finalPaidAmount: Math.max(0, parseNumber(line?.applyAmount))
          };
        })
        .filter(Boolean)
    )
    .sort((left, right) => {
      const leftDate = String(left?.date || "");
      const rightDate = String(right?.date || "");
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right?.paymentNo || "").localeCompare(String(left?.paymentNo || ""));
    });
}

function computeTotals(payload) {
  const amountPaid = Math.max(0, parseNumber(payload.amountPaid));
  const tdsAmount = Math.max(0, parseNumber(payload.tdsAmount));
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
  if (tdsAmount > amountPaid) {
    throw new Error("TDS amount cannot exceed amount paid.");
  }

  const supplierOutstandingBefore = Math.max(0, parseNumber(payload.supplierOutstandingBefore));
  const totalSettled = amountPaid + tdsAmount;
  const unappliedAmount = Math.max(0, amountPaid - amountApplied);
  const supplierOutstandingAfter = Math.max(0, supplierOutstandingBefore - totalSettled);

  return {
    allocations,
    totals: {
      amountPaid,
      tdsAmount,
      totalSettled,
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
    .reduce(
      (sum, entry) =>
        sum +
        Math.max(0, parseNumber(entry?.amount)) +
        Math.max(0, parseNumber(entry?.tdsAmount || entry?.tds_amount)),
      0
    );

  const premium = getAllPayments()
    .filter((entry) => String(entry?.status || "") === "Applied")
    .reduce(
      (sum, entry) =>
        sum +
        ensureArray(entry?.allocations)
          .filter((line) => String(line?.billId || "") === String(billId))
          .reduce((lineSum, line) => lineSum + paymentOutAllocationSettledAmount(entry, line), 0),
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
    tdsAmount: note.totals.tdsAmount,
    totalSettled: note.totals.totalSettled,
    amountApplied: note.totals.amountApplied,
    unappliedAmount: note.totals.unappliedAmount,
    status: note.status,
    postedBy: actor,
    postedAt: nowIso()
  };
  setLedgerEntries([entry, ...ledger]);
}

export function listPaymentOut(country) {
  const list = getMergedPayments();
  if (!country) return list;
  return list.filter((entry) => normalizeCountry(entry.country) === normalizeCountry(country));
}

export function getPaymentOut(id) {
  return getMergedPayments().find((entry) => entry.id === id) || null;
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

function rawAdvanceWalletBySupplier(country, supplierId) {
  if (!supplierId) return 0;
  return listPaymentOut(country)
    .filter((entry) => String(entry?.supplierId || "") === String(supplierId))
    .filter((entry) => String(entry?.status || "") !== "Draft")
    .reduce((sum, entry) => sum + parseNumber(entry?.totals?.unappliedAmount), 0);
}

function mapOpenBillsByCountryInternal(country, { applyAdvance = true, includeCoveredByAdvance = false } = {}) {
  const target = normalizeCountry(country);
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));

  const baseBills = purchases
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
      const taxableAmount = Math.max(
        0,
        parseNumber(bill?.totals?.subTotal ?? bill?.totals?.taxableTotal ?? billAmount)
      );
      const taxAmount = Math.max(
        0,
        parseNumber(bill?.totals?.taxTotal ?? bill?.totals?.taxAmount ?? billAmount - taxableAmount)
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
        supplierState: bill?.partyState || bill?.vendorState || bill?.supplierState || "",
        billAmount,
        taxableAmount,
        taxAmount,
        taxBreakup:
          bill?.totals?.taxBreakup && typeof bill.totals.taxBreakup === "object"
            ? bill.totals.taxBreakup
            : bill?.taxBreakup && typeof bill.taxBreakup === "object"
              ? bill.taxBreakup
              : null,
        supplyType:
          bill?.supplyType ||
          bill?.totals?.tax?.supplyType ||
          bill?.totals?.taxBreakup?.supplyType ||
          null,
        balanceDue
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.billDate < b.billDate ? 1 : -1));

  if (!applyAdvance) {
    return baseBills;
  }

  const billsBySupplier = new Map();
  baseBills.forEach((bill) => {
    const supplierId = String(bill?.supplierId || "").trim();
    if (!supplierId) return;
    const list = billsBySupplier.get(supplierId) || [];
    list.push({ ...bill });
    billsBySupplier.set(supplierId, list);
  });

  const adjustedBills = [];
  billsBySupplier.forEach((bills, supplierId) => {
    let remainingAdvance = Math.max(0, rawAdvanceWalletBySupplier(country, supplierId));
    const sortedBills = [...bills].sort((left, right) => {
      const leftDate = String(left?.billDate || "");
      const rightDate = String(right?.billDate || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return String(left?.billNo || "").localeCompare(String(right?.billNo || ""));
    });

    sortedBills.forEach((bill) => {
      const baseBalance = Math.max(0, parseNumber(bill?.balanceDue));
      const adjustedBalance = Math.max(0, baseBalance - remainingAdvance);
      const consumedAdvance = Math.min(baseBalance, remainingAdvance);
      remainingAdvance = Math.max(0, remainingAdvance - consumedAdvance);
      if (adjustedBalance <= 0 && !includeCoveredByAdvance) return;
      adjustedBills.push({
        ...bill,
        originalBalanceDue: baseBalance,
        balanceDue: adjustedBalance,
        advanceConsumed: consumedAdvance,
        coveredByAdvance: consumedAdvance > 0,
        fullyCoveredByAdvance: adjustedBalance <= 0
      });
    });
  });

  return adjustedBills.sort((a, b) => (a.billDate < b.billDate ? 1 : -1));
}

export function mapOpenBillsByCountry(country) {
  return mapOpenBillsByCountryInternal(country, { applyAdvance: true });
}

export function mapBillsByCountryForSelection(country) {
  return mapOpenBillsByCountryInternal(country, {
    applyAdvance: true,
    includeCoveredByAdvance: true
  });
}

export function outstandingBySupplier(country, supplierId) {
  if (!supplierId) return 0;
  return mapOpenBillsByCountry(country)
    .filter((bill) => String(bill.supplierId) === String(supplierId))
    .reduce((sum, bill) => sum + parseNumber(bill.balanceDue), 0);
}

export function paymentInsightsBySupplier(country, supplierId) {
  if (!supplierId) {
    return {
      lastPaymentDate: "",
      advanceWallet: 0,
      totalPaid: 0,
      paymentCount: 0
    };
  }

  const records = listPaymentOut(country).filter((entry) => String(entry?.supplierId || "") === String(supplierId));
  const sorted = [...records].sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1));
  const rawAdvanceWallet = rawAdvanceWalletBySupplier(country, supplierId);
  const rawOutstandingBeforeAdvance = mapOpenBillsByCountryInternal(country, { applyAdvance: false })
    .filter((bill) => String(bill.supplierId || "") === String(supplierId))
    .reduce((sum, bill) => sum + parseNumber(bill.balanceDue), 0);

  return {
    lastPaymentDate: sorted[0]?.paymentDate || "",
    advanceWallet: Math.max(0, rawAdvanceWallet - rawOutstandingBeforeAdvance),
    totalPaid: records
      .filter((entry) => String(entry?.status || "") !== "Draft")
      .reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountPaid), 0),
    paymentCount: records.length
  };
}

function round2(value) {
  return Math.round((parseNumber(value) + Number.EPSILON) * 100) / 100;
}

export function listSupplierAdvanceWalletHistory(country, supplierId) {
  const normalizedSupplierId = String(supplierId || "").trim();
  if (!normalizedSupplierId) return [];

  const events = [];

  listPaymentOut(country)
    .filter((entry) => String(entry?.status || "") !== "Draft")
    .filter((entry) => String(entry?.supplierId || "") === normalizedSupplierId)
    .forEach((entry) => {
      const allocations = ensureArray(entry?.allocations);
      const advanceUsageLines = allocations.filter(
        (line) => line?.appliedFromAdvance === true && Math.max(0, parseNumber(line?.applyAmount)) > 0
      );
      const advanceUsed = round2(
        advanceUsageLines.reduce((sum, line) => sum + Math.max(0, parseNumber(line?.applyAmount)), 0)
      );
      const advanceAdded = round2(Math.max(0, parseNumber(entry?.totals?.unappliedAmount)) + advanceUsed);

      if (advanceAdded > 0) {
        events.push({
          id: `adv_add_${entry.id}`,
          supplierId: normalizedSupplierId,
          supplierName: entry.supplierName || "Supplier",
          date: entry.paymentDate || "",
          paymentNo: entry.paymentNo || entry.id,
          amountAdded: advanceAdded,
          amountUsed: 0,
          remainingBalance: 0,
          entryType: "added"
        });
      }

      advanceUsageLines.forEach((line, index) => {
        events.push({
          id: `adv_use_${entry.id}_${line.billId || index}`,
          supplierId: normalizedSupplierId,
          supplierName: entry.supplierName || "Supplier",
          date: line?.appliedAt || line?.billDate || entry.paymentDate || "",
          paymentNo: entry.paymentNo || entry.id,
          billId: line?.billId || "",
          billNo: line?.billNo || "",
          amountAdded: 0,
          amountUsed: round2(line?.applyAmount),
          remainingBalance: 0,
          entryType: "used"
        });
      });
    });

  const sorted = events.sort((left, right) => {
    const leftDate = String(left?.date || "");
    const rightDate = String(right?.date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (left.entryType !== right.entryType) return left.entryType === "added" ? -1 : 1;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });

  let runningBalance = 0;
  return sorted
    .map((event) => {
      runningBalance = round2(runningBalance + event.amountAdded - event.amountUsed);
      return {
        ...event,
        remainingBalance: runningBalance
      };
    })
    .sort((left, right) => {
      const leftDate = String(left?.date || "");
      const rightDate = String(right?.date || "");
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right.id || "").localeCompare(String(left.id || ""));
    });
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

  const openBills = mapOpenBillsByCountryInternal(payload.country, { applyAdvance: false }).filter(
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
    tdsAmount: Math.max(0, parseNumber(payload.tdsAmount)),
    tdsCategory: payload.tdsCategory || "",
    tdsRate: Math.max(0, parseNumber(payload.tdsRate)),
    isManual: !!payload.isManual,
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

export function applyAdvanceWalletToSupplierBill({
  country,
  supplierId,
  billId,
  billNo,
  billDate,
  billAmount,
  actor
}) {
  const normalizedSupplierId = String(supplierId || "").trim();
  const normalizedBillId = String(billId || "").trim();
  const normalizedBillNo = String(billNo || normalizedBillId).trim();
  const safeBillAmount = Math.max(0, parseNumber(billAmount));

  if (!normalizedSupplierId || !normalizedBillId || safeBillAmount <= 0) {
    return [];
  }

  const existingAppliedAmount = listPaymentOut(country)
    .filter((entry) => String(entry?.status || "") !== "Draft")
    .reduce(
      (sum, entry) =>
        sum +
        ensureArray(entry?.allocations)
          .filter((line) => String(line?.billId || "") === normalizedBillId)
          .reduce((lineSum, line) => lineSum + Math.max(0, parseNumber(line?.applyAmount)), 0),
      0
    );
  let remainingBalance = Math.max(0, safeBillAmount - existingAppliedAmount);
  if (remainingBalance <= 0) return [];

  const records = listPaymentOut(country)
    .filter((entry) => String(entry?.supplierId || "") === normalizedSupplierId)
    .filter((entry) => String(entry?.status || "") !== "Draft")
    .filter((entry) => Math.max(0, parseNumber(entry?.totals?.unappliedAmount)) > 0)
    .sort((left, right) => {
      const leftDate = String(left?.paymentDate || "");
      const rightDate = String(right?.paymentDate || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return String(left?.paymentNo || "").localeCompare(String(right?.paymentNo || ""));
    });

  const updatedRecords = [];

  records.forEach((record) => {
    if (remainingBalance <= 0) return;
    const availableAdvance = Math.max(0, parseNumber(record?.totals?.unappliedAmount));
    if (availableAdvance <= 0) return;

    const applyAmount = Math.min(availableAdvance, remainingBalance);
    const nextAllocations = [
      ...ensureArray(record?.allocations),
      {
        billId: normalizedBillId,
        billNo: normalizedBillNo,
        billDate: billDate || "",
        billAmount: safeBillAmount,
        balanceDue: remainingBalance,
        applyAmount,
        appliedFromAdvance: true,
        appliedAt: billDate || "",
        sourcePaymentNo: record?.paymentNo || "",
        sourcePaymentId: record?.id || ""
      }
    ];

    const updated = savePaymentOut({
      id: record.id,
      country: record.country || country,
      paymentDate: record.paymentDate,
      supplierId: record.supplierId,
      supplierName: record.supplierName,
      currency: record.currency || "",
      paymentMode: record.paymentMode,
      referenceNo: record.referenceNo || "",
      chequeNo: record.chequeNo || "",
      bankName: record.bankName || "",
      transactionId: record.transactionId || "",
      paymentReference: record.paymentReference || "",
      internalNotes: record.internalNotes || "",
      attachment: record.attachment || null,
      desiredStatus: "Applied",
      amountPaid: record?.totals?.amountPaid ?? record?.amountPaid ?? 0,
      tdsAmount: record?.totals?.tdsAmount ?? record?.tdsAmount ?? 0,
      tdsCategory: record?.tdsCategory || "",
      tdsRate: record?.tdsRate ?? 0,
      isManual: !!record?.isManual,
      allocations: nextAllocations,
      supplierOutstandingBefore: record?.totals?.supplierOutstandingBefore ?? safeBillAmount,
      actor: actor || "System User"
    });

    updatedRecords.push(updated);
    remainingBalance = Math.max(0, remainingBalance - applyAmount);
  });

  return updatedRecords;
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
  const totalTds = list.reduce((sum, entry) => sum + parseNumber(entry?.totals?.tdsAmount), 0);
  const totalSettled = list.reduce((sum, entry) => sum + parseNumber(entry?.totals?.totalSettled), 0);
  const totalUnapplied = list.reduce((sum, entry) => sum + parseNumber(entry?.totals?.unappliedAmount), 0);
  return {
    count: list.length,
    totalPaid,
    totalTds,
    totalSettled,
    totalUnapplied
  };
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
    tdsAmount: form.tdsAmount,
    tdsCategory: form.tdsCategory,
    tdsRate: form.tdsRate,
    isManual: !!form.isManual,
    allocations: form.allocations,
    supplierOutstandingBefore,
    actor
  };
}

export function defaultPaymentForm(country, currency) {
  const defaultTdsCategory = "none";
  return {
    id: "",
    country,
    currency: currency || "",
    paymentDate: "",
    supplierId: "",
    supplierName: "",
    allocationMode: "normal",
    selectedBillId: "",
    paymentMode: "Cash",
    referenceNo: "",
    chequeNo: "",
    bankName: "",
    transactionId: "",
    paymentReference: "",
    internalNotes: "",
    attachment: null,
    amountPaid: 0,
    tdsAmount: 0,
    tdsCategory: defaultTdsCategory,
    tdsRate: "0",
    isManual: false,
    allocations: [],
    desiredStatus: "Draft"
  };
}
