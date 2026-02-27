import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightCircle,
  ClipboardList,
  FileClock,
  Package,
  ReceiptIndianRupee,
  Wallet
} from "lucide-react";
import Card from "../components/Card";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { purchasesList, purchasesSyncFromRemote } from "../services/purchases.service";
import { paymentsList, paymentsSyncFromRemote } from "../services/payments.service";
import { computeItemStock, listItems, syncItemsFromRemote } from "../modules/items/store";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { mapOpenBillsByCountry } from "../modules/paymentOut/store";
import { useOrganization } from "../context/OrganizationContext";
import {
  isOrganizationScopedStorageEventKey,
  LS_KEYS,
  lsGetOrganizationScoped
} from "../services/storage";

const COUNTRY_ALIAS = {
  india: "india",
  in: "india",
  "sri lanka": "sri lanka",
  lk: "sri lanka",
  sl: "sri lanka",
  uae: "uae",
  ae: "uae",
  usa: "usa",
  us: "usa",
  "united states": "usa",
  uk: "uk",
  gb: "uk",
  "united kingdom": "uk",
  ireland: "ireland",
  ie: "ireland",
  singapore: "singapore",
  sg: "singapore"
};

const CREDIT_NOTE_KEY = "creditNotesPremiumV1";
const DEBIT_NOTE_KEY = "debitNotesPremiumV1";
const PAYMENT_IN_KEY = "paymentInPremiumV1";
const PAYMENT_OUT_KEY = "paymentOutPremiumV1";

function parseNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCountryKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return COUNTRY_ALIAS[key] || key;
}

function recordCountry(record) {
  if (!record || typeof record !== "object") return "";
  return (
    record.country ||
    record.countryCode ||
    record?.metadata?.country ||
    record?.companySnapshot?.country ||
    ""
  );
}

function countryMatches(recordValue, targetCountry) {
  const target = normalizeCountryKey(targetCountry);
  const source = normalizeCountryKey(recordValue);
  if (!source) return true;
  return source === target;
}

function toIsoDate(value) {
  if (!value) return "";
  const raw = String(value);
  if (raw.length >= 10 && raw[4] === "-" && raw[7] === "-") return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function invoiceTotal(invoice) {
  return parseNumber(
    invoice?.totals?.grandTotal ??
      invoice?.totals?.total ??
      invoice?.totals?.subTotal ??
      invoice?.grandTotal
  );
}

function invoiceBalance(invoice) {
  return Math.max(
    0,
    parseNumber(
      invoice?.totals?.balance ??
        invoice?.remainingBalance ??
        invoice?.balanceAmount ??
        invoice?.totals?.grandTotal ??
        invoice?.totals?.total
    )
  );
}

function money(value, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "INR",
    maximumFractionDigits: 2
  }).format(parseNumber(value));
}

function refreshPremiumRecords() {
  return {
    creditNotes: lsGetOrganizationScoped(CREDIT_NOTE_KEY, []),
    debitNotes: lsGetOrganizationScoped(DEBIT_NOTE_KEY, []),
    paymentIn: lsGetOrganizationScoped(PAYMENT_IN_KEY, []),
    paymentOut: lsGetOrganizationScoped(PAYMENT_OUT_KEY, [])
  };
}

