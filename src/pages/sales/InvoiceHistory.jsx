import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import { useToast } from "../../context/ToastContext";
import { invoicesList, invoicesSyncFromRemote } from "../../services/invoices.service";
import {
  fetchInvoiceAllocationDetails,
  fetchInvoiceProfitDetails
} from "../../services/inventory.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

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

export default function InvoiceHistory() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState(() => invoicesList());
  const [activeInvoiceId, setActiveInvoiceId] = useState("");
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [allocationError, setAllocationError] = useState("");
  const [allocationRows, setAllocationRows] = useState([]);
  const [profitSummary, setProfitSummary] = useState(null);
  const [itemProfitRows, setItemProfitRows] = useState([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const synced = await invoicesSyncFromRemote();
        if (!mounted) return;
        setInvoices(Array.isArray(synced) ? synced : invoicesList());
      } catch (error) {
        if (!mounted) return;
        setInvoices(invoicesList());
        toast.error("Failed to load invoice history", error?.message || "Showing local data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [toast]);

  async function toggleAllocationDetails(invoiceId) {
    if (!invoiceId) return;
    if (String(activeInvoiceId) === String(invoiceId)) {
      setActiveInvoiceId("");
      setAllocationError("");
      setAllocationRows([]);
      setProfitSummary(null);
      setItemProfitRows([]);
      return;
    }

    setActiveInvoiceId(invoiceId);
    setAllocationLoading(true);
    setAllocationError("");
    try {
      const [allocations, profit] = await Promise.all([
        fetchInvoiceAllocationDetails(invoiceId),
        fetchInvoiceProfitDetails(invoiceId)
      ]);
      setAllocationRows(Array.isArray(allocations) ? allocations : []);
      setProfitSummary(profit?.summary || null);
      setItemProfitRows(Array.isArray(profit?.items) ? profit.items : []);
    } catch (error) {
      setAllocationRows([]);
      setProfitSummary(null);
      setItemProfitRows([]);
      setAllocationError(error?.message || "Failed to load allocation details.");
    } finally {
      setAllocationLoading(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Invoice History" subtitle="All saved sales invoices in one place." />

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
            {invoices.length} invoices
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Invoice No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Phone</th>
                <th className="px-3 py-3 font-semibold text-right">Qty</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    Loading invoice history...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => {
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
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/payment-in?invoiceId=${encodeURIComponent(invoice.id)}`)
                              }
                              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Payment
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/app/sales/credit-note?invoiceId=${encodeURIComponent(invoice.id)}`)
                              }
                              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Credit Note
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void toggleAllocationDetails(invoice.id);
                              }}
                              className="rounded-xl border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              {String(activeInvoiceId) === String(invoice.id)
                                ? "Hide Allocation"
                                : "Allocation"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {String(activeInvoiceId) === String(invoice.id) ? (
                        <tr className="border-t border-slate-100 bg-slate-50/60">
                          <td className="px-3 py-3" colSpan={8}>
                            {allocationLoading ? (
                              <p className="text-xs text-slate-600">Loading allocation details...</p>
                            ) : allocationError ? (
                              <p className="text-xs text-rose-600">{allocationError}</p>
                            ) : (
                              <div className="space-y-3">
                                {profitSummary ? (
                                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                    <span className="mr-4">Revenue (excl tax): {money(profitSummary.revenue_excl_tax)}</span>
                                    <span className="mr-4">COGS: {money(profitSummary.cogs_amount)}</span>
                                    <span className="mr-4">Gross Profit: {money(profitSummary.gross_profit)}</span>
                                    <span>Margin %: {money(profitSummary.margin_percent)}</span>
                                  </div>
                                ) : null}

                                {allocationRows.length ? (
                                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                    <table className="min-w-[760px] w-full text-left text-xs">
                                      <thead className="bg-slate-100 text-slate-600">
                                        <tr>
                                          <th className="px-2 py-2 font-semibold">Item</th>
                                          <th className="px-2 py-2 font-semibold">Batch</th>
                                          <th className="px-2 py-2 font-semibold text-right">Qty</th>
                                          <th className="px-2 py-2 font-semibold text-right">Cost/unit</th>
                                          <th className="px-2 py-2 font-semibold text-right">COGS</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {allocationRows.map((row) => (
                                          <tr key={row.allocation_id} className="border-t border-slate-100">
                                            <td className="px-2 py-2">
                                              {row.item_name || row.item_code || row.item_id || "Item"}
                                            </td>
                                            <td className="px-2 py-2">
                                              {row.batch_document_no || "NEGATIVE-STOCK"}{" "}
                                              {row.batch_date ? `(${formatDate(row.batch_date)})` : ""}
                                            </td>
                                            <td className="px-2 py-2 text-right">{money(row.allocated_qty)}</td>
                                            <td className="px-2 py-2 text-right">{money(row.unit_cost_excl_tax)}</td>
                                            <td className="px-2 py-2 text-right">{money(row.cogs_amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-600">
                                    No batch allocation rows found for this invoice.
                                  </p>
                                )}

                                {itemProfitRows.length ? (
                                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                    <table className="min-w-[760px] w-full text-left text-xs">
                                      <thead className="bg-slate-100 text-slate-600">
                                        <tr>
                                          <th className="px-2 py-2 font-semibold">Line Item</th>
                                          <th className="px-2 py-2 font-semibold text-right">Qty</th>
                                          <th className="px-2 py-2 font-semibold text-right">Revenue</th>
                                          <th className="px-2 py-2 font-semibold text-right">COGS</th>
                                          <th className="px-2 py-2 font-semibold text-right">Profit</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {itemProfitRows.map((row) => (
                                          <tr key={row.invoice_item_id} className="border-t border-slate-100">
                                            <td className="px-2 py-2">{row.item_name || "Item"}</td>
                                            <td className="px-2 py-2 text-right">{money(row.qty)}</td>
                                            <td className="px-2 py-2 text-right">{money(row.revenue_excl_tax)}</td>
                                            <td className="px-2 py-2 text-right">{money(row.cogs_amount)}</td>
                                            <td className="px-2 py-2 text-right">{money(row.gross_profit_amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
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
