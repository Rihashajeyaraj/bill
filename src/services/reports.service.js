import { listParties, computePartyFinancials, syncPartiesFromRemote } from "../modules/parties/store";
import { listCreditNotes as listPremiumCreditNotes } from "../modules/creditNote/store";
import { listDebitNotes } from "../modules/debitNote/store";
import { listPaymentIn, paymentInAllocationSettledAmount, paymentInAllocationTdsShare } from "../modules/paymentIn/store";
import { listPaymentOut, paymentOutAllocationTdsShare } from "../modules/paymentOut/store";
import { normalizeText, openingBalanceSigned, parseNumber, toIsoDate } from "../modules/parties/utils";
import { creditNotesList, creditNotesSyncFromRemote } from "./creditNotes.service";
import { expensesList, expensesSyncFromRemote } from "./expenses.service";
import { matchesFinancialYearFilter, resolveFinancialYearFilterRange } from "./financialYears.service";
import { invoicesList, invoicesSyncFromRemote } from "./invoices.service";
import { paymentsList, paymentsSyncFromRemote } from "./payments.service";
import { purchasesList, purchasesSyncFromRemote } from "./purchases.service";

export const PARTY_TYPES = {
  customer: "Customer",
  supplier: "Supplier"
};

export const TRANSACTION_TYPE_OPTIONS = [
  "All",
  "Sale",
  "Purchase",
  "Payment In",
  "TDS",
  "Payment Out",
  "Credit Note",
  "Debit Note",
  "Expense"
];

function isIndiaCountry(value) {
  const normalized = normalizeText(value);
  return normalized === "india" || normalized === "in";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIsoDate() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

export function getDefaultReportFilters() {
  return {
    fromDate: monthStartIsoDate(),
    toDate: todayIsoDate(),
    asOfDate: todayIsoDate(),
    partyType: PARTY_TYPES.customer,
    partyId: "",
    transactionType: "All",
    search: "",
    sortKey: "date",
    sortDirection: "desc"
  };
}

function filterRowsByFinancialYear(rows, resolveDate, range) {
  const source = Array.isArray(rows) ? rows : [];
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);
  if (!fromDate && !toDate) return source;
  return source.filter((row) => matchesFinancialYearFilter(resolveDate(row), { fromDate, toDate }));
}

export async function syncReportsData(range) {
  try {
    await Promise.all([
      syncPartiesFromRemote(),
      invoicesSyncFromRemote(range),
      purchasesSyncFromRemote(range),
      paymentsSyncFromRemote(range),
      expensesSyncFromRemote(range),
      creditNotesSyncFromRemote(range)
    ]);
  } catch {
    // Cached local data remains usable.
  }

  return getReportsDataset(range);
}

export function getReportsDataset(range) {
  return {
    parties: listParties(),
    invoices: invoicesList(range),
    purchases: purchasesList(range),
    legacyPayments: paymentsList(range),
    paymentIns: filterRowsByFinancialYear(
      listPaymentIn(),
      (row) => row?.paymentDate || row?.payment_date || row?.date || row?.created_at,
      range
    ),
    paymentOuts: filterRowsByFinancialYear(
      listPaymentOut(),
      (row) => row?.paymentDate || row?.payment_date || row?.date || row?.created_at,
      range
    ),
    legacyCreditNotes: creditNotesList(range),
    premiumCreditNotes: filterRowsByFinancialYear(
      listPremiumCreditNotes(),
      (row) => row?.creditNoteDate || row?.creditDate || row?.credit_note_date || row?.created_at,
      range
    ),
    debitNotes: filterRowsByFinancialYear(
      listDebitNotes(),
      (row) => row?.debitNoteDate || row?.date || row?.created_at,
      range
    ),
    expenses: expensesList(range)
  };
}

function normalizePartyType(value) {
  return normalizeText(value) === "supplier" ? PARTY_TYPES.supplier : PARTY_TYPES.customer;
}

function matchesPartyType(party, partyType) {
  return normalizePartyType(party?.type) === normalizePartyType(partyType);
}

function partyCandidates(row, partyType) {
  if (normalizePartyType(partyType) === PARTY_TYPES.supplier) {
    return [row?.partyId, row?.party_id, row?.supplierId, row?.supplier_id, row?.vendorId];
  }

  return [row?.partyId, row?.party_id, row?.customerId, row?.customer_id, row?.buyer?.id];
}

function matchesPartyId(row, partyId, partyType) {
  const safePartyId = String(partyId || "").trim();
  if (!safePartyId) return true;
  return partyCandidates(row, partyType).some((value) => String(value || "").trim() === safePartyId);
}

function buildPartyIndexes(dataset) {
  const parties = Array.isArray(dataset?.parties) ? dataset.parties : [];
  const byId = new Map(parties.map((party) => [String(party?.id || ""), party]));
  return {
    parties,
    partiesById: byId,
    customers: parties.filter((party) => matchesPartyType(party, PARTY_TYPES.customer)),
    suppliers: parties.filter((party) => matchesPartyType(party, PARTY_TYPES.supplier))
  };
}

function resolvePartyName(row, partyType, partiesById) {
  const ids = partyCandidates(row, partyType);
  for (const id of ids) {
    const party = partiesById.get(String(id || "").trim());
    if (party?.name) return party.name;
  }

  if (normalizePartyType(partyType) === PARTY_TYPES.supplier) {
    return String(row?.partyName || row?.supplierName || row?.vendorName || "Supplier").trim();
  }
  return String(row?.partyName || row?.customerName || row?.buyer?.name || "Customer").trim();
}

function amountFromInvoice(row) {
  return Math.max(
    0,
    parseNumber(
      row?.totals?.grandTotal ??
        row?.totals?.total ??
        row?.totals?.finalTotal ??
        row?.grand_total ??
        row?.grandTotal ??
        row?.amount
    )
  );
}

function amountFromExpense(row) {
  return Math.max(0, parseNumber(row?.totalAmount ?? row?.amount ?? row?.total));
}

function amountFromAdjustment(row) {
  return Math.max(
    0,
    parseNumber(
      row?.totals?.total ??
        row?.totals?.grandTotal ??
        row?.grand_total ??
        row?.grandTotal ??
        row?.amount
    )
  );
}

function taxTotalsFromRow(row) {
  const totals = row?.totals && typeof row.totals === "object" ? row.totals : {};
  const tax = totals?.tax && typeof totals.tax === "object" ? totals.tax : {};
  const taxBreakup = totals?.taxBreakup && typeof totals.taxBreakup === "object" ? totals.taxBreakup : {};
  const cgst = Math.max(0, parseNumber(tax?.cgst ?? totals?.cgst ?? taxBreakup?.cgst));
  const sgst = Math.max(0, parseNumber(tax?.sgst ?? totals?.sgst ?? taxBreakup?.sgst));
  const igst = Math.max(0, parseNumber(tax?.igst ?? totals?.igst ?? taxBreakup?.igst));
  const explicitTotal = Math.max(
    0,
    parseNumber(
      tax?.taxTotal ??
        tax?.totalTax ??
        tax?.taxAmount ??
        totals?.taxTotal ??
        totals?.totalTax ??
        taxBreakup?.taxTotal ??
        taxBreakup?.totalTax
    )
  );
  const computedTotal = cgst + sgst + igst;

  return {
    cgst,
    sgst,
    igst,
    taxTotal: explicitTotal || computedTotal
  };
}

function amountFromPayment(row, partyType) {
  if (normalizePartyType(partyType) === PARTY_TYPES.supplier) {
    return Math.max(
      0,
      parseNumber(row?.totals?.amountPaid ?? row?.totals?.amountApplied ?? row?.amountPaid ?? row?.amountApplied ?? row?.amount)
    );
  }

  return Math.max(
    0,
    parseNumber(
      row?.totals?.amountReceived ??
        row?.totals?.amountApplied ??
        row?.amountReceived ??
        row?.amountApplied ??
        row?.amount
    )
  );
}

function paymentInTdsAmount(row) {
  return Math.max(0, parseNumber(row?.totals?.tdsAmount ?? row?.tdsAmount));
}

function paymentOutTdsAmount(row) {
  return Math.max(0, parseNumber(row?.totals?.tdsAmount ?? row?.tdsAmount));
}