export default function AccounterDashboard() {
  const navigate = useNavigate();
  const { currency = "INR", country = "India", countryCode = "IN" } = useOrganization();

  const [invoices, setInvoices] = useState(() => invoicesList());
  const [purchases, setPurchases] = useState(() => purchasesList());
  const [payments, setPayments] = useState(() => paymentsList());
  const [items, setItems] = useState(() => listItems());
  const [parties, setParties] = useState(() => listParties());
  const [premiumRecords, setPremiumRecords] = useState(() => refreshPremiumRecords());

  useEffect(() => {
    let mounted = true;
    async function syncDashboardData() {
      try {
        const [syncedInvoices, syncedPurchases, syncedPayments] = await Promise.all([
          invoicesSyncFromRemote(),
          purchasesSyncFromRemote(),
          paymentsSyncFromRemote(),
          syncItemsFromRemote(),
          syncPartiesFromRemote()
        ]);
        if (!mounted) return;
        setInvoices(Array.isArray(syncedInvoices) ? syncedInvoices : invoicesList());
        setPurchases(Array.isArray(syncedPurchases) ? syncedPurchases : purchasesList());
        setPayments(Array.isArray(syncedPayments) ? syncedPayments : paymentsList());
        setItems(listItems());
        setParties(listParties());
        setPremiumRecords(refreshPremiumRecords());
      } catch {
        if (!mounted) return;
        setInvoices(invoicesList());
        setPurchases(purchasesList());
        setPayments(paymentsList());
        setItems(listItems());
        setParties(listParties());
        setPremiumRecords(refreshPremiumRecords());
      }
    }
    syncDashboardData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function handleStorage(event) {
      if (
        isOrganizationScopedStorageEventKey(LS_KEYS.invoices, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.purchases, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.payments, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.items, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.parties, event?.key)
      ) {
        setInvoices(invoicesList());
        setPurchases(purchasesList());
        setPayments(paymentsList());
        setItems(listItems());
        setParties(listParties());
      }

      if (
        isOrganizationScopedStorageEventKey(CREDIT_NOTE_KEY, event?.key) ||
        isOrganizationScopedStorageEventKey(DEBIT_NOTE_KEY, event?.key) ||
        isOrganizationScopedStorageEventKey(PAYMENT_IN_KEY, event?.key) ||
        isOrganizationScopedStorageEventKey(PAYMENT_OUT_KEY, event?.key)
      ) {
        setPremiumRecords(refreshPremiumRecords());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const dashboard = useMemo(() => {
    const today = todayIso();
    const scopedInvoices = invoices.filter((invoice) => countryMatches(recordCountry(invoice), country));
    const scopedPurchases = purchases.filter((bill) => countryMatches(recordCountry(bill), country));
    const scopedPayments = payments.filter((entry) => countryMatches(recordCountry(entry), country));
    const scopedItems = items.filter((item) => countryMatches(recordCountry(item), country));
    const scopedParties = parties.filter((party) => countryMatches(recordCountry(party), country));
    const scopedCreditNotes = (Array.isArray(premiumRecords.creditNotes) ? premiumRecords.creditNotes : []).filter(
      (entry) => countryMatches(recordCountry(entry), country)
    );
    const scopedDebitNotes = (Array.isArray(premiumRecords.debitNotes) ? premiumRecords.debitNotes : []).filter(
      (entry) => countryMatches(recordCountry(entry), country)
    );
    const scopedPaymentIn = (Array.isArray(premiumRecords.paymentIn) ? premiumRecords.paymentIn : []).filter(
      (entry) => countryMatches(recordCountry(entry), country)
    );
    const scopedPaymentOut = (Array.isArray(premiumRecords.paymentOut) ? premiumRecords.paymentOut : []).filter(
      (entry) => countryMatches(recordCountry(entry), country)
    );

    const todaysInvoices = scopedInvoices.filter(
      (invoice) => toIsoDate(invoice?.invoiceDate || invoice?.date || invoice?.created_at) === today
    );
    const todaysPurchases = scopedPurchases.filter(
      (bill) => toIsoDate(bill?.billDate || bill?.invoiceDate || bill?.date || bill?.created_at) === today
    );

    const pendingInvoices = scopedInvoices.filter((invoice) => {
      const status = normalizeStatus(invoice?.status || invoice?.paymentStatus);
      if (status === "draft" || status === "cancelled" || status === "canceled") return false;
      return invoiceBalance(invoice) > 0;
    });

    const legacyIncoming = scopedPayments
      .filter((entry) => {
        const direction = normalizeStatus(entry?.direction).toUpperCase();
        if (direction !== "IN") return false;
        const reference = String(entry?.referenceNo || entry?.reference_no || "");
        return !reference.startsWith("PI:");
      })
      .reduce((sum, entry) => sum + parseNumber(entry?.amount), 0);
    const legacyOutgoing = scopedPayments
      .filter((entry) => {
        const direction = normalizeStatus(entry?.direction).toUpperCase();
        if (direction !== "OUT") return false;
        const reference = String(entry?.referenceNo || entry?.reference_no || "");
        return !reference.startsWith("PO:");
      })
      .reduce((sum, entry) => sum + parseNumber(entry?.amount), 0);
    const premiumIncoming = scopedPaymentIn
      .filter((entry) => normalizeStatus(entry?.status) !== "draft")
      .reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountReceived), 0);
    const premiumOutgoing = scopedPaymentOut
      .filter((entry) => normalizeStatus(entry?.status) !== "draft")
      .reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountPaid), 0);

    const cashIn = legacyIncoming + premiumIncoming;
    const cashOut = legacyOutgoing + premiumOutgoing;

    const lowStock = scopedItems.filter((item) => item?.trackInventory && computeItemStock(item).lowStock);
    const awaitingApproval = {
      creditNotes: scopedCreditNotes.filter((entry) => normalizeStatus(entry?.status) === "issued").length,
      debitNotes: scopedDebitNotes.filter((entry) => normalizeStatus(entry?.status) === "issued").length,
      paymentIn: scopedPaymentIn.filter((entry) => normalizeStatus(entry?.status) === "received").length,
      paymentOut: scopedPaymentOut.filter((entry) => normalizeStatus(entry?.status) === "paid").length
    };
    const drafts =
      scopedCreditNotes.filter((entry) => normalizeStatus(entry?.status) === "draft").length +
      scopedDebitNotes.filter((entry) => normalizeStatus(entry?.status) === "draft").length +
      scopedPaymentIn.filter((entry) => normalizeStatus(entry?.status) === "draft").length +
      scopedPaymentOut.filter((entry) => normalizeStatus(entry?.status) === "draft").length;

    const receivableAmount = pendingInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
    const payableAmount = mapOpenBillsByCountry(countryCode || country).reduce(
      (sum, bill) => sum + parseNumber(bill?.balanceDue),
      0
    );

    const pendingFollowUps = pendingInvoices
      .map((invoice) => {
        const dueDate = toIsoDate(
          invoice?.dueDate || invoice?.invoiceDate || invoice?.date || invoice?.created_at
        );
        const overdueDays = dueDate
          ? Math.max(
              0,
              Math.floor(
                (new Date(`${today}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) /
                  (24 * 60 * 60 * 1000)
              )
            )
          : 0;
        return {
          id: invoice?.id || "",
          invoiceNo: invoice?.invoiceNo || invoice?.id || "-",
          customer: invoice?.partyName || invoice?.customerName || "Customer",
          dueDate: dueDate || "-",
          balance: invoiceBalance(invoice),
          overdueDays
        };
      })
      .sort((a, b) => b.overdueDays - a.overdueDays || b.balance - a.balance)
      .slice(0, 8);

    let customers = 0;
    let suppliers = 0;
    scopedParties.forEach((party) => {
      const type = normalizeStatus(party?.type);
      if (type === "supplier") suppliers += 1;
      else customers += 1;
    });

    return {
      todayInvoiceCount: todaysInvoices.length,
      todaySalesAmount: todaysInvoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0),
      todayPurchaseCount: todaysPurchases.length,
      awaitingApprovalTotal:
        awaitingApproval.creditNotes +
        awaitingApproval.debitNotes +
        awaitingApproval.paymentIn +
        awaitingApproval.paymentOut,
      awaitingApproval,
      receivableAmount,
      receivableCount: pendingInvoices.length,
      payableAmount,
      cashIn,
      cashOut,
      cashNet: cashIn - cashOut,
      lowStockCount: lowStock.length,
      draftDocs: drafts,
      partyCount: scopedParties.length,
      customers,
      suppliers,
      pendingFollowUps
    };
  }, [country, countryCode, invoices, purchases, payments, items, parties, premiumRecords]);

  return (
    <div className="dashboard-theme max-w-6xl space-y-4">
      <div className="rounded-2xl bg-slate-100 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Accounter Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Monitor all staff operations, review approval queues, and control receivable/payable flow ({countryCode}{" "}
          {country}).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Today Sales Invoices</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.todayInvoiceCount}</p>
          <p className="text-xs text-slate-500">{money(dashboard.todaySalesAmount, currency)}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Today Purchase Bills</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.todayPurchaseCount}</p>
          <p className="text-xs text-slate-500">Staff entry volume</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Awaiting Approvals</p>
          <p className="mt-2 text-2xl font-semibold text-rose-600">{dashboard.awaitingApprovalTotal}</p>
          <p className="text-xs text-slate-500">Issued/Paid docs to apply</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Receivables</p>
          <p className="mt-2 text-xl font-semibold text-amber-700">{money(dashboard.receivableAmount, currency)}</p>
          <p className="text-xs text-slate-500">{dashboard.receivableCount} open invoices</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Payables</p>
          <p className="mt-2 text-xl font-semibold text-rose-700">{money(dashboard.payableAmount, currency)}</p>
          <p className="text-xs text-slate-500">Live supplier balances</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Cash Net</p>
          <p
            className={`mt-2 text-xl font-semibold ${
              dashboard.cashNet >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {money(dashboard.cashNet, currency)}
          </p>
          <p className="text-xs text-slate-500">
            In {money(dashboard.cashIn, currency)} / Out {money(dashboard.cashOut, currency)}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Approval Queue</p>
            <FileClock className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span>Credit Notes (Issued)</span>
              <span className="font-semibold">{dashboard.awaitingApproval.creditNotes}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span>Debit Notes (Issued)</span>
              <span className="font-semibold">{dashboard.awaitingApproval.debitNotes}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span>Payment In (Received)</span>
              <span className="font-semibold">{dashboard.awaitingApproval.paymentIn}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span>Payment Out (Paid)</span>
              <span className="font-semibold">{dashboard.awaitingApproval.paymentOut}</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => navigate("/app/sales/credit-note")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Credit Note
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/purchase/debit-note")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Debit Note
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/sales/payment-in")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Payment In
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/purchases/payment-out")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Payment Out
            </button>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-800">Operations Health</p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span className="inline-flex items-center gap-2">
                <Package className="h-4 w-4 text-amber-600" />
                Low Stock Items
              </span>
              <span className="font-semibold">{dashboard.lowStockCount}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span className="inline-flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-slate-600" />
                Draft Documents
              </span>
              <span className="font-semibold">{dashboard.draftDocs}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <span className="inline-flex items-center gap-2">
                <ReceiptIndianRupee className="h-4 w-4 text-indigo-600" />
                Parties
              </span>
              <span className="font-semibold">
                {dashboard.partyCount} (C {dashboard.customers} | S {dashboard.suppliers})
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Customer Follow-up Queue</p>
          <button
            type="button"
            onClick={() => navigate("/app/sales/invoice/history")}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            Open Invoice History
            <ArrowRightCircle className="h-3.5 w-3.5" />
          </button>
        </div>
        {dashboard.pendingFollowUps.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-2 py-2 font-semibold">Invoice</th>
                  <th className="px-2 py-2 font-semibold">Customer</th>
                  <th className="px-2 py-2 font-semibold">Due Date</th>
                  <th className="px-2 py-2 font-semibold">Overdue Days</th>
                  <th className="px-2 py-2 font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.pendingFollowUps.map((row) => (
                  <tr key={row.id || row.invoiceNo} className="border-b border-slate-100 text-slate-700">
                    <td className="px-2 py-2 font-semibold">{row.invoiceNo}</td>
                    <td className="px-2 py-2">{row.customer}</td>
                    <td className="px-2 py-2">{row.dueDate}</td>
                    <td className="px-2 py-2">{row.overdueDays}</td>
                    <td className="px-2 py-2">{money(row.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500">
            No pending customer follow-ups in this country right now.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <p className="text-sm font-semibold text-slate-800">Accounter Responsibilities</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Review all documents created by staff and apply approvals for ledger impact.</li>
          <li>Monitor receivables/payables and prioritize overdue collections.</li>
          <li>Validate tax treatment before month-end filings and reconciliations.</li>
          <li>Track low-stock and draft queues to keep staff workflow clean.</li>
        </ul>
      </Card>
    </div>
  );
}
