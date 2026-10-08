import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { openingBalanceSigned, parseNumber, toIsoDate } from "../modules/parties/utils";
import {
  listCustomerAdvanceWalletHistory,
  listPaymentIn,
  paymentInsightsByCustomer
} from "../modules/paymentIn/store";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE } from "../modules/paymentIn/countryConfig";
import { listCreditNotes as listPremiumCreditNotes } from "../modules/creditNote/store";
import { listPaymentOut } from "../modules/paymentOut/store";
import { listDebitNotes } from "../modules/debitNote/store";
import { creditNotesList, creditNotesSyncFromRemote } from "./creditNotes.service";
import { invoicesList, invoicesSyncFromRemote } from "./invoices.service";
import { paymentsList, paymentsSyncFromRemote } from "./payments.service";
import { purchasesList, purchasesSyncFromRemote } from "./purchases.service";

const PARTY_TYPES = {
  customer: "Customer",
  supplier: "Supplier"
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePartyType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "supplier") return PARTY_TYPES.supplier;
  return PARTY_TYPES.customer;
}

function sortByName(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function sortTransactions(left, right) {
  const leftDate = String(left?.date || "");
  const rightDate = String(right?.date || "");
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const leftKey = `${left?.transaction_type || ""}:${left?.reference_number || ""}:${left?.id || ""}`;
  const rightKey = `${right?.transaction_type || ""}:${right?.reference_number || ""}:${right?.id || ""}`;
  return leftKey.localeCompare(rightKey);
}

function normalizeParty(party) {
  return {
    id: String(party?.id || ""),
    type: normalizePartyType(party?.type),
    name: String(party?.name || "").trim(),
    phone: String(party?.phone || "").trim(),
    email: String(party?.email || "").trim(),
    address: String(party?.address || "").trim()
  };
}

function resolvePaymentCountryCode(value) {
  const raw = String(value || "").trim();
  if (raw === "LK") return "SL";
  if (raw === "GB") return "UK";
  if (raw && raw in COUNTRY_CONFIG) return raw;
  return COUNTRY_NAME_TO_CODE[raw] || "IN";
}

function matchesPartyType(party, partyType) {
  return normalizePartyType(party?.type) === normalizePartyType(partyType);
}

function findPartyById(partyId, partyType = "") {
  const safeType = partyType ? normalizePartyType(partyType) : "";
  return listParties().find((party) => {
    if (String(party?.id || "") !== String(partyId || "")) return false;
    return safeType ? matchesPartyType(party, safeType) : true;
  }) || null;
}

function getPartyCandidates(row, partyType) {
  const normalizedType = normalizePartyType(partyType);
  if (normalizedType === PARTY_TYPES.supplier) {
    return [
      row?.partyId,
      row?.party_id,
      row?.supplierId,
      row?.supplier_id,
      row?.vendorId
    ];
  }
  return [
    row?.partyId,
    row?.party_id,
    row?.customerId,
    row?.customer_id,
    row?.buyer?.id
  ];
}

function matchesPartyId(row, partyId, partyType) {
  const safePartyId = String(partyId || "").trim();
  if (!safePartyId) return false;
  return getPartyCandidates(row, partyType).some((entry) => String(entry || "").trim() === safePartyId);
}

function partyNameFromRow(row, partyType) {
  const normalizedType = normalizePartyType(partyType);
  if (normalizedType === PARTY_TYPES.supplier) {
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

function amountFromPayment(row, partyType) {
  const normalizedType = normalizePartyType(partyType);
  return Math.max(
    0,
    parseNumber(
      normalizedType === PARTY_TYPES.supplier
        ? row?.totals?.amountPaid ?? row?.totals?.amountApplied ?? row?.amountPaid ?? row?.amountApplied ?? row?.amount
        : row?.totals?.amountReceived ?? row?.totals?.amountApplied ?? row?.amountReceived ?? row?.amountApplied ?? row?.amount
    )
  );
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

function uniqueTransactions(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = `${row.transaction_type}:${row.reference_number}:${row.date}:${row.debit}:${row.credit}`;
    if (!map.has(key)) map.set(key, row);
  });
  return Array.from(map.values()).sort(sortTransactions);
}

function buildCustomerStatementTransactions(party) {
  return uniqueTransactions([
    ...invoicesList()
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
      .map((row) => ({
        id: `invoice_${row?.id || row?.invoiceNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.invoiceDate || row?.date || row?.created_at),
        transaction_type: "Invoice",
        reference_number: String(row?.invoiceNo || row?.id || "").trim(),
        debit: amountFromInvoice(row),
        credit: 0
      })),
    ...paymentsList()
      .filter((row) => String(row?.direction || "").trim().toUpperCase() === "IN")
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
      .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PI:"))
      .map((row) => ({
        id: `payment_legacy_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.date || row?.payment_date || row?.created_at),
        transaction_type: "Payment",
        reference_number: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
        debit: 0,
        credit: amountFromPayment(row, PARTY_TYPES.customer)
      }))
      .filter((row) => row.credit > 0),
    ...listPaymentIn()
      .filter((row) => String(row?.status || "").trim().toLowerCase() !== "draft")
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
      .map((row) => ({
        id: `payment_premium_${row?.id || row?.receiptNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.paymentDate || row?.created_at),
        transaction_type: "Payment",
        reference_number: String(row?.receiptNo || row?.referenceNo || row?.paymentReference || row?.id || "").trim(),
        debit: 0,
        credit: amountFromPayment(row, PARTY_TYPES.customer)
      }))
      .filter((row) => row.credit > 0),
    ...creditNotesList()
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
      .map((row) => ({
        id: `credit_legacy_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.creditDate || row?.credit_note_date || row?.created_at),
        transaction_type: "Credit Note",
        reference_number: String(row?.creditNoteNo || row?.id || "").trim(),
        debit: 0,
        credit: amountFromAdjustment(row)
      }))
      .filter((row) => row.credit > 0),
    ...listPremiumCreditNotes()
      .filter((row) => String(row?.status || "").trim().toLowerCase() === "applied")
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.customer))
      .map((row) => ({
        id: `credit_premium_${row?.id || row?.creditNoteNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.creditNoteDate || row?.creditDate || row?.created_at),
        transaction_type: "Credit Note",
        reference_number: String(row?.creditNoteNo || row?.id || "").trim(),
        debit: 0,
        credit: amountFromAdjustment(row)
      }))
      .filter((row) => row.credit > 0)
  ]);
}

function buildSupplierStatementTransactions(party) {
  return uniqueTransactions([
    ...purchasesList()
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
      .map((row) => ({
        id: `purchase_${row?.id || row?.billNumber || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.billDate || row?.invoiceDate || row?.date || row?.created_at),
        transaction_type: "Purchase Bill",
        reference_number: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
        debit: amountFromInvoice(row),
        credit: 0
      })),
    ...paymentsList()
      .filter((row) => String(row?.direction || "").trim().toUpperCase() === "OUT")
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
      .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PO:"))
      .map((row) => ({
        id: `payment_legacy_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.date || row?.payment_date || row?.created_at),
        transaction_type: "Payment",
        reference_number: String(row?.paymentNo || row?.referenceNo || row?.reference_no || row?.id || "").trim(),
        debit: 0,
        credit: amountFromPayment(row, PARTY_TYPES.supplier)
      }))
      .filter((row) => row.credit > 0),
    ...listPaymentOut()
      .filter((row) => String(row?.status || "").trim().toLowerCase() !== "draft")
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
      .map((row) => ({
        id: `payment_premium_${row?.id || row?.paymentNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.paymentDate || row?.created_at),
        transaction_type: "Payment",
        reference_number: String(row?.paymentNo || row?.referenceNo || row?.transactionId || row?.id || "").trim(),
        debit: 0,
        credit: amountFromPayment(row, PARTY_TYPES.supplier)
      }))
      .filter((row) => row.credit > 0),
    ...listDebitNotes()
      .filter((row) => String(row?.status || "").trim().toLowerCase() === "applied")
      .filter((row) => matchesPartyId(row, party.id, PARTY_TYPES.supplier))
      .map((row) => ({
        id: `debit_${row?.id || row?.debitNoteNo || Math.random().toString(16).slice(2)}`,
        date: toIsoDate(row?.debitNoteDate || row?.created_at),
        transaction_type: "Debit Note",
        reference_number: String(row?.debitNoteNo || row?.id || "").trim(),
        debit: 0,
        credit: amountFromAdjustment(row)
      }))
      .filter((row) => row.credit > 0)
  ]);
}

