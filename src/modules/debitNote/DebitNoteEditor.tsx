import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { COUNTRY_CONFIG, DEBIT_REASONS, type CountryCode, type DebitStatus, type DebitType } from "./countryConfig";
import type { PurchaseInvoice, DebitNoteRecord, SupplierOption } from "./store";
import type { DebitNoteFormState } from "./types";
import { formatMoney, parseNumber } from "./utils";
import FloatingCard, { defaultFloatingCardState, sanitizeFloatingCardState, type FloatingCardState } from "./FloatingCard";

interface DebitNoteEditorProps {
  country: CountryCode;
  readOnly?: boolean;
  form: DebitNoteFormState;
  activeNote: DebitNoteRecord | null;
  suppliers: SupplierOption[];
  invoices: PurchaseInvoice[];
  selectedInvoice: PurchaseInvoice | null;
  totals: {
    detailed: Array<any>;
    subtotal: number;
    taxTotal: number;
    total: number;
    updatedPayable: number;
    cgst: number;
    sgst: number;
    igst: number;
  };
  actorName: string;
  access: { roleType: "Admin" | "Staff"; canApply: boolean; canOverride: boolean };
  fieldErrors: Record<string, string>;
  onBack: () => void;
  onUpdateForm: <K extends keyof DebitNoteFormState>(key: K, value: DebitNoteFormState[K]) => void;
  onApplyInvoice: (invoiceId: string) => void;
  onUpdateLine: (id: string, patch: any) => void;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onPersist: (targetStatus: DebitStatus, options?: { email?: boolean; download?: boolean }) => void;
}

const DEBIT_TYPES: DebitType[] = [
  "Full Debit",
  "Partial Debit",
  "Price Increase",
  "Quantity Shortage",
  "Additional Charges"
];

function readStoredTotalsCard(storageKey: string) {
  if (typeof window === "undefined") return defaultFloatingCardState();
  try {
    const raw = window.localStorage.getItem(storageKey);
    const saved = raw ? sanitizeFloatingCardState(JSON.parse(raw)) : defaultFloatingCardState();
    if (window.innerWidth >= 1280 && saved.size !== "maximized" && !saved.hidden) {
      return {
        ...saved,
        x: Math.max(92, window.innerWidth - 420),
        y: 170
      };
    }
    return saved;
  } catch {
    return defaultFloatingCardState();
  }
}

