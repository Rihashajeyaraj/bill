import React, { useMemo } from "react";
import { TrendingUp, HandCoins, Wallet2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Card from "../components/Card";

import { invoicesList } from "../services/invoices.service";
import { purchasesList } from "../services/purchases.service";
import { paymentsList } from "../services/payments.service";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function Dashboard() {
  const invoices = invoicesList();
  const purchases = purchasesList();
  const payments = paymentsList();

  const totals = useMemo(() => {
    const sales = invoices.reduce((a, x) => a + Number(x?.totals?.grandTotal || 0), 0);
    const purchase = purchases.reduce((a, x) => a + Number(x?.totals?.grandTotal || 0), 0);

    const received = payments.filter((p) => p.direction === "IN").reduce((a, x) => a + Number(x.amount || 0), 0);
    const paid = payments.filter((p) => p.direction === "OUT").reduce((a, x) => a + Number(x.amount || 0), 0);

    return {
      totalSales: sales,
      receivables: Math.max(0, sales - received),
      payables: Math.max(0, purchase - paid)
    };
  }, [invoices, purchases, payments]);

  const recent = useMemo(() => {
    const tx = [];
    invoices.slice(0, 5).forEach((x) =>
      tx.push({ id: x.id, type: "Invoice", party: x.partyName, amount: x.totals?.grandTotal, date: x.invoiceDate })
    );
    purchases.slice(0, 5).forEach((x) =>
      tx.push({ id: x.id, type: "Purchase", party: x.partyName, amount: x.totals?.grandTotal, date: x.billDate })
    );
    payments.slice(0, 5).forEach((x) =>
      tx.push({
        id: x.id,
        type: x.direction === "IN" ? "Payment In" : "Payment Out",
        party: x.partyName,
        amount: x.amount,
        date: x.date
      })
    );
    return tx
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 10);
  }, [invoices, purchases, payments]);

  const chart = useMemo(() => {
    const map = new Map();
    for (const inv of invoices) {
      const m = String(inv.invoiceDate || "").slice(0, 7) || "2026-01";
      map.set(m, (map.get(m) || 0) + Number(inv.totals?.grandTotal || 0));
    }
    const keys = Array.from(map.keys()).sort();
    return keys.map((k) => ({ month: k, sales: Math.round(map.get(k) || 0) }));
  }, [invoices]);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Dashboard" subtitle="Business overview (mock data, localStorage-ready)" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Sales" value={money(totals.totalSales)} icon={TrendingUp} hint="Sum of invoices" />
        <StatCard title="Receivables" value={money(totals.receivables)} icon={HandCoins} hint="Sales - Payments In" />
        <StatCard title="Payables" value={money(totals.payables)} icon={Wallet2} hint="Purchases - Payments Out" />
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Sales Trend</p>
              <p className="text-xs text-slate-500">Based on invoices grouped by month</p>
            </div>
          </div>

          <div className="mt-3 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart.length ? chart : [{ month: "2026-01", sales: 0 }]}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="sales" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="lg:col-span-1">
          <DataTable
            columns={[
              { key: "type", header: "Type" },
              { key: "party", header: "Party" },
              { key: "date", header: "Date" },
              { key: "amount", header: "Amount", render: (r) => money(r.amount) }
            ]}
            rows={recent}
            emptyText="No transactions yet"
          />
        </div>
      </div>
    </div>
  );
}