function buildStatementTransactions(party) {
  if (!party) return [];
  return normalizePartyType(party?.type) === PARTY_TYPES.supplier
    ? buildSupplierStatementTransactions(party)
    : buildCustomerStatementTransactions(party);
}

function buildStatementResponse(party, transactions, fromDate, toDate) {
  const safeFrom = toIsoDate(fromDate);
  const safeTo = toIsoDate(toDate);
  if (!party) {
    return {
      party: null,
      opening_balance: 0,
      transactions: [],
      closing_balance: 0,
      totals: { debit: 0, credit: 0, count: 0 },
      period: {
        from_date: safeFrom,
        to_date: safeTo,
        as_of_date: safeTo || todayIsoDate()
      }
    };
  }

  let openingBalance = openingBalanceSigned(party);
  transactions.forEach((row) => {
    if (safeFrom && row.date && row.date < safeFrom) {
      openingBalance += parseNumber(row.debit) - parseNumber(row.credit);
    }
  });

  const filtered = transactions.filter((row) => {
    if (safeFrom && row.date && row.date < safeFrom) return false;
    if (safeTo && row.date && row.date > safeTo) return false;
    return true;
  });

  let runningBalance = openingBalance;
  const reportTransactions = filtered.map((row) => {
    runningBalance += parseNumber(row.debit) - parseNumber(row.credit);
    return {
      id: row.id,
      date: row.date,
      transaction_type: row.transaction_type,
      reference_number: row.reference_number,
      debit: parseNumber(row.debit),
      credit: parseNumber(row.credit),
      running_balance: runningBalance
    };
  });

  return {
    party: normalizeParty(party),
    opening_balance: openingBalance,
    transactions: reportTransactions,
    closing_balance: runningBalance,
    totals: {
      debit: reportTransactions.reduce((sum, row) => sum + parseNumber(row.debit), 0),
      credit: reportTransactions.reduce((sum, row) => sum + parseNumber(row.credit), 0),
      count: reportTransactions.length
    },
    period: {
      from_date: safeFrom,
      to_date: safeTo,
      as_of_date: safeTo || todayIsoDate()
    }
  };
}

