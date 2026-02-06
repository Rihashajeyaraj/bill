import React from "react";
import type { PaymentAllocationDraft } from "./store";

interface InvoiceApplyCardProps {
  allocation: PaymentAllocationDraft;
  maxAllowed: number;
  currencyText: string;
  onApply: (amount: number) => void;
  onAutoFill: () => void;
}

export default function InvoiceApplyCard({
  allocation,
  maxAllowed,
  currencyText,
  onApply,
  onAutoFill
}: InvoiceApplyCardProps) {
  const sliderMax = Math.max(0, Math.min(allocation.balanceDue, maxAllowed));
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{allocation.invoiceNo}</p>
          <p className="text-xs text-slate-500">Due {allocation.invoiceDate}</p>
        </div>
        <button
          type="button"
          onClick={onAutoFill}
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Fill max
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <p>Total: <span className="font-semibold text-slate-800">{currencyText} {allocation.invoiceAmount.toFixed(2)}</span></p>
        <p>Balance: <span className="font-semibold text-slate-800">{currencyText} {allocation.balanceDue.toFixed(2)}</span></p>
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={1}
          value={Math.min(allocation.applyAmount, sliderMax)}
          onChange={(event) => onApply(Number(event.target.value))}
          className="w-full accent-slate-900"
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">Apply amount</span>
        <input
          type="number"
          min={0}
          max={sliderMax}
          value={allocation.applyAmount}
          onChange={(event) => onApply(Number(event.target.value))}
          className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm font-semibold text-slate-800"
        />
      </div>
    </article>
  );
}