function paymentInSettledAmount(row) {
  return Math.max(
    0,
    parseNumber(row?.totals?.totalSettled ?? amountFromPayment(row, PARTY_TYPES.customer) + paymentInTdsAmount(row))
  );
}

function resolveInvoiceDate(row) {
  return toIsoDate(row?.invoiceDate || row?.invoice_date || row?.date || row?.created_at);
}

function resolvePurchaseDate(row) {
  return toIsoDate(row?.billDate || row?.bill_date || row?.invoiceDate || row?.date || row?.created_at);
}

function resolvePaymentDate(row) {
  return toIsoDate(row?.paymentDate || row?.payment_date || row?.date || row?.created_at);
}

function resolveExpenseDate(row) {
  return toIsoDate(row?.date || row?.expense_date || row?.created_at);
}

function resolveCreditDate(row) {
  return toIsoDate(row?.creditNoteDate || row?.creditDate || row?.credit_note_date || row?.created_at);
}

function resolveDebitDate(row) {
  return toIsoDate(row?.debitNoteDate || row?.created_at);
}

function inDateRange(dateValue, fromDate, toDate) {
  const safeDate = toIsoDate(dateValue);
  const safeFrom = toIsoDate(fromDate);
  const safeTo = toIsoDate(toDate);
  if (safeFrom && safeDate && safeDate < safeFrom) return false;
  if (safeTo && safeDate && safeDate > safeTo) return false;
  return true;
}

function compareValues(left, right, direction = "asc") {
  const factor = direction === "asc" ? 1 : -1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumber = Number.isFinite(leftNumber);
  const rightIsNumber = Number.isFinite(rightNumber);

  if (leftIsNumber && rightIsNumber) {
    return (leftNumber - rightNumber) * factor;
  }

  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  }) * factor;
}

function paginate(rows, page = 1, pageSize = 20) {
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  return {
    rows: rows.slice(startIndex, startIndex + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalRows,
    totalPages,
    startIndex,
    endIndex: Math.min(startIndex + safePageSize, totalRows)
  };
}

function normalizeStatusLabel(value, fallback = "Open") {
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  if (normalized === "issued") return "Unpaid";
  if (normalized === "partial") return "Partial";
  if (normalized === "paid") return "Paid";
  if (normalized === "posted") return "Posted";
  if (normalized === "applied") return "Applied";
  if (normalized === "draft") return "Draft";
  if (normalized === "cancelled") return "Cancelled";
  return String(value || fallback);
}

export function listReportParties(dataset, partyType = PARTY_TYPES.customer) {
  const rawType = String(partyType || "").trim().toLowerCase();
  return (Array.isArray(dataset?.parties) ? dataset.parties : [])
    .filter((party) => !rawType || rawType === "all" || matchesPartyType(party, partyType))
    .sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));
}

