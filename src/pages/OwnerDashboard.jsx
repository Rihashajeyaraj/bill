import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  Wallet,
  Users,
  RotateCw
} from "lucide-react";
import Card from "../components/Card";
import DateInput from "../components/DateInput";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { purchasesList, purchasesSyncFromRemote } from "../services/purchases.service";
import { paymentsList, paymentsSyncFromRemote } from "../services/payments.service";
import { EXPENSES_CHANGED_EVENT, expensesList, expensesSyncFromRemote } from "../services/expenses.service";
import { mapOpenBillsByCountry } from "../modules/paymentOut/store";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { useOrganization } from "../context/OrganizationContext";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { beginPageLoading, endPageLoading } from "../state/pageLoadingStore";
import { isOrganizationScopedStorageEventKey, LS_KEYS, lsGetOrganizationScoped } from "../services/storage";
import { resolveCountryIsoCode } from "../lib/geoData";
import { formatCurrencyByPreference, formatNumberByPreference } from "../lib/formatPreferences";
import { useFinancialYears } from "../context/FinancialYearContext";

function money(n) {
  return formatNumberByPreference(Number(n || 0), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function compactMoney(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(v);
}

function buildMonthLabels() {
  return ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
}

const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COUNTRY_TIMEZONE_BY_ISO = {
  IN: "Asia/Kolkata",
  LK: "Asia/Colombo",
  AE: "Asia/Dubai",
  GB: "Europe/London",
  IE: "Europe/London",
  US: "America/New_York"
};

function resolveCompanyTimeZone(profile, country, countryCode) {
  const configuredTimeZone = String(profile?.settings?.localization?.timezone || "").trim();
  if (configuredTimeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: configuredTimeZone }).format(new Date());
      return configuredTimeZone;
    } catch {
      // Fall back to country-derived timezone.
    }
  }

  const isoCode = String(countryCode || resolveCountryIsoCode(country) || "")
    .trim()
    .toUpperCase();
  return COUNTRY_TIMEZONE_BY_ISO[isoCode] || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function toIsoDateParts(date, timeZone = "") {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) return "";
    return `${year}-${month}-${day}`;
  } catch {
    return "";
  }
}

function toLocalIsoDate(date = new Date(), timeZone = "") {
  const zonedIso = toIsoDateParts(date, timeZone);
  if (zonedIso) return zonedIso;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoDate(value, timeZone = "") {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const zonedIso = toIsoDateParts(parsed, timeZone);
  if (zonedIso) return zonedIso;
  return parsed.toISOString().slice(0, 10);
}

function dateInRange(dateValue, fromDate, toDate, timeZone = "") {
  const iso = toIsoDate(dateValue, timeZone);
  if (!iso) return false;
  if (fromDate && iso < fromDate) return false;
  if (toDate && iso > toDate) return false;
  return true;
}

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

function normalizeCountryKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return COUNTRY_ALIAS[key] || key;
}

function recordCountry(record) {
  if (!record || typeof record !== "object") return "";
  return record.country || record.countryCode || record?.metadata?.country || record?.companySnapshot?.country || "";
}

function countryMatches(recordValue, targetCountry) {
  const target = normalizeCountryKey(targetCountry);
  const source = normalizeCountryKey(recordValue);
  if (!source) return true;
  return source === target;
}