function customerPaymentAppliedByInvoice(asOfDate) {
  const map = new Map();

  paymentsList()
    .filter((row) => String(row?.direction || "").trim().toUpperCase() === "IN")
    .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PI:"))
    .filter((row) => {
      const paymentDate = toIsoDate(row?.date || row?.payment_date || row?.created_at);
      return !asOfDate || !paymentDate || paymentDate <= asOfDate;
    })
    .forEach((row) => {
      const invoiceId = String(row?.invoiceId || row?.invoice_id || "").trim();
      if (!invoiceId) return;
      map.set(invoiceId, (map.get(invoiceId) || 0) + parseNumber(row?.amount));
    });

  listPaymentIn()
    .filter((row) => String(row?.status || "").trim().toLowerCase() !== "draft")
    .filter((row) => {
      const paymentDate = toIsoDate(row?.paymentDate || row?.created_at);
      return !asOfDate || !paymentDate || paymentDate <= asOfDate;
    })
    .forEach((row) => {
      const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
      allocations.forEach((line) => {
        if (String(line?.documentType || "invoice").toLowerCase() !== "invoice") return;
        const invoiceId = String(line?.invoiceId || "").trim();
        if (!invoiceId) return;
        map.set(invoiceId, (map.get(invoiceId) || 0) + Math.max(0, parseNumber(line?.applyAmount)));
      });
    });

  return map;
}

function customerCreditAppliedByInvoice(asOfDate) {
  const map = new Map();

  creditNotesList()
    .filter((row) => {
      const creditDate = toIsoDate(row?.creditDate || row?.credit_note_date || row?.created_at);
      return !asOfDate || !creditDate || creditDate <= asOfDate;
    })
    .forEach((row) => {
      const invoiceId = String(row?.referenceInvoiceId || row?.related_invoice_id || "").trim();
      if (!invoiceId) return;
      map.set(invoiceId, (map.get(invoiceId) || 0) + amountFromAdjustment(row));
    });

  listPremiumCreditNotes()
    .filter((row) => String(row?.status || "").trim().toLowerCase() === "applied")
    .filter((row) => {
      const creditDate = toIsoDate(row?.creditNoteDate || row?.creditDate || row?.created_at);
      return !asOfDate || !creditDate || creditDate <= asOfDate;
    })
    .forEach((row) => {
      const invoiceId = String(row?.linkedInvoiceId || "").trim();
      if (!invoiceId) return;
      map.set(invoiceId, (map.get(invoiceId) || 0) + amountFromAdjustment(row));
    });

  return map;
}

