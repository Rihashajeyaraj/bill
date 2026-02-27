import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save, Search, X } from "lucide-react";
import { COUNTRY_CONFIG, type CountryCode, type CreditStatus } from "./countryConfig";
import type { CreditInvoice, CreditNoteRecord, CustomerOption } from "./store";
import type { CreditNoteFormState } from "./types";
import { formatMoney, parseNumber } from "./utils";

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
  allocationByInvoiceItemId?: Record<string, Array<any>>;
  allocationsLoading?: boolean;
  onBack: () => void;
  onUpdateForm: <K extends keyof CreditNoteFormState>(key: K, value: CreditNoteFormState[K]) => void;
  onApplyInvoice: (invoiceId: string) => void;
  onUpdateLine: (id: string, patch: any) => void;
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onPersist: (targetStatus: CreditStatus, options?: { email?: boolean; download?: boolean }) => void;
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

function normalizePhoneForLookup(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function customerAddressSummary(customer: CustomerOption | null) {
  return [customer?.address, customer?.state, customer?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
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
  allocationByInvoiceItemId = {},
  allocationsLoading = false,
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
  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );
  const [availableInvoices, setAvailableInvoices] = useState<CreditInvoice[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [customerSearchPhone, setCustomerSearchPhone] = useState("");
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const customerLookupResults = useMemo(() => {
    const query = String(customerLookupQuery || "").trim().toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(query);
    return customers
      .filter((customer) => {
        const text = [customer?.name, customer?.email, customer?.address, customer?.state, customer?.country]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const customerPhone = normalizePhoneForLookup(customer?.phone);
        return text.includes(query) || (normalizedPhoneQuery && customerPhone && customerPhone.includes(normalizedPhoneQuery));
      })
      .slice(0, 8);
  }, [customers, customerLookupQuery]);

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

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerSearchPhone("");
      return;
    }
    setCustomerSearchPhone(String(selectedCustomer?.phone || "").replace(/\D/g, "").slice(-10));
  }, [selectedCustomerId, selectedCustomer?.phone]);

  function resetInvoiceSelection() {
    onUpdateForm("linkedInvoiceId", "");
    onUpdateForm("lines", []);
    onUpdateForm("partialAmountCap", "");
    onUpdateForm("discountPercent", "");
    onUpdateForm("priceAdjustmentAmount", "");
  }

  function applyCustomerSelection(customer: CustomerOption) {
    const customerChanged = customer.id !== selectedCustomerId;
    onUpdateForm("customerId", customer.id);
    onUpdateForm("customerInput", customer.name || "");
    if (customer.registrationNumber) {
      onUpdateForm("registrationNumber", customer.registrationNumber);
    }
    if (customerChanged) {
      resetInvoiceSelection();
    }
    setCustomerSearchPhone(String(customer.phone || "").replace(/\D/g, "").slice(-10));
    setCustomerLookupQuery("");
    setCustomerSearchError("");
  }

  function handleCustomerPhoneChange(value: string) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    setCustomerSearchPhone(digits);
    setCustomerSearchError("");
    if (selectedCustomerId && normalizePhoneForLookup(digits) !== normalizePhoneForLookup(selectedCustomer?.phone)) {
      onUpdateForm("customerId", "");
      onUpdateForm("customerInput", "");
      resetInvoiceSelection();
    }
  }

  function handleCustomerLookupChange(value: string) {
    setCustomerLookupQuery(value);
    setCustomerSearchError("");
  }

  function handleCustomerSearch() {
    const phoneDigits = String(customerSearchPhone || "").replace(/\D/g, "");
    if (phoneDigits) {
      if (phoneDigits.length !== 10) {
        setCustomerSearchError("Enter valid 10-digit mobile number.");
        return;
      }
      const normalizedPhone = normalizePhoneForLookup(phoneDigits);
      const matchedCustomer = customers.find(
        (customer) => normalizePhoneForLookup(customer?.phone) === normalizedPhone
      );
      if (!matchedCustomer) {
        setCustomerSearchError("No customer found for this mobile number.");
        return;
      }
      applyCustomerSelection(matchedCustomer);
      return;
    }

    const query = String(customerLookupQuery || "").trim();
    if (query.length < 2) {
      setCustomerSearchError("Enter mobile number or name/email/address to search.");
      return;
    }
    if (!customerLookupResults.length) {
      setCustomerSearchError("No customer found.");
      return;
    }
    if (customerLookupResults.length === 1) {
      applyCustomerSelection(customerLookupResults[0]);
      return;
    }
    setCustomerSearchError("Multiple customers found. Select one below.");
  }

  function resetCustomerSelection() {
    onUpdateForm("customerId", "");
    onUpdateForm("customerInput", "");
    resetInvoiceSelection();
    setCustomerSearchPhone("");
    setCustomerLookupQuery("");
    setCustomerSearchError("");
  }

  return (
    <div className="credit-note-compact flex min-h-full flex-col gap-2.5">
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
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:col-span-2 xl:col-span-2">
                <p className="text-xs font-semibold text-slate-600">Customer Search</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={customerSearchPhone}
                    onChange={(event) => handleCustomerPhoneChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCustomerSearch();
                      }
                    }}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Enter 10-digit mobile number"
                    disabled={isReadOnly}
                    className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleCustomerSearch}
                    disabled={isReadOnly}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Search
                  </button>
                  {selectedCustomerId ? (
                    <button
                      type="button"
                      onClick={resetCustomerSelection}
                      disabled={isReadOnly}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  ) : null}
                </div>
                <input
                  value={customerLookupQuery}
                  onChange={(event) => handleCustomerLookupChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCustomerSearch();
                    }
                  }}
                  placeholder="Type customer name, email, or address"
                  disabled={isReadOnly}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:bg-slate-100"
                />
                {customerSearchError ? <p className="text-xs font-medium text-rose-600">{customerSearchError}</p> : null}
                {customerLookupQuery.trim() ? (
                  customerLookupResults.length ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {customerLookupResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => applyCustomerSelection(customer)}
                          disabled={isReadOnly}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <p className="text-sm font-semibold text-slate-900">{customer.name || "-"}</p>
                          <p className="text-xs text-slate-600">{customer.phone || "-"}</p>
                          <p className="text-xs text-slate-500">{customerAddressSummary(customer) || "-"}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      No customer found. Try another search.
                    </p>
                  )
                ) : null}
                {selectedCustomer ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                    <p className="font-semibold text-slate-900">{selectedCustomer.name || "-"}</p>
                    <p className="mt-1 text-slate-500">{selectedCustomer.phone || "-"}</p>
                    <p className="mt-1 text-slate-500">{selectedCustomer.email || "-"}</p>
                    <p className="mt-1 text-slate-500">{customerAddressSummary(selectedCustomer) || "-"}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Search customer by mobile, name, email, or address.
                  </div>
                )}
                {fieldErrors.customerId ? <span className="block text-xs text-rose-600">{fieldErrors.customerId}</span> : null}
              </div>
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
            <p className="text-sm font-semibold text-slate-900">Section 2 - How Credit Is Calculated</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">Mode: Auto (Full Credit)</p>
                <p className="mt-1">Credit amount is automatic from `Return Qty x Invoice Rate + Tax`.</p>
                <p className="mt-1">Item, rate and tax come from the linked invoice and stay locked.</p>
              </div>
              <label className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">
                <span className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!form.returnToStock}
                    onChange={(event) => onUpdateForm("returnToStock", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Return items to stock
                </span>
                <p className="mt-2 font-normal text-slate-500">
                  Enable this only when customer physically returns goods.
                </p>
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Section 3 - Items</p>
                <p className="text-xs text-slate-500">
                  {selectedInvoiceId ? "Linked invoice lines only. Quantity can be reduced but not increased." : "Add or adjust line items in invoice-style cards."}
                </p>
              </div>
              <button
                onClick={onAddLine}
                disabled={!!selectedInvoiceId}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={selectedInvoiceId ? "Use linked invoice lines only." : "Add line"}
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
                      Return Qty
                      <input
                        type="number"
                        min={0}
                        max={parseNumber((line as any).sourceInvoiceQty) > 0 ? parseNumber((line as any).sourceInvoiceQty) : undefined}
                        value={line.quantity}
                        onChange={(event) => {
                          const sourceQty = Math.max(0, parseNumber((line as any).sourceInvoiceQty));
                          const nextQtyRaw = Math.max(0, parseNumber(event.target.value));
                          const nextQty = sourceQty > 0 ? Math.min(nextQtyRaw, sourceQty) : nextQtyRaw;
                          onUpdateLine(line.id, {
                            quantity: nextQty,
                            creditType: "Percentage",
                            creditValue: 0
                          });
                        }}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      {parseNumber((line as any).sourceInvoiceQty) > 0 ? (
                        <p className="mt-1 text-[11px] text-slate-500">Invoice qty: {parseNumber((line as any).sourceInvoiceQty)}</p>
                      ) : null}
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                      Invoice Rate
                      <input
                        type="number"
                        min={0}
                        value={line.rate}
                        readOnly
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
                        value={line.taxRate}
                        readOnly
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
                      />
                    </label>
                  </div>
                  {allocationsLoading ? (
                    <p className="mt-2 text-[11px] text-slate-500">Loading batch details...</p>
                  ) : null}
                  {!allocationsLoading &&
                  Array.isArray(
                    allocationByInvoiceItemId[String((line as any).sourceInvoiceItemId || line.id || "")]
                  ) &&
                  allocationByInvoiceItemId[String((line as any).sourceInvoiceItemId || line.id || "")].length ? (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                      <p className="font-semibold text-slate-700">Sold Batch Details</p>
                      <div className="mt-1 space-y-1">
                        {allocationByInvoiceItemId[
                          String((line as any).sourceInvoiceItemId || line.id || "")
                        ]
                          .slice(0, 4)
                          .map((row: any, idx: number) => (
                            <p key={`${line.id}-alloc-${idx}`}>
                              {row?.batch_document_no || "BATCH"} | Qty {parseNumber(row?.allocated_qty)} | Cost {formatMoney(parseNumber(row?.unit_cost_excl_tax), country)}
                            </p>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Base Amount</p><p className="font-semibold text-slate-900">{formatMoney(line.baseAmount, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Tax Amount</p><p className="font-semibold text-slate-900">{formatMoney(line.taxAmount, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">After Tax</p><p className="font-semibold text-slate-900">{formatMoney(line.amountAfterTax, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Credit Amount</p><p className="font-semibold text-emerald-700">{formatMoney(line.creditAmount, country)}</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"><p className="text-slate-500">Mode</p><p className="font-semibold text-slate-900">Auto</p></div>
                  </div>
                </div>
              ))}
              {!totals.detailed.length ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">Select invoice to load items.</p>
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
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">Internal Notes<textarea rows={2} value={form.internalNotes} onChange={(event) => onUpdateForm("internalNotes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">Customer Notes<textarea rows={2} value={form.customerNotes} onChange={(event) => onUpdateForm("customerNotes", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
        <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
        <p className="mt-1 text-xs text-slate-500">Auto-calculated totals and remaining balance.</p>
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
            <span className="text-slate-600">Tax Reversal</span>
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
              <span className="font-semibold text-slate-900">Total Credit</span>
              <span className="font-semibold text-slate-900">{formatMoney(totals.total, country)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-slate-600">Remaining Invoice Balance</span>
              <span className="font-semibold text-emerald-700">{formatMoney(totals.remaining, country)}</span>
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
