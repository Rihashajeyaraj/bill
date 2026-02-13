import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { CREDIT_REASONS, COUNTRY_CONFIG, type CountryCode, type CreditStatus, type CreditType } from "./countryConfig";
import type { CreditInvoice, CreditNoteRecord, CustomerOption } from "./store";
import type { CreditNoteFormState } from "./types";
import { formatMoney, parseNumber } from "./utils";
import FloatingCard, { defaultFloatingCardState, sanitizeFloatingCardState, type FloatingCardState } from "./FloatingCard";

interface CreditNoteEditorProps {
  country: CountryCode;
  readOnly?: boolean;
  form: CreditNoteFormState;
  activeNote: CreditNoteRecord | null;
  customers: CustomerOption[];
  invoices: CreditInvoice[];
  selectedInvoice: CreditInvoice | null;
  totals: {
    detailed: Array<any>;
    subtotal: number;
    taxTotal: number;
    total: number;
    remaining: number;
    cgst: number;
    sgst: number;
    igst: number;
  };
  actorName: string;
  access: { roleType: "Admin" | "Staff"; canApply: boolean; canOverride: boolean };
  fieldErrors: Record<string, string>;
  onBack: () => void;
  onUpdateForm: <K extends keyof CreditNoteFormState>(key: K, value: CreditNoteFormState[K]) => void;
  onApplyInvoice: (invoiceId: string) => void;
  onUpdateLine: (id: string, patch: any) => void;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onPersist: (targetStatus: CreditStatus, options?: { email?: boolean; download?: boolean }) => void;
}

