import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, FileDown, FileSpreadsheet, Mail, Plus, Save, Search, Send, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE, COUNTRY_OPTIONS, type CountryCode, type PaymentMode, type PaymentStatus } from "../../modules/paymentIn/countryConfig";
import {
  getSelectedPaymentCountry,
  listPaymentIn,
  mapCustomersByCountry,
  mapOpenInvoicesByCountry,
  outstandingByCustomer,
  paymentInsightsByCustomer,
  removePaymentIn,
  savePaymentIn,
  setSelectedPaymentCountry,
  summarizePaymentIn,
  type PaymentInRecord
} from "../../modules/paymentIn/store";
import { allocationsFromInvoices, computeEditorTotals, defaultForm, formFromRecord, formatMoney, parseNumber } from "../../modules/paymentIn/utils";
import { exportPaymentInCsv, exportPaymentInSummaryPdf, exportSinglePaymentInPdf } from "../../modules/paymentIn/pdf";
import type { PaymentInFormState } from "../../modules/paymentIn/types";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { canApplyApprovals, canCreateEntries, canDeleteEntries, canEditEntries, roleTypeLabel } from "../../services/roles";
import { useOrganization } from "../../context/OrganizationContext";
import { invoicesSyncFromRemote } from "../../services/invoices.service";
import { deletePaymentInRemote, syncPaymentInRemote } from "../../services/payments.service";
import { syncPartiesFromRemote } from "../../modules/parties/store";
import FlowCard from "../../modules/paymentIn/FlowCard";
import FlowStepTabs from "../../modules/paymentIn/FlowStepTabs";
import PaymentModePicker from "../../modules/paymentIn/PaymentModePicker";
import PaymentInSkeleton from "../../modules/paymentIn/PaymentInSkeleton";
import AuditDrawer from "../../modules/paymentIn/AuditDrawer";
import { useGlobalLoadingBridge } from "../../hooks/useGlobalLoadingBridge";

const STEPS = ["Customer & Country", "Payment Details", "Review & Confirm"];
const EDIT_WINDOW_MS = 15 * 60 * 1000;

type PanelMode = "feed" | "flow";
type FlowMode = "create" | "edit" | "view";

function roleAccess(role: string, user: any) {
  const canApply = canApplyApprovals(role);
  const configured = Array.isArray(user?.allowedCountries) ? user.allowedCountries.filter((entry: string) => entry in COUNTRY_CONFIG) : [];
  return {
    roleType: roleTypeLabel(role) as "Admin" | "Staff",
    canApply,
    allowedCountries: canApply ? COUNTRY_OPTIONS.map((entry) => entry.code) : configured.length ? configured : (["IN", "SL", "AE"] as CountryCode[])
  };
}

function canReopenWithinWindow(record: PaymentInRecord | null) {
  if (!record || record.status !== "Applied") return false;
  const touched = new Date(record.audit.modifiedAt).getTime();
  return Number.isFinite(touched) && Date.now() - touched <= EDIT_WINDOW_MS;
}

