import React from "react";
import Modal from "./Modal";

function alignClass(align) {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

const ACCENT_STYLES = {
  amber: {
    card: "border-amber-200 bg-amber-50",
    badge: "border-amber-200 bg-white text-amber-700",
    button: "border-amber-200 bg-white text-slate-800",
    summary: "border-amber-200 bg-white",
    checkbox: "text-amber-500 focus:ring-amber-400"
  },
  sky: {
    card: "border-sky-200 bg-sky-50",
    badge: "border-sky-200 bg-white text-sky-700",
    button: "border-sky-200 bg-white text-slate-800",
    summary: "border-sky-200 bg-white",
    checkbox: "text-sky-500 focus:ring-sky-400"
  }
};

export default function AllocationSelectionCard({
  accent = "amber",
  title,
  subtitle,
  countLabel,
  countValue,
  availableLabel,
  availableAmount,
  selectedAmount,
  appliedAmount,
  remainingAmount,
  updatedTotal,
  updatedTotalLabel,
  appliedAmountLabel = "Applied Amount",
  remainingAmountLabel = "Remaining Balance",
  selectedAmountLabel = "Selected Amount",
  buttonLabel = "Select Entries",
  emptyMessage = "No entries available.",
  modalTitle,
  modalSubtitle,
  rows = [],
  columns = [],
  open = false,
  onOpen,
  onClose,
  renderRowCheckbox,
  disabled = false
}) {
  const styles = ACCENT_STYLES[accent] || ACCENT_STYLES.amber;

  return (
    <>
      <div className={`overflow-hidden rounded-2xl border ${styles.card}`}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
          <div>
            <p className="text-xs font-semibold text-slate-700">{title}</p>
            {subtitle ? <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles.badge}`}>
            {countLabel}: {countValue}
          </span>
        </div>

        <div className="border-b border-slate-200 px-3 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-1 text-xs text-slate-600">
                {availableLabel}: {availableAmount}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpen}
              disabled={disabled}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles.button}`}
            >
              {buttonLabel}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className={`rounded-2xl border px-3 py-2.5 text-xs text-slate-600 ${styles.summary}`}>
              <p>
                {selectedAmountLabel}: <span className="font-semibold text-slate-900">{selectedAmount}</span>
              </p>
              <p className="mt-1">
                {appliedAmountLabel}: <span className="font-semibold text-emerald-700">{appliedAmount}</span>
              </p>
            </div>
            <div className={`rounded-2xl border px-3 py-2.5 text-xs text-slate-600 ${styles.summary}`}>
              <p>
                {remainingAmountLabel}: <span className="font-semibold text-slate-900">{remainingAmount}</span>
              </p>
              <p className="mt-1">
                {updatedTotalLabel}: <span className="font-semibold text-rose-700">{updatedTotal}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={open}
        title={modalTitle || title}
        onClose={onClose}
        footer={modalSubtitle ? <p className="text-xs text-slate-500">{modalSubtitle}</p> : null}
      >
        {!rows.length ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <div className="overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-3 py-2 font-semibold ${alignClass(column.align)}`}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-semibold">Use</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200 bg-white">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-3 py-2 text-slate-700 ${alignClass(column.align)}`}
                      >
                        {column.render ? column.render(row) : row[column.key] ?? "-"}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {renderRowCheckbox ? renderRowCheckbox(row, styles.checkbox) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