const CREDIT_TYPES: CreditType[] = [
  "Full Credit",
  "Partial Credit",
  "Discount Credit"
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

function normalizeInvoiceStatus(status: unknown) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function isOpenInvoiceStatus(status: unknown) {
  const normalized = normalizeInvoiceStatus(status);
  return normalized === "issued" || normalized === "partially paid";
}

export default function CreditNoteEditor({
  country,
  readOnly,
  form,
  activeNote,
  customers,
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
}: CreditNoteEditorProps) {
  const cfg = COUNTRY_CONFIG[country];
  const isReadOnly = !!readOnly;
  const selectedCustomerId = form.customerId;
  const selectedInvoiceId = form.linkedInvoiceId;
  const totalsCardStorageKey = useMemo(
    () => `creditNoteTotalsCardState:${country}:${(actorName || "user").toLowerCase()}`,
    [country, actorName]
  );
  const [totalsCard, setTotalsCard] = useState<FloatingCardState>(() => readStoredTotalsCard(totalsCardStorageKey));
  const [availableInvoices, setAvailableInvoices] = useState<CreditInvoice[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  useEffect(() => {
    setTotalsCard(readStoredTotalsCard(totalsCardStorageKey));
  }, [totalsCardStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(totalsCardStorageKey, JSON.stringify(totalsCard));
  }, [totalsCardStorageKey, totalsCard]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setAvailableInvoices([]);
      setInvoiceLoading(false);
      return;
    }

    setInvoiceLoading(true);
    const timer = window.setTimeout(() => {
      const next = invoices.filter((invoice) => {
        const balance = parseNumber(invoice.balanceAmount ?? invoice.remainingBalance);
        return (
          invoice.customerId === selectedCustomerId &&
          invoice.country === country &&
          isOpenInvoiceStatus(invoice.status) &&
          balance > 0
        );
      });
      setAvailableInvoices(next);
      setInvoiceLoading(false);
    }, 260);

    return () => window.clearTimeout(timer);
  }, [selectedCustomerId, country, invoices]);

  useEffect(() => {
    setAvailableInvoices([]);
    setInvoiceLoading(false);
  }, [country]);

  function resetInvoiceSelection() {
    onUpdateForm("linkedInvoiceId", "");
    onUpdateForm("lines", []);
    onUpdateForm("partialAmountCap", "");
    onUpdateForm("discountPercent", "");
    onUpdateForm("priceAdjustmentAmount", "");
  }

  function handleCustomerInput(next: string) {
    const matched = customers.find((customer) => customer.name.toLowerCase() === next.trim().toLowerCase());
    const nextCustomerId = matched?.id || "";
    const customerChanged = nextCustomerId !== selectedCustomerId;

    onUpdateForm("customerInput", next);
    onUpdateForm("customerId", nextCustomerId);

    if (customerChanged) {
      resetInvoiceSelection();
      setTotalsCard(defaultFloatingCardState());
    }
  }

  return (
    <div className="credit-note-compact flex h-full min-h-0 flex-col gap-2.5">
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
                Credit Note Number
                <input
                  value={activeNote?.creditNoteNo || "Auto generated on save"}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Credit Note Date
                <input
                  type="date"
                  value={form.creditNoteDate}
                  onChange={(event) => onUpdateForm("creditNoteDate", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
                {fieldErrors.creditNoteDate ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.creditNoteDate}</span> : null}
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Customer (searchable)
                <input
                  list="credit-note-customer-options"
                  value={form.customerInput}
                  onChange={(event) => handleCustomerInput(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  placeholder="Type customer"
                />
                <datalist id="credit-note-customer-options">
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.name} />
                  ))}
                </datalist>
                {fieldErrors.customerId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.customerId}</span> : null}
              </label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2 xl:col-span-3">
                <span className="inline-flex items-center gap-2">
                  Linked Invoice (same country only)
                  {invoiceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" /> : null}
                </span>
                <select
                  value={selectedInvoiceId}
                  onChange={(event) => onApplyInvoice(event.target.value)}
                  disabled={!selectedCustomerId || invoiceLoading}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                >
                  {!selectedCustomerId ? <option value="">Select customer first</option> : null}
                  {selectedCustomerId && invoiceLoading ? <option value="">Loading invoices...</option> : null}
                  {selectedCustomerId && !invoiceLoading && !availableInvoices.length ? (
                    <option value="">No open invoices for this customer</option>
                  ) : null}
                  {selectedCustomerId && !invoiceLoading && availableInvoices.length ? <option value="">Select invoice</option> : null}
                  {availableInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNo} | {invoice.customerName} | Remaining {formatMoney(invoice.balanceAmount || invoice.remainingBalance, country)}
                    </option>
                  ))}
                </select>
                {fieldErrors.linkedInvoiceId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.linkedInvoiceId}</span> : null}
                {selectedCustomerId && !invoiceLoading && !availableInvoices.length ? (
                  <span className="mt-1 block text-xs text-slate-500">No open invoices for this customer</span>
                ) : null}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 2 - Credit Type</p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {CREDIT_TYPES.map((type) => (
                <label
                  key={type}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    form.creditType === type ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input type="radio" checked={form.creditType === type} onChange={() => onUpdateForm("creditType", type)} />
                  {type}
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {form.creditType === "Partial Credit" ? (
                <label className="text-xs font-semibold text-slate-600">
                  Partial Credit Amount
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
              {form.creditType === "Discount Credit" ? (
                <label className="text-xs font-semibold text-slate-600">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.discountPercent}
                    onChange={(event) => onUpdateForm("discountPercent", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  />
                </label>
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
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Qty</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Rate</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Base Amount</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">{cfg.taxLabel} %</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Tax Amount</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">After Tax</th>
                    <th className="px-3 py-2 font-semibold text-slate-700">Credit Type</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Credit Value</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Credit Amount</th>
                    <th className="px-3 py-2 font-semibold text-right text-slate-700">Final Total</th>
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
                          <button type="button" onClick={() => onUpdateLine(line.id, { creditType: "Percentage" })} className={`rounded-md px-2 py-1 text-xs font-semibold ${line.creditType === "Percentage" ? "bg-slate-900 text-white" : "text-slate-600"}`}>%</button>
                          <button type="button" onClick={() => onUpdateLine(line.id, { creditType: "Fixed" })} className={`rounded-md px-2 py-1 text-xs font-semibold ${line.creditType === "Fixed" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Amount</button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          value={line.creditValue}
                          onChange={(event) => onUpdateLine(line.id, { creditValue: parseNumber(event.target.value) })}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                        />
                        {line.validationMessage ? <p className="mt-1 text-right text-[11px] text-rose-600">{line.validationMessage}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">{formatMoney(line.creditApplied, country)}</td>
                      <td className="px-3 py-2 text-right text-base font-bold text-emerald-700">{formatMoney(line.creditAmount, country)}</td>
                      <td className="px-3 py-2"><button onClick={() => onRemoveLine(line.id)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold">Remove</button></td>
                    </tr>
                  ))}
                  {!totals.detailed.length ? <tr><td colSpan={country === "IN" ? 13 : 12} className="px-3 py-8 text-center text-slate-500">Select invoice to load items.</td></tr> : null}
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
                  {CREDIT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <div className="text-xs text-slate-600">
                <p className="font-semibold">Audit Trail</p>
                <p className="mt-1">Created by: {activeNote?.audit.createdBy || actorName}</p>
                <p>Modified by: {activeNote?.audit.modifiedBy || actorName}</p>
              </div>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">Internal Notes<textarea rows={2} value={form.internalNotes} onChange={(event) => onUpdateForm("internalNotes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">Customer Notes<textarea rows={2} value={form.customerNotes} onChange={(event) => onUpdateForm("customerNotes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
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
            <span className="text-slate-600">Tax reversal</span>
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
            <span className="font-semibold text-slate-900">Total Credit</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.total, country)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Remaining invoice balance</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.remaining, country)}</span>
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
