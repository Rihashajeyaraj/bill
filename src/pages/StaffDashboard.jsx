import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightCircle,
  ClipboardList,
  FileClock,
  Package,
  ReceiptIndianRupee,
  UserRound,
  Wallet
} from "lucide-react";
import Card from "../components/Card";
import { authGetRole } from "../services/auth.service";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { purchasesList, purchasesSyncFromRemote } from "../services/purchases.service";
import { computeItemStock, listItems, syncItemsFromRemote } from "../modules/items/store";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import {
  isOrganizationScopedStorageEventKey,
  LS_KEYS,
  lsGetOrganizationScoped
} from "../services/storage";
import { useOrganization } from "../context/OrganizationContext";

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

export default function StaffDashboard() {
  const navigate = useNavigate();
  const role = authGetRole();
  const { country = "India", countryCode = "IN", currency = "INR" } = useOrganization();

  const [invoices, setInvoices] = useState(() => invoicesList());
  const [purchases, setPurchases] = useState(() => purchasesList());
  const [items, setItems] = useState(() => listItems());
  const [parties, setParties] = useState(() => listParties());
  const [premiumRecords, setPremiumRecords] = useState(() => refreshPremiumRecords());

  useEffect(() => {
    let mounted = true;
    async function syncDashboardData() {
      try {
        const [syncedInvoices, syncedPurchases] = await Promise.all([
          invoicesSyncFromRemote(),
          purchasesSyncFromRemote(),
          syncItemsFromRemote(),
          syncPartiesFromRemote()
        ]);
        if (!mounted) return;
        setInvoices(Array.isArray(syncedInvoices) ? syncedInvoices : invoicesList());
        setPurchases(Array.isArray(syncedPurchases) ? syncedPurchases : purchasesList());
        setItems(listItems());
        setParties(listParties());
        setPremiumRecords(refreshPremiumRecords());
      } catch {
        if (!mounted) return;
        setInvoices(invoicesList());
        setPurchases(purchasesList());
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
        isOrganizationScopedStorageEventKey(LS_KEYS.items, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.parties, event?.key)
      ) {
        setInvoices(invoicesList());
        setPurchases(purchasesList());
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

    const lowStockItems = scopedItems
      .map((item) => {
        const stock = computeItemStock(item);
        return {
          id: item?.id || "",
          name: item?.name || item?.itemName || "Item",
          currentStock: parseNumber(item?.currentStock ?? item?.stockQty),
          reorderLevel: parseNumber(item?.minStock ?? item?.reorderLevel),
          lowStock: !!item?.trackInventory && !!stock.lowStock
        };
      })
      .filter((item) => item.lowStock)
      .sort((a, b) => a.currentStock - b.currentStock);

    const awaitingApproval = {
      creditNotes: scopedCreditNotes.filter((entry) => normalizeStatus(entry?.status) === "issued").length,
      debitNotes: scopedDebitNotes.filter((entry) => normalizeStatus(entry?.status) === "issued").length,
      paymentIn: scopedPaymentIn.filter((entry) => normalizeStatus(entry?.status) === "received").length,
      paymentOut: scopedPaymentOut.filter((entry) => normalizeStatus(entry?.status) === "paid").length
    };

    const drafts = {
      creditNotes: scopedCreditNotes.filter((entry) => normalizeStatus(entry?.status) === "draft").length,
      debitNotes: scopedDebitNotes.filter((entry) => normalizeStatus(entry?.status) === "draft").length,
      paymentIn: scopedPaymentIn.filter((entry) => normalizeStatus(entry?.status) === "draft").length,
      paymentOut: scopedPaymentOut.filter((entry) => normalizeStatus(entry?.status) === "draft").length
    };

    const recentInvoices = [...scopedInvoices]
      .sort((a, b) =>
        toIsoDate(a?.invoiceDate || a?.date || a?.created_at) <
        toIsoDate(b?.invoiceDate || b?.date || b?.created_at)
          ? 1
          : -1
      )
      .slice(0, 6)
      .map((invoice) => ({
        id: invoice?.id || "",
        invoiceNo: invoice?.invoiceNo || invoice?.id || "-",
        invoiceDate: toIsoDate(invoice?.invoiceDate || invoice?.date || invoice?.created_at) || "-",
        customer: invoice?.partyName || invoice?.customerName || "Customer",
        total: invoiceTotal(invoice),
        balance: invoiceBalance(invoice)
      }));

    return {
      totals: {
        todayInvoiceCount: todaysInvoices.length,
        todaySalesAmount: todaysInvoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0),
        todayPurchaseCount: todaysPurchases.length,
        pendingInvoiceCount: pendingInvoices.length,
        pendingInvoiceAmount: pendingInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0),
        lowStockCount: lowStockItems.length,
        partyCount: scopedParties.length,
        draftDocs: drafts.creditNotes + drafts.debitNotes + drafts.paymentIn + drafts.paymentOut,
        awaitingApprovals:
          awaitingApproval.creditNotes +
          awaitingApproval.debitNotes +
          awaitingApproval.paymentIn +
          awaitingApproval.paymentOut
      },
      awaitingApproval,
      lowStockItems,
      recentInvoices
    };
  }, [country, invoices, purchases, items, parties, premiumRecords]);

  return (
    <div className="dashboard-theme max-w-6xl space-y-4">
      <div className="rounded-2xl bg-slate-100 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Staff Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Biller workspace for daily sales, billing queue, and stock alerts ({countryCode} {country}).
        </p>
        <p className="mt-1 text-xs text-slate-500">Logged in role: {role}</p>
      </div>

      <Card className="p-4">
        <p className="text-sm font-semibold text-slate-800">Quick Actions</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => navigate("/app/sales/invoice")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Create Sales Invoice
          </button>
          <button
            type="button"
            onClick={() => navigate("/app/purchase/bill")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Create Purchase Bill
          </button>
          <button
            type="button"
            onClick={() => navigate("/app/sales/credit-note")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Create Credit Note
          </button>
          <button
            type="button"
            onClick={() => navigate("/app/purchase/debit-note")}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Create Debit Note
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <ReceiptIndianRupee className="h-4 w-4" />
            <p className="text-xs font-semibold">Today Invoices</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.totals.todayInvoiceCount}</p>
          <p className="text-xs text-slate-500">{money(dashboard.totals.todaySalesAmount, currency)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <Wallet className="h-4 w-4" />
            <p className="text-xs font-semibold">Pending Collections</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{dashboard.totals.pendingInvoiceCount}</p>
          <p className="text-xs text-slate-500">{money(dashboard.totals.pendingInvoiceAmount, currency)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <ClipboardList className="h-4 w-4" />
            <p className="text-xs font-semibold">Approval Queue</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-rose-600">{dashboard.totals.awaitingApprovals}</p>
          <p className="text-xs text-slate-500">Issued/Paid docs waiting apply</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <Package className="h-4 w-4" />
            <p className="text-xs font-semibold">Low Stock</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{dashboard.totals.lowStockCount}</p>
          <p className="text-xs text-slate-500">Items below reorder level</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Pending Approval Breakdown</p>
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
          <p className="mt-3 text-xs text-slate-500">
            Staff can create and issue these documents. Owner/Accounter will apply them.
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Low Stock Alerts</p>
            <button
              type="button"
              onClick={() => navigate("/app/items")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Open Items
              <ArrowRightCircle className="h-3.5 w-3.5" />
            </button>
          </div>
          {dashboard.lowStockItems.length ? (
            <div className="mt-3 space-y-2">
              {dashboard.lowStockItems.slice(0, 6).map((item) => (
                <div
                  key={item.id || item.name}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="truncate pr-3">{item.name}</span>
                  <span className="text-xs text-slate-500">
                    {item.currentStock} / reorder {item.reorderLevel}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500">
              No low-stock items right now.
            </p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Recent Invoices</p>
          <button
            type="button"
            onClick={() => navigate("/app/sales/invoice/history")}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            View Full History
            <ArrowRightCircle className="h-3.5 w-3.5" />
          </button>
        </div>
        {dashboard.recentInvoices.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-2 py-2 font-semibold">Invoice</th>
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">Customer</th>
                  <th className="px-2 py-2 font-semibold">Total</th>
                  <th className="px-2 py-2 font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentInvoices.map((row) => (
                  <tr key={row.id || row.invoiceNo} className="border-b border-slate-100 text-slate-700">
                    <td className="px-2 py-2 font-semibold">{row.invoiceNo}</td>
                    <td className="px-2 py-2">{row.invoiceDate}</td>
                    <td className="px-2 py-2">{row.customer}</td>
                    <td className="px-2 py-2">{money(row.total, currency)}</td>
                    <td className="px-2 py-2">{money(row.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500">
            No invoices yet. Start from "Create Sales Invoice".
          </p>
        )}
      </Card>

      <Card className="p-5">
        <p className="text-sm font-semibold text-slate-800">Biller Checklist</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Create invoices and purchase bills with correct tax mode (inclusive/exclusive).</li>
          <li>Check pending collections and follow up with customers daily.</li>
          <li>Raise credit/debit notes as needed, then inform Owner/Accounter to apply.</li>
          <li>Review low-stock alerts and notify purchasing before stockout.</li>
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <ReceiptIndianRupee className="h-4 w-4" />
            <p className="text-xs font-semibold">Today Purchases</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.totals.todayPurchaseCount}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <FileClock className="h-4 w-4" />
            <p className="text-xs font-semibold">Draft Documents</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.totals.draftDocs}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <UserRound className="h-4 w-4" />
            <p className="text-xs font-semibold">Parties</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.totals.partyCount}</p>
        </Card>
      </div>
    </div>
  );
}
