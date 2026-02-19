import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileDown,
  Mail,
  Plus,
  Save,
  Send,
  Wallet
} from "lucide-react";
import Badge from "../../components/Badge";
import EmptyState from "../../components/EmptyState";
import FlowCard from "../../modules/paymentIn/FlowCard";
import FlowStepTabs from "../../modules/paymentIn/FlowStepTabs";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { companyGetProfile } from "../../services/company.service";
import { purchasesSyncFromRemote } from "../../services/purchases.service";
import { syncPaymentOutRemote } from "../../services/payments.service";
import { syncPartiesFromRemote } from "../../modules/parties/store";
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
const FORM_STEPS = ["Supplier & Context", "Payment Details", "Review & Confirm"];

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
  const [activeStep, setActiveStep] = useState(0);
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

  const supplierLastPayment = useMemo(() => {
    if (!form.supplierId) return "";
    return (
      payments
        .filter((entry) => entry.supplierId === form.supplierId)
        .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))[0]?.paymentDate || ""
    );
  }, [payments, form.supplierId]);

  const supplierAdvanceWallet = useMemo(() => {
    if (!form.supplierId) return 0;
    return payments
      .filter((entry) => entry.supplierId === form.supplierId && entry.status !== "Draft")
      .reduce((sum, entry) => sum + Math.max(0, parseNumber(entry?.totals?.unappliedAmount)), 0);
  }, [payments, form.supplierId]);

  useEffect(() => {
    let mounted = true;
    async function syncReferenceData() {
      try {
        await Promise.all([syncPartiesFromRemote(), purchasesSyncFromRemote()]);
      } catch {
        // Keep local cache if remote sync fails.
      } finally {
        if (mounted) setRefreshKey((prev) => prev + 1);
      }
    }
    syncReferenceData();
    return () => {
      mounted = false;
    };
  }, [country]);

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
    setActiveStep(0);
    setDirty(false);
  }

  function openRecord(record, mode) {
    setForm({
      ...record,
      desiredStatus: record.status
    });
    setActivePayment(record);
    setPanelMode("form");
    setActiveStep(mode === "view" ? 2 : 0);
    setDirty(false);
    if (mode === "view") {
      setForm((prev) => ({ ...prev, readOnly: true }));
    }
  }

  function backToList() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setPanelMode("list");
    setActiveStep(0);
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

  async function persist(status) {
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
      await syncPaymentOutRemote(saved);
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
      <div className="sticky top-0 z-30 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">Payment Out</p>
            <p className="text-xs text-slate-500">Pay suppliers and track payables</p>
          </div>
          <div className="mx-auto w-full max-w-xs rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-700 sm:mx-0 sm:flex-1 sm:max-w-sm">
            {country} | {currency || "N/A"}
          </div>
          {panelMode === "list" ? (
            <button
              type="button"
              onClick={startNew}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              New Payment
            </button>
          ) : (
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to list
            </button>
          )}
        </div>
      </div>
      {panelMode === "list" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FlowCard title="Total Payments" subtitle="Count of supplier payments">
              <p className="text-2xl font-bold text-slate-900">{summary.count}</p>
            </FlowCard>
            <FlowCard title="Total Paid" subtitle="Across all statuses">
              <p className="text-2xl font-bold text-slate-900">{formatMoney(summary.totalPaid, currency)}</p>
            </FlowCard>
            <FlowCard title="Unallocated" subtitle="Advance payment wallet">
              <p className="text-2xl font-bold text-emerald-700">{formatMoney(summary.totalUnapplied, currency)}</p>
            </FlowCard>
          </div>

          <FlowCard title="Supplier Payments" subtitle="Search by supplier, payment number, or reference.">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Filters</p>
                <p className="text-xs text-slate-500">Refine by supplier, mode, status, and date.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search supplier, payment number, reference"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 sm:max-w-xs"
                />
                <select
                  value={supplierFilter}
                  onChange={(event) => setSupplierFilter(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
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
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
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
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
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
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
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
          </FlowCard>
        </div>
      ) : (
        <div className="space-y-4">
          <FlowStepTabs steps={FORM_STEPS} activeStep={activeStep} onChange={setActiveStep} />

          {activeStep === 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <FlowCard title="Country Context" subtitle="Auto updates currency and payment numbering">
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                    {country}
                  </div>
                  <p className="text-sm text-slate-700">
                    Currency: <span className="font-semibold">{currency || "-"}</span>
                  </p>
                  <p className="text-sm text-slate-700">
                    Payment Number: <span className="font-semibold">{form.paymentNo || "Auto-generated on save"}</span>
                  </p>
                  <p className="text-xs text-slate-500">Payment Out flow records supplier settlements and purchase bill allocations.</p>
                </div>
              </FlowCard>

              <FlowCard title="Supplier" subtitle="Search and pick a supplier to begin">
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Payment Date</span>
                    <input
                      type="date"
                      value={form.paymentDate}
                      onChange={(event) => updateField("paymentDate", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Supplier</span>
                    <select
                      value={form.supplierId}
                      onChange={(event) => updateSupplier(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      disabled={readOnly}
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">Outstanding</p>
                      <p className="font-semibold text-slate-900">{formatMoney(supplierOutstandingBefore, currency)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">Last Payment</p>
                      <p className="font-semibold text-slate-900">{supplierLastPayment || "-"}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">Advance Wallet</p>
                      <p className="font-semibold text-emerald-700">{formatMoney(supplierAdvanceWallet, currency)}</p>
                    </div>
                  </div>
                </div>
              </FlowCard>
            </div>
          ) : null}

          {activeStep === 1 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <FlowCard title="Payment Details" subtitle="Capture amount and mode details">
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Amount Paid</span>
                    <input
                      type="number"
                      min={0}
                      value={form.amountPaid}
                      onChange={(event) => updateField("amountPaid", event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-2xl font-bold text-slate-900 outline-none focus:ring-4 focus:ring-slate-200"
                      disabled={readOnly || !form.supplierId}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Payment Mode</span>
                    <select
                      value={form.paymentMode}
                      onChange={(event) => updateField("paymentMode", event.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      disabled={readOnly}
                    >
                      {PAYMENT_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.paymentMode === "Bank Transfer" ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={form.bankName}
                        onChange={(event) => updateField("bankName", event.target.value)}
                        placeholder="Bank Name"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        disabled={readOnly}
                      />
                      <input
                        value={form.transactionId}
                        onChange={(event) => updateField("transactionId", event.target.value)}
                        placeholder="Transaction ID"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        disabled={readOnly}
                      />
                    </div>
                  ) : null}
                  {form.paymentMode === "Cheque" ? (
                    <input
                      value={form.chequeNo}
                      onChange={(event) => updateField("chequeNo", event.target.value)}
                      placeholder="Cheque Number"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  ) : null}
                  {form.paymentMode === "Card" || form.paymentMode === "Online" ? (
                    <input
                      value={form.transactionId}
                      onChange={(event) => updateField("transactionId", event.target.value)}
                      placeholder="Transaction ID"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  ) : null}
                  <input
                    value={form.referenceNo}
                    onChange={(event) => updateField("referenceNo", event.target.value)}
                    placeholder="Payment reference"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    disabled={readOnly}
                  />
                </div>
              </FlowCard>

              <FlowCard title="Allocate to Bills" subtitle="Apply payments to open purchase bills">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">Allocate current payment to supplier purchase bills.</p>
                    <button
                      type="button"
                      onClick={autoApplyAll}
                      disabled={!form.supplierId || readOnly}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Auto-apply
                    </button>
                  </div>
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
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
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
              </FlowCard>
            </div>
          ) : null}

          {activeStep === 2 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <FlowCard title="Review Summary" subtitle="Validate totals before final action">
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{selectedSupplier?.name || form.supplierName || "-"}</p>
                    <p className="text-xs text-slate-500">
                      {country} | {currency || "-"} | {form.paymentDate || "-"}
                    </p>
                  </div>
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
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="text-slate-500">Supplier Outstanding After Payment</p>
                    <p className={`text-base font-semibold ${outstandingAfter <= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      {formatMoney(outstandingAfter, currency)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="text-slate-500">Approval Role</p>
                    <p className="font-semibold text-slate-700">{role}</p>
                  </div>
                </div>
              </FlowCard>

              <FlowCard title="Notes & Attachments" subtitle="Store internal context and payment proof">
                <div className="space-y-3">
                  <textarea
                    value={form.internalNotes}
                    onChange={(event) => updateField("internalNotes", event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Internal notes (finance team)."
                    disabled={readOnly}
                  />
                  <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
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
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <p>Mode: <span className="font-semibold text-slate-800">{form.paymentMode}</span></p>
                    <p>Reference: <span className="font-semibold text-slate-800">{form.referenceNo || "-"}</span></p>
                  </div>
                </div>
              </FlowCard>
            </div>
          ) : null}

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

