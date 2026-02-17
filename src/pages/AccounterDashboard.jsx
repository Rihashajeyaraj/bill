import React, { useMemo } from "react";
import { ArrowDownCircle, ArrowUpCircle, FileClock, ReceiptIndianRupee } from "lucide-react";
import Card from "../components/Card";
import { invoicesList } from "../services/invoices.service";
import { paymentsList } from "../services/payments.service";
import { companyGetProfile } from "../services/company.service";

function money(n) {
  const value = Number(n || 0);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function AccounterDashboard() {
  const company = companyGetProfile();
  const currency = company?.currency || company?.currencies?.[0] || "INR";
  const invoices = invoicesList();
  const payments = paymentsList();

  const stats = useMemo(() => {
    const totalInvoices = invoices.reduce((sum, invoice) => sum + Number(invoice?.totals?.grandTotal || 0), 0);
    const pendingInvoices = invoices.filter((invoice) => {
      const status = String(invoice?.status || invoice?.paymentStatus || "").toLowerCase();
      return status !== "paid";
    });

    const incoming = payments
      .filter((entry) => String(entry?.direction || "").toUpperCase() === "IN")
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);

    const outgoing = payments
      .filter((entry) => String(entry?.direction || "").toUpperCase() === "OUT")
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);

    const pendingTotal = pendingInvoices.reduce(
      (sum, invoice) => sum + Number(invoice?.totals?.balance || invoice?.totals?.grandTotal || 0),
      0
    );

    return {
      totalInvoices,
      pendingCount: pendingInvoices.length,
      pendingTotal,
      incoming,
      outgoing
    };
  }, [invoices, payments]);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="rounded-2xl bg-slate-100 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Accounter Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Track receivables, payables, and daily billing operations.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Total Invoiced</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{currency} {money(stats.totalInvoices)}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Pending Invoices</p>
          <p className="mt-2 text-lg font-semibold text-amber-600">{stats.pendingCount}</p>
          <p className="text-xs text-slate-500">{currency} {money(stats.pendingTotal)}</p>
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Payment In</p>
            <p className="mt-2 text-lg font-semibold text-emerald-600">{currency} {money(stats.incoming)}</p>
          </div>
          <ArrowDownCircle className="h-6 w-6 text-emerald-600" />
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Payment Out</p>
            <p className="mt-2 text-lg font-semibold text-rose-600">{currency} {money(stats.outgoing)}</p>
          </div>
          <ArrowUpCircle className="h-6 w-6 text-rose-600" />
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-slate-700">
          <FileClock className="h-4 w-4" />
          <p className="text-sm font-semibold">Today&apos;s Accounter Focus</p>
        </div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Collect pending customer dues and reconcile payment-in entries.</li>
          <li>Review supplier dues before due-date to avoid penalties.</li>
          <li>Check GST/VAT impact in today&apos;s invoices and purchase bills.</li>
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-slate-700">
          <ReceiptIndianRupee className="h-4 w-4" />
          <p className="text-sm font-semibold">Organization Billing Rules</p>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Tax and invoice numbering are read from organization settings. Use Company Setup and Company
          Settings to keep India GST details correct.
        </p>
      </Card>
    </div>
  );
}