function supplierPaymentAppliedByBill(asOfDate) {
  const map = new Map();

  paymentsList()
    .filter((row) => String(row?.direction || "").trim().toUpperCase() === "OUT")
    .filter((row) => !String(row?.referenceNo || row?.reference_no || "").startsWith("PO:"))
    .filter((row) => {
      const paymentDate = toIsoDate(row?.date || row?.payment_date || row?.created_at);
      return !asOfDate || !paymentDate || paymentDate <= asOfDate;
    })
    .forEach((row) => {
      const billId = String(row?.billId || row?.bill_id || "").trim();
      if (!billId) return;
      map.set(billId, (map.get(billId) || 0) + parseNumber(row?.amount));
    });

  listPaymentOut()
    .filter((row) => String(row?.status || "").trim().toLowerCase() !== "draft")
    .filter((row) => {
      const paymentDate = toIsoDate(row?.paymentDate || row?.created_at);
      return !asOfDate || !paymentDate || paymentDate <= asOfDate;
    })
    .forEach((row) => {
      const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
      allocations.forEach((line) => {
        const billId = String(line?.billId || "").trim();
        if (!billId) return;
        map.set(billId, (map.get(billId) || 0) + Math.max(0, parseNumber(line?.applyAmount)));
      });
    });

  return map;
}

function supplierDebitAppliedByBill(asOfDate) {
  const map = new Map();

  listDebitNotes()
    .filter((row) => String(row?.status || "").trim().toLowerCase() === "applied")
    .filter((row) => {
      const noteDate = toIsoDate(row?.debitNoteDate || row?.created_at);
      return !asOfDate || !noteDate || noteDate <= asOfDate;
    })
    .forEach((row) => {
      const billId = String(row?.linkedPurchaseInvoiceId || "").trim();
      if (!billId) return;
      map.set(billId, (map.get(billId) || 0) + amountFromAdjustment(row));
    });

  return map;
}

function ageInDays(documentDate, asOfDate) {
  const document = new Date(`${toIsoDate(documentDate)}T00:00:00`);
  const asOf = new Date(`${toIsoDate(asOfDate)}T00:00:00`);
  if (Number.isNaN(document.getTime()) || Number.isNaN(asOf.getTime())) return 0;
  return Math.floor((asOf.getTime() - document.getTime()) / 86400000);
}

function resolveAgingBucket(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "bucket_0_30";
  if (days <= 60) return "bucket_31_60";
  if (days <= 90) return "bucket_61_90";
  return "bucket_above_90";
}

function buildCustomerOutstandingDocuments(asOfDate) {
  const paymentsByInvoice = customerPaymentAppliedByInvoice(asOfDate);
  const creditsByInvoice = customerCreditAppliedByInvoice(asOfDate);

  return invoicesList()
    .map((row) => {
      const documentDate = toIsoDate(row?.invoiceDate || row?.date || row?.created_at);
      if (asOfDate && documentDate && documentDate > asOfDate) return null;
      const totalAmount = amountFromInvoice(row);
      const invoiceId = String(row?.id || "").trim();
      const outstanding = Math.max(
        0,
        totalAmount - (paymentsByInvoice.get(invoiceId) || 0) - (creditsByInvoice.get(invoiceId) || 0)
      );
      return {
        id: invoiceId,
        party_id: String(row?.partyId || row?.customerId || row?.buyer?.id || "").trim(),
        party_name: partyNameFromRow(row, PARTY_TYPES.customer),
        date: documentDate,
        reference_number: String(row?.invoiceNo || row?.id || "").trim(),
        amount: outstanding
      };
    })
    .filter(Boolean)
    .filter((row) => row.party_id && row.amount > 0);
}

function buildSupplierOutstandingDocuments(asOfDate) {
  const paymentsByBill = supplierPaymentAppliedByBill(asOfDate);
  const debitByBill = supplierDebitAppliedByBill(asOfDate);

  return purchasesList()
    .map((row) => {
      const documentDate = toIsoDate(row?.billDate || row?.invoiceDate || row?.date || row?.created_at);
      if (asOfDate && documentDate && documentDate > asOfDate) return null;
      const totalAmount = amountFromInvoice(row);
      const billId = String(row?.id || "").trim();
      const outstanding = Math.max(
        0,
        totalAmount - (paymentsByBill.get(billId) || 0) - (debitByBill.get(billId) || 0)
      );
      return {
        id: billId,
        party_id: String(row?.partyId || row?.supplierId || row?.vendorId || "").trim(),
        party_name: partyNameFromRow(row, PARTY_TYPES.supplier),
        date: documentDate,
        reference_number: String(row?.billNumber || row?.invoiceNo || row?.id || "").trim(),
        amount: outstanding
      };
    })
    .filter(Boolean)
    .filter((row) => row.party_id && row.amount > 0);
}