function customerPaymentAppliedByInvoice(dataset, asOfDate = "") {
  const applied = new Map();

  (Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
    .filter((row) => String(row?.direction || "").trim().toUpperCase() === "IN")
    .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PI:"))
    .filter((row) => !asOfDate || resolvePaymentDate(row) <= asOfDate)
    .forEach((row) => {
      const invoiceId = String(row?.invoiceId || row?.invoice_id || "").trim();
      if (!invoiceId) return;
      applied.set(invoiceId, (applied.get(invoiceId) || 0) + parseNumber(row?.amount));
    });

  (Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
    .filter((row) => normalizeText(row?.status) !== "draft")
    .filter((row) => !asOfDate || resolvePaymentDate(row) <= asOfDate)
    .forEach((row) => {
      const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
      allocations.forEach((allocation) => {
        if (normalizeText(allocation?.documentType || "invoice") !== "invoice") return;
        const invoiceId = String(allocation?.invoiceId || "").trim();
        if (!invoiceId) return;
        applied.set(invoiceId, (applied.get(invoiceId) || 0) + paymentInAllocationSettledAmount(row, allocation));
      });
    });

  return applied;
}

function customerCreditAppliedByInvoice(dataset, asOfDate = "") {
  const applied = new Map();

  (Array.isArray(dataset?.legacyCreditNotes) ? dataset.legacyCreditNotes : [])
    .filter((row) => !asOfDate || resolveCreditDate(row) <= asOfDate)
    .forEach((row) => {
      const invoiceId = String(row?.referenceInvoiceId || row?.related_invoice_id || "").trim();
      if (!invoiceId) return;
      applied.set(invoiceId, (applied.get(invoiceId) || 0) + amountFromAdjustment(row));
    });

  (Array.isArray(dataset?.premiumCreditNotes) ? dataset.premiumCreditNotes : [])
    .filter((row) => normalizeText(row?.status) === "applied")
    .filter((row) => !asOfDate || resolveCreditDate(row) <= asOfDate)
    .forEach((row) => {
      const invoiceId = String(row?.linkedInvoiceId || "").trim();
      if (!invoiceId) return;
      applied.set(invoiceId, (applied.get(invoiceId) || 0) + amountFromAdjustment(row));
    });

  return applied;
}

function supplierPaymentAppliedByBill(dataset, asOfDate = "") {
  const applied = new Map();

  (Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
    .filter((row) => String(row?.direction || "").trim().toUpperCase() === "OUT")
    .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PO:"))
    .filter((row) => !asOfDate || resolvePaymentDate(row) <= asOfDate)
    .forEach((row) => {
      const billId = String(row?.billId || row?.bill_id || "").trim();
      if (!billId) return;
      applied.set(billId, (applied.get(billId) || 0) + parseNumber(row?.amount));
    });

  (Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
    .filter((row) => normalizeText(row?.status) !== "draft")
    .filter((row) => !asOfDate || resolvePaymentDate(row) <= asOfDate)
    .forEach((row) => {
      const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
      allocations.forEach((allocation) => {
        const billId = String(allocation?.billId || "").trim();
        if (!billId) return;
        applied.set(billId, (applied.get(billId) || 0) + Math.max(0, parseNumber(allocation?.applyAmount)));
      });
    });

  return applied;
}

function supplierDebitAppliedByBill(dataset, asOfDate = "") {
  const applied = new Map();

  (Array.isArray(dataset?.debitNotes) ? dataset.debitNotes : [])
    .filter((row) => normalizeText(row?.status) === "applied")
    .filter((row) => !asOfDate || resolveDebitDate(row) <= asOfDate)
    .forEach((row) => {
      const billId = String(row?.linkedPurchaseInvoiceId || "").trim();
      if (!billId) return;
      applied.set(billId, (applied.get(billId) || 0) + amountFromAdjustment(row));
    });

  return applied;
}

function resolveInvoiceBalance(row, paymentMap, creditMap) {
  const explicitBalance = row?.remainingBalance ?? row?.totals?.balance ?? row?.balanceAmount ?? row?.balance;
  const invoiceId = String(row?.id || "").trim();
  const linkedSettlements = (paymentMap.get(invoiceId) || 0) + (creditMap.get(invoiceId) || 0);
  if (linkedSettlements <= 0 && explicitBalance !== undefined && explicitBalance !== null && explicitBalance !== "") {
    return Math.max(0, parseNumber(explicitBalance));
  }
  return Math.max(0, amountFromInvoice(row) - linkedSettlements);
}

function resolvePurchaseBalance(row, paymentMap, debitMap) {
  const explicitBalance = row?.remainingBalance ?? row?.totals?.balance ?? row?.balanceAmount ?? row?.balance;
  const billId = String(row?.id || "").trim();
  const linkedSettlements = (paymentMap.get(billId) || 0) + (debitMap.get(billId) || 0);
  if (linkedSettlements <= 0 && explicitBalance !== undefined && explicitBalance !== null && explicitBalance !== "") {
    return Math.max(0, parseNumber(explicitBalance));
  }
  return Math.max(0, amountFromInvoice(row) - linkedSettlements);
}

function ageInDays(documentDate, asOfDate) {
  const safeDocumentDate = toIsoDate(documentDate);
  const safeAsOfDate = toIsoDate(asOfDate);
  const left = new Date(`${safeDocumentDate}T00:00:00`);
  const right = new Date(`${safeAsOfDate}T00:00:00`);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return 0;
  return Math.max(0, Math.floor((right.getTime() - left.getTime()) / 86400000));
}

function agingBucket(days) {
  if (days <= 30) return "bucket_0_30";
  if (days <= 60) return "bucket_31_60";
  if (days <= 90) return "bucket_61_90";
  return "bucket_above_90";
}

const AGING_BUCKET_KEYS = ["bucket_0_30", "bucket_31_60", "bucket_61_90", "bucket_above_90"];

function createEmptyAgingBucketDetails() {
  return {
    bucket_0_30: [],
    bucket_31_60: [],
    bucket_61_90: [],
    bucket_above_90: []
  };
}

function agingDetailRank(transactionType) {
  if (transactionType === "Invoice" || transactionType === "Purchase") return 0;
  if (transactionType === "Credit Note" || transactionType === "Debit Note") return 1;
  if (transactionType === "Payment") return 2;
  return 3;
}

function sortAgingDetails(details) {
  return [...details].sort((left, right) => {
    const byDate = compareValues(left.date, right.date, "asc");
    if (byDate !== 0) return byDate;

    const byType = agingDetailRank(left.transactionType) - agingDetailRank(right.transactionType);
    if (byType !== 0) return byType;

    return String(left.reference || "").localeCompare(String(right.reference || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function appendAgingDetail(detailMap, documentId, detail) {
  const safeDocumentId = String(documentId || "").trim();
  if (!safeDocumentId || !detail) return;
  const current = detailMap.get(safeDocumentId) || [];
  current.push(detail);
  detailMap.set(safeDocumentId, current);
}

function buildAgingDetailIndex(dataset, partyType, asOfDate) {
  const normalizedType = normalizePartyType(partyType);
  const detailMap = new Map();

  if (normalizedType === PARTY_TYPES.supplier) {
    (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
      .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
      .forEach((row) => {
        const billId = String(row?.id || "").trim();
        const date = resolvePurchaseDate(row);
        if (!billId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, billId, {
          id: `purchase_${billId}`,
          date,
          transactionType: "Purchase",
          reference: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
          amount: amountFromInvoice(row)
        });
      });

    (Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
      .filter((row) => String(row?.direction || "").trim().toUpperCase() === "OUT")
      .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PO:"))
      .forEach((row) => {
        const billId = String(row?.billId || row?.bill_id || "").trim();
        const date = resolvePaymentDate(row);
        if (!billId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, billId, {
          id: `payment_legacy_${row?.id || row?.paymentNo || row?.referenceNo || Math.random().toString(16).slice(2)}`,
          date,
          transactionType: "Payment",
          reference: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
          amount: -Math.max(0, parseNumber(row?.amount))
        });
      });

    (Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
      .filter((row) => normalizeText(row?.status) !== "draft")
      .forEach((row) => {
        const date = resolvePaymentDate(row);
        if (asOfDate && date && date > asOfDate) return;
        const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
        allocations.forEach((allocation, index) => {
          const billId = String(allocation?.billId || "").trim();
          const appliedAmount = Math.max(0, parseNumber(allocation?.applyAmount));
          if (!billId || appliedAmount <= 0) return;
          appendAgingDetail(detailMap, billId, {
            id: `payment_out_${row?.id || row?.paymentNo || "entry"}_${index}`,
            date,
            transactionType: "Payment",
            reference: String(row?.paymentNo || row?.referenceNo || row?.transactionId || row?.id || "").trim(),
            amount: -appliedAmount
          });
        });
      });

    (Array.isArray(dataset?.debitNotes) ? dataset.debitNotes : [])
      .filter((row) => normalizeText(row?.status) === "applied")
      .forEach((row) => {
        const billId = String(row?.linkedPurchaseInvoiceId || "").trim();
        const date = resolveDebitDate(row);
        if (!billId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, billId, {
          id: `debit_${row?.id || row?.debitNoteNo || Math.random().toString(16).slice(2)}`,
          date,
          transactionType: "Debit Note",
          reference: String(row?.debitNoteNo || row?.referenceNo || row?.id || "").trim(),
          amount: -amountFromAdjustment(row)
        });
      });
  } else {
    (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
      .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
      .forEach((row) => {
        const invoiceId = String(row?.id || "").trim();
        const date = resolveInvoiceDate(row);
        if (!invoiceId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, invoiceId, {
          id: `invoice_${invoiceId}`,
          date,
          transactionType: "Invoice",
          reference: String(row?.invoiceNo || row?.id || "").trim(),
          amount: amountFromInvoice(row)
        });
      });

    (Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
      .filter((row) => String(row?.direction || "").trim().toUpperCase() === "IN")
      .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PI:"))
      .forEach((row) => {
        const invoiceId = String(row?.invoiceId || row?.invoice_id || "").trim();
        const date = resolvePaymentDate(row);
        if (!invoiceId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, invoiceId, {
          id: `payment_legacy_${row?.id || row?.paymentNo || row?.referenceNo || Math.random().toString(16).slice(2)}`,
          date,
          transactionType: "Payment",
          reference: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
          amount: -Math.max(0, parseNumber(row?.amount))
        });
      });

    (Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
      .filter((row) => normalizeText(row?.status) !== "draft")
      .forEach((row) => {
        const date = resolvePaymentDate(row);
        if (asOfDate && date && date > asOfDate) return;
        const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
        allocations.forEach((allocation, index) => {
          if (normalizeText(allocation?.documentType || "invoice") !== "invoice") return;
          const invoiceId = String(allocation?.invoiceId || "").trim();
          const settledAmount = paymentInAllocationSettledAmount(row, allocation);
          if (!invoiceId || settledAmount <= 0) return;
          appendAgingDetail(detailMap, invoiceId, {
            id: `payment_in_${row?.id || row?.receiptNo || "entry"}_${index}`,
            date,
            transactionType: "Payment",
            reference: String(row?.receiptNo || row?.referenceNo || row?.transactionId || row?.id || "").trim(),
            amount: -settledAmount
          });
        });
      });

    (Array.isArray(dataset?.legacyCreditNotes) ? dataset.legacyCreditNotes : [])
      .forEach((row) => {
        const invoiceId = String(row?.referenceInvoiceId || row?.related_invoice_id || "").trim();
        const date = resolveCreditDate(row);
        if (!invoiceId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, invoiceId, {
          id: `credit_legacy_${row?.id || row?.creditNoteNo || row?.referenceNo || Math.random().toString(16).slice(2)}`,
          date,
          transactionType: "Credit Note",
          reference: String(row?.creditNoteNo || row?.referenceNo || row?.id || "").trim(),
          amount: -amountFromAdjustment(row)
        });
      });

    (Array.isArray(dataset?.premiumCreditNotes) ? dataset.premiumCreditNotes : [])
      .filter((row) => normalizeText(row?.status) === "applied")
      .forEach((row) => {
        const invoiceId = String(row?.linkedInvoiceId || "").trim();
        const date = resolveCreditDate(row);
        if (!invoiceId || (asOfDate && date && date > asOfDate)) return;
        appendAgingDetail(detailMap, invoiceId, {
          id: `credit_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
          date,
          transactionType: "Credit Note",
          reference: String(row?.creditNoteNo || row?.referenceNo || row?.id || "").trim(),
          amount: -amountFromAdjustment(row)
        });
      });
  }

  detailMap.forEach((details, documentId) => {
    detailMap.set(documentId, sortAgingDetails(details));
  });

  return detailMap;
}

function buildOutstandingDocuments(dataset, partyType, asOfDate) {
  const normalizedType = normalizePartyType(partyType);
  const { partiesById } = buildPartyIndexes(dataset);

  if (normalizedType === PARTY_TYPES.supplier) {
    const paymentsByBill = supplierPaymentAppliedByBill(dataset, asOfDate);
    const debitByBill = supplierDebitAppliedByBill(dataset, asOfDate);
    return (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
      .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
      .map((row) => {
        const date = resolvePurchaseDate(row);
        if (asOfDate && date && date > asOfDate) return null;
        const balance = resolvePurchaseBalance(row, paymentsByBill, debitByBill);
        if (balance <= 0) return null;
        return {
          id: String(row?.id || ""),
          partyId: String(row?.partyId || row?.supplierId || row?.supplier_id || ""),
          partyName: resolvePartyName(row, PARTY_TYPES.supplier, partiesById),
          date,
          reference: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
          amount: balance,
          daysPending: ageInDays(date, asOfDate),
          documentType: "Purchase"
        };
      })
      .filter(Boolean);
  }

  const paymentsByInvoice = customerPaymentAppliedByInvoice(dataset, asOfDate);
  const creditByInvoice = customerCreditAppliedByInvoice(dataset, asOfDate);
  return (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .map((row) => {
      const date = resolveInvoiceDate(row);
      if (asOfDate && date && date > asOfDate) return null;
      const balance = resolveInvoiceBalance(row, paymentsByInvoice, creditByInvoice);
      if (balance <= 0) return null;
      return {
        id: String(row?.id || ""),
        partyId: String(row?.partyId || row?.customerId || row?.customer_id || row?.buyer?.id || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, partiesById),
        date,
        reference: String(row?.invoiceNo || row?.id || "").trim(),
        amount: balance,
        daysPending: ageInDays(date, asOfDate),
        documentType: "Invoice"
      };
    })
    .filter(Boolean);
}

export function buildAgingReport(dataset, filters = {}) {
  const partyType = normalizePartyType(filters.partyType);
  const partyId = String(filters.partyId || "").trim();
  const asOfDate = toIsoDate(filters.asOfDate) || todayIsoDate();
  const parties = listReportParties(dataset, partyType);
  const detailsByDocument = buildAgingDetailIndex(dataset, partyType, asOfDate);

  const rowsByPartyId = new Map(
    parties
      .filter((party) => !partyId || String(party?.id || "") === partyId)
      .map((party) => [
        String(party?.id || ""),
        {
          id: String(party?.id || ""),
          partyName: String(party?.name || "").trim(),
          totalOutstanding: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_above_90: 0,
          bucketDetails: createEmptyAgingBucketDetails()
        }
      ])
  );

  buildOutstandingDocuments(dataset, partyType, asOfDate)
    .filter((row) => !partyId || row.partyId === partyId)
    .forEach((row) => {
      const bucket = agingBucket(row.daysPending);
      const current =
        rowsByPartyId.get(row.partyId) ||
        {
          id: row.partyId,
          partyName: row.partyName,
          totalOutstanding: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_above_90: 0,
          bucketDetails: createEmptyAgingBucketDetails()
        };
      current.totalOutstanding += row.amount;
      current[bucket] += row.amount;
      const detailRows = (detailsByDocument.get(row.id) || [
        {
          id: `${row.documentType.toLowerCase()}_${row.id}`,
          date: row.date,
          transactionType: row.documentType,
          reference: row.reference,
          amount: row.amount
        }
      ]).map((detail, index) => ({
        ...detail,
        id: `${row.id}_${detail.id || index}`,
        daysPending: row.daysPending
      }));
      current.bucketDetails[bucket] = sortAgingDetails([...(current.bucketDetails[bucket] || []), ...detailRows]);
      rowsByPartyId.set(row.partyId, current);
    });

  const rows = Array.from(rowsByPartyId.values())
    .filter((row) => row.totalOutstanding > 0 || !!partyId)
    .sort((left, right) => {
      if (right.totalOutstanding !== left.totalOutstanding) {
        return right.totalOutstanding - left.totalOutstanding;
      }
      return left.partyName.localeCompare(right.partyName);
    });

  const totals = rows.reduce(
    (summary, row) => ({
      totalOutstanding: summary.totalOutstanding + row.totalOutstanding,
      bucket_0_30: summary.bucket_0_30 + row.bucket_0_30,
      bucket_31_60: summary.bucket_31_60 + row.bucket_31_60,
      bucket_61_90: summary.bucket_61_90 + row.bucket_61_90,
      bucket_above_90: summary.bucket_above_90 + row.bucket_above_90
    }),
    {
      totalOutstanding: 0,
      bucket_0_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_above_90: 0
    }
  );

  return {
    partyType,
    partyId,
    asOfDate,
    rows,
    totals
  };
}

function statementTransactionsForParty(dataset, party) {
  if (!party) return [];

  if (normalizePartyType(party?.type) === PARTY_TYPES.supplier) {
    return [
      ...(Array.isArray(dataset?.purchases) ? dataset.purchases : [])
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
        .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
        .map((row) => ({
          id: `purchase_${row?.id || row?.billNumber || Math.random().toString(16).slice(2)}`,
          date: resolvePurchaseDate(row),
          transactionType: "Purchase",
          referenceNumber: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
          debit: amountFromInvoice(row),
          credit: 0
        })),
      ...(Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
        .filter((row) => String(row?.direction || "").trim().toUpperCase() === "OUT")
        .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PO:"))
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
        .filter((row) => normalizeText(row?.status) !== "cancelled" && normalizeText(row?.status) !== "draft")
        .map((row) => ({
          id: `payment_legacy_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
          date: resolvePaymentDate(row),
          transactionType: "Payment",
          referenceNumber: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
          debit: 0,
          credit: parseNumber(row?.amount)
        })),
      ...(Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
        .filter((row) => normalizeText(row?.status) !== "draft")
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
        .map((row) => ({
          id: `payment_premium_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
          date: resolvePaymentDate(row),
          transactionType: "Payment",
          referenceNumber: String(row?.paymentNo || row?.referenceNo || row?.transactionId || row?.id || "").trim(),
          debit: 0,
          credit: amountFromPayment(row, PARTY_TYPES.supplier)
        }))
        .filter((row) => row.credit > 0),
      ...(Array.isArray(dataset?.debitNotes) ? dataset.debitNotes : [])
        .filter((row) => normalizeText(row?.status) === "applied")
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
        .map((row) => ({
          id: `debit_${row?.id || row?.debitNoteNo || Math.random().toString(16).slice(2)}`,
          date: resolveDebitDate(row),
          transactionType: "Credit Note",
          referenceNumber: String(row?.debitNoteNo || row?.id || "").trim(),
          debit: 0,
          credit: amountFromAdjustment(row)
        }))
        .filter((row) => row.credit > 0)
    ].sort((left, right) => {
      if (left.date !== right.date) return String(left.date || "").localeCompare(String(right.date || ""));
      return `${left.transactionType}:${left.referenceNumber}:${left.id}`.localeCompare(
        `${right.transactionType}:${right.referenceNumber}:${right.id}`
      );
    });
  }

  return [
    ...(Array.isArray(dataset?.invoices) ? dataset.invoices : [])
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
      .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
      .map((row) => ({
        id: `invoice_${row?.id || row?.invoiceNo || Math.random().toString(16).slice(2)}`,
        date: resolveInvoiceDate(row),
        transactionType: "Invoice",
        referenceNumber: String(row?.invoiceNo || row?.id || "").trim(),
        debit: amountFromInvoice(row),
        credit: 0
      })),
      ...(Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
        .filter((row) => String(row?.direction || "").trim().toUpperCase() === "IN")
        .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PI:"))
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
        .filter((row) => normalizeText(row?.status) !== "cancelled" && normalizeText(row?.status) !== "draft")
        .map((row) => ({
          id: `payment_legacy_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
          date: resolvePaymentDate(row),
          transactionType: "Payment",
          referenceNumber: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
          debit: 0,
          credit: parseNumber(row?.amount)
        })),
      ...(Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
        .filter((row) => normalizeText(row?.status) !== "draft")
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
        .map((row) => ({
          id: `payment_premium_${row?.id || row?.receiptNo || Math.random().toString(16).slice(2)}`,
          date: resolvePaymentDate(row),
          transactionType: "Payment",
          referenceNumber: String(row?.receiptNo || row?.referenceNo || row?.paymentReference || row?.id || "").trim(),
          debit: 0,
          credit: paymentInSettledAmount(row)
        }))
        .filter((row) => row.credit > 0),
      ...(Array.isArray(dataset?.legacyCreditNotes) ? dataset.legacyCreditNotes : [])
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
        .map((row) => ({
          id: `credit_legacy_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
          date: resolveCreditDate(row),
          transactionType: "Credit Note",
          referenceNumber: String(row?.creditNoteNo || row?.id || "").trim(),
          debit: 0,
          credit: amountFromAdjustment(row)
        }))
        .filter((row) => row.credit > 0),
      ...(Array.isArray(dataset?.premiumCreditNotes) ? dataset.premiumCreditNotes : [])
        .filter((row) => normalizeText(row?.status) === "applied")
        .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
        .map((row) => ({
          id: `credit_premium_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
          date: resolveCreditDate(row),
          transactionType: "Credit Note",
          referenceNumber: String(row?.creditNoteNo || row?.id || "").trim(),
          debit: 0,
          credit: amountFromAdjustment(row)
        }))
        .filter((row) => row.credit > 0)
    ].sort((left, right) => {
      if (left.date !== right.date) return String(left.date || "").localeCompare(String(right.date || ""));
      return `${left.transactionType}:${left.referenceNumber}:${left.id}`.localeCompare(
        `${right.transactionType}:${right.referenceNumber}:${right.id}`
      );
    });
}

export function buildPartyStatementReport(dataset, filters = {}, options = {}) {
  const partyType = normalizePartyType(filters.partyType);
  const partyId = String(filters.partyId || "").trim();
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);

  if (fromDate && toDate && fromDate > toDate) {
    throw new Error("From Date cannot be after To Date.");
  }

  const party = (Array.isArray(dataset?.parties) ? dataset.parties : []).find(
    (entry) => String(entry?.id || "") === partyId && matchesPartyType(entry, partyType)
  );
  if (!party) {
    return {
      partyType,
      partyId: "",
      party: null,
      fromDate,
      toDate,
      openingBalance: 0,
      closingBalance: 0,
      totals: { debit: 0, credit: 0, count: 0 },
      rows: [],
      ...paginate([], options.page, options.pageSize)
    };
  }

  let openingBalance = openingBalanceSigned(party);
  const allTransactions = statementTransactionsForParty(dataset, party);
  allTransactions.forEach((row) => {
    if (fromDate && row.date && row.date < fromDate) {
      openingBalance += parseNumber(row.debit) - parseNumber(row.credit);
    }
  });

  let runningBalance = openingBalance;
  const rows = allTransactions
    .filter((row) => inDateRange(row.date, fromDate, toDate))
    .map((row) => {
      runningBalance += parseNumber(row.debit) - parseNumber(row.credit);
      return {
        ...row,
        runningBalance
      };
    });
  const periodClosingBalance = rows.reduce(
    (sum, row) => sum + parseNumber(row.debit) - parseNumber(row.credit),
    0
  );

  const page = paginate(rows, options.page, options.pageSize);
  return {
    partyType,
    partyId,
    party,
    fromDate,
    toDate,
    openingBalance,
    closingBalance: periodClosingBalance,
    endingBalance: runningBalance,
    totals: {
      debit: rows.reduce((sum, row) => sum + parseNumber(row.debit), 0),
      credit: rows.reduce((sum, row) => sum + parseNumber(row.credit), 0),
      count: rows.length
    },
    allRows: rows,
    ...page
  };
}

export function buildSaleReport(dataset, filters = {}) {
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);
  const partyId = String(filters.partyId || "").trim();
  const indexes = buildPartyIndexes(dataset);
  const paymentsByInvoice = customerPaymentAppliedByInvoice(dataset, toDate);
  const creditByInvoice = customerCreditAppliedByInvoice(dataset, toDate);

  const rows = (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolveInvoiceDate(row), fromDate, toDate))
    .filter((row) => matchesPartyId(row, partyId, PARTY_TYPES.customer))
    .map((row) => {
      const totalAmount = amountFromInvoice(row);
      const balance = resolveInvoiceBalance(row, paymentsByInvoice, creditByInvoice);
      const paidAmount = Math.max(0, totalAmount - balance);
      return {
        id: String(row?.id || row?.invoiceNo || ""),
        date: resolveInvoiceDate(row),
        reference: String(row?.invoiceNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        totalAmount,
        paidAmount,
        unpaidAmount: balance,
        status: balance <= 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid"
      };
    })
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));

  const totals = rows.reduce(
    (summary, row) => ({
      totalSales: summary.totalSales + row.totalAmount,
      paidAmount: summary.paidAmount + row.paidAmount,
      unpaidAmount: summary.unpaidAmount + row.unpaidAmount
    }),
    { totalSales: 0, paidAmount: 0, unpaidAmount: 0 }
  );

  return {
    fromDate,
    toDate,
    partyId,
    rows,
    totals: {
      ...totals,
      invoiceCount: rows.length,
      paidCount: rows.filter((row) => row.unpaidAmount <= 0).length,
      unpaidCount: rows.filter((row) => row.unpaidAmount > 0).length
    }
  };
}

export function buildPurchaseReport(dataset, filters = {}) {
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);
  const partyId = String(filters.partyId || "").trim();
  const indexes = buildPartyIndexes(dataset);
  const paymentsByBill = supplierPaymentAppliedByBill(dataset, toDate);
  const debitByBill = supplierDebitAppliedByBill(dataset, toDate);

  const rows = (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolvePurchaseDate(row), fromDate, toDate))
    .filter((row) => matchesPartyId(row, partyId, PARTY_TYPES.supplier))
    .map((row) => {
      const totalAmount = amountFromInvoice(row);
      const balance = resolvePurchaseBalance(row, paymentsByBill, debitByBill);
      const paidAmount = Math.max(0, totalAmount - balance);
      return {
        id: String(row?.id || row?.billNumber || ""),
        date: resolvePurchaseDate(row),
        reference: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        totalAmount,
        paidAmount,
        pendingAmount: balance,
        status: balance <= 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Pending"
      };
    })
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));

  const totals = rows.reduce(
    (summary, row) => ({
      totalPurchases: summary.totalPurchases + row.totalAmount,
      paidAmount: summary.paidAmount + row.paidAmount,
      pendingAmount: summary.pendingAmount + row.pendingAmount
    }),
    { totalPurchases: 0, paidAmount: 0, pendingAmount: 0 }
  );

  return {
    fromDate,
    toDate,
    partyId,
    rows,
    totals: {
      ...totals,
      billCount: rows.length,
      paidCount: rows.filter((row) => row.pendingAmount <= 0).length,
      pendingCount: rows.filter((row) => row.pendingAmount > 0).length
    }
  };
}

function buildPaymentRows(dataset, indexes, mode = "cash") {
  const rows = [];

  (Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => {
      const prefix = String(row?.referenceNo || row?.reference_no || "");
      return !prefix.startsWith("PI:") && !prefix.startsWith("PO:");
    })
    .forEach((row) => {
      const isOut = String(row?.direction || "").trim().toUpperCase() === "OUT";
      const partyType = isOut ? PARTY_TYPES.supplier : PARTY_TYPES.customer;
      rows.push({
        id: `legacy_payment_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
        date: resolvePaymentDate(row),
        transactionType: isOut ? "Payment Out" : "Payment In",
        reference: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
        partyId: String(row?.partyId || row?.party_id || ""),
        partyName: resolvePartyName(row, partyType, indexes.partiesById),
        amount: Math.max(0, parseNumber(row?.amount)),
        status: normalizeStatusLabel(row?.status, "Posted"),
        note: String(row?.note || row?.notes || "").trim(),
        direction: isOut ? "outflow" : "inflow"
      });
    });

  (Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
    .filter((row) => normalizeText(row?.status) !== "draft")
    .forEach((row) => {
      const tdsAmount = paymentInTdsAmount(row);
      rows.push({
        id: `payment_in_${row?.id || row?.receiptNo || Math.random().toString(16).slice(2)}`,
        date: resolvePaymentDate(row),
        transactionType: "Payment In",
        reference: String(row?.receiptNo || row?.referenceNo || row?.paymentReference || row?.id || "").trim(),
        partyId: String(row?.customerId || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        amount: mode === "settled" ? paymentInSettledAmount(row) : amountFromPayment(row, PARTY_TYPES.customer),
        status: normalizeStatusLabel(row?.status, "Received"),
        note: [String(row?.internalNotes || row?.customerNotes || "").trim(), tdsAmount > 0 ? `TDS ${tdsAmount.toFixed(2)}` : ""]
          .filter(Boolean)
          .join(" | "),
        direction: "inflow"
      });
    });

  (Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
    .filter((row) => normalizeText(row?.status) !== "draft")
    .forEach((row) => {
      rows.push({
        id: `payment_out_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
        date: resolvePaymentDate(row),
        transactionType: "Payment Out",
        reference: String(row?.paymentNo || row?.referenceNo || row?.transactionId || row?.id || "").trim(),
        partyId: String(row?.supplierId || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        amount: amountFromPayment(row, PARTY_TYPES.supplier),
        status: normalizeStatusLabel(row?.status, "Paid"),
        note: String(row?.internalNotes || row?.supplierNotes || "").trim(),
        direction: "outflow"
      });
    });

  return rows;
}

export function buildDayBookReport(dataset, filters = {}) {
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);
  const indexes = buildPartyIndexes(dataset);
  const rows = [];

  (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `sale_${row?.id || row?.invoiceNo || Math.random().toString(16).slice(2)}`,
        date: resolveInvoiceDate(row),
        entryType: "Sale",
        reference: String(row?.invoiceNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        cashIn: amountFromInvoice(row),
        cashOut: 0,
        amount: amountFromInvoice(row)
      });
    });

  (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `purchase_${row?.id || row?.billNumber || Math.random().toString(16).slice(2)}`,
        date: resolvePurchaseDate(row),
        entryType: "Purchase",
        reference: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        cashIn: 0,
        cashOut: amountFromInvoice(row),
        amount: amountFromInvoice(row)
      });
    });

  buildPaymentRows(dataset, indexes).forEach((row) => {
    rows.push({
      id: `day_book_${row.id}`,
      date: row.date,
      entryType: row.transactionType,
      reference: row.reference,
      partyName: row.partyName,
      cashIn: row.direction === "inflow" ? row.amount : 0,
      cashOut: row.direction === "outflow" ? row.amount : 0,
      amount: row.amount
    });
  });

  (Array.isArray(dataset?.expenses) ? dataset.expenses : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `expense_${row?.id || row?.expenseNo || Math.random().toString(16).slice(2)}`,
        date: resolveExpenseDate(row),
        entryType: "Expense",
        reference: String(row?.expenseNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById) || row?.category || "Expense",
        cashIn: 0,
        cashOut: amountFromExpense(row),
        amount: amountFromExpense(row)
      });
    });

  const filtered = rows
    .filter((row) => inDateRange(row.date, fromDate, toDate))
    .sort((left, right) => {
      if (left.date !== right.date) return String(left.date || "").localeCompare(String(right.date || ""));
      return String(left.reference || "").localeCompare(String(right.reference || ""));
    });

  const totals = filtered.reduce(
    (summary, row) => ({
      cashIn: summary.cashIn + row.cashIn,
      cashOut: summary.cashOut + row.cashOut,
      sales: summary.sales + (row.entryType === "Sale" ? row.amount : 0),
      purchases: summary.purchases + (row.entryType === "Purchase" ? row.amount : 0),
      payments: summary.payments + (row.entryType.includes("Payment") ? row.amount : 0),
      expenses: summary.expenses + (row.entryType === "Expense" ? row.amount : 0)
    }),
    { cashIn: 0, cashOut: 0, sales: 0, purchases: 0, payments: 0, expenses: 0 }
  );

  return {
    fromDate,
    toDate,
    rows: filtered,
    totals: {
      ...totals,
      netMovement: totals.cashIn - totals.cashOut
    }
  };
}

export function buildCashFlowReport(dataset, filters = {}) {
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);
  const indexes = buildPartyIndexes(dataset);
  const rows = [];

  buildPaymentRows(dataset, indexes).forEach((row) => {
    rows.push({
      id: `cash_${row.id}`,
      date: row.date,
      transactionType: row.transactionType,
      reference: row.reference,
      partyName: row.partyName,
      cashIn: row.direction === "inflow" ? row.amount : 0,
      cashOut: row.direction === "outflow" ? row.amount : 0,
      netAmount: row.direction === "inflow" ? row.amount : -row.amount
    });
  });

  (Array.isArray(dataset?.expenses) ? dataset.expenses : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `cash_expense_${row?.id || row?.expenseNo || Math.random().toString(16).slice(2)}`,
        date: resolveExpenseDate(row),
        transactionType: "Expense",
        reference: String(row?.expenseNo || row?.id || "").trim(),
        partyName: row?.category || "Expense",
        cashIn: 0,
        cashOut: amountFromExpense(row),
        netAmount: -amountFromExpense(row)
      });
    });

  const filtered = rows
    .filter((row) => inDateRange(row.date, fromDate, toDate))
    .sort((left, right) => {
      if (left.date !== right.date) return String(left.date || "").localeCompare(String(right.date || ""));
      return String(left.reference || "").localeCompare(String(right.reference || ""));
    });

  const totals = filtered.reduce(
    (summary, row) => ({
      cashIn: summary.cashIn + row.cashIn,
      cashOut: summary.cashOut + row.cashOut
    }),
    { cashIn: 0, cashOut: 0 }
  );

  return {
    fromDate,
    toDate,
    rows: filtered,
    totals: {
      ...totals,
      netCashFlow: totals.cashIn - totals.cashOut
    }
  };
}

