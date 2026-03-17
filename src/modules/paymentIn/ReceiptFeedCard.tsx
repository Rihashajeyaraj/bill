import React from "react";
import { Eye, FileDown, Pencil, RotateCcw } from "lucide-react";
import type { PaymentInRecord } from "./store";
import { formatCurrencyByPreference } from "../../lib/formatPreferences";

interface ReceiptFeedCardProps {
  record: PaymentInRecord;
  onView: () => void;
  onEdit: () => void;
  onPdf: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
}

function statusClass(status: PaymentInRecord["status"]) {
  if (status === "Applied") return "bg-emerald-50 border-emerald-200 text-emerald-700";
  if (status === "Confirmed") return "bg-sky-50 border-sky-200 text-sky-700";
  return "bg-slate-100 border-slate-200 text-slate-700";
}

export default function ReceiptFeedCard({
  record,
  onView,
  onEdit,
  onPdf,
  onUndo,
  canUndo
}: ReceiptFeedCardProps) {
  const money = (value: number) =>
    formatCurrencyByPreference(Number(value || 0), record.currency, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{record.receiptNo}</p>
          <p className="text-xs text-slate-500">{record.paymentDate}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(record.status)}`}>
          {record.status}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-sm text-slate-700">
        <p>{record.customerName}</p>
        <p className="text-xs text-slate-500">{record.paymentMode} | {record.referenceNo || record.transactionId || "No reference"}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-slate-500">Received</p>
          <p className="font-semibold text-slate-900">{money(record.totals.amountReceived)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-slate-500">Applied</p>
          <p className="font-semibold text-slate-900">{money(record.totals.amountApplied)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-slate-500">Unapplied</p>
          <p className="font-semibold text-amber-700">{money(record.totals.unappliedAmount)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={onView} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700"><Eye className="h-3.5 w-3.5" />View</button>
        <button onClick={onEdit} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700"><Pencil className="h-3.5 w-3.5" />Edit</button>
        <button onClick={onPdf} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700"><FileDown className="h-3.5 w-3.5" />PDF</button>
        {canUndo && onUndo ? (
          <button onClick={onUndo} className="inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700"><RotateCcw className="h-3.5 w-3.5" />Undo</button>
        ) : null}
      </div>
    </article>
  );
}