function statusBadgeClass(status: PaymentStatus) {
  if (status === "Applied") return "bg-emerald-100 text-emerald-700";
  if (status === "Received") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function resolveFixedCountry(organizationCountry: string, organizationCountryCode: string): CountryCode {
  const rawCode = String(organizationCountryCode || "").trim().toUpperCase();
  if (rawCode === "LK") return "SL";
  if (rawCode === "GB") return "UK";
  if (rawCode && rawCode in COUNTRY_CONFIG) return rawCode as CountryCode;

  const raw = String(organizationCountry || "").trim();
  if (raw && raw in COUNTRY_CONFIG) return raw as CountryCode;
  if (raw && COUNTRY_NAME_TO_CODE[raw]) return COUNTRY_NAME_TO_CODE[raw];
  const saved = getSelectedPaymentCountry();
  if (saved && saved in COUNTRY_CONFIG) return saved;
  return "IN";
}

function normalizePhoneForLookup(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function customerAddressSummary(customer: any) {
  return [customer?.address, customer?.state, customer?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function numberInputValue(value: unknown) {
  const numeric = parseNumber(value as any);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return String(value ?? "");
}

export default function PaymentInPremium() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile: company = {}, country: organizationCountry, countryCode: organizationCountryCode } = useOrganization();
  const user = authGetUser();
  const role = authGetRole();
  const access = useMemo(() => roleAccess(role, user), [role, user]);
  const canCreatePayment = canCreateEntries(role);
  const canEditPayment = canEditEntries(role);
  const canDeletePayment = canDeleteEntries(role);
  const actorName = user?.name || user?.email || "System User";

  const country = useMemo<CountryCode>(
    () => resolveFixedCountry(organizationCountry, organizationCountryCode),
    [organizationCountry, organizationCountryCode]
  );
  const [panelMode, setPanelMode] = useState<PanelMode>("feed");
  const [flowMode, setFlowMode] = useState<FlowMode>("create");
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState<PaymentInFormState | null>(null);
  const [activePayment, setActivePayment] = useState<PaymentInRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showAudit, setShowAudit] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "">("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  useGlobalLoadingBridge(loading, "payment-in");

  const payments = useMemo(() => listPaymentIn(country), [country, refreshKey]);
  const customers = useMemo(() => mapCustomersByCountry(country), [country, refreshKey]);
  const openInvoices = useMemo(() => mapOpenInvoicesByCountry(country), [country, refreshKey]);
  const summary = useMemo(() => summarizePaymentIn(country), [country, refreshKey]);

  const customerOutstandingBefore = useMemo(() => (form?.customerId ? outstandingByCustomer(country, form.customerId) : 0), [country, form?.customerId, refreshKey]);
  const customerInsights = useMemo(() => (form?.customerId ? paymentInsightsByCustomer(country, form.customerId) : { lastPaymentDate: "", advanceWallet: 0, totalReceived: 0, paymentCount: 0 }), [country, form?.customerId, refreshKey]);
  const totals = useMemo(() => (form ? computeEditorTotals(form, customerOutstandingBefore) : { amountReceived: 0, amountApplied: 0, unappliedAmount: 0, outstandingAfter: 0 }), [form, customerOutstandingBefore]);
  const selectedCustomer = useMemo(() => customers.find((entry) => entry.id === form?.customerId) || null, [customers, form?.customerId]);
  const filteredPayments = useMemo(() => payments.filter((entry) => {
    const haystack = `${entry.customerName} ${entry.receiptNo} ${entry.referenceNo || ""} ${entry.transactionId || ""}`.toLowerCase();
    const q = search.trim().toLowerCase();
    const matchFrom = fromDate ? entry.paymentDate >= fromDate : true;
    const matchTo = toDate ? entry.paymentDate <= toDate : true;
    return (!q || haystack.includes(q)) && (!statusFilter || entry.status === statusFilter) && (!customerFilter || entry.customerId === customerFilter) && (!modeFilter || entry.paymentMode === modeFilter) && matchFrom && matchTo;
  }), [payments, search, statusFilter, customerFilter, modeFilter, fromDate, toDate]);
  const customerLookupResults = useMemo(() => {
    const query = String(customerLookupQuery || "").trim().toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(query);
    return customers
      .filter((customer) => {
        const text = [
          customer?.name,
          customer?.email,
          customer?.address,
          customer?.state,
          customer?.country
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const customerPhone = normalizePhoneForLookup(customer?.phone);
        return (
          text.includes(query) ||
          (normalizedPhoneQuery && customerPhone && customerPhone.includes(normalizedPhoneQuery))
        );
      })
      .slice(0, 8);
  }, [customers, customerLookupQuery]);

  const allowed = access.allowedCountries.includes(country);
  const readOnly = flowMode === "view";
  const prefillInvoiceId = searchParams.get("invoiceId") || "";

  useEffect(() => {
    setSelectedPaymentCountry(country);
  }, [country]);

  useEffect(() => {
    let mounted = true;
    async function syncReferenceData() {
      try {
        await Promise.all([syncPartiesFromRemote(), invoicesSyncFromRemote()]);
      } catch {
        // Continue with local cache.
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
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 180);
    return () => window.clearTimeout(timer);
  }, [country]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!prefillInvoiceId) return;
    const invoice = openInvoices.find((entry) => entry.id === prefillInvoiceId);
    if (!invoice) return;

    const linkedInvoices = openInvoices.filter((entry) => entry.customerId === invoice.customerId);
    const nextAllocations = allocationsFromInvoices(linkedInvoices).map((line) =>
      line.invoiceId === invoice.id ? { ...line, applyAmount: line.balanceDue } : line
    );

    setForm((prev) => {
      const base = prev || defaultForm(country, company);
      return {
        ...base,
        customerId: invoice.customerId,
        customerInput: invoice.customerName,
        allocations: nextAllocations
      };
    });
    setPanelMode("flow");
    setFlowMode("create");
    setActiveStep(1);
    setDirty(false);

    const next = new URLSearchParams(searchParams);
    next.delete("invoiceId");
    setSearchParams(next, { replace: true });
  }, [prefillInvoiceId, openInvoices, country, company, searchParams, setSearchParams]);

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
    setFieldErrors({});
  }

  function startNewPayment() {
    if (!allowed) return;
    if (!canCreatePayment) {
      setErrorMessage("You do not have permission to create payment receipts.");
      setSuccessMessage("");
      return;
    }
    setForm(defaultForm(country, company));
    setActivePayment(null);
    setPanelMode("flow");
    setFlowMode("create");
    setActiveStep(0);
    setDirty(false);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
    setShowMoreActions(false);
    clearMessages();
  }

  function openFlow(record: PaymentInRecord, mode: FlowMode) {
    if (record.country !== country) return;
    if (mode === "edit" && !canEditPayment) {
      setErrorMessage("You do not have permission to edit payment receipts.");
      setSuccessMessage("");
      return;
    }
    if (mode === "edit" && record.status === "Applied" && !canReopenWithinWindow(record)) return;
    setForm(formFromRecord(record));
    setActivePayment(record);
    setPanelMode("flow");
    setFlowMode(mode);
    setActiveStep(mode === "view" ? 2 : 0);
    setDirty(false);
    setShowMoreActions(false);
    clearMessages();
  }

  function backToFeed() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setPanelMode("feed");
    setFlowMode("create");
    setActiveStep(0);
    setForm(null);
    setActivePayment(null);
    setDirty(false);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
    setShowMoreActions(false);
    clearMessages();
  }

  function updateForm<K extends keyof PaymentInFormState>(key: K, value: PaymentInFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  function applyCustomer(customerId: string, inputName?: string) {
    const customer = customers.find((entry) => entry.id === customerId);
    const linkedInvoices = openInvoices.filter((invoice) => invoice.customerId === customerId);
    setForm((prev) =>
      prev
        ? {
            ...prev,
            customerId,
            customerInput: inputName || customer?.name || prev.customerInput,
            registrationNumber: customer?.registrationNumber || prev.registrationNumber,
            allocations: allocationsFromInvoices(linkedInvoices)
          }
        : prev
    );
    setDirty(true);
  }

  function applyCustomerSelection(customer: any) {
    if (!customer) return;
    applyCustomer(customer.id, customer.name);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
  }

  function handleCustomerLookupChange(value: string) {
    setCustomerLookupQuery(value);
    setCustomerSearchError("");
  }

  function handleCustomerSearch() {
    const query = String(customerLookupQuery || "").trim();
    if (query.length < 2) {
      setCustomerSearchError("Enter at least 2 characters to search.");
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
    setForm((prev) =>
      prev
        ? {
            ...prev,
            customerId: "",
            customerInput: "",
            allocations: []
          }
        : prev
    );
    setDirty(true);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
  }

  function setAllocateAmount(totalAllocate: number) {
    setForm((prev) => {
      if (!prev) return prev;
      const amountReceived = Math.max(0, parseNumber(prev.amountReceived));
      let remaining = Math.min(Math.max(0, totalAllocate), amountReceived);
      const nextAllocations = prev.allocations.map((line) => {
        const applyAmount = Math.min(line.balanceDue, remaining);
        remaining -= applyAmount;
        return { ...line, applyAmount };
      });
      return { ...prev, allocations: nextAllocations };
    });
    setDirty(true);
  }

  function validate(targetStatus: PaymentStatus) {
    if (!form) return false;
    const cfg = COUNTRY_CONFIG[country];
    const errors: Record<string, string> = {};
    const amountReceived = Math.max(0, parseNumber(form.amountReceived));
    const amountApplied = form.allocations.reduce((sum, line) => sum + Math.max(0, parseNumber(line.applyAmount)), 0);

    if (!form.paymentDate) errors.paymentDate = "Payment date is required.";
    if (!form.customerId) errors.customerId = "Customer is required.";
    if (amountReceived <= 0) errors.amountReceived = "Amount received must be greater than zero.";
    if (cfg.registrationRequired && !form.registrationNumber.trim()) errors.registrationNumber = `${cfg.registrationLabel} is required.`;
    if (cfg.registrationRegex && form.registrationNumber.trim() && !cfg.registrationRegex.test(form.registrationNumber.trim())) errors.registrationNumber = `Invalid ${cfg.registrationLabel} format.`;
    if (form.paymentMode === "Cheque") {
      if (!form.chequeNo.trim()) errors.chequeNo = "Cheque number is required.";
      if (!form.bankName.trim()) errors.bankName = "Bank name is required.";
    }
    if (form.paymentMode === "Bank Transfer" && !form.bankAccount.trim()) errors.bankAccount = "Bank account is required.";
    if ((form.paymentMode === "Bank Transfer" || form.paymentMode === "Card" || form.paymentMode === "UPI" || form.paymentMode === "Online Gateway") && !form.transactionId.trim()) errors.transactionId = "Transaction ID is required.";
    if (form.allocations.some((line) => parseNumber(line.applyAmount) > line.balanceDue)) errors.allocations = "Apply amount cannot exceed invoice balance due.";
    if (amountApplied > amountReceived) errors.allocations = "Applied amount cannot exceed amount received.";
    if (targetStatus === "Applied" && !access.canApply) {
      errors.workflow = "You do not have approval permission to apply payments to invoices.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      if (errors.customerId) {
        setActiveStep(0);
      } else if (
        errors.amountReceived ||
        errors.allocations ||
        errors.paymentDate ||
        errors.registrationNumber ||
        errors.chequeNo ||
        errors.bankName ||
        errors.bankAccount ||
        errors.transactionId
      ) {
        setActiveStep(1);
      }
      setErrorMessage(Object.values(errors)[0] || "Please fix the highlighted fields before saving.");
      setSuccessMessage("");
      return false;
    }
    return true;
  }

  function buildPayload(targetStatus: PaymentStatus, outstandingOverride?: number) {
    if (!form) return null;
    const customer = customers.find((entry) => entry.id === form.customerId);
    return {
      id: form.id,
      country,
      paymentDate: form.paymentDate,
      customerId: form.customerId,
      customerName: customer?.name || form.customerInput || "Customer",
      paymentMode: form.paymentMode,
      referenceNo: form.referenceNo,
      chequeNo: form.chequeNo,
      bankName: form.bankName,
      bankAccount: form.bankAccount,
      transactionId: form.transactionId,
      paymentReference: form.paymentReference,
      registrationNumber: form.registrationNumber,
      internalNotes: form.internalNotes,
      customerNotes: form.customerNotes,
      attachment: form.attachment,
      desiredStatus: targetStatus,
      amountReceived: parseNumber(form.amountReceived),
      allocations: form.allocations,
      customerOutstandingBefore: typeof outstandingOverride === "number" ? outstandingOverride : customerOutstandingBefore,
      actor: actorName
    };
  }

  async function persist(targetStatus: PaymentStatus, options?: { email?: boolean; download?: boolean }) {
    if (!form) return;
    const isEditMode = !!form?.id;
    if (isEditMode && !canEditPayment) {
      setErrorMessage("You do not have permission to edit payment receipts.");
      setSuccessMessage("");
      return;
    }
    if (!isEditMode && !canCreatePayment) {
      setErrorMessage("You do not have permission to create payment receipts.");
      setSuccessMessage("");
      return;
    }
    if (!validate(targetStatus)) return;
    try {
      let saved: PaymentInRecord | null = null;
      const canDirectApply = !!activePayment && activePayment.status === "Received";
      if (targetStatus === "Applied" && !canDirectApply) {
        const stagedPayload = buildPayload("Received");
        if (!stagedPayload) return;
        const staged = savePaymentIn(stagedPayload);
        const applyPayload = { ...stagedPayload, id: staged.id, desiredStatus: "Applied" as PaymentStatus, customerOutstandingBefore: staged.totals.customerOutstandingBefore };
        saved = savePaymentIn(applyPayload);
      } else {
        const payload = buildPayload(targetStatus);
        if (!payload) return;
        saved = savePaymentIn(payload);
      }
      if (!saved) return;
      await syncPaymentInRemote(saved);
      if (options?.download) exportSinglePaymentInPdf(saved);
      if (options?.email) window.alert(`Email queued for ${saved.receiptNo}.`);
      setRefreshKey((prev) => prev + 1);
      setActivePayment(saved);
      setForm(formFromRecord(saved));
      setFlowMode("edit");
      setActiveStep(2);
      setDirty(false);
      setSuccessMessage(`${saved.receiptNo} saved as ${saved.status}.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to save payment.");
    }
  }

  async function undoApplied(record: PaymentInRecord) {
    if (!canReopenWithinWindow(record)) return;
    if (!canEditPayment) {
      setErrorMessage("You do not have permission to edit payment receipts.");
      setSuccessMessage("");
      return;
    }
    try {
      const saved = savePaymentIn({
        id: record.id,
        country: record.country,
        paymentDate: record.paymentDate,
        customerId: record.customerId,
        customerName: record.customerName,
        paymentMode: record.paymentMode,
        referenceNo: record.referenceNo,
        chequeNo: record.chequeNo,
        bankName: record.bankName,
        bankAccount: record.bankAccount,
        transactionId: record.transactionId,
        paymentReference: record.paymentReference,
        registrationNumber: record.registrationNumber,
        internalNotes: record.internalNotes,
        customerNotes: record.customerNotes,
        attachment: record.attachment,
        desiredStatus: "Received",
        amountReceived: record.totals.amountReceived,
        allocations: record.allocations,
        customerOutstandingBefore: record.totals.customerOutstandingBefore,
        actor: actorName
      });
      await syncPaymentInRemote(saved);
      setRefreshKey((prev) => prev + 1);
      setSuccessMessage(`${saved.receiptNo} reopened as Received.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to undo apply.");
    }
  }

  async function removeRecord(record: PaymentInRecord) {
    if (!canDeletePayment) {
      setErrorMessage("You do not have permission to delete payment receipts.");
      setSuccessMessage("");
      return;
    }
    if (record.status === "Applied") {
      setErrorMessage("Applied payment receipts cannot be deleted.");
      setSuccessMessage("");
      return;
    }
    const confirmed = window.confirm(`Delete ${record.receiptNo}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      removePaymentIn(record.id);
      await deletePaymentInRemote(record.id);
      if (activePayment?.id === record.id) {
        setPanelMode("feed");
        setFlowMode("create");
        setActiveStep(0);
        setForm(null);
        setActivePayment(null);
        setDirty(false);
      }
      setRefreshKey((prev) => prev + 1);
      setSuccessMessage(`${record.receiptNo} deleted successfully.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to delete payment receipt.");
      setSuccessMessage("");
    }
  }

  const confirmStatus: PaymentStatus = access.canApply && totals.amountApplied > 0 ? "Applied" : "Received";
  const canSaveCurrentFlow = form?.id ? canEditPayment : canCreatePayment;

  return (
    <div className="mx-auto min-h-full max-w-[1360px] space-y-4 pb-36">
      <div className="z-30 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white/95 to-slate-50/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">Payment In</p>
            <p className="text-xs text-slate-500">Receive money from customers</p>
          </div>
          <div className="mx-auto w-full max-w-xs rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-700 sm:mx-0 sm:flex-1 sm:max-w-sm">
            {COUNTRY_CONFIG[country].name} | {COUNTRY_CONFIG[country].currency}
          </div>
          <button onClick={startNewPayment} disabled={!allowed || !canCreatePayment} className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="h-4 w-4" />
            New Payment
          </button>
        </div>
      </div>

      {!allowed ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have access to manage {COUNTRY_CONFIG[country].name} data.</div>
      ) : (
        <div className="space-y-4">
          {panelMode === "feed" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FlowCard title="Total Payments" subtitle="Count of receipts">{loading ? <PaymentInSkeleton /> : <p className="text-2xl font-bold text-slate-900">{summary?.count || 0}</p>}</FlowCard>
                <FlowCard title="Total Received" subtitle="Across all statuses"><p className="text-2xl font-bold text-slate-900">{formatMoney(summary?.totalReceived || 0, country)}</p></FlowCard>
                <FlowCard title="Unallocated" subtitle="Advance wallet value"><p className="text-2xl font-bold text-amber-700">{formatMoney(summary?.totalUnallocated || 0, country)}</p></FlowCard>
              </div>

              <FlowCard>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, receipt, reference" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200" />
                  <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"><option value="">All Customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>
                  <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"><option value="">All Modes</option>{COUNTRY_CONFIG[country].paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PaymentStatus | "")} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"><option value="">All Status</option><option value="Draft">Draft</option><option value="Received">Received</option><option value="Applied">Applied</option></select>
                  <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200" />
                  <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => exportPaymentInSummaryPdf(filteredPayments, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><FileDown className="h-3.5 w-3.5" />Summary PDF</button>
                  <button onClick={() => exportPaymentInCsv(filteredPayments, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><FileSpreadsheet className="h-3.5 w-3.5" />CSV</button>
                </div>
              </FlowCard>

              {loading ? (
                <PaymentInSkeleton />
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="min-w-[980px] w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-3 font-semibold">Receipt No</th>
                        <th className="px-3 py-3 font-semibold">Date</th>
                        <th className="px-3 py-3 font-semibold">Customer</th>
                        <th className="px-3 py-3 font-semibold">Mode</th>
                        <th className="px-3 py-3 font-semibold text-right">Received</th>
                        <th className="px-3 py-3 font-semibold text-right">Applied</th>
                        <th className="px-3 py-3 font-semibold">Status</th>
                        <th className="px-3 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!filteredPayments.length ? (
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                            No payments found. Create a new payment to get started.
                          </td>
                        </tr>
                      ) : (
                        filteredPayments.map((record) => (
                          <tr key={record.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                            <td className="px-3 py-3 font-semibold text-slate-900">{record.receiptNo}</td>
                            <td className="px-3 py-3 text-slate-600">{record.paymentDate || "-"}</td>
                            <td className="px-3 py-3 text-slate-700">{record.customerName || "-"}</td>
                            <td className="px-3 py-3 text-slate-600">{record.paymentMode}</td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                              {formatMoney(record?.totals?.amountReceived || 0, country)}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {formatMoney(record?.totals?.amountApplied || 0, country)}
                            </td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(record.status)}`}>
                                {record.status}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => openFlow(record, "view")}
                                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openFlow(record, "edit")}
                                  disabled={!canEditPayment || (record.status === "Applied" && !canReopenWithinWindow(record))}
                                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => exportSinglePaymentInPdf(record)}
                                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  PDF
                                </button>
                                {canReopenWithinWindow(record) ? (
                                  <button
                                    type="button"
                                    onClick={() => undoApplied(record)}
                                    disabled={!canEditPayment}
                                    className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Undo
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => removeRecord(record)}
                                  disabled={!canDeletePayment || record.status === "Applied"}
                                  className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}

          {panelMode === "flow" && form ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button onClick={backToFeed} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><ArrowLeft className="h-4 w-4" />Back</button>
                <button onClick={() => setShowAudit(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Audit Timeline</button>
              </div>

              <FlowStepTabs steps={STEPS} activeStep={activeStep} onChange={setActiveStep} />

              {activeStep === 0 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <FlowCard title="Country Context" subtitle="Auto updates currency, label and legal wording">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">{COUNTRY_CONFIG[country].name}</div>
                      <p className="text-sm text-slate-700">Currency: <span className="font-semibold">{COUNTRY_CONFIG[country].currency}</span></p>
                      <p className="text-sm text-slate-700">Receipt Label: <span className="font-semibold">{COUNTRY_CONFIG[country].receiptLabel}</span></p>
                      <p className="text-xs text-slate-500">Payment In is locked to {COUNTRY_CONFIG[country].name}.</p>
                      <p className="text-xs text-slate-500">{COUNTRY_CONFIG[country].legalWording}</p>
                    </div>
                  </FlowCard>

                  <FlowCard title="Customer" subtitle="Search and pick a customer to begin">
                    <div className="space-y-3">
                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-600">Customer Search</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={customerLookupQuery}
                            onChange={(event) => handleCustomerLookupChange(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleCustomerSearch();
                              }
                            }}
                            placeholder="Search customer/supplier by name, phone, email, or address"
                            disabled={readOnly}
                            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:bg-slate-100"
                          />
                          <button
                            type="button"
                            onClick={handleCustomerSearch}
                            disabled={readOnly}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Search className="h-3.5 w-3.5" />
                            Search
                          </button>
                        </div>
                        {customerSearchError ? (
                          <p className="text-xs font-medium text-rose-600">{customerSearchError}</p>
                        ) : null}
                        {customerLookupQuery.trim() ? (
                          customerLookupResults.length ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {customerLookupResults.map((customer) => (
                                <button
                                  key={customer.id}
                                  type="button"
                                  onClick={() => applyCustomerSelection(customer)}
                                  disabled={readOnly}
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
                      </div>
                      {selectedCustomer ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                          <p className="font-semibold text-slate-900">{selectedCustomer.name || "-"}</p>
                          <p className="mt-1 text-slate-500">{selectedCustomer.phone || "-"}</p>
                          <p className="mt-1 text-slate-500">{selectedCustomer.email || "-"}</p>
                          <p className="mt-1 text-slate-500">{customerAddressSummary(selectedCustomer) || "-"}</p>
                        </div>
                      ) : null}
                      {form.customerId ? (
                        <button
                          type="button"
                          onClick={resetCustomerSelection}
                          disabled={readOnly}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Clear Selection
                        </button>
                      ) : null}
                      {fieldErrors.customerId ? <p className="text-xs text-rose-600">{fieldErrors.customerId}</p> : null}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">Outstanding</p><p className="font-semibold text-slate-900">{formatMoney(customerOutstandingBefore, country)}</p></div>
                        <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">Last Payment</p><p className="font-semibold text-slate-900">{customerInsights.lastPaymentDate || "-"}</p></div>
                        <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">Advance Wallet</p><p className="font-semibold text-amber-700">{formatMoney(customerInsights.advanceWallet, country)}</p></div>
                      </div>
                    </div>
                  </FlowCard>
                </div>
              ) : null}

              {activeStep === 1 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <FlowCard title="Payment Details" subtitle="Core details for this receipt">
                    <div className="space-y-3">
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Amount Received</span>
                        <input
                          type="number"
                          min={0}
                          value={numberInputValue(form.amountReceived)}
                          placeholder="0"
                          disabled={readOnly}
                          onChange={(event) => updateForm("amountReceived", event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-2xl font-bold text-slate-900 outline-none focus:ring-4 focus:ring-slate-200"
                        />
                        {fieldErrors.amountReceived ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.amountReceived}</p> : null}
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Allocate</span>
                        <input
                          type="number"
                          min={0}
                          value={numberInputValue(totals.amountApplied)}
                          disabled={readOnly || !form.customerId || !form.allocations.length}
                          onChange={(event) => setAllocateAmount(parseNumber(event.target.value))}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50"
                          placeholder="0"
                        />
                        <p className="mt-1 text-xs text-slate-500">
                          Unapplied: <span className="font-semibold text-slate-700">{formatMoney(totals.unappliedAmount, country)}</span>
                        </p>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Payment Date</span>
                        <input type="date" value={form.paymentDate} disabled={readOnly} onChange={(event) => updateForm("paymentDate", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                        {fieldErrors.paymentDate ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.paymentDate}</p> : null}
                      </label>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-600">Payment Mode</p>
                        <PaymentModePicker options={COUNTRY_CONFIG[country].paymentModes} value={form.paymentMode} onChange={(mode) => updateForm("paymentMode", mode as PaymentMode)} />
                      </div>
                    </div>
                  </FlowCard>

                  <FlowCard title="Mode Specific Fields" subtitle="Details vary by selected payment mode">
                    <div className="space-y-3">
                      <input value={form.referenceNo} disabled={readOnly} onChange={(event) => updateForm("referenceNo", event.target.value)} placeholder="Payment Reference" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      {form.paymentMode === "Cheque" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div><input value={form.chequeNo} disabled={readOnly} onChange={(event) => updateForm("chequeNo", event.target.value)} placeholder="Cheque No" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.chequeNo ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.chequeNo}</p> : null}</div>
                          <div><input value={form.bankName} disabled={readOnly} onChange={(event) => updateForm("bankName", event.target.value)} placeholder="Bank Name" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.bankName ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.bankName}</p> : null}</div>
                        </div>
                      ) : null}
                      {form.paymentMode === "Bank Transfer" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div><input value={form.bankAccount} disabled={readOnly} onChange={(event) => updateForm("bankAccount", event.target.value)} placeholder="Bank Account" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.bankAccount ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.bankAccount}</p> : null}</div>
                          <div><input value={form.transactionId} disabled={readOnly} onChange={(event) => updateForm("transactionId", event.target.value)} placeholder="Transaction ID" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.transactionId}</p> : null}</div>
                        </div>
                      ) : null}
                      {(form.paymentMode === "Card" || form.paymentMode === "UPI" || form.paymentMode === "Online Gateway") ? <div><input value={form.transactionId} disabled={readOnly} onChange={(event) => updateForm("transactionId", event.target.value)} placeholder="Transaction ID" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.transactionId}</p> : null}</div> : null}
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">{COUNTRY_CONFIG[country].registrationLabel}</span>
                        <input value={form.registrationNumber} disabled={readOnly} onChange={(event) => updateForm("registrationNumber", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      </label>
                      <label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                        <input type="file" disabled={readOnly} onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          updateForm("attachment", file ? { name: file.name, size: file.size, type: file.type || "application/octet-stream" } : null);
                        }} className="hidden" />
                        Drag & drop payment proof or click to upload
                        {form.attachment ? <p className="mt-2 text-xs font-semibold text-slate-700">{form.attachment.name}</p> : null}
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Internal Notes</span>
                        <textarea
                          value={form.internalNotes}
                          disabled={readOnly}
                          onChange={(event) => updateForm("internalNotes", event.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          placeholder="Visible to finance team only"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Customer Notes</span>
                        <textarea
                          value={form.customerNotes}
                          disabled={readOnly}
                          onChange={(event) => updateForm("customerNotes", event.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          placeholder="Shown in receipt PDF"
                        />
                      </label>
                    </div>
                  </FlowCard>
                </div>
              ) : null}

              {activeStep === 2 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                  <FlowCard title="Review & Confirm" subtitle="Final check before posting this payment">
                    <div className="space-y-3 text-sm">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Customer</p>
                        <p className="font-semibold text-slate-900">{selectedCustomer?.name || form.customerInput || "-"}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {COUNTRY_CONFIG[country].name} | {COUNTRY_CONFIG[country].currency}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Amount Received</p>
                          <p className="text-base font-semibold text-slate-900">{formatMoney(totals.amountReceived, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Amount Applied</p>
                          <p className="text-base font-semibold text-slate-900">{formatMoney(totals.amountApplied, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Unapplied</p>
                          <p className="text-base font-semibold text-amber-700">{formatMoney(totals.unappliedAmount, country)}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Extra received amount not yet linked to any invoice.
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Payment Mode</p>
                          <p className="text-base font-semibold text-slate-900">{form.paymentMode}</p>
                        </div>
                      </div>
                      {totals.unappliedAmount > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Unapplied Amount means the payment received is greater than the amount applied to invoices. The extra amount stays available until it is adjusted to another invoice.
                        </div>
                      ) : null}
                    </div>
                  </FlowCard>

                  <FlowCard title="Receipt Snapshot" subtitle="Country wording + legal labels">
                    <div className="space-y-3">
                      <p className="text-xs text-slate-500">{COUNTRY_CONFIG[country].receiptLabel}</p>
                      <p className="text-3xl font-bold tracking-tight text-slate-900">{formatMoney(totals.amountReceived, country)}</p>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <p>{COUNTRY_CONFIG[country].legalWording}</p>
                        <p className="mt-2">
                          {COUNTRY_CONFIG[country].registrationLabel}:{" "}
                          <span className="font-semibold text-slate-800">{form.registrationNumber || "-"}</span>
                        </p>
                      </div>
                      {activePayment ? (
                        <button
                          type="button"
                          onClick={() => exportSinglePaymentInPdf(activePayment)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          Download Current PDF
                        </button>
                      ) : null}
                    </div>
                  </FlowCard>
                </div>
              ) : null}

              {fieldErrors.workflow ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {fieldErrors.workflow}
                </div>
              ) : null}
              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              ) : null}
              {successMessage ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {successMessage}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {panelMode === "flow" && form && !readOnly ? (
        <div className="fixed bottom-4 right-4 z-40 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => persist("Draft")}
            disabled={!canSaveCurrentFlow}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => persist(confirmStatus)}
            disabled={!canSaveCurrentFlow}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Mark Paid
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreActions((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              More
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showMoreActions ? (
              <div className="absolute bottom-full right-0 mb-2 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreActions(false);
                    persist("Applied");
                  }}
                  disabled={!access.canApply || !canSaveCurrentFlow}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply to Bills
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreActions(false);
                    if (activePayment) {
                      exportSinglePaymentInPdf(activePayment);
                      return;
                    }
                    persist(confirmStatus, { download: true });
                  }}
                  disabled={!canSaveCurrentFlow}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreActions(false);
                    persist(confirmStatus, { email: true });
                  }}
                  disabled={!canSaveCurrentFlow}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Email Receipt
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <AuditDrawer open={showAudit} record={activePayment} onClose={() => setShowAudit(false)} />
    </div>
  );
}