function buildAllTransactionsBase(dataset) {
  const indexes = buildPartyIndexes(dataset);
  const rows = [];

  (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `tx_sale_${row?.id || row?.invoiceNo || Math.random().toString(16).slice(2)}`,
        date: resolveInvoiceDate(row),
        transactionType: "Sale",
        reference: String(row?.invoiceNo || row?.id || "").trim(),
        partyId: String(row?.partyId || row?.customerId || row?.customer_id || row?.buyer?.id || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        amount: amountFromInvoice(row),
        status: normalizeStatusLabel(row?.status, "Unpaid"),
        note: ""
      });
    });

  (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `tx_purchase_${row?.id || row?.billNumber || Math.random().toString(16).slice(2)}`,
        date: resolvePurchaseDate(row),
        transactionType: "Purchase",
        reference: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
        partyId: String(row?.partyId || row?.supplierId || row?.supplier_id || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        amount: amountFromInvoice(row),
        status: normalizeStatusLabel(row?.status, "Pending"),
        note: ""
      });
    });

  buildPaymentRows(dataset, indexes).forEach((row) => {
    rows.push({
      id: `tx_${row.id}`,
      date: row.date,
      transactionType: row.transactionType,
      reference: row.reference,
      partyId: row.partyId,
      partyName: row.partyName,
      amount: row.amount,
      status: row.status,
      note: row.note
    });
  });

  (Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
    .filter((row) => normalizeText(row?.status) !== "draft")
    .filter((row) => paymentInTdsAmount(row) > 0)
    .forEach((row) => {
      rows.push({
        id: `tx_tds_${row?.id || row?.receiptNo || Math.random().toString(16).slice(2)}`,
        date: resolvePaymentDate(row),
        transactionType: "TDS",
        reference: String(row?.receiptNo || row?.referenceNo || row?.paymentReference || row?.id || "").trim(),
        partyId: String(row?.customerId || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        amount: paymentInTdsAmount(row),
        status: normalizeStatusLabel(row?.status, "Received"),
        note: `TDS deducted${row?.tdsCategory ? ` (${row.tdsCategory})` : ""}`
      });
    });

  (Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
    .filter((row) => normalizeText(row?.status) !== "draft")
    .filter((row) => paymentOutTdsAmount(row) > 0)
    .forEach((row) => {
      rows.push({
        id: `tx_tds_out_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
        date: resolvePaymentDate(row),
        transactionType: "TDS",
        reference: String(row?.paymentNo || row?.referenceNo || row?.paymentReference || row?.id || "").trim(),
        partyId: String(row?.supplierId || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        amount: paymentOutTdsAmount(row),
        status: normalizeStatusLabel(row?.status, "Paid"),
        note: `TDS deducted${row?.tdsCategory ? ` (${row.tdsCategory})` : ""}`
      });
    });

  (Array.isArray(dataset?.legacyCreditNotes) ? dataset.legacyCreditNotes : []).forEach((row) => {
    rows.push({
      id: `tx_credit_legacy_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
      date: resolveCreditDate(row),
      transactionType: "Credit Note",
      reference: String(row?.creditNoteNo || row?.id || "").trim(),
      partyId: String(row?.partyId || row?.customerId || row?.customer_id || ""),
      partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
      amount: amountFromAdjustment(row),
      status: normalizeStatusLabel(row?.status, "Applied"),
      note: ""
    });
  });

  (Array.isArray(dataset?.premiumCreditNotes) ? dataset.premiumCreditNotes : [])
    .filter((row) => normalizeText(row?.status) === "applied")
    .forEach((row) => {
      rows.push({
        id: `tx_credit_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
        date: resolveCreditDate(row),
        transactionType: "Credit Note",
        reference: String(row?.creditNoteNo || row?.id || "").trim(),
        partyId: String(row?.customerId || row?.partyId || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        amount: amountFromAdjustment(row),
        status: normalizeStatusLabel(row?.status, "Applied"),
        note: ""
      });
    });

  (Array.isArray(dataset?.debitNotes) ? dataset.debitNotes : [])
    .filter((row) => normalizeText(row?.status) === "applied")
    .forEach((row) => {
      rows.push({
        id: `tx_debit_${row?.id || row?.debitNoteNo || Math.random().toString(16).slice(2)}`,
        date: resolveDebitDate(row),
        transactionType: "Debit Note",
        reference: String(row?.debitNoteNo || row?.id || "").trim(),
        partyId: String(row?.supplierId || row?.partyId || ""),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        amount: amountFromAdjustment(row),
        status: normalizeStatusLabel(row?.status, "Applied"),
        note: ""
      });
    });

  (Array.isArray(dataset?.expenses) ? dataset.expenses : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .forEach((row) => {
      rows.push({
        id: `tx_expense_${row?.id || row?.expenseNo || Math.random().toString(16).slice(2)}`,
        date: resolveExpenseDate(row),
        transactionType: "Expense",
        reference: String(row?.expenseNo || row?.id || "").trim(),
        partyId: String(row?.partyId || row?.party_id || ""),
        partyName: row?.category || resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        amount: amountFromExpense(row),
        status: normalizeStatusLabel(row?.status, "Posted"),
        note: String(row?.note || row?.notes || "").trim()
      });
    });

  return rows;
}

export function buildAllTransactionsReport(dataset, filters = {}, options = {}) {
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);
  const transactionType = String(filters.transactionType || "All").trim() || "All";
  const partyId = String(filters.partyId || "").trim();
  const search = normalizeText(filters.search);
  const sortKey = filters.sortKey || "date";
  const sortDirection = filters.sortDirection === "asc" ? "asc" : "desc";

  const rows = buildAllTransactionsBase(dataset)
    .filter((row) => inDateRange(row.date, fromDate, toDate))
    .filter((row) => transactionType === "All" || row.transactionType === transactionType)
    .filter((row) => !partyId || String(row.partyId || "") === partyId)
    .filter((row) => {
      if (!search) return true;
      return normalizeText([row.date, row.transactionType, row.reference, row.partyName, row.status, row.note].join(" ")).includes(search);
    })
    .sort((left, right) => compareValues(left?.[sortKey], right?.[sortKey], sortDirection));

  return {
    fromDate,
    toDate,
    transactionType,
    partyId,
    search,
    sortKey,
    sortDirection,
    allRows: rows,
    ...paginate(rows, options.page, options.pageSize)
  };
}

export function buildTdsReport(dataset, filters = {}) {
  const organizationCountry = String(
    filters.organizationCountry || filters.country || dataset?.organizationCountry || ""
  ).trim();
  if (!isIndiaCountry(organizationCountry)) {
    return {
      fromDate: toIsoDate(filters.fromDate),
      toDate: toIsoDate(filters.toDate),
      partyId: String(filters.partyId || "").trim(),
      rows: [],
      totals: {
        totalTds: 0,
        customers: 0,
        suppliers: 0,
        documents: 0
      }
    };
  }

  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);
  const partyId = String(filters.partyId || "").trim();
  const partyType = normalizePartyType(filters.partyType || PARTY_TYPES.customer);
  const indexes = buildPartyIndexes(dataset);
  const rows = [];

  (Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
    .filter(() => partyType === PARTY_TYPES.customer)
    .filter((row) => normalizeText(row?.status) !== "draft")
    .filter((row) => inDateRange(resolvePaymentDate(row), fromDate, toDate))
    .filter((row) => matchesPartyId(row, partyId, PARTY_TYPES.customer))
    .forEach((row) => {
      const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
      const positiveTdsAllocations = allocations.filter(
        (allocation) =>
          normalizeText(allocation?.documentType || "invoice") === "invoice" &&
          paymentInAllocationTdsShare(row, allocation) > 0
      );

      if (!positiveTdsAllocations.length && paymentInTdsAmount(row) > 0) {
        rows.push({
          id: `tds_${row?.id || row?.receiptNo || Math.random().toString(16).slice(2)}`,
          date: resolvePaymentDate(row),
          source: "Payment In",
          partyType: PARTY_TYPES.customer,
          partyId: String(row?.customerId || ""),
          partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
          invoiceReference: "-",
          tdsAmount: paymentInTdsAmount(row),
          category: row?.tdsCategory || "Other",
          status: normalizeStatusLabel(row?.status, "Received")
        });
        return;
      }

      positiveTdsAllocations.forEach((allocation, index) => {
        rows.push({
          id: `tds_${row?.id || row?.receiptNo || Math.random().toString(16).slice(2)}_${index}`,
          date: resolvePaymentDate(row),
          source: "Payment In",
          partyType: PARTY_TYPES.customer,
          partyId: String(row?.customerId || ""),
          partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
          invoiceReference: String(allocation?.invoiceNo || allocation?.invoiceId || "-").trim() || "-",
          tdsAmount: paymentInAllocationTdsShare(row, allocation),
          category: row?.tdsCategory || "Other",
          status: normalizeStatusLabel(row?.status, "Received")
        });
      });
    });

  (Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
    .filter(() => partyType === PARTY_TYPES.supplier)
    .filter((row) => normalizeText(row?.status) !== "draft")
    .filter((row) => inDateRange(resolvePaymentDate(row), fromDate, toDate))
    .filter((row) => matchesPartyId(row, partyId, PARTY_TYPES.supplier))
    .forEach((row) => {
      const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
      const positiveTdsAllocations = allocations.filter(
        (allocation) => paymentOutAllocationTdsShare(row, allocation) > 0
      );

      if (!positiveTdsAllocations.length && paymentOutTdsAmount(row) > 0) {
        rows.push({
          id: `tds_out_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
          date: resolvePaymentDate(row),
          source: "Payment Out",
          partyType: PARTY_TYPES.supplier,
          partyId: String(row?.supplierId || ""),
          partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
          invoiceReference: "-",
          tdsAmount: paymentOutTdsAmount(row),
          category: row?.tdsCategory || "Other",
          status: normalizeStatusLabel(row?.status, "Paid")
        });
        return;
      }

      positiveTdsAllocations.forEach((allocation, index) => {
        rows.push({
          id: `tds_out_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}_${index}`,
          date: resolvePaymentDate(row),
          source: "Payment Out",
          partyType: PARTY_TYPES.supplier,
          partyId: String(row?.supplierId || ""),
          partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
          invoiceReference: String(allocation?.billNo || allocation?.billId || "-").trim() || "-",
          tdsAmount: paymentOutAllocationTdsShare(row, allocation),
          category: row?.tdsCategory || "Other",
          status: normalizeStatusLabel(row?.status, "Paid")
        });
      });
    });

  rows.sort((left, right) => {
    if (left.date !== right.date) return String(left.date || "").localeCompare(String(right.date || ""));
    return String(left.partyName || "").localeCompare(String(right.partyName || ""));
  });

  return {
    fromDate,
    toDate,
    partyType,
    partyId,
    rows,
    totals: {
      totalTds: rows.reduce((sum, row) => sum + row.tdsAmount, 0),
      customers: new Set(rows.filter((row) => row.partyType === PARTY_TYPES.customer).map((row) => row.partyId || row.partyName)).size,
      suppliers: new Set(rows.filter((row) => row.partyType === PARTY_TYPES.supplier).map((row) => row.partyId || row.partyName)).size,
      documents: rows.filter((row) => row.invoiceReference !== "-").length
    }
  };
}

function findLatestActivityDate(dataset, party) {
  const partyType = normalizePartyType(party?.type);
  const candidates = [];

  (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => partyType === PARTY_TYPES.customer && matchesPartyId(row, party.id, partyType))
    .forEach((row) => candidates.push(resolveInvoiceDate(row)));

  (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
    .filter((row) => partyType === PARTY_TYPES.supplier && matchesPartyId(row, party.id, partyType))
    .forEach((row) => candidates.push(resolvePurchaseDate(row)));

  (Array.isArray(dataset?.legacyPayments) ? dataset.legacyPayments : [])
    .filter((row) => matchesPartyId(row, party.id, partyType))
    .forEach((row) => candidates.push(resolvePaymentDate(row)));

  (Array.isArray(dataset?.paymentIns) ? dataset.paymentIns : [])
    .filter((row) => partyType === PARTY_TYPES.customer && matchesPartyId(row, party.id, partyType))
    .forEach((row) => candidates.push(resolvePaymentDate(row)));

  (Array.isArray(dataset?.paymentOuts) ? dataset.paymentOuts : [])
    .filter((row) => partyType === PARTY_TYPES.supplier && matchesPartyId(row, party.id, partyType))
    .forEach((row) => candidates.push(resolvePaymentDate(row)));

  return candidates.filter(Boolean).sort().pop() || "";
}

export function buildAllPartiesReport(dataset, filters = {}) {
  const partyType = filters.partyType ? normalizePartyType(filters.partyType) : "";
  const search = normalizeText(filters.search);
  const paymentByInvoice = customerPaymentAppliedByInvoice(dataset);
  const creditByInvoice = customerCreditAppliedByInvoice(dataset);
  const paymentByBill = supplierPaymentAppliedByBill(dataset);
  const debitByBill = supplierDebitAppliedByBill(dataset);

  const rows = (Array.isArray(dataset?.parties) ? dataset.parties : [])
    .filter((party) => !partyType || matchesPartyType(party, partyType))
    .filter((party) => {
      if (!search) return true;
      return normalizeText([party?.name, party?.phone, party?.email, party?.address, party?.city, party?.state].join(" ")).includes(search);
    })
    .map((party) => {
      const normalizedPartyType = normalizePartyType(party?.type);
      let outstanding = 0;
      let maxOverdueDays = 0;

      if (normalizedPartyType === PARTY_TYPES.customer) {
        (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
          .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
          .filter((row) => matchesPartyId(row, party?.id, PARTY_TYPES.customer))
          .forEach((row) => {
            const balance = resolveInvoiceBalance(row, paymentByInvoice, creditByInvoice);
            outstanding += balance;
            if (balance > 0) {
              maxOverdueDays = Math.max(maxOverdueDays, ageInDays(resolveInvoiceDate(row), todayIsoDate()));
            }
          });
      } else {
        (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
          .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
          .filter((row) => matchesPartyId(row, party?.id, PARTY_TYPES.supplier))
          .forEach((row) => {
            const balance = resolvePurchaseBalance(row, paymentByBill, debitByBill);
            outstanding += balance;
            if (balance > 0) {
              maxOverdueDays = Math.max(maxOverdueDays, ageInDays(resolvePurchaseDate(row), todayIsoDate()));
            }
          });
      }

      const fallbackFinancials = computePartyFinancials(party);
      return {
        id: String(party?.id || ""),
        name: String(party?.name || "").trim(),
        type: normalizedPartyType,
        phone: String(party?.phone || "").trim(),
        email: String(party?.email || "").trim(),
        outstanding: Number(outstanding.toFixed(2)),
        maxOverdueDays: maxOverdueDays || fallbackFinancials.maxOverdueDays,
        latestActivityDate: findLatestActivityDate(dataset, party)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    partyType: partyType || "All",
    search,
    rows,
    totals: {
      parties: rows.length,
      totalOutstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
      overdueParties: rows.filter((row) => row.maxOverdueDays > 0).length
    }
  };
}

export function buildProfitLossReport(dataset, filters = {}) {
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);

  const totalSales = (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolveInvoiceDate(row), fromDate, toDate))
    .reduce((sum, row) => sum + amountFromInvoice(row), 0);

  const totalPurchases = (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolvePurchaseDate(row), fromDate, toDate))
    .reduce((sum, row) => sum + amountFromInvoice(row), 0);

  const totalExpenses = (Array.isArray(dataset?.expenses) ? dataset.expenses : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolveExpenseDate(row), fromDate, toDate))
    .reduce((sum, row) => sum + amountFromExpense(row), 0);

  const grossProfit = totalSales - totalPurchases;
  const netProfit = grossProfit - totalExpenses;

  const expenseByCategory = new Map();
  (Array.isArray(dataset?.expenses) ? dataset.expenses : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolveExpenseDate(row), fromDate, toDate))
    .forEach((row) => {
      const key = String(row?.category || "Uncategorized").trim() || "Uncategorized";
      expenseByCategory.set(key, (expenseByCategory.get(key) || 0) + amountFromExpense(row));
    });

  const expenseRows = Array.from(expenseByCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);

  return {
    fromDate,
    toDate,
    totals: {
      totalSales,
      totalPurchase: totalPurchases,
      totalPurchases,
      totalExpenses,
      grossProfit,
      grossLoss: grossProfit < 0 ? Math.abs(grossProfit) : 0,
      grossResultType: grossProfit < 0 ? "loss" : "profit",
      netProfit,
      netLoss: netProfit < 0 ? Math.abs(netProfit) : 0,
      netResultType: netProfit < 0 ? "loss" : "profit"
    },
    expenseRows
  };
}

export function buildGstReport(dataset, filters = {}) {
  const organizationCountry = String(
    filters.organizationCountry || filters.country || dataset?.organizationCountry || ""
  ).trim();
  const fromDate = toIsoDate(filters.fromDate);
  const toDate = toIsoDate(filters.toDate);

  if (!isIndiaCountry(organizationCountry)) {
    return {
      fromDate,
      toDate,
      rows: [],
      totals: {
        outputGst: 0,
        inputGst: 0,
        gstPayable: 0,
        outputCgst: 0,
        outputSgst: 0,
        outputIgst: 0,
        inputCgst: 0,
        inputSgst: 0,
        inputIgst: 0,
        payableCgst: 0,
        payableSgst: 0,
        payableIgst: 0
      }
    };
  }

  const indexes = buildPartyIndexes(dataset);
  const salesRows = (Array.isArray(dataset?.invoices) ? dataset.invoices : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolveInvoiceDate(row), fromDate, toDate))
    .map((row) => {
      const taxTotals = taxTotalsFromRow(row);
      return {
        id: `gst_sale_${row?.id || row?.invoiceNo || Math.random().toString(16).slice(2)}`,
        date: resolveInvoiceDate(row),
        reference: String(row?.invoiceNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.customer, indexes.partiesById),
        gstAmount: taxTotals.taxTotal,
        cgst: taxTotals.cgst,
        sgst: taxTotals.sgst,
        igst: taxTotals.igst
      };
    })
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));

  const purchaseRows = (Array.isArray(dataset?.purchases) ? dataset.purchases : [])
    .filter((row) => normalizeText(row?.status) !== "draft" && normalizeText(row?.status) !== "cancelled")
    .filter((row) => inDateRange(resolvePurchaseDate(row), fromDate, toDate))
    .map((row) => {
      const taxTotals = taxTotalsFromRow(row);
      return {
        id: `gst_purchase_${row?.id || row?.billNumber || Math.random().toString(16).slice(2)}`,
        date: resolvePurchaseDate(row),
        reference: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
        partyName: resolvePartyName(row, PARTY_TYPES.supplier, indexes.partiesById),
        gstAmount: taxTotals.taxTotal,
        cgst: taxTotals.cgst,
        sgst: taxTotals.sgst,
        igst: taxTotals.igst
      };
    });

  const outputTotals = salesRows.reduce(
    (summary, row) => ({
      outputGst: summary.outputGst + row.gstAmount,
      outputCgst: summary.outputCgst + row.cgst,
      outputSgst: summary.outputSgst + row.sgst,
      outputIgst: summary.outputIgst + row.igst
    }),
    { outputGst: 0, outputCgst: 0, outputSgst: 0, outputIgst: 0 }
  );

  const inputTotals = purchaseRows.reduce(
    (summary, row) => ({
      inputGst: summary.inputGst + row.gstAmount,
      inputCgst: summary.inputCgst + row.cgst,
      inputSgst: summary.inputSgst + row.sgst,
      inputIgst: summary.inputIgst + row.igst
    }),
    { inputGst: 0, inputCgst: 0, inputSgst: 0, inputIgst: 0 }
  );

  return {
    fromDate,
    toDate,
    rows: salesRows,
    totals: {
      ...outputTotals,
      ...inputTotals,
      gstPayable: outputTotals.outputGst - inputTotals.inputGst,
      payableCgst: outputTotals.outputCgst - inputTotals.inputCgst,
      payableSgst: outputTotals.outputSgst - inputTotals.inputSgst,
      payableIgst: outputTotals.outputIgst - inputTotals.inputIgst
    }
  };
}