export default function DebitNoteEditor({
  country,
  readOnly,
  form,
  activeNote,
  suppliers,
  invoices,
  selectedInvoice,
  totals,
  actorName,
  access,
  fieldErrors,
  onBack,
  onUpdateForm,
  onApplyInvoice,
  onUpdateLine,
  onAddLine,
  onRemoveLine,
  onPersist
}: DebitNoteEditorProps) {
  const cfg = COUNTRY_CONFIG[country];
  const isReadOnly = !!readOnly;
  const supplierInvoices = form.supplierId ? invoices.filter((invoice) => invoice.supplierId === form.supplierId) : invoices;
  const totalsCardStorageKey = useMemo(
    () => `debitNoteTotalsCardState:${country}:${(actorName || "user").toLowerCase()}`,
    [country, actorName]
  );
  const [totalsCard, setTotalsCard] = useState<FloatingCardState>(() => readStoredTotalsCard(totalsCardStorageKey));

  useEffect(() => {
    setTotalsCard(readStoredTotalsCard(totalsCardStorageKey));
  }, [totalsCardStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(totalsCardStorageKey, JSON.stringify(totalsCard));
  }, [totalsCardStorageKey, totalsCard]);

  return (
    <div className="debit-note-compact flex h-full min-h-0 flex-col gap-2.5">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2.5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to List
        </button>
        <div className="text-xs text-slate-500">
          Role: <span className="font-semibold text-slate-700">{access.roleType}</span> | Workflow: Draft &gt; Issued &gt; Applied
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2 xl:pr-[400px]">
        <fieldset className="space-y-2.5" disabled={isReadOnly}>
          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 1 - Basic Info</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                Selected Country
                <input
                  value={`${cfg.flag} ${cfg.name}`}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Debit Note Number
                <input
                  value={activeNote?.debitNoteNo || "Auto generated on save"}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Debit Note Date
                <input
                  type="date"
                  value={form.debitNoteDate}
                  onChange={(event) => onUpdateForm("debitNoteDate", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
                {fieldErrors.debitNoteDate ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.debitNoteDate}</span> : null}
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Supplier / Vendor
                <input
                  list="debit-note-supplier-options"
                  value={form.supplierInput}
                  onChange={(event) => {
                    const next = event.target.value;
                    const matched = suppliers.find((supplier) => supplier.name.toLowerCase() === next.trim().toLowerCase());
                    onUpdateForm("supplierInput", next);
                    if (matched) onUpdateForm("supplierId", matched.id);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  placeholder="Type supplier"
                />
                <datalist id="debit-note-supplier-options">
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.name} />
                  ))}
                </datalist>
                {fieldErrors.supplierId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.supplierId}</span> : null}
              </label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2 xl:col-span-3">
                Linked Purchase Invoice (same country only)
                <select
                  value={form.linkedPurchaseInvoiceId}
                  onChange={(event) => onApplyInvoice(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                >
                  <option value="">Select invoice</option>
                  {supplierInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNo} | {invoice.supplierName} | Payable {formatMoney(invoice.remainingBalance, country)}
                    </option>
                  ))}
                </select>
                {fieldErrors.linkedPurchaseInvoiceId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.linkedPurchaseInvoiceId}</span> : null}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 2 - Debit Type</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {DEBIT_TYPES.map((type) => (
                <label
                  key={type}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    form.debitType === type ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input type="radio" checked={form.debitType === type} onChange={() => onUpdateForm("debitType", type)} />
                  {type}
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {form.debitType === "Partial Debit" ? (
                <label className="text-xs font-semibold text-slate-600">
                  Partial Debit Amount
                  <input
                    type="number"
                    min={0}
                    value={form.partialAmountCap}
                    onChange={(event) => onUpdateForm("partialAmountCap", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  />
                  {fieldErrors.partialAmountCap ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.partialAmountCap}</span> : null}
                </label>
              ) : null}
              {form.debitType === "Price Increase" ? (
                <label className="text-xs font-semibold text-slate-600">
                  Price Increase Amount
                  <input
                    type="number"
                    min={0}
                    value={form.priceAdjustmentAmount}
                    onChange={(event) => onUpdateForm("priceAdjustmentAmount", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  />
                </label>
              ) : null}
              {form.debitType === "Additional Charges" ? (
                <label className="text-xs font-semibold text-slate-600">
                  Additional Charges Amount
                  <input
                    type="number"
                    min={0}
                    value={form.additionalChargesAmount}
                    onChange={(event) => onUpdateForm("additionalChargesAmount", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  />
                </label>
              ) : null}
              {form.debitType === "Quantity Shortage" ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Update line quantities to reflect shortage before issuing the debit note.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Section 3 - Items Table</p>
              <button onClick={onAddLine} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Add line
              </button>
            </div>
            {fieldErrors.lines ? <p className="mt-2 text-xs text-rose-600">{fieldErrors.lines}</p> : null}
            <div className="mt-2.5 max-h-[32vh] overflow-auto">
              <table className="min-w-[1060px] w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-700">Item Name</th>
                    {country === "IN" ? <th className="px-3 py-2 font-semibold text-slate-700">HSN/SAC</th> : null}
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Rate</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Base Amount</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">{cfg.taxLabel} %</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Tax Amount</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">After Tax</th>
                    <th className="px-3 py-2 font-semibold text-slate-700">Debit Type</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Debit Value</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Debit Amount</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Final Total</th>
                    <th className="px-3 py-2 font-semibold text-slate-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.detailed.map((line) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="px-3 py-2"><input value={line.itemName} onChange={(event) => onUpdateLine(line.id, { itemName: event.target.value })} className="w-44 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></td>
                      {country === "IN" ? <td className="px-3 py-2"><input value={line.hsnSac || ""} onChange={(event) => onUpdateLine(line.id, { hsnSac: event.target.value })} className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></td> : null}
                      <td className="px-3 py-2"><input type="number" min={0} value={line.quantity} onChange={(event) => onUpdateLine(line.id, { quantity: parseNumber(event.target.value) })} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm" /></td>
                      <td className="px-3 py-2"><input type="number" min={0} value={line.rate} onChange={(event) => onUpdateLine(line.id, { rate: parseNumber(event.target.value) })} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm" /></td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{formatMoney(line.baseAmount, country)}</td>
                      <td className="px-3 py-2"><input type="number" min={0} value={line.taxRate} onChange={(event) => onUpdateLine(line.id, { taxRate: parseNumber(event.target.value) })} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm" /></td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{formatMoney(line.taxAmount, country)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{formatMoney(line.amountAfterTax, country)}</td>
                      <td className="px-3 py-2">
                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                          <button type="button" onClick={() => onUpdateLine(line.id, { debitValueType: "Percentage" })} className={`rounded-md px-2 py-1 text-xs font-semibold ${line.debitValueType === "Percentage" ? "bg-slate-900 text-white" : "text-slate-600"}`}>%</button>
                          <button type="button" onClick={() => onUpdateLine(line.id, { debitValueType: "Fixed" })} className={`rounded-md px-2 py-1 text-xs font-semibold ${line.debitValueType === "Fixed" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Amount</button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={line.debitValue}
                          onChange={(event) => onUpdateLine(line.id, { debitValue: parseNumber(event.target.value) })}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                        />
                        {line.validationMessage ? <p className="mt-1 text-right text-[11px] text-rose-600">{line.validationMessage}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{formatMoney(line.debitCharge, country)}</td>
                      <td className="px-3 py-2 text-right text-base font-bold text-emerald-700">{formatMoney(line.debitAmount, country)}</td>
                      <td className="px-3 py-2"><button onClick={() => onRemoveLine(line.id)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold">Remove</button></td>
                    </tr>
                  ))}
                  {!totals.detailed.length ? <tr><td colSpan={country === "IN" ? 13 : 12} className="px-3 py-8 text-center text-slate-500">Select purchase invoice to load items.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 4 - Reason & Notes</p>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Reason
                <select value={form.reason} onChange={(event) => onUpdateForm("reason", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  {DEBIT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <div className="text-xs text-slate-600">
                <p className="font-semibold">Audit Trail</p>
                <p className="mt-1">Created by: {activeNote?.audit.createdBy || actorName}</p>
                <p>Modified by: {activeNote?.audit.modifiedBy || actorName}</p>
              </div>
              {access.roleType === "Admin" ? (
                <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                  Internal Notes (finance team only)
                  <textarea rows={2} value={form.internalNotes} onChange={(event) => onUpdateForm("internalNotes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                </label>
              ) : (
                <p className="text-xs text-slate-500 md:col-span-2">Internal notes are visible only to finance/admin users.</p>
              )}
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">Supplier-visible Notes<textarea rows={2} value={form.supplierNotes} onChange={(event) => onUpdateForm("supplierNotes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
            </div>
          </div>
        </fieldset>
      </div>

      <FloatingCard
        title="Totals"
        previewValue={formatMoney(totals.total, country)}
        state={totalsCard}
        onChange={setTotalsCard}
      >
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Subtotal</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.subtotal, country)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">{cfg.taxLabel}</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.taxTotal, country)}</span>
          </div>
          {country === "IN" ? (
            <>
              <div className="flex justify-between text-xs text-slate-600">
                <span>CGST</span>
                <span>{formatMoney(totals.cgst, country)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>SGST</span>
                <span>{formatMoney(totals.sgst, country)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-600">
                <span>IGST</span>
                <span>{formatMoney(totals.igst, country)}</span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-900">Total Debit Amount</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.total, country)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Current payable balance</span>
            <span className="font-semibold text-slate-900">{formatMoney(selectedInvoice?.remainingBalance || 0, country)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Updated payable balance</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.updatedPayable, country)}</span>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">{cfg.label}</p>
          <p className="mt-1">{cfg.legalWording}</p>
        </div>
      </FloatingCard>

      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Status: <span className="font-semibold text-slate-700">{activeNote?.status || "Unsaved Draft"}</span>
            {fieldErrors.workflow ? <span className="ml-3 font-semibold text-rose-600">{fieldErrors.workflow}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnly ? (
              <button
                onClick={() => onPersist("Draft")}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                <Save className="h-4 w-4" />
                Save
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
