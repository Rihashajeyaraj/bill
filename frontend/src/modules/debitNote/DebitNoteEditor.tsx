import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save, Search, X } from "lucide-react";
import { COUNTRY_CONFIG, type CountryCode, type DebitStatus } from "./countryConfig";
import DateInput from "../../components/DateInput";
import FieldLabelText from "../../components/FieldLabelText";
import type { PurchaseInvoice, DebitNoteRecord, SupplierOption } from "./store";
import type { DebitNoteFormState } from "./types";
import { formatMoney, parseNumber } from "./utils";

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
  savingStatus?: DebitStatus | null;
  onBack: () => void;
  onUpdateForm: <K extends keyof DebitNoteFormState>(key: K, value: DebitNoteFormState[K]) => void;
  onApplyInvoice: (invoiceId: string) => void;
  onUpdateLine: (id: string, patch: any) => void;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onPersist: (targetStatus: DebitStatus, options?: { email?: boolean; download?: boolean }) => void;
}

function normalizePhoneForLookup(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function supplierAddressSummary(supplier: SupplierOption | null) {
  return [supplier?.address, supplier?.state, supplier?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function numberInputValue(value: unknown) {
  const numeric = parseNumber(value as any);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return String(value ?? "");
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
  savingStatus = null,
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
  const selectedSupplierId = form.supplierId;
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );
  const [availableInvoices, setAvailableInvoices] = useState<PurchaseInvoice[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("");
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const supplierLookupResults = useMemo(() => {
    const query = String(supplierSearchQuery || "").trim().toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(query);
    return suppliers
      .filter((supplier) => {
        const text = [supplier?.name, supplier?.email, supplier?.address, supplier?.state, supplier?.country]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const supplierPhone = normalizePhoneForLookup(supplier?.phone);
        return text.includes(query) || (normalizedPhoneQuery && supplierPhone && supplierPhone.includes(normalizedPhoneQuery));
      })
      .slice(0, 8);
  }, [suppliers, supplierSearchQuery]);

  useEffect(() => {
    if (!selectedSupplierId) {
      setAvailableInvoices([]);
      setInvoiceLoading(false);
      return;
    }

    setInvoiceLoading(true);
    const timer = window.setTimeout(() => {
      const next = invoices.filter((invoice) => {
        const remainingBalance = Math.max(0, parseNumber(invoice.remainingBalance));
        return invoice.supplierId === selectedSupplierId && invoice.country === country && remainingBalance > 0;
      });
      setAvailableInvoices(next);
      setInvoiceLoading(false);
    }, 260);

    return () => window.clearTimeout(timer);
  }, [selectedSupplierId, country, invoices]);

  useEffect(() => {
    setAvailableInvoices([]);
    setInvoiceLoading(false);
  }, [country]);

  useEffect(() => {
    if (!selectedSupplierId) {
      setSupplierSearchQuery("");
      return;
    }
    setSupplierSearchQuery(String(selectedSupplier?.name || "").trim());
  }, [selectedSupplierId, selectedSupplier?.name]);

  function resetInvoiceSelection() {
    onUpdateForm("linkedPurchaseInvoiceId", "");
    onUpdateForm("lines", []);
    onUpdateForm("partialAmountCap", "");
    onUpdateForm("priceAdjustmentAmount", "");
    onUpdateForm("additionalChargesAmount", "");
    onUpdateForm("taxAdjustmentAmount", "");
  }

  function applySupplierSelection(supplier: SupplierOption) {
    const supplierChanged = supplier.id !== selectedSupplierId;
    onUpdateForm("supplierId", supplier.id);
    onUpdateForm("supplierInput", supplier.name || "");
    if (supplier.registrationNumber) {
      onUpdateForm("registrationNumber", supplier.registrationNumber);
    }
    if (supplierChanged) {
      resetInvoiceSelection();
    }
    setSupplierSearchQuery(String(supplier.name || "").trim());
    setSupplierSearchError("");
  }

  function handleSupplierSearchInputChange(value: string) {
    setSupplierSearchQuery(value);
    setSupplierSearchError("");
    if (
      selectedSupplierId &&
      String(value || "").trim().toLowerCase() !== String(selectedSupplier?.name || "").trim().toLowerCase()
    ) {
      onUpdateForm("supplierId", "");
      onUpdateForm("supplierInput", "");
      resetInvoiceSelection();
    }
  }

  function handleSupplierSearch() {
    const query = String(supplierSearchQuery || "").trim();
    if (query.length < 2) {
      setSupplierSearchError("Enter name, phone, email, or address to search.");
      return;
    }
    if (!supplierLookupResults.length) {
      setSupplierSearchError("No supplier found for this search.");
      return;
    }
    if (supplierLookupResults.length === 1) {
      applySupplierSelection(supplierLookupResults[0]);
      return;
    }
    setSupplierSearchError("Multiple suppliers found. Choose one from the list below.");
  }

  function resetSupplierSelection() {
    onUpdateForm("supplierId", "");
    onUpdateForm("supplierInput", "");
    resetInvoiceSelection();
    setSupplierSearchQuery("");
    setSupplierSearchError("");
  }

  return (
    <div className="debit-note-compact flex min-h-full flex-col gap-2.5">
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

      <div className="pr-1 pb-2">
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
                <FieldLabelText required className="text-xs font-semibold text-slate-600">
                  Debit Note Date
                </FieldLabelText>
                <DateInput
                  value={form.debitNoteDate}
                  onChange={(nextValue) => onUpdateForm("debitNoteDate", nextValue)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
                {fieldErrors.debitNoteDate ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.debitNoteDate}</span> : null}
              </label>
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:col-span-2 xl:col-span-2">
                <p className="text-xs font-semibold text-slate-600">
                  <FieldLabelText required className="text-xs font-semibold text-slate-600">
                    Supplier Search
                  </FieldLabelText>
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={supplierSearchQuery}
                    onChange={(event) => handleSupplierSearchInputChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSupplierSearch();
                      }
                    }}
                    placeholder="Search supplier by name, phone, email, or address"
                    disabled={isReadOnly}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleSupplierSearch}
                    disabled={isReadOnly}
                    className="inline-flex h-10 w-[96px] shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Search
                  </button>
                </div>
                {supplierSearchError ? <p className="text-xs font-medium text-rose-600">{supplierSearchError}</p> : null}
                {supplierSearchQuery.trim() ? (
                  supplierLookupResults.length ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {supplierLookupResults.map((supplier) => (
                        <button
                          key={supplier.id}
                          type="button"
                          onClick={() => applySupplierSelection(supplier)}
                          disabled={isReadOnly}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <p className="text-sm font-semibold text-slate-900">{supplier.name || "-"}</p>
                          <p className="text-xs text-slate-600">{supplier.phone || "-"}</p>
                          <p className="text-xs text-slate-500">{supplierAddressSummary(supplier) || "-"}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      No supplier found. Try another search.
                    </p>
                  )
                ) : null}
                {selectedSupplier ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                    <p className="font-semibold text-slate-900">{selectedSupplier.name || "-"}</p>
                    <p className="mt-1 text-slate-500">{selectedSupplier.phone || "-"}</p>
                    <p className="mt-1 text-slate-500">{selectedSupplier.email || "-"}</p>
                    <p className="mt-1 text-slate-500">{supplierAddressSummary(selectedSupplier) || "-"}</p>
                    <button
                      type="button"
                      onClick={resetSupplierSelection}
                      disabled={isReadOnly}
                      className="mt-2 inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  </div>
                ) : null}
                {fieldErrors.supplierId ? <span className="block text-xs text-rose-600">{fieldErrors.supplierId}</span> : null}
              </div>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2 xl:col-span-3">
                <span className="inline-flex items-center gap-2">
                  Linked Purchase Invoice (same country only)
                  {invoiceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" /> : null}
                </span>
                <select
                  value={form.linkedPurchaseInvoiceId}
                  onChange={(event) => onApplyInvoice(event.target.value)}
                  disabled={!selectedSupplierId || invoiceLoading}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                >
                  {!selectedSupplierId ? <option value="">Select supplier first</option> : null}
                  {selectedSupplierId && invoiceLoading ? <option value="">Loading invoices...</option> : null}
                  {selectedSupplierId && !invoiceLoading && !availableInvoices.length ? (
                    <option value="">No open invoices for this supplier</option>
                  ) : null}
                  {selectedSupplierId && !invoiceLoading && availableInvoices.length ? <option value="">Select invoice</option> : null}
                  {availableInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {(() => {
                        const billQty = (invoice.lines || []).reduce(
                          (sum, line: any) => sum + Math.max(0, parseNumber(line?.quantity)),
                          0
                        );
                        const debitedQty = (invoice.lines || []).reduce(
                          (sum, line: any) => sum + Math.max(0, parseNumber(line?.debitedQty)),
                          0
                        );
                        const availableQty = (invoice.lines || []).reduce(
                          (sum, line: any) =>
                            sum +
                            Math.max(
                              0,
                              parseNumber(
                                line?.availableDebitQty !== undefined && line?.availableDebitQty !== null
                                  ? line.availableDebitQty
                                  : line.quantity
                              )
                            ),
                          0
                        );
                        return `${invoice.invoiceNo} | ${invoice.supplierName} | Payable ${formatMoney(invoice.remainingBalance, country)} | Qty ${availableQty}/${billQty}${debitedQty > 0 ? ` | Debited ${debitedQty}` : ""}`;
                      })()}
                    </option>
                  ))}
                </select>
                {fieldErrors.linkedPurchaseInvoiceId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.linkedPurchaseInvoiceId}</span> : null}
                {selectedSupplierId && !invoiceLoading && !availableInvoices.length ? (
                  <span className="mt-1 block text-xs text-slate-500">No open invoices for this supplier</span>
                ) : null}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 2 - How Debit Is Calculated</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">Mode: Auto (Full Debit)</p>
                <p className="mt-1">Debit amount is automatic from `Qty x Bill Rate + Tax`.</p>
                <p className="mt-1">Item, rate and tax come from linked purchase bill and stay locked.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Use case</p>
                <p className="mt-1">Use Debit Note when supplier payable must reduce (return, discount, or rate correction).</p>
                <p className="mt-1">For physical stock return to supplier, first do Purchase Return/stock update, then apply debit note.</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Section 3 - Items</p>
                <p className="text-xs text-slate-500">
                  {form.linkedPurchaseInvoiceId ? "Linked bill lines only. Quantity can be reduced but not increased." : "Add or adjust line items in invoice-style cards."}
                </p>
              </div>
              <button
                onClick={onAddLine}
                disabled={!!form.linkedPurchaseInvoiceId}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={form.linkedPurchaseInvoiceId ? "Use linked bill lines only." : "Add line"}
              >
                Add line
              </button>
            </div>
            {fieldErrors.lines ? <p className="mt-2 text-xs text-rose-600">{fieldErrors.lines}</p> : null}
            <div className="mt-3 space-y-3">
              {totals.detailed.map((line, index) => (
                <div key={line.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-700">Line {index + 1}</p>
                    <button onClick={() => onRemoveLine(line.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-xs font-semibold text-slate-600 xl:col-span-2">
                      Item Name
                      <input
                        value={line.itemName}
                        readOnly
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      <FieldLabelText required className="text-xs font-semibold text-slate-600">
                        Quantity
                      </FieldLabelText>
                      <input
                        type="number"
                        min={0}
                        max={parseNumber((line as any).sourcePurchaseQty)}
                        value={numberInputValue(line.quantity)}
                        onChange={(event) => {
                          const sourceQty = Math.max(0, parseNumber((line as any).sourcePurchaseQty));
                          const nextQtyRaw = Math.max(0, parseNumber(event.target.value));
                          const nextQty = Math.min(nextQtyRaw, sourceQty);
                          onUpdateLine(line.id, {
                            quantity: nextQty,
                            debitValueType: "Percentage",
                            debitValue: 0
                          });
                        }}
                        placeholder="0"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        {(() => {
                          const availableQty = Math.max(
                            0,
                            parseNumber((line as any).sourcePurchaseQty)
                          );
                          const billQtyRaw = Math.max(
                            0,
                            parseNumber((line as any).sourcePurchaseOriginalQty)
                          );
                          const billQty = billQtyRaw > 0 ? billQtyRaw : availableQty;
                          const alreadyDebited = Math.max(
                            0,
                            parseNumber((line as any).debitedQty || billQty - availableQty)
                          );
                          return `Bill qty: ${billQty} | Already debited: ${alreadyDebited} | Available qty: ${availableQty}`;
                        })()}
                      </p>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      Bill Rate
                      <input
                        type="number"
                        min={0}
                        value={numberInputValue(line.rate)}
                        readOnly
                        placeholder="0"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Tax in price: {String((line as any).priceTaxMode || "").toUpperCase() === "WITH_TAX" ? "Yes" : "No"}
                      </p>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      {cfg.taxLabel} %
                      <input
                        type="number"
                        min={0}
                        value={numberInputValue(line.taxRate)}
                        readOnly
                        placeholder="0"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                      />
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Base Amount</p><p className="font-semibold text-slate-900">{formatMoney(line.baseAmount, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Tax Amount</p><p className="font-semibold text-slate-900">{formatMoney(line.taxAmount, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">After Tax</p><p className="font-semibold text-slate-900">{formatMoney(line.amountAfterTax, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Debit Amount</p><p className="font-semibold text-emerald-700">{formatMoney(line.debitAmount, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Mode</p><p className="font-semibold text-slate-900">Auto</p></div>
                  </div>
                </div>
              ))}
              {!totals.detailed.length ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">Select purchase invoice to load items.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 4 - Reason & Notes</p>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Reason
                <input
                  type="text"
                  value={form.reason}
                  onChange={(event) => onUpdateForm("reason", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
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

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
        <p className="mt-1 text-xs text-slate-500">Auto-calculated totals and payable balance.</p>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Total Quantity</span>
            <span className="font-semibold text-slate-900">{totals.detailed.reduce((sum, line) => sum + parseNumber(line.quantity), 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Subtotal</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.subtotal, country)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">{cfg.taxLabel}</span>
            <span className="font-semibold text-slate-900">{formatMoney(totals.taxTotal, country)}</span>
          </div>
          {country === "IN" ? (
            totals.igst > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-slate-600">IGST</span>
                <span className="font-semibold text-slate-900">{formatMoney(totals.igst, country)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-slate-600">CGST + SGST</span>
                <span className="font-semibold text-slate-900">{formatMoney(totals.cgst + totals.sgst, country)}</span>
              </div>
            )
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-slate-600">{cfg.taxLabel}</span>
              <span className="font-semibold text-slate-900">{formatMoney(totals.taxTotal, country)}</span>
            </div>
          )}
          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">Total Debit Amount</span>
              <span className="font-semibold text-slate-900">{formatMoney(totals.total, country)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-slate-600">Current Payable Balance</span>
              <span className="font-semibold text-slate-900">{formatMoney(selectedInvoice?.remainingBalance || 0, country)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-slate-600">Updated Payable Balance</span>
              <span className="font-semibold text-emerald-700">{formatMoney(totals.updatedPayable, country)}</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">{cfg.label}</p>
            <p className="mt-1">{cfg.legalWording}</p>
          </div>
        </div>
      </div>

      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Status: <span className="font-semibold text-slate-700">{activeNote?.status || "Unsaved Draft"}</span>
            {fieldErrors.workflow ? <span className="ml-3 font-semibold text-rose-600">{fieldErrors.workflow}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnly ? (
              <>
                <button
                  onClick={() => onPersist("Draft")}
                  disabled={!!savingStatus}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingStatus === "Draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingStatus === "Draft" ? "Saving..." : "Save Draft"}
                </button>
                <button
                  onClick={() => onPersist("Issued")}
                  disabled={!!savingStatus || activeNote?.status === "Applied"}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingStatus === "Issued" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {savingStatus === "Issued" ? "Issuing..." : "Issue"}
                </button>
                <button
                  onClick={() => onPersist("Applied")}
                  disabled={
                    !!savingStatus ||
                    !access.canApply ||
                    ((activeNote?.status || "Draft") !== "Issued" && (activeNote?.status || "Draft") !== "Applied")
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingStatus === "Applied" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {savingStatus === "Applied" ? "Applying..." : "Apply"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
