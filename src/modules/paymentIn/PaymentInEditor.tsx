import React from "react";
import { ArrowLeft, Download, FileDown, Mail, Save, Send } from "lucide-react";
import GradientButton from "../../components/GradientButton";
import { COUNTRY_CONFIG, type CountryCode, type PaymentMode, type PaymentStatus } from "./countryConfig";
import type { CustomerOpenInvoice, CustomerOption, PaymentInRecord } from "./store";
import type { PaymentInFormState } from "./types";
import { formatMoney, parseNumber } from "./utils";

interface PaymentInEditorProps {
  country: CountryCode;
  readOnly?: boolean;
  form: PaymentInFormState;
  activePayment: PaymentInRecord | null;
  customers: CustomerOption[];
  openInvoices: CustomerOpenInvoice[];
  totals: {
    amountReceived: number;
    amountApplied: number;
    unappliedAmount: number;
    outstandingAfter: number;
  };
  customerOutstandingBefore: number;
  actorName: string;
  access: { roleType: "Admin" | "Staff"; canApply: boolean; canOverride: boolean };
  fieldErrors: Record<string, string>;
  onBack: () => void;
  onUpdateForm: <K extends keyof PaymentInFormState>(key: K, value: PaymentInFormState[K]) => void;
  onApplyCustomer: (customerId: string, inputName?: string) => void;
  onUpdateAllocation: (invoiceId: string, value: number) => void;
  onPersist: (targetStatus: PaymentStatus, options?: { email?: boolean; download?: boolean }) => void;
}

function paymentHint(mode: PaymentMode) {
  if (mode === "Cheque") return "Provide cheque number and bank details.";
  if (mode === "Bank Transfer") return "Add bank account and transaction details.";
  if (mode === "Card" || mode === "UPI" || mode === "Online Gateway") return "Transaction ID is recommended for reconciliation.";
  return "Cash receipt will be recorded against customer ledger.";
}

