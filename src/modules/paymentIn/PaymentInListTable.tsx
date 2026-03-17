import React from "react";
import { Download, Eye, FilePenLine } from "lucide-react";
import type { PaymentInRecord } from "./store";
import { formatCurrencyByPreference } from "../../lib/formatPreferences";

interface PaymentInListTableProps {
  records: PaymentInRecord[];
  page: number;
  pageSize: number;
  onPageChange: (next: number) => void;
  onView: (paymentId: string) => void;
  onEdit: (paymentId: string) => void;
  onDownloadPdf: (paymentId: string) => void;
}

function statusClass(status: PaymentInRecord["status"]) {
  if (status === "Applied") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "Confirmed") return "bg-sky-50 text-sky-700 border-sky-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function PaymentInListTable({
  records,
  page,
  pageSize,
  onPageChange,
  onView,
  onEdit,
  onDownloadPdf
}: PaymentInListTableProps) {
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const rows = records.slice(start, start + pageSize);
  const money = (value: number, currency: string) =>
    formatCurrencyByPreference(Number(value || 0), currency, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1320px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="px-4 py-3 font-semibold text-slate-700">Receipt No</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Customer</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Payment Mode</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Reference No</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-right">Amount Received</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-right">Applied Amount</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-right">Balance / Unapplied</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-semibold text-slate-900">{entry.receiptNo}</td>
                  <td className="px-4 py-3 text-slate-700">{entry.paymentDate}</td>
                  <td className="px-4 py-3 text-slate-700">{entry.customerName}</td>
                  <td className="px-4 py-3 text-slate-700">{entry.paymentMode}</td>
                  <td className="px-4 py-3 text-slate-700">{entry.referenceNo || entry.transactionId || "-"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {money(entry.totals.amountReceived, entry.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {money(entry.totals.amountApplied, entry.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {money(entry.totals.unappliedAmount, entry.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(entry.status)}`}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onView(entry.id)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(entry.id)}
                        disabled={entry.status === "Applied"}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FilePenLine className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadPdf(entry.id)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="px-4 py-20 text-center text-slate-500">
                  No payment receipts found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500">
          Showing {rows.length ? start + 1 : 0}-{start + rows.length} of {records.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-xs font-semibold text-slate-600">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
