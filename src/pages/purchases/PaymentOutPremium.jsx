import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileDown,
  Mail,
  Plus,
  Save,
  Search,
  Send,
  Wallet
} from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { companyGetProfile } from "../../services/company.service";
import {
  allocationsFromBills,
  buildPaymentOutPayload,
  defaultPaymentForm,
  listPaymentOut,
  mapOpenBillsByCountry,
  mapSuppliersByCountry,
  outstandingBySupplier,
  savePaymentOut,
  summarizePaymentOut,
  updateAllocationAmount
} from "../../modules/paymentOut/store";
import { exportPaymentOutPdf } from "../../modules/paymentOut/pdf";
import { formatMoney, normalizeText, parseNumber } from "../../modules/paymentOut/utils";

const PAYMENT_MODES = ["Cash", "Bank Transfer", "Cheque", "Card", "Online"];
const STATUSES = ["Draft", "Paid", "Applied"];

const ACTION_BAR_BASE =
  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold";

function statusBadge(status) {
  if (status === "Applied") return "success";
  if (status === "Paid") return "warning";
  return "neutral";
}

export default function PaymentOutPremium() {
  const company = companyGetProfile();
  const country = company?.country || "India";
  const currency = company?.currency || company?.tax?.currency || "";
  const user = authGetUser();
  const role = authGetRole();
  const actorName = user?.name || user?.email || "System User";

  const [panelMode, setPanelMode] = useState("list");
  const [form, setForm] = useState(defaultPaymentForm(country, currency));
  const [activePayment, setActivePayment] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dirty, setDirty] = useState(false);

  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const payments = useMemo(() => listPaymentOut(country), [country, refreshKey]);
  const suppliers = useMemo(() => mapSuppliersByCountry(country), [country, refreshKey]);
  const bills = useMemo(() => mapOpenBillsByCountry(country), [country, refreshKey]);
  const summary = useMemo(() => summarizePaymentOut(country), [country, refreshKey]);

  const selectedSupplier = useMemo(
    () => suppliers.find((entry) => entry.id === form.supplierId) || null,
    [suppliers, form.supplierId]
  );
  const supplierBills = useMemo(
    () => bills.filter((bill) => bill.supplierId === form.supplierId),
    [bills, form.supplierId]
  );
  const supplierOutstandingBefore = useMemo(
    () => (form.supplierId ? outstandingBySupplier(country, form.supplierId) : 0),
    [country, form.supplierId, refreshKey]
  );

  const amountPaid = Math.max(0, parseNumber(form.amountPaid));
  const amountApplied = form.allocations.reduce((sum, line) => sum + parseNumber(line.applyAmount), 0);
  const unappliedAmount = Math.max(0, amountPaid - amountApplied);
  const outstandingAfter = supplierOutstandingBefore - amountApplied;

  const filteredPayments = useMemo(() => {
    const query = normalizeText(search);
    return payments.filter((entry) => {
      const haystack = `${entry.supplierName} ${entry.paymentNo} ${entry.referenceNo || ""}`.toLowerCase();
      const matchQuery = !query || haystack.includes(query);
      const matchSupplier = !supplierFilter || entry.supplierId === supplierFilter;
      const matchStatus = !statusFilter || entry.status === statusFilter;
      const matchMode = !modeFilter || entry.paymentMode === modeFilter;
      const matchFrom = fromDate ? entry.paymentDate >= fromDate : true;
      const matchTo = toDate ? entry.paymentDate <= toDate : true;
      return matchQuery && matchSupplier && matchStatus && matchMode && matchFrom && matchTo;
    });
  }, [payments, search, supplierFilter, statusFilter, modeFilter, fromDate, toDate]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function startNew() {
    setForm(defaultPaymentForm(country, currency));
    setActivePayment(null);
    setPanelMode("form");
    setDirty(false);
  }

  function openRecord(record, mode) {
    setForm({
      ...record,
      desiredStatus: record.status
    });
    setActivePayment(record);
    setPanelMode("form");
    setDirty(false);
    if (mode === "view") {
      setForm((prev) => ({ ...prev, readOnly: true }));
    }
  }

  function backToList() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setPanelMode("list");
    setForm(defaultPaymentForm(country, currency));
    setActivePayment(null);
    setDirty(false);
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function updateSupplier(supplierId) {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    setForm((prev) => ({
      ...prev,
      supplierId,
      supplierName: supplier?.name || "",
      allocations: allocationsFromBills(bills.filter((bill) => bill.supplierId === supplierId))
    }));
    setDirty(true);
  }

  function updateAllocation(billId, value) {
    const otherApplied = form.allocations
      .filter((line) => line.billId !== billId)
      .reduce((sum, line) => sum + parseNumber(line.applyAmount), 0);
    const maxAllowed = Math.max(0, amountPaid - otherApplied);
    setForm((prev) => ({
      ...prev,
      allocations: updateAllocationAmount(prev.allocations, billId, value, maxAllowed)
    }));
    setDirty(true);
  }

  function autoApplyAll() {
    let remaining = amountPaid;
    const next = form.allocations.map((line) => {
      const applyAmount = Math.min(line.balanceDue, remaining);
      remaining -= applyAmount;
      return { ...line, applyAmount };
    });
    setForm((prev) => ({ ...prev, allocations: next }));
    setDirty(true);
  }

  function persist(status) {
    if (!form.supplierId) {
      window.alert("Select a supplier before saving.");
      return;
    }
    try {
      const payload = buildPaymentOutPayload(
        { ...form, desiredStatus: status, supplierName: selectedSupplier?.name || form.supplierName },
        supplierOutstandingBefore,
        actorName
      );
      const saved = savePaymentOut(payload);
      setActivePayment(saved);
      setForm({ ...saved, desiredStatus: saved.status });
      setRefreshKey((prev) => prev + 1);
      setDirty(false);
      window.alert(`Payment ${saved.paymentNo} saved as ${saved.status}.`);
    } catch (error) {
      window.alert(error?.message || "Unable to save payment.");
    }
  }

  const readOnly = !!form.readOnly;

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24">
      <PageHeader
        title="Payment Out"
        subtitle="Pay suppliers • Track payables • Statement ready"
        right={
          panelMode === "list" ? (
            <button
              type="button"
              onClick={startNew}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              New Payment
            </button>
          ) : (
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to list
            </button>
          )
        }
      />
      {panelMode === "list" ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold text-slate-500">Total Payments Made</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.count}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold text-slate-500">Total Amount Paid</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {formatMoney(summary.totalPaid, currency)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold text-slate-500">Unallocated Payments</p>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {formatMoney(summary.totalUnapplied, currency)}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Supplier Payments</p>
                <p className="text-xs text-slate-500">Search by supplier, payment number, or reference.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search payments"
                    className="w-full rounded-full border border-slate-200 bg-slate-50 px-10 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200"
                  />
                </label>
                <select
                  value={supplierFilter}
                  onChange={(event) => setSupplierFilter(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
                >
                  <option value="">All Suppliers</option>
                  {suppliers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <select
                  value={modeFilter}
                  onChange={(event) => setModeFilter(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
                >
                  <option value="">All Modes</option>
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
                >
                  <option value="">All Status</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
                />
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">Payment No</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Supplier</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Mode</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Reference</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 text-right">Amount Paid</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 text-right">Applied</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 text-right">Balance / Advance</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.length ? (
                    filteredPayments.map((entry) => {
                      const advance = Math.max(0, parseNumber(entry?.totals?.unappliedAmount));
                      return (
                        <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-semibold text-slate-900">{entry.paymentNo}</td>
                          <td className="px-4 py-3 text-slate-700">{entry.paymentDate}</td>
                          <td className="px-4 py-3 text-slate-700">{entry.supplierName}</td>
                          <td className="px-4 py-3 text-slate-700">{entry.paymentMode}</td>
                          <td className="px-4 py-3 text-slate-700">{entry.referenceNo || "-"}</td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {formatMoney(entry.totals?.amountPaid, currency)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {formatMoney(entry.totals?.amountApplied, currency)}
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold ${advance ? "text-emerald-700" : "text-slate-700"}`}>
                            {advance ? `Adv ${formatMoney(advance, currency)}` : "-"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={statusBadge(entry.status)}>{entry.status}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openRecord(entry, "view")}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => openRecord(entry, "edit")}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => exportPaymentOutPdf(entry)}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                PDF
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                        No payments found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_0.6fr]">
            <div className="space-y-4">
              <Card className="p-5">
                <p className="text-sm font-semibold text-slate-900">Basic Info</p>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Country</p>
                    <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {country}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Payment Number</p>
                    <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {form.paymentNo || "Auto-generated on save"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Payment Date</p>
                    <input
                      type="date"
                      value={form.paymentDate}
                      onChange={(event) => updateField("paymentDate", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Supplier</p>
                    <select
                      value={form.supplierId}
                      onChange={(event) => updateSupplier(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      disabled={readOnly}
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-semibold text-slate-900">Payment Details</p>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Amount Paid</p>
                    <input
                      type="number"
                      min={0}
                      value={form.amountPaid}
                      onChange={(event) => updateField("amountPaid", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-lg font-semibold"
                      disabled={readOnly || !form.supplierId}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Payment Mode</p>
                    <select
                      value={form.paymentMode}
                      onChange={(event) => updateField("paymentMode", event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      disabled={readOnly}
                    >
                      {PAYMENT_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.paymentMode === "Bank Transfer" ? (
                    <>
                      <input
                        value={form.bankName}
                        onChange={(event) => updateField("bankName", event.target.value)}
                        placeholder="Bank Name"
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        disabled={readOnly}
                      />
                      <input
                        value={form.transactionId}
                        onChange={(event) => updateField("transactionId", event.target.value)}
                        placeholder="Transaction ID"
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        disabled={readOnly}
                      />
                    </>
                  ) : null}
                  {form.paymentMode === "Cheque" ? (
                    <input
                      value={form.chequeNo}
                      onChange={(event) => updateField("chequeNo", event.target.value)}
                      placeholder="Cheque Number"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  ) : null}
                  {form.paymentMode === "Card" || form.paymentMode === "Online" ? (
                    <input
                      value={form.transactionId}
                      onChange={(event) => updateField("transactionId", event.target.value)}
                      placeholder="Transaction ID"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  ) : null}
                  <input
                    value={form.referenceNo}
                    onChange={(event) => updateField("referenceNo", event.target.value)}
                    placeholder="Payment reference"
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                    disabled={readOnly}
                  />
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Allocate to Bills</p>
                    <p className="text-xs text-slate-500">Apply payments to open purchase bills.</p>
                  </div>
                  <button
                    type="button"
                    onClick={autoApplyAll}
                    disabled={!form.supplierId || readOnly}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Auto-apply
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {!form.supplierId ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      Select a supplier to view open bills.
                    </div>
                  ) : supplierBills.length ? (
                    form.allocations.map((line) => (
                      <div key={line.billId} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{line.billNo}</p>
                            <p className="text-xs text-slate-500">Bill date: {line.billDate || "-"}</p>
                          </div>
                          <div className="text-right text-xs text-slate-500">
                            <p>Bill Amount: {formatMoney(line.billAmount, currency)}</p>
                            <p>Balance Due: {formatMoney(line.balanceDue, currency)}</p>
                          </div>
                        </div>
                        <div className="mt-3">
                          <label className="text-xs font-semibold text-slate-500">Apply Amount</label>
                          <input
                            type="number"
                            min={0}
                            max={line.balanceDue}
                            value={line.applyAmount}
                            onChange={(event) => updateAllocation(line.billId, event.target.value)}
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                            disabled={readOnly}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      No open bills for this supplier. Any payment will be saved as advance.
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-semibold text-slate-900">Notes & Attachments</p>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <textarea
                    value={form.internalNotes}
                    onChange={(event) => updateField("internalNotes", event.target.value)}
                    rows={4}
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Internal notes (finance team)."
                    disabled={readOnly}
                  />
                  <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    <input
                      type="file"
                      className="hidden"
                      disabled={readOnly}
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        updateField(
                          "attachment",
                          file ? { name: file.name, size: file.size, type: file.type || "application/octet-stream" } : null
                        );
                      }}
                    />
                    {form.attachment ? (
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-700">{form.attachment.name}</p>
                        <p className="text-xs text-slate-500">{Math.round(form.attachment.size / 1024)} KB</p>
                      </div>
                    ) : (
                      "Upload payment proof"
                    )}
                  </label>
                </div>
              </Card>
            </div>

            <div className="lg:sticky lg:top-24 h-fit">
              <Card className="p-5">
                <p className="text-sm font-semibold text-slate-900">Summary</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Amount Paid</span>
                    <span className="font-semibold text-slate-900">{formatMoney(amountPaid, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Amount Applied</span>
                    <span className="font-semibold text-slate-900">{formatMoney(amountApplied, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Advance</span>
                    <span className="font-semibold text-emerald-700">{formatMoney(unappliedAmount, currency)}</span>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="text-slate-500">Supplier Outstanding After Payment</p>
                    <p className={`text-base font-semibold ${outstandingAfter <= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      {formatMoney(outstandingAfter, currency)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="text-slate-500">Approval Role</p>
                    <p className="font-semibold text-slate-700">{role}</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {panelMode === "form" && !readOnly ? (
            <div className="fixed bottom-4 right-4 z-40 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => persist("Draft")}
                className={`${ACTION_BAR_BASE} border border-slate-200 text-slate-700`}
              >
                <Save className="h-3.5 w-3.5" />
                Save Draft
              </button>
              <button
                type="button"
                onClick={() => persist("Paid")}
                className={`${ACTION_BAR_BASE} bg-slate-900 text-white`}
              >
                <Send className="h-3.5 w-3.5" />
                Mark Paid
              </button>
              <button
                type="button"
                onClick={() => persist("Applied")}
                className={`${ACTION_BAR_BASE} border border-emerald-200 bg-emerald-50 text-emerald-700`}
              >
                <Wallet className="h-3.5 w-3.5" />
                Apply to Bills
              </button>
              <button
                type="button"
                onClick={() => exportPaymentOutPdf(activePayment || form)}
                className={`${ACTION_BAR_BASE} border border-slate-200 text-slate-700`}
              >
                <FileDown className="h-3.5 w-3.5" />
                PDF
              </button>
              <button
                type="button"
                onClick={() => window.alert("Email payment advice queued.")}
                className={`${ACTION_BAR_BASE} border border-slate-200 text-slate-700`}
              >
                <Mail className="h-3.5 w-3.5" />
                Email
              </button>
            </div>
          ) : null}
        </div>
      )}

      {!suppliers.length && panelMode === "list" ? (
        <EmptyState
          title="No suppliers yet"
          description="Add suppliers in Parties before creating payment out transactions."
        />
      ) : null}
    </div>
  );
}
