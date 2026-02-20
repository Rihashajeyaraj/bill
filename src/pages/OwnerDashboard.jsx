import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  Wallet,
  Plus,
  Minus,
  RotateCw
} from "lucide-react";
import Card from "../components/Card";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { purchasesList, purchasesSyncFromRemote } from "../services/purchases.service";
import { paymentsList, paymentsSyncFromRemote } from "../services/payments.service";
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

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buildMonthLabels() {
  return ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
}

export default function Dashboard() {
  const { currency = "INR" } = useOrganization();

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
  const [donutTab, setDonutTab] = useState("income");

  useEffect(() => {
    let mounted = true;
    async function syncDashboardData() {
      try {
        const [syncedInvoices, syncedPurchases, syncedPayments] = await Promise.all([
          invoicesSyncFromRemote(),
          purchasesSyncFromRemote(),
          paymentsSyncFromRemote()
        ]);
        if (!mounted) return;
        setInvoices(Array.isArray(syncedInvoices) ? syncedInvoices : invoicesList());
        setPurchases(Array.isArray(syncedPurchases) ? syncedPurchases : purchasesList());
        setPayments(Array.isArray(syncedPayments) ? syncedPayments : paymentsList());
      } catch {
        if (!mounted) return;
        setInvoices(invoicesList());
        setPurchases(purchasesList());
        setPayments(paymentsList());
      }
    }
    syncDashboardData();
    return () => {
      mounted = false;
    };
  }, []);

  const currencyPrefix = currency ? `${currency} ` : "";
  const currencyBadge = currency.slice(0, 3).toUpperCase();

  const totals = useMemo(() => {
    const sales = invoices.reduce((a, x) => a + Number(x?.totals?.grandTotal || 0), 0);
    const purchase = purchases.reduce((a, x) => a + Number(x?.totals?.grandTotal || 0), 0);

    const received = payments.filter((p) => p.direction === "IN").reduce((a, x) => a + Number(x.amount || 0), 0);
    const paid = payments.filter((p) => p.direction === "OUT").reduce((a, x) => a + Number(x.amount || 0), 0);
    const overdueCutoff = new Date();
    overdueCutoff.setHours(0, 0, 0, 0);
    overdueCutoff.setDate(overdueCutoff.getDate() - 30);

    let remainingReceived = Math.max(0, received);
    const sortedInvoices = [...invoices].sort((a, b) => {
      const aTime = new Date(a?.invoiceDate || a?.date || a?.created_at || 0).getTime();
      const bTime = new Date(b?.invoiceDate || b?.date || b?.created_at || 0).getTime();
      return aTime - bTime;
    });

    const overdueAmount = sortedInvoices.reduce((sum, invoice) => {
      const status = String(invoice?.status || invoice?.paymentStatus || "").toLowerCase();
      if (status === "paid") return sum;

      const invoiceTotal = Math.max(
        0,
        Number(
          invoice?.totals?.balance ??
            invoice?.remainingBalance ??
            invoice?.totals?.grandTotal ??
            invoice?.totals?.total ??
            0
        )
      );
      if (!invoiceTotal) return sum;

      const applied = Math.min(invoiceTotal, remainingReceived);
      remainingReceived = Math.max(0, remainingReceived - applied);
      const outstanding = Math.max(0, invoiceTotal - applied);
      if (!outstanding) return sum;

      const invoiceDate = new Date(invoice?.invoiceDate || invoice?.date || invoice?.created_at || 0);
      if (Number.isNaN(invoiceDate.getTime()) || invoiceDate >= overdueCutoff) return sum;

      return sum + outstanding;
    }, 0);

    return {
      totalSales: sales,
      receivables: Math.max(0, sales - received),
      payables: Math.max(0, purchase - paid),
      cashBalance: Math.max(0, received - paid),
      overdueAmount: Math.max(0, overdueAmount),
      expenses: purchase,
      received,
      paid
    };
  }, [invoices, purchases, payments]);

  const chart = useMemo(() => {
    const months = buildMonthLabels();
    const incomeMap = new Map();
    const expenseMap = new Map();

    invoices.forEach((inv) => {
      const label = new Date(inv.invoiceDate || Date.now()).toLocaleString(undefined, { month: "short" });
      incomeMap.set(label, (incomeMap.get(label) || 0) + Number(inv.totals?.grandTotal || 0));
    });
    purchases.forEach((bill) => {
      const label = new Date(bill.billDate || Date.now()).toLocaleString(undefined, { month: "short" });
      expenseMap.set(label, (expenseMap.get(label) || 0) + Number(bill.totals?.grandTotal || 0));
    });

    return months.map((m) => ({
      month: m,
      income: Math.round(incomeMap.get(m) || 0),
      expense: Math.round(expenseMap.get(m) || 0)
    }));
  }, [invoices, purchases]);

  const donutData = useMemo(() => {
    if (donutTab === "expense") {
      return [
        { name: "Rent", value: 42 },
        { name: "Salaries", value: 28 },
        { name: "Transport", value: 12 },
        { name: "Utilities", value: 10 },
        { name: "Misc", value: 8 }
      ];
    }
    return [
      { name: "Interest Income", value: 38 },
      { name: "Rental Income", value: 18 },
      { name: "Sponsorship Income", value: 15 },
      { name: "Commission Income", value: 17 },
      { name: "Bad debts recovery", value: 12 }
    ];
  }, [donutTab]);

  const donutColors = ["#ff6b6b", "#f6c453", "#4caf50", "#8e8e93", "#3b82f6"];

  return (
    <div className="max-w-6xl">
      <div className="rounded-2xl bg-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-700">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none"
            defaultValue="2023-04-01"
          />
          <input
            type="date"
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none"
            defaultValue="2024-03-31"
          />
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 outline-none">
            <option>This Fin Year</option>
            <option>Last Fin Year</option>
            <option>Custom</option>
          </select>
          <button className="h-8 w-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center">
            <RotateCw className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Income vs Expense</p>
            <div className="flex items-center gap-2">
              <button className="h-7 w-7 rounded-md border border-slate-200 bg-white flex items-center justify-center">
                <Plus className="h-4 w-4 text-slate-500" />
              </button>
              <button className="h-7 w-7 rounded-md border border-slate-200 bg-white flex items-center justify-center">
                <Minus className="h-4 w-4 text-slate-500" />
              </button>
              <button className="h-7 w-7 rounded-md border border-slate-200 bg-white flex items-center justify-center">
                <RotateCw className="h-4 w-4 text-slate-500" />
              </button>
            </div>
          </div>
          <div className="mt-3 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="income" fill="#4caf50" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expense" fill="#6b7280" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
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
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            {donutData.map((item, idx) => (
              <span key={item.name} className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: donutColors[idx % donutColors.length] }} />
                {item.name}
              </span>
            ))}
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
            <p className="text-sm font-semibold text-slate-700">{currencyPrefix}{money(totals.paid)}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