export default function Dashboard() {
  const { currency = "INR", country = "India", countryCode = "IN", profile = {} } = useOrganization();
  const { selectedYear } = useFinancialYears();
  const companyTimeZone = useMemo(
    () => resolveCompanyTimeZone(profile, country, countryCode),
    [profile, country, countryCode]
  );
  const todayIso = useMemo(() => toLocalIsoDate(new Date(), companyTimeZone), [companyTimeZone]);
  const defaultFromDate = selectedYear?.startDate || todayIso;
  const defaultToDate = selectedYear?.endDate || todayIso;

  useEffect(() => {
    const token = beginPageLoading("dashboard");
    const timer = window.setTimeout(() => endPageLoading(token), 260);
    return () => {
      window.clearTimeout(timer);
      endPageLoading(token);
    };
  }, []);

  const [invoices, setInvoices] = useState(() => invoicesList());
  const [purchases, setPurchases] = useState(() => purchasesList());
  const [payments, setPayments] = useState(() => paymentsList());
  const [expenses, setExpenses] = useState(() => expensesList());
  const [parties, setParties] = useState(() => listParties());
  const [paymentInPremium, setPaymentInPremium] = useState(() =>
    lsGetOrganizationScoped("paymentInPremiumV1", [])
  );
  const [paymentOutPremium, setPaymentOutPremium] = useState(() =>
    lsGetOrganizationScoped("paymentOutPremiumV1", [])
  );
  const [fromDate, setFromDate] = useState(() => defaultFromDate);
  const [toDate, setToDate] = useState(() => defaultToDate);
  const [donutTab, setDonutTab] = useState("income");

  useEffect(() => {
    if (!selectedYear) return;
    setFromDate(selectedYear.startDate);
    setToDate(selectedYear.endDate);
  }, [selectedYear?.id, selectedYear?.startDate, selectedYear?.endDate]);

  const refreshExpenses = useCallback(async () => {
    try {
      const synced = await expensesSyncFromRemote();
      setExpenses(Array.isArray(synced) ? synced : expensesList());
    } catch {
      setExpenses(expensesList());
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    async function syncDashboardData() {
      try {
        const [syncedInvoices, syncedPurchases, syncedPayments, syncedExpenses, syncedParties] = await Promise.all([
          invoicesSyncFromRemote(),
          purchasesSyncFromRemote(),
          paymentsSyncFromRemote(),
          expensesSyncFromRemote(),
          syncPartiesFromRemote(),
        ]);
        if (!mounted) return;
        setInvoices(Array.isArray(syncedInvoices) ? syncedInvoices : invoicesList());
        setPurchases(Array.isArray(syncedPurchases) ? syncedPurchases : purchasesList());
        setPayments(Array.isArray(syncedPayments) ? syncedPayments : paymentsList());
        setExpenses(Array.isArray(syncedExpenses) ? syncedExpenses : expensesList());
        setParties(Array.isArray(syncedParties) ? syncedParties : listParties());
        setPaymentInPremium(lsGetOrganizationScoped("paymentInPremiumV1", []));
        setPaymentOutPremium(lsGetOrganizationScoped("paymentOutPremiumV1", []));
      } catch {
        if (!mounted) return;
        setInvoices(invoicesList());
        setPurchases(purchasesList());
        setPayments(paymentsList());
        setExpenses(expensesList());
        setParties(listParties());
        setPaymentInPremium(lsGetOrganizationScoped("paymentInPremiumV1", []));
        setPaymentOutPremium(lsGetOrganizationScoped("paymentOutPremiumV1", []));
      }
    }
    syncDashboardData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function handleExpenseChange() {
      void refreshExpenses();
    }

    function handleStorage(event) {
      if (isOrganizationScopedStorageEventKey(LS_KEYS.expenses, event?.key)) {
        void refreshExpenses();
        return;
      }
      if (
        isOrganizationScopedStorageEventKey(LS_KEYS.invoices, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.purchases, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.payments, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.parties, event?.key) ||
        isOrganizationScopedStorageEventKey("paymentInPremiumV1", event?.key) ||
        isOrganizationScopedStorageEventKey("paymentOutPremiumV1", event?.key)
      ) {
        setInvoices(invoicesList());
        setPurchases(purchasesList());
        setPayments(paymentsList());
        setParties(listParties());
        setPaymentInPremium(lsGetOrganizationScoped("paymentInPremiumV1", []));
        setPaymentOutPremium(lsGetOrganizationScoped("paymentOutPremiumV1", []));
      }
    }

    window.addEventListener(EXPENSES_CHANGED_EVENT, handleExpenseChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(EXPENSES_CHANGED_EVENT, handleExpenseChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshExpenses]);

  const currencyPrefix = currency ? `${currency} ` : "";
  const currencyBadge = currency.slice(0, 3).toUpperCase();

  const filteredInvoices = useMemo(
    () =>
      invoices.filter(
        (entry) =>
          countryMatches(recordCountry(entry), country) &&
          dateInRange(entry?.invoiceDate || entry?.date || entry?.created_at, fromDate, toDate, companyTimeZone)
      ),
    [invoices, country, fromDate, toDate, companyTimeZone]
  );

  const filteredPurchases = useMemo(
    () =>
      purchases.filter(
        (entry) =>
          countryMatches(recordCountry(entry), country) &&
          dateInRange(
            entry?.billDate || entry?.invoiceDate || entry?.date || entry?.created_at,
            fromDate,
            toDate,
            companyTimeZone
          )
      ),
    [purchases, country, fromDate, toDate, companyTimeZone]
  );

  const filteredExpenses = useMemo(
    () => expenses.filter((entry) => dateInRange(entry?.date || entry?.created_at, fromDate, toDate, companyTimeZone)),
    [expenses, fromDate, toDate, companyTimeZone]
  );

  const filteredPaymentInPremium = useMemo(
    () =>
      (Array.isArray(paymentInPremium) ? paymentInPremium : []).filter(
        (entry) =>
          String(entry?.status || "").toLowerCase() !== "draft" &&
          countryMatches(recordCountry(entry), country) &&
          dateInRange(
            entry?.paymentDate || entry?.payment_date || entry?.created_at,
            fromDate,
            toDate,
            companyTimeZone
          )
      ),
    [paymentInPremium, country, fromDate, toDate, companyTimeZone]
  );

  const filteredPaymentOutPremium = useMemo(
    () =>
      (Array.isArray(paymentOutPremium) ? paymentOutPremium : []).filter(
        (entry) =>
          String(entry?.status || "").toLowerCase() !== "draft" &&
          countryMatches(recordCountry(entry), country) &&
          dateInRange(
            entry?.paymentDate || entry?.payment_date || entry?.created_at,
            fromDate,
            toDate,
            companyTimeZone
          )
      ),
    [paymentOutPremium, country, fromDate, toDate, companyTimeZone]
  );

  const filteredLegacyPayments = useMemo(
    () =>
      payments.filter(
        (entry) =>
          countryMatches(recordCountry(entry), country) &&
          dateInRange(entry?.date || entry?.payment_date || entry?.created_at, fromDate, toDate, companyTimeZone)
      ),
    [payments, country, fromDate, toDate, companyTimeZone]
  );

  const partyCounts = useMemo(() => {
    const scoped = parties.filter((party) => countryMatches(recordCountry(party), country));
    let customers = 0;
    let suppliers = 0;
    scoped.forEach((party) => {
      const type = String(party?.type || "").toLowerCase();
      if (type === "supplier") suppliers += 1;
      else customers += 1;
    });
    return { total: scoped.length, customers, suppliers };
  }, [parties, country]);

  const totals = useMemo(() => {
    const sales = filteredInvoices.reduce(
      (sum, entry) =>
        sum +
        Number(entry?.totals?.grandTotal ?? entry?.totals?.total ?? entry?.totals?.subTotal ?? entry?.grandTotal ?? 0),
      0
    );
    const purchase = filteredPurchases.reduce(
      (sum, entry) =>
        sum +
        Number(
          entry?.totals?.grandTotal ??
            entry?.totals?.finalTotal ??
            entry?.totals?.total ??
            entry?.totals?.subTotal ??
            entry?.grandTotal ??
            0
        ),
      0
    );
    const totalExpense = filteredExpenses.reduce(
      (sum, entry) => sum + Number(entry?.amount ?? entry?.totalAmount ?? entry?.total ?? 0),
      0
    );

    const receivedLegacy = filteredLegacyPayments
      .filter((entry) => {
        const direction = String(entry?.direction || "").toUpperCase();
        if (direction !== "IN") return false;
        const reference = String(entry?.referenceNo || entry?.reference_no || "");
        return !reference.startsWith("PI:");
      })
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);
    const paidLegacy = filteredLegacyPayments
      .filter((entry) => {
        const direction = String(entry?.direction || "").toUpperCase();
        if (direction !== "OUT") return false;
        const reference = String(entry?.referenceNo || entry?.reference_no || "");
        return !reference.startsWith("PO:");
      })
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);
    const receivedPremium = filteredPaymentInPremium
      .reduce((sum, entry) => sum + Number(entry?.totals?.amountReceived || 0), 0);
    const paidPremium = filteredPaymentOutPremium
      .reduce((sum, entry) => sum + Number(entry?.totals?.amountPaid || 0), 0);

    const received = Math.max(0, receivedLegacy + receivedPremium);
    const paid = Math.max(0, paidLegacy + paidPremium);

    const payables = mapOpenBillsByCountry(countryCode || country)
      .filter((bill) =>
        dateInRange(
          bill?.billDate || bill?.invoiceDate || bill?.date || bill?.created_at,
          fromDate,
          toDate,
          companyTimeZone
        )
      )
      .reduce((sum, bill) => sum + Number(bill?.balanceDue || 0), 0);

    const receivables = filteredInvoices.reduce((sum, invoice) => {
      const balance = Number(
        invoice?.totals?.balance ??
          invoice?.remainingBalance ??
          invoice?.balanceAmount ??
          invoice?.totals?.grandTotal ??
          invoice?.totals?.total ??
          0
      );
      return sum + Math.max(0, balance);
    }, 0);

    const overdueAmount = filteredInvoices.reduce((sum, invoice) => {
      const balance = Math.max(
        0,
        Number(
          invoice?.totals?.balance ??
            invoice?.remainingBalance ??
            invoice?.balanceAmount ??
            invoice?.totals?.grandTotal ??
            invoice?.totals?.total ??
            0
        )
      );
      if (!balance) return sum;
      const dueDate = toIsoDate(
        invoice?.dueDate || invoice?.invoiceDate || invoice?.date || invoice?.created_at,
        companyTimeZone
      );
      if (!dueDate) return sum;
      const overdueDays = Math.floor(
        (new Date(`${todayIso}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) /
          (24 * 60 * 60 * 1000)
      );
      if (overdueDays <= 30) return sum;
      return sum + balance;
    }, 0);

    return {
      totalSales: sales,
      receivables: Math.max(0, receivables),
      payables: Math.max(0, payables),
      cashBalance: Math.max(0, received - paid),
      overdueAmount: Math.max(0, overdueAmount),
      expenses: purchase,
      received,
      paid,
      totalExpense: Math.max(0, totalExpense)
    };
  }, [
    filteredInvoices,
    filteredPurchases,
    filteredExpenses,
    filteredLegacyPayments,
    filteredPaymentInPremium,
    filteredPaymentOutPremium,
    countryCode,
    country,
    todayIso,
    companyTimeZone
  ]);

  const chart = useMemo(() => {
    const months = buildMonthLabels();
    const incomeMap = new Map();
    const expenseMap = new Map();

    filteredInvoices.forEach((inv) => {
      const isoDate = toIsoDate(inv?.invoiceDate || inv?.date || inv?.created_at, companyTimeZone);
      if (!isoDate) return;
      const monthIndex = Number(isoDate.slice(5, 7)) - 1;
      const label = MONTH_SHORT_NAMES[monthIndex] || "";
      if (!label) return;
      incomeMap.set(
        label,
        (incomeMap.get(label) || 0) + Number(inv?.totals?.grandTotal ?? inv?.totals?.total ?? inv?.grandTotal ?? 0)
      );
    });
    filteredPurchases.forEach((bill) => {
      const isoDate = toIsoDate(bill?.billDate || bill?.invoiceDate || bill?.date || bill?.created_at, companyTimeZone);
      if (!isoDate) return;
      const monthIndex = Number(isoDate.slice(5, 7)) - 1;
      const label = MONTH_SHORT_NAMES[monthIndex] || "";
      if (!label) return;
      expenseMap.set(
        label,
        (expenseMap.get(label) || 0) +
          Number(bill?.totals?.grandTotal ?? bill?.totals?.finalTotal ?? bill?.totals?.total ?? bill?.grandTotal ?? 0)
      );
    });

    return months.map((m) => ({
      month: m,
      income: Math.round(incomeMap.get(m) || 0),
      expense: Math.round(expenseMap.get(m) || 0)
    }));
  }, [filteredInvoices, filteredPurchases, companyTimeZone]);

  const donutData = useMemo(() => {
    if (donutTab === "expense") {
      const bucket = new Map();
      filteredExpenses.forEach((entry) => {
        const name = String(entry?.category || "Uncategorized").trim() || "Uncategorized";
        const value = Math.max(0, Number(entry?.amount ?? entry?.totalAmount ?? entry?.total ?? 0));
        bucket.set(name, (bucket.get(name) || 0) + value);
      });
      return Array.from(bucket.entries())
        .map(([name, value]) => ({ name, value }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
    }
    const incomeByParty = new Map();
    filteredInvoices.forEach((entry) => {
      const party = String(entry?.partyName || entry?.buyer?.name || "Customer").trim() || "Customer";
      const value = Math.max(0, Number(entry?.totals?.grandTotal ?? entry?.totals?.total ?? entry?.grandTotal ?? 0));
      incomeByParty.set(party, (incomeByParty.get(party) || 0) + value);
    });
    return Array.from(incomeByParty.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [donutTab, filteredExpenses, filteredInvoices]);

  const donutColors = ["#ff6b6b", "#f6c453", "#4caf50", "#8e8e93", "#3b82f6"];
  const isDonutEmpty = donutData.length === 0;

  return (
    <div className="dashboard-theme max-w-6xl">
      <div className="rounded-2xl bg-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-700">Dashboard ({country})</h1>
          <p className="text-xs text-slate-500">Financial Year: {selectedYear?.label || "Not selected"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateInput
            value={fromDate}
            onChange={(next) => {
              setFromDate(next);
              if (next && toDate && next > toDate) setToDate(next);
            }}
            max={toDate || undefined}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none"
          />
          <DateInput
            value={toDate}
            onChange={(next) => {
              setToDate(next);
              if (next && fromDate && next < fromDate) setFromDate(next);
            }}
            min={fromDate || undefined}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setFromDate(defaultFromDate);
              setToDate(defaultToDate);
            }}
            className="h-8 w-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center"
            title="Reset date range"
          >
            <RotateCw className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Receivable</p>
            <p className="text-sm font-semibold text-blue-600">{currencyPrefix}{money(totals.receivables)}</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center">
            <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
          </div>
        </Card>

        <Card className="p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Payables</p>
            <p className="text-sm font-semibold text-rose-500">{currencyPrefix}{money(totals.payables)}</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-rose-100 flex items-center justify-center">
            <ArrowUpCircle className="h-4 w-4 text-rose-500" />
          </div>
        </Card>

        <Card className="p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Cash Balance</p>
            <p className="text-sm font-semibold text-emerald-600">{currencyPrefix}{money(totals.cashBalance)}</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center">
            <Wallet className="h-4 w-4 text-emerald-600" />
          </div>
        </Card>

        <Card className="p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Overdue Amount</p>
            <p className="text-sm font-semibold text-amber-500">{currencyPrefix}{money(totals.overdueAmount)}</p>
          </div>
          <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
        </Card>

        <Card className="p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Parties</p>
            <p className="text-sm font-semibold text-slate-900">{partyCounts.total}</p>
            <p className="text-[11px] text-slate-500">
              C {partyCounts.customers} | S {partyCounts.suppliers}
            </p>
          </div>
          <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center">
            <Users className="h-4 w-4 text-indigo-600" />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <Card className="p-4 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Income vs Expense</p>
            <p className="text-xs text-slate-500">Date-filtered totals</p>
          </div>
          <div className="mt-3 h-[clamp(240px,40vw,320px)] w-full rounded-xl border border-slate-200 bg-slate-50 pl-2 pr-1 pt-3 pb-2 sm:pl-3 sm:pr-2 sm:pt-4 sm:pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chart}
                margin={{ top: 8, right: 8, left: 6, bottom: 10 }}
                barCategoryGap="22%"
                barGap={6}
              >
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickMargin={10}
                  padding={{ left: 10, right: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickMargin={8}
                  domain={[0, "auto"]}
                  tickFormatter={compactMoney}
                />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="income" fill="#4caf50" radius={[6, 6, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expense" fill="#6b7280" radius={[6, 6, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-slate-500 sm:justify-start">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Income
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
              Expense
            </span>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setDonutTab("income")}
                className={`pb-1 ${donutTab === "income" ? "text-emerald-600 border-b-2 border-emerald-500" : "text-slate-400"}`}
              >
                Top 5 Income
              </button>
              <button
                type="button"
                onClick={() => setDonutTab("expense")}
                className={`pb-1 ${donutTab === "expense" ? "text-rose-500 border-b-2 border-rose-500" : "text-slate-400"}`}
              >
                Expense
              </button>
            </div>
          </div>

          <div className="mt-4 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {isDonutEmpty ? (
                  <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#64748b" fontSize={14}>
                    No Data
                  </text>
                ) : (
                  <Pie
                    data={donutData}
                    dataKey="value"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {donutData.map((entry, idx) => (
                      <Cell key={entry.name} fill={donutColors[idx % donutColors.length]} />
                    ))}
                  </Pie>
                )}
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            {isDonutEmpty ? (
              <span>No data in selected date range</span>
            ) : (
              donutData.map((item, idx) => (
                <span key={item.name} className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: donutColors[idx % donutColors.length] }} />
                  {item.name}
                </span>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full border border-blue-200 text-blue-600 flex items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-blue-500 flex items-center justify-center text-[10px] font-semibold">
              {currencyBadge}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Sales</p>
            <p className="text-sm font-semibold text-slate-700">{currencyPrefix}{money(totals.totalSales)}</p>
          </div>
        </Card>

        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full border border-amber-200 text-amber-600 flex items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-amber-500 flex items-center justify-center text-[10px] font-semibold">
              {currencyBadge}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Purchase</p>
            <p className="text-sm font-semibold text-slate-700">{currencyPrefix}{money(totals.expenses)}</p>
          </div>
        </Card>

        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full border border-emerald-200 text-emerald-600 flex items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-emerald-500 flex items-center justify-center text-[10px] font-semibold">
              {currencyBadge}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Income</p>
            <p className="text-sm font-semibold text-slate-700">{currencyPrefix}{money(totals.received)}</p>
          </div>
        </Card>

        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full border border-rose-200 text-rose-600 flex items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-rose-500 flex items-center justify-center text-[10px] font-semibold">
              {currencyBadge}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Expense</p>
            <p className="text-sm font-semibold text-slate-700">{currencyPrefix}{money(totals.totalExpense)}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
