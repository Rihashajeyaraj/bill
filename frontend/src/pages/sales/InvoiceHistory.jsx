import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import ActionStatusDialog from "../../components/ActionStatusDialog";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import DateInput from "../../components/DateInput";
import { useFinancialYears } from "../../context/FinancialYearContext";
import { useToast } from "../../context/ToastContext";
import { invoicesList, invoicesSyncFromRemote } from "../../services/invoices.service";
import { apiClient } from "../../services/apiClient";
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

function totalFromInvoice(invoice) {
  return Number(invoice?.totals?.grandTotal || 0);
}

function balanceFromInvoice(invoice) {
  return Number(invoice?.remainingBalance ?? invoice?.totals?.balance ?? totalFromInvoice(invoice));
}

function paidFromInvoice(invoice) {
  return Math.max(0, totalFromInvoice(invoice) - balanceFromInvoice(invoice));
}

function resolveStatus(invoice) {
  const rawStatus = String(invoice?.status || "").trim().toLowerCase();
  if (rawStatus === "cancelled" || rawStatus === "draft") return rawStatus;
  const grandTotal = totalFromInvoice(invoice);
  const balance = balanceFromInvoice(invoice);
  if (grandTotal <= 0) return "draft";
  if (balance <= 0) return "paid";
  if (balance < grandTotal) return "partial";
  if (rawStatus) return rawStatus;
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
  const location = useLocation();
  const toast = useToast();
  const { activeRange, selectedYear } = useFinancialYears();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [invoices, setInvoices] = useState(() => invoicesList(activeRange));
  const [reloadKey, setReloadKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusDialog, setStatusDialog] = useState({
    open: false,
    title: "",
    message: "",
    tone: "success"
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const previewId = params.get("preview");
    if (previewId) {
      navigate(`/app/sales/invoice/view/${encodeURIComponent(previewId)}`, { replace: true });
    }
  }, [location.search, navigate]);

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
    const timeoutMs = 8000;

    async function fetchInvoicesWithTimeout() {
      setLoading(true);
      setError(null);
      setWarning(null);

      const fetchPromise = (async () => {
        let loadedInvoices = [];
        let hasData = false;

        // 1. Primary: FastAPI backend (batch-loaded parties, avoids redundant full table + lines download)
        try {
          const fastApiData = await apiClient.getInvoices();
          if (Array.isArray(fastApiData)) {
            hasData = true;
            loadedInvoices = fastApiData.map((inv) => ({
              id: inv.id,
              invoiceNo: inv.invoice_no || inv.invoiceNo || inv.id,
              invoiceDate: inv.invoice_date || inv.invoiceDate || "",
              dueDate: inv.due_date || inv.dueDate || "",
              partyName: inv.customer_name || (inv.customer && (inv.customer.display_name || inv.customer.name)) || inv.party_name || "-",
              buyer: {
                name: inv.customer_name || (inv.customer && (inv.customer.display_name || inv.customer.name)) || inv.party_name || "-",
                phone: inv.customer_phone || (inv.customer && inv.customer.phone) || ""
              },
              totals: {
                grandTotal: Number(inv.grand_total ?? inv.subtotal ?? 0)
              },
              remainingBalance: Number(inv.balance_due ?? inv.balance_amount ?? 0),
              status: inv.status || "issued",
              lines: Array.isArray(inv.items) ? inv.items : []
            }));
          }
        } catch (fastApiErr) {
          console.warn("FastAPI invoices fetch failed, checking fallback:", fastApiErr);
        }

        // 2. Fallback: remote sync or local storage if primary failed
        if (!hasData) {
          try {
            const remoteSyncData = await invoicesSyncFromRemote(activeRange);
            if (Array.isArray(remoteSyncData) && remoteSyncData.length > 0) {
              hasData = true;
              loadedInvoices = remoteSyncData;
            }
          } catch (syncErr) {
            console.warn("Remote sync fallback failed:", syncErr);
          }
        }

        if (!hasData) {
          loadedInvoices = invoicesList(activeRange);
        }

        return loadedInvoices;
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out while loading invoice history.")), timeoutMs)
      );

      try {
        const data = await Promise.race([fetchPromise, timeoutPromise]);
        if (mounted) {
          setInvoices(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          console.warn("Invoice history load error:", err);
          const fallbackData = invoicesList(activeRange);
          if (fallbackData.length > 0) {
            setInvoices(fallbackData);
            setWarning("Showing local cached data due to network notice.");
          } else {
            setError(err?.message || "Failed to load invoice history.");
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchInvoicesWithTimeout();
    return () => {
      mounted = false;
    };
  }, [reloadKey, activeRange?.fromDate, activeRange?.toDate]);

  useEffect(() => {
    const dialogState = location.state?.statusDialog;
    if (!dialogState?.title || !dialogState?.message) return;

    setStatusDialog({
      open: true,
      title: dialogState.title,
      message: dialogState.message,
      tone: dialogState.tone || "success"
    });

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  return (
    <div className="max-w-6xl space-y-6">
      <ActionStatusDialog
        open={statusDialog.open}
        title={statusDialog.title}
        message={statusDialog.message}
        tone={statusDialog.tone}
        onClose={() =>
          setStatusDialog({
            open: false,
            title: "",
            message: "",
            tone: "success"
          })
        }
      />
      <PageHeader
        title="Tax Invoice History"
        subtitle={`All saved sales tax invoices in one place.${selectedYear?.label ? ` FY ${selectedYear.label}` : ""}`}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/app/sales/invoice")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          New Tax Invoice
        </button>
      </div>

      {warning ? (
        <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <span>{warning}</span>
          <button
            type="button"
            onClick={() => setWarning(null)}
            className="font-semibold text-amber-900 hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <Card className="border-rose-200 bg-rose-50 p-6 text-center">
          <p className="text-sm font-semibold text-rose-800">Failed to load Tax Invoice History</p>
          <p className="mt-1 text-xs text-rose-600">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((prev) => prev + 1)}
            className="mt-4 inline-flex items-center rounded-xl border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            Retry
          </button>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tax Invoices</h2>
            <p className="text-xs text-slate-500">Review tax invoices and open actions.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {filteredInvoices.length} tax invoices
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
          <table className="min-w-[1320px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Invoice No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Phone</th>
                <th className="px-3 py-3 font-semibold text-right">Qty</th>
                <th className="px-3 py-3 font-semibold text-right">Total</th>
                <th className="px-3 py-3 font-semibold text-right">Paid</th>
                <th className="px-3 py-3 font-semibold text-right">Balance</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold min-w-[320px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-8 text-center text-slate-500" colSpan={10}>
                    <div className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                      <span>Loading invoice history...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-10 text-center text-slate-500" colSpan={10}>
                    <p className="text-sm font-semibold text-slate-700">No tax invoices yet</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {searchQuery || fromDate || toDate || statusFilter || customerFilter
                        ? "No matching tax invoices found for the applied filters."
                        : "Create your first Tax Invoice to see it listed here."}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => {
                  const status = resolveStatus(invoice);
                  const totalAmount = totalFromInvoice(invoice);
                  const paidAmount = paidFromInvoice(invoice);
                  const balanceAmount = balanceFromInvoice(invoice);
                  return (
                    <React.Fragment key={invoice.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-3 font-semibold text-slate-900">{invoice.invoiceNo || "-"}</td>
                        <td className="px-3 py-3 text-slate-600">{formatDate(invoice.invoiceDate)}</td>
                        <td className="px-3 py-3 text-slate-700">{invoice.partyName || invoice?.buyer?.name || "-"}</td>
                        <td className="px-3 py-3 text-slate-600">{invoice?.buyer?.phone || "-"}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{money(qtyFromInvoice(invoice))}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">
                          {money(totalAmount)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-emerald-700">
                          {money(paidAmount)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-amber-700">
                          {money(balanceAmount)}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(status)}`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="grid min-w-[280px] grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/invoice/view/${encodeURIComponent(invoice.id)}`)
                              }
                              className={neutralActionButtonClass}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/invoice/view/${encodeURIComponent(invoice.id)}?payment=true`)
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
