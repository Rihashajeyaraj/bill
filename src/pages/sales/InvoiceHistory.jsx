import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import DateInput from "../../components/DateInput";
import { useFinancialYears } from "../../context/FinancialYearContext";
import { useToast } from "../../context/ToastContext";
import { invoicesList, invoicesSyncFromRemote } from "../../services/invoices.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";
import { compareHistoryDatesDesc, sortHistoryRowsByDate } from "../../lib/historySort";

function money(n) {
  return formatNumberByPreference(Number(n || 0), { maximumFractionDigits: 2 });
}

function formatDate(value) {
  return formatDateByPreference(value, String(value || "-"));
}

function qtyFromInvoice(invoice) {
  const lines = Array.isArray(invoice?.lines) ? invoice.lines : [];
  return lines.reduce((sum, line) => sum + Number(line?.qty || 0), 0);
}

function resolveStatus(invoice) {
  const rawStatus = String(invoice?.status || "").trim().toLowerCase();
  if (rawStatus) return rawStatus;
  const grandTotal = Number(invoice?.totals?.grandTotal || 0);
  const balance = Number(invoice?.remainingBalance ?? invoice?.totals?.balance ?? grandTotal);
  if (grandTotal <= 0) return "draft";
  if (balance <= 0) return "paid";
  if (balance < grandTotal) return "partial";
  return "issued";
}

function statusBadgeClass(status) {
  if (status === "paid") return "bg-emerald-100 text-emerald-700";
  if (status === "partial") return "bg-amber-100 text-amber-700";
  if (status === "cancelled") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

const actionButtonClass =
  "inline-flex min-h-9 items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition";
const neutralActionButtonClass = `${actionButtonClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

export default function InvoiceHistory() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeRange, selectedYear } = useFinancialYears();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState(() => invoicesList(activeRange));
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");

  const sortedInvoices = useMemo(
    () => {
      const source = sortHistoryRowsByDate(
        invoices,
        (invoice) => invoice?.invoiceDate || invoice?.created_at || invoice?.createdAt,
        (invoice) => invoice?.invoiceNo || invoice?.id
      );
      return source.sort((left, right) => {
        const byCreatedAt = compareHistoryDatesDesc(
          left?.created_at || left?.createdAt || left?.updated_at || left?.updatedAt,
          right?.created_at || right?.createdAt || right?.updated_at || right?.updatedAt
        );
        if (byCreatedAt !== 0) return byCreatedAt;

        const byInvoiceDate = compareHistoryDatesDesc(left?.invoiceDate, right?.invoiceDate);
        if (byInvoiceDate !== 0) return byInvoiceDate;

        return String(right?.invoiceNo || right?.id || "").localeCompare(
          String(left?.invoiceNo || left?.id || ""),
          undefined,
          { numeric: true, sensitivity: "base" }
        );
      });
    },
    [invoices]
  );
  const customerOptions = useMemo(() => {
    const unique = new Set();
    sortedInvoices.forEach((invoice) => {
      const value = String(invoice?.partyName || invoice?.buyer?.name || "").trim();
      if (value) unique.add(value);
    });
    return [...unique].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [sortedInvoices]);
  const statusOptions = useMemo(() => {
    const unique = new Set(sortedInvoices.map((invoice) => resolveStatus(invoice)).filter(Boolean));
    return [...unique];
  }, [sortedInvoices]);
  const filteredByControls = useMemo(() => {
    return sortedInvoices.filter((invoice) => {
      const invoiceDate = String(invoice?.invoiceDate || "").trim();
      const status = resolveStatus(invoice);
      const customerName = String(invoice?.partyName || invoice?.buyer?.name || "").trim();
      if (fromDate && invoiceDate && invoiceDate < fromDate) return false;
      if (toDate && invoiceDate && invoiceDate > toDate) return false;
      if (statusFilter && status !== statusFilter) return false;
      if (customerFilter && customerName !== customerFilter) return false;
      return true;
    });
  }, [customerFilter, fromDate, sortedInvoices, statusFilter, toDate]);
  const filteredInvoices = useMemo(() => {
    const query = String(searchQuery || "").trim().toLowerCase();
    if (!query) return filteredByControls;
    return filteredByControls.filter((invoice) => {
      const values = [
        invoice?.invoiceNo,
        invoice?.invoiceDate,
        invoice?.partyName,
        invoice?.buyer?.name,
        invoice?.buyer?.phone,
        resolveStatus(invoice),
        invoice?.totals?.grandTotal
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [filteredByControls, searchQuery]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const synced = await invoicesSyncFromRemote(activeRange);
        if (!mounted) return;
        setInvoices(Array.isArray(synced) ? synced : invoicesList(activeRange));
      } catch (error) {
        if (!mounted) return;
        setInvoices(invoicesList(activeRange));
        toast.error("Failed to load invoice history", error?.message || "Showing local data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [toast, activeRange?.fromDate, activeRange?.toDate]);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Invoice History"
        subtitle={`All saved sales invoices in one place.${selectedYear?.label ? ` FY ${selectedYear.label}` : ""}`}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/app/sales/invoice")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Back to Invoice
        </button>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Sales Invoices</h2>
            <p className="text-xs text-slate-500">Review invoices and open actions.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {filteredInvoices.length} invoices
          </span>
        </div>

        <div className="mt-4">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search invoice no, customer, phone, status"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <DateInput
            value={fromDate}
            onChange={setFromDate}
            placeholder="From date"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          />
          <DateInput
            value={toDate}
            onChange={setToDate}
            placeholder="To date"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          >
            <option value="">All Status</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            value={customerFilter}
            onChange={(event) => setCustomerFilter(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          >
            <option value="">All Customers</option>
            {customerOptions.map((customer) => (
              <option key={customer} value={customer}>
                {customer}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[1180px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Invoice No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Phone</th>
                <th className="px-3 py-3 font-semibold text-right">Qty</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold min-w-[320px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    Loading invoice history...
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    {searchQuery ? "No matching invoices found." : "No invoices yet."}
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => {
                  const status = resolveStatus(invoice);
                  return (
                    <React.Fragment key={invoice.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-3 font-semibold text-slate-900">{invoice.invoiceNo || "-"}</td>
                        <td className="px-3 py-3 text-slate-600">{formatDate(invoice.invoiceDate)}</td>
                        <td className="px-3 py-3 text-slate-700">{invoice.partyName || invoice?.buyer?.name || "-"}</td>
                        <td className="px-3 py-3 text-slate-600">{invoice?.buyer?.phone || "-"}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{money(qtyFromInvoice(invoice))}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">
                          {money(invoice?.totals?.grandTotal)}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(status)}`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="grid min-w-[300px] grid-cols-2 gap-2 lg:grid-cols-3">
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/invoice?preview=${encodeURIComponent(invoice.id)}`)
                              }
                              className={neutralActionButtonClass}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/invoice?edit=${encodeURIComponent(invoice.id)}`)
                              }
                              className={neutralActionButtonClass}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/payment-in?invoiceId=${encodeURIComponent(invoice.id)}`)
                              }
                              className={neutralActionButtonClass}
                            >
                              Payment
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/credit-note?invoiceId=${encodeURIComponent(invoice.id)}`)
                              }
                              className={neutralActionButtonClass}
                            >
                              Credit Note
                            </button>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