function buildAgingSummary({ partyType, partyId = "", toDate = "" }) {
  const normalizedType = normalizePartyType(partyType);
  const safePartyId = String(partyId || "").trim();
  const asOfDate = toIsoDate(toDate) || todayIsoDate();
  const relevantParties = listParties()
    .filter((party) => matchesPartyType(party, normalizedType))
    .filter((party) => !safePartyId || String(party?.id || "") === safePartyId)
    .sort(sortByName);

  const rowsByPartyId = new Map(
    relevantParties.map((party) => [
      String(party.id || ""),
      {
        party_id: String(party.id || ""),
        party_name: String(party.name || "").trim(),
        total_outstanding: 0,
        current: 0,
        bucket_0_30: 0,
        bucket_31_60: 0,
        bucket_61_90: 0,
        bucket_above_90: 0
      }
    ])
  );

  const outstandingDocuments =
    normalizedType === PARTY_TYPES.supplier
      ? buildSupplierOutstandingDocuments(asOfDate)
      : buildCustomerOutstandingDocuments(asOfDate);

  outstandingDocuments
    .filter((row) => !safePartyId || String(row.party_id || "") === safePartyId)
    .forEach((row) => {
      const summaryRow =
        rowsByPartyId.get(String(row.party_id || "")) ||
        {
          party_id: String(row.party_id || ""),
          party_name: String(row.party_name || "").trim(),
          total_outstanding: 0,
          current: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_above_90: 0
        };
      const bucket = resolveAgingBucket(ageInDays(row.date, asOfDate));
      summaryRow.total_outstanding += parseNumber(row.amount);
      summaryRow[bucket] += parseNumber(row.amount);
      rowsByPartyId.set(summaryRow.party_id, summaryRow);
    });

  return Array.from(rowsByPartyId.values())
    .filter((row) => safePartyId || row.total_outstanding > 0)
    .sort((left, right) => {
      if (right.total_outstanding !== left.total_outstanding) {
        return right.total_outstanding - left.total_outstanding;
      }
      return String(left.party_name || "").localeCompare(String(right.party_name || ""));
    });
}

async function syncLocalReportSources() {
  try {
    await Promise.all([
      syncPartiesFromRemote(),
      invoicesSyncFromRemote(),
      purchasesSyncFromRemote(),
      paymentsSyncFromRemote(),
      creditNotesSyncFromRemote()
    ]);
  } catch {
    // Continue with cached local data.
  }
}

export async function listPartyReportParties({ partyType = PARTY_TYPES.customer } = {}) {
  await syncLocalReportSources();
  return listParties()
    .filter((party) => matchesPartyType(party, partyType))
    .sort(sortByName)
    .map(normalizeParty);
}

export async function fetchPartyWiseStatementReport({
  partyType = PARTY_TYPES.customer,
  partyId = "",
  fromDate = "",
  toDate = ""
} = {}) {
  const normalizedType = normalizePartyType(partyType);
  const safePartyId = String(partyId || "").trim();
  const safeFrom = toIsoDate(fromDate);
  const safeTo = toIsoDate(toDate);
  if (safeFrom && safeTo && safeFrom > safeTo) {
    throw new Error("From Date cannot be after To Date.");
  }

  await syncLocalReportSources();

  const party = safePartyId ? findPartyById(safePartyId, normalizedType) : null;
  if (safePartyId && !party) {
    throw new Error("Selected party was not found.");
  }

  const statement = buildStatementResponse(party, buildStatementTransactions(party), safeFrom, safeTo);
  const agingSummary = buildAgingSummary({
    partyType: normalizedType,
    partyId: safePartyId,
    toDate: safeTo
  });

  return {
    party_type: normalizedType,
    party: statement.party,
    period: statement.period,
    opening_balance: statement.opening_balance,
    transactions: statement.transactions,
    closing_balance: statement.closing_balance,
    totals: statement.totals,
    advance_wallet:
      normalizedType === PARTY_TYPES.customer && party
        ? paymentInsightsByCustomer(resolvePaymentCountryCode(party.country), party.id).advanceWallet
        : 0,
    wallet_history:
      normalizedType === PARTY_TYPES.customer && party
        ? listCustomerAdvanceWalletHistory(resolvePaymentCountryCode(party.country), party.id)
        : [],
    aging_summary: agingSummary
  };
}

export async function listCustomerStatementCustomers() {
  return listPartyReportParties({ partyType: PARTY_TYPES.customer });
}

export async function fetchCustomerStatementReport({ customerId, fromDate = "", toDate = "" } = {}) {
  return fetchPartyWiseStatementReport({
    partyType: PARTY_TYPES.customer,
    partyId: customerId,
    fromDate,
    toDate
  });
}