export default function PaymentInEditor({
  country,
  readOnly,
  form,
  activePayment,
  customers,
  openInvoices,
  totals,
  customerOutstandingBefore,
  actorName,
  access,
  fieldErrors,
  onBack,
  onUpdateForm,
  onApplyCustomer,
  onUpdateAllocation,
  onPersist
}: PaymentInEditorProps) {
  const cfg = COUNTRY_CONFIG[country];
  const isReadOnly = !!readOnly;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to List
        </button>
        <div className="text-xs text-slate-500">
          Role: <span className="font-semibold text-slate-700">{access.roleType}</span> | Workflow: Draft &gt; Received &gt; Applied
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <fieldset className="space-y-4 xl:col-span-2" disabled={isReadOnly}>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 1 - Basic Info</p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Selected Country
                <input
                  value={`${cfg.flag} ${cfg.name}`}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Receipt Number
                <input
                  value={activePayment?.receiptNo || "Auto generated on save"}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Payment Date
                <input
                  type="date"
                  value={form.paymentDate}
                  onChange={(event) => onUpdateForm("paymentDate", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
                {fieldErrors.paymentDate ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.paymentDate}</span> : null}
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Customer
                <input
                  list="payment-in-customer-options"
                  value={form.customerInput}
                  onChange={(event) => {
                    const next = event.target.value;
                    const matched = customers.find((customer) => customer.name.toLowerCase() === next.trim().toLowerCase());
                    if (matched) {
                      onApplyCustomer(matched.id, matched.name);
                    } else {
                      onUpdateForm("customerInput", next);
                      onUpdateForm("customerId", "");
                      onUpdateForm("allocations", []);
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                  placeholder="Type customer"
                />
                <datalist id="payment-in-customer-options">
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.name} />
                  ))}
                </datalist>
                {fieldErrors.customerId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.customerId}</span> : null}
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Currency
                <input
                  value={form.currency}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Amount Received
                <input
                  type="number"
                  min={0}
                  value={form.amountReceived}
                  onChange={(event) => onUpdateForm("amountReceived", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
                {fieldErrors.amountReceived ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.amountReceived}</span> : null}
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 2 - Payment Details</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Payment Mode
                <select
                  value={form.paymentMode}
                  onChange={(event) => onUpdateForm("paymentMode", event.target.value as PaymentMode)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  {cfg.paymentModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Payment Reference
                <input
                  value={form.referenceNo}
                  onChange={(event) => onUpdateForm("referenceNo", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
              </label>

              {form.paymentMode === "Cheque" ? (
                <>
                  <label className="text-xs font-semibold text-slate-600">
                    Cheque No
                    <input
                      value={form.chequeNo}
                      onChange={(event) => onUpdateForm("chequeNo", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                    />
                    {fieldErrors.chequeNo ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.chequeNo}</span> : null}
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Bank Name
                    <input
                      value={form.bankName}
                      onChange={(event) => onUpdateForm("bankName", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                    />
                    {fieldErrors.bankName ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.bankName}</span> : null}
                  </label>
                </>
              ) : null}

              {form.paymentMode === "Bank Transfer" ? (
                <>
                  <label className="text-xs font-semibold text-slate-600">
                    Bank Account
                    <input
                      value={form.bankAccount}
                      onChange={(event) => onUpdateForm("bankAccount", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                    />
                    {fieldErrors.bankAccount ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.bankAccount}</span> : null}
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Transaction ID
                    <input
                      value={form.transactionId}
                      onChange={(event) => onUpdateForm("transactionId", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                    />
                    {fieldErrors.transactionId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.transactionId}</span> : null}
                  </label>
                </>
              ) : null}

              {form.paymentMode === "Card" || form.paymentMode === "UPI" || form.paymentMode === "Online Gateway" ? (
                <>
                  <label className="text-xs font-semibold text-slate-600">
                    Transaction ID
                    <input
                      value={form.transactionId}
                      onChange={(event) => onUpdateForm("transactionId", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                    />
                    {fieldErrors.transactionId ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.transactionId}</span> : null}
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Gateway / Reference
                    <input
                      value={form.paymentReference}
                      onChange={(event) => onUpdateForm("paymentReference", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                    />
                  </label>
                </>
              ) : null}

              <label className="text-xs font-semibold text-slate-600">
                {cfg.registrationLabel}
                <input
                  value={form.registrationNumber}
                  onChange={(event) => onUpdateForm("registrationNumber", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-emerald-200"
                />
                {fieldErrors.registrationNumber ? <span className="mt-1 block text-xs text-rose-600">{fieldErrors.registrationNumber}</span> : null}
              </label>
              <p className="text-xs text-slate-500 md:col-span-2">{paymentHint(form.paymentMode)}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 3 - Apply Payment to Invoices</p>
            {fieldErrors.allocations ? <p className="mt-2 text-xs text-rose-600">{fieldErrors.allocations}</p> : null}
            <div className="mt-3 overflow-auto">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-700">Invoice No</th>
                    <th className="px-3 py-2 font-semibold text-slate-700">Invoice Date</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 text-right">Invoice Amount</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 text-right">Balance Due</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 text-right">Apply Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {form.allocations.map((line) => (
                    <tr key={line.invoiceId} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{line.invoiceNo}</td>
                      <td className="px-3 py-2 text-slate-700">{line.invoiceDate}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{formatMoney(line.invoiceAmount, country)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatMoney(line.balanceDue, country)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={line.applyAmount}
                          onChange={(event) => onUpdateAllocation(line.invoiceId, parseNumber(event.target.value))}
                          className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                        />
                      </td>
                    </tr>
                  ))}
                  {!form.allocations.length ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                        Select customer to load open invoices. Advance payment is allowed even without invoices.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Section 4 - Notes & Attachments</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                Internal Notes
                <textarea
                  rows={2}
                  value={form.internalNotes}
                  onChange={(event) => onUpdateForm("internalNotes", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                Customer Notes
                <textarea
                  rows={2}
                  value={form.customerNotes}
                  onChange={(event) => onUpdateForm("customerNotes", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-2">
                Payment Proof Attachment
                <input
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    onUpdateForm(
                      "attachment",
                      file
                        ? { name: file.name, size: file.size, type: file.type || "application/octet-stream" }
                        : null
                    );
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
                />
                {form.attachment ? <span className="mt-1 block text-xs text-slate-500">{form.attachment.name}</span> : null}
              </label>
              <div className="text-xs text-slate-600 md:col-span-2">
                <p className="font-semibold">Audit Trail</p>
                <p className="mt-1">Created by: {activePayment?.audit.createdBy || actorName}</p>
                <p>Modified by: {activePayment?.audit.modifiedBy || actorName}</p>
              </div>
            </div>
          </div>
        </fieldset>

        <div className="space-y-4 xl:col-span-1">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft xl:sticky xl:top-24">
            <p className="text-sm font-semibold text-slate-900">Section 5 - Totals</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Amount Received</span><span className="font-semibold text-slate-900">{formatMoney(totals.amountReceived, country)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Amount Applied</span><span className="font-semibold text-slate-900">{formatMoney(totals.amountApplied, country)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-semibold text-slate-900">Unapplied Amount</span><span className="font-semibold text-slate-900">{formatMoney(totals.unappliedAmount, country)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Outstanding Before</span><span className="font-semibold text-slate-900">{formatMoney(customerOutstandingBefore, country)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Outstanding After</span><span className="font-semibold text-slate-900">{formatMoney(totals.outstandingAfter, country)}</span></div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">{cfg.receiptLabel}</p>
              <p className="mt-1">{cfg.legalWording}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 right-0 left-[84px] z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-[260px]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Status: <span className="font-semibold text-slate-700">{activePayment?.status || "Unsaved Draft"}</span>
            {fieldErrors.workflow ? <span className="ml-3 font-semibold text-rose-600">{fieldErrors.workflow}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnly ? (
              <>
                <button
                  onClick={() => onPersist("Draft")}
                  disabled={activePayment?.status === "Received"}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Save as Draft
                </button>
                <button onClick={() => onPersist("Received")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><Send className="h-4 w-4" />Mark as Received</button>
                <button onClick={() => onPersist("Applied")} disabled={!access.canApply} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><Download className="h-4 w-4" />Apply to Invoices</button>
                <button onClick={() => onPersist(activePayment?.status || "Draft", { email: true })} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><Mail className="h-4 w-4" />Email Receipt</button>
              </>
            ) : null}
            <GradientButton onClick={() => onPersist(activePayment?.status || "Draft", { download: true })}><FileDown className="h-4 w-4" />Download PDF</GradientButton>
          </div>
        </div>
      </div>
    </div>
  );
}
