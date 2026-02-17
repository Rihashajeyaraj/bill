import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileDown, FileSpreadsheet, Plus } from "lucide-react";
import CountrySelector from "../../modules/creditNote/CountrySelector";
import CreditNoteSkeleton from "../../modules/creditNote/CreditNoteSkeleton";
import CreditNoteListTable from "../../modules/creditNote/CreditNoteListTable";
import CreditNoteEditor from "../../modules/creditNote/CreditNoteEditor";
import {
  COUNTRY_CONFIG,
  COUNTRY_NAME_TO_CODE,
  COUNTRY_OPTIONS,
  type CountryCode,
  type CreditStatus
} from "../../modules/creditNote/countryConfig";
import {
  getCreditNote,
  getSelectedCreditCountry,
  listCreditNotes,
  mapCustomersByCountry,
  mapInvoicesByCountry,
  saveCreditNote,
  setSelectedCreditCountry,
  summarizeCreditNotes,
  type CreditInvoice,
  type CreditNoteRecord
} from "../../modules/creditNote/store";
import { computeEditorTotals, defaultForm, draftLinesFromInvoice, formFromNote, formatMoney, parseNumber } from "../../modules/creditNote/utils";
import { exportCreditNoteSummaryPdf, exportCreditNotesCsv, exportSingleCreditNotePdf } from "../../modules/creditNote/pdf";
import type { CreditNoteFormState } from "../../modules/creditNote/types";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { companyGetProfile } from "../../services/company.service";
import EmptyState from "../../components/EmptyState";
import GradientButton from "../../components/GradientButton";
import { UI } from "../../theme/tokens";
import { useGlobalLoadingBridge } from "../../hooks/useGlobalLoadingBridge";

type ViewMode = "list" | "create" | "edit" | "view";

function roleAccess(role: string, user: any) {
  const normalized = String(role || "").toLowerCase();
  const isAdmin =
    normalized.includes("owner") ||
    normalized.includes("manager") ||
    normalized.includes("accounter") ||
    normalized.includes("accountant") ||
    normalized.includes("admin");
  if (isAdmin) {
    return { roleType: "Admin" as const, canApply: true, canOverride: true, allowedCountries: COUNTRY_OPTIONS.map((country) => country.code) };
  }
  const configured = Array.isArray(user?.allowedCountries) ? user.allowedCountries.filter((entry: string) => entry in COUNTRY_CONFIG) : [];
  return { roleType: "Staff" as const, canApply: false, canOverride: false, allowedCountries: configured.length ? configured : (["IN", "SL", "AE"] as CountryCode[]) };
}

export default function CreditNotePremium() {
  const company = companyGetProfile();
  const user = authGetUser();
  const role = authGetRole();
  const access = useMemo(() => roleAccess(role, user), [role, user]);
  const actorName = user?.name || user?.email || "System User";
  const companyState = company?.address?.state || "";

  function resolveInitialCountry(): CountryCode | "" {
    const saved = getSelectedCreditCountry();
    if (saved && access.allowedCountries.includes(saved)) return saved;

    const companyCountryRaw = company?.country || company?.address?.country || "";
    const mappedCompanyCountry =
      (companyCountryRaw in COUNTRY_CONFIG
        ? (companyCountryRaw as CountryCode)
        : COUNTRY_NAME_TO_CODE[String(companyCountryRaw || "").trim()]) || "";
    if (mappedCompanyCountry && access.allowedCountries.includes(mappedCompanyCountry)) {
      return mappedCompanyCountry;
    }
    return access.allowedCountries[0] || "";
  }

  const [country, setCountry] = useState<CountryCode | "">(resolveInitialCountry);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<CreditNoteFormState | null>(null);
  const [activeNote, setActiveNote] = useState<CreditNoteRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CreditStatus | "">("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  useGlobalLoadingBridge(loading || editorLoading || switching, "credit-note");

  const notes = useMemo(() => (country ? listCreditNotes(country) : []), [country, refreshKey]);
  const invoices = useMemo(() => (country ? mapInvoicesByCountry(country) : []), [country, refreshKey]);
  const customers = useMemo(() => (country ? mapCustomersByCountry(country) : []), [country, refreshKey]);
  const summary = useMemo(() => (country ? summarizeCreditNotes(country) : null), [country, refreshKey]);
  const selectedInvoice: CreditInvoice | null = useMemo(() => invoices.find((invoice) => invoice.id === form?.linkedInvoiceId) || null, [invoices, form?.linkedInvoiceId]);
  const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === form?.customerId) || null, [customers, form?.customerId]);
  const totals = useMemo(() => (form && country ? computeEditorTotals(form, country, selectedInvoice?.remainingBalance || 0, companyState) : { detailed: [], subtotal: 0, taxTotal: 0, total: 0, remaining: 0, cgst: 0, sgst: 0, igst: 0 }), [form, country, selectedInvoice?.remainingBalance, companyState]);
  const allowed = !country || access.allowedCountries.includes(country);

  useEffect(() => {
    if (!country) return;
    setSelectedCreditCountry(country);
  }, [country]);

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 220);
    return () => window.clearTimeout(timer);
  }, [country, refreshKey]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const filteredNotes = useMemo(
    () =>
      notes.filter((note) => {
        const haystack = `${note.customerName} ${note.linkedInvoiceNo} ${note.creditNoteNo}`.toLowerCase();
        const matchSearch = search.trim() ? haystack.includes(search.trim().toLowerCase()) : true;
        const matchStatus = statusFilter ? note.status === statusFilter : true;
        const matchCustomer = customerFilter ? note.customerId === customerFilter : true;
        const matchFrom = fromDate ? note.creditNoteDate >= fromDate : true;
        const matchTo = toDate ? note.creditNoteDate <= toDate : true;
        return matchSearch && matchStatus && matchCustomer && matchFrom && matchTo;
      }),
    [notes, search, statusFilter, customerFilter, fromDate, toDate]
  );

  function onCountryChange(next: CountryCode) {
    if (next === country) return;
    if (dirty && !window.confirm("Discard unsaved changes and switch country?")) return;
    setSwitching(true);
    window.setTimeout(() => {
      setCountry(next);
      setSelectedCreditCountry(next);
      setViewMode("list");
      setForm(null);
      setActiveNote(null);
      setDirty(false);
      setFieldErrors({});
      setErrorMessage("");
      setSuccessMessage("");
      setPage(1);
      setSwitching(false);
    }, 180);
  }

  function startCreate() {
    if (!country || !allowed) return;
    setEditorLoading(true);
    setForm(defaultForm(country, company));
    setActiveNote(null);
    setFieldErrors({});
    setErrorMessage("");
    setSuccessMessage("");
    setDirty(false);
    setViewMode("create");
    window.setTimeout(() => setEditorLoading(false), 260);
  }

  function openNote(noteId: string, mode: "view" | "edit") {
    const note = getCreditNote(noteId);
    if (!note || !country || note.country !== country) return;
    if (mode === "edit" && note.status === "Applied") return;
    setEditorLoading(true);
    setForm(formFromNote(note));
    setActiveNote(note);
    setDirty(false);
    setFieldErrors({});
    setErrorMessage("");
    setSuccessMessage("");
    setViewMode(mode);
    window.setTimeout(() => setEditorLoading(false), 260);
  }

  function backToList() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setViewMode("list");
    setActiveNote(null);
    setForm(null);
    setDirty(false);
    setFieldErrors({});
  }

  function updateForm<K extends keyof CreditNoteFormState>(key: K, value: CreditNoteFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  function applyInvoice(invoiceId: string) {
    if (!invoiceId) {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              linkedInvoiceId: "",
              lines: []
            }
          : prev
      );
      setDirty(true);
      return;
    }
    const invoice = invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) return;
    setForm((prev) => (prev ? { ...prev, linkedInvoiceId: invoiceId, customerId: invoice.customerId, customerInput: invoice.customerName, placeOfSupply: invoice.placeOfSupply || prev.placeOfSupply, taxRate: invoice.lines[0]?.taxRate || prev.taxRate, lines: draftLinesFromInvoice(invoice) } : prev));
    setDirty(true);
  }

  function updateLine(id: string, patch: any) {
    setForm((prev) => (prev ? { ...prev, lines: prev.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) } : prev));
    setDirty(true);
  }

  function addLine() {
    setForm((prev) => (prev ? { ...prev, lines: [...prev.lines, { id: `line_${Date.now().toString(16)}`, itemName: "", quantity: 1, rate: 0, taxRate: prev.taxRate, hsnSac: "", creditType: "Percentage", creditValue: 0 }] } : prev));
    setDirty(true);
  }

  function removeLine(id: string) {
    setForm((prev) => (prev ? { ...prev, lines: prev.lines.filter((line) => line.id !== id) } : prev));
    setDirty(true);
  }

  function validate(targetStatus: CreditStatus) {
    if (!form || !country) return false;
    const errors: Record<string, string> = {};
    if (!form.creditNoteDate) errors.creditNoteDate = "Credit note date is required.";
    if (!form.customerId) errors.customerId = "Customer is required.";
    if (!form.linkedInvoiceId) errors.linkedInvoiceId = "Linked invoice is mandatory.";
    if (country === "IN" && form.lines.some((line) => !line.hsnSac?.trim())) errors.lines = "HSN/SAC is mandatory for India.";
    if ((totals as any).detailed?.some((line: any) => line.validationMessage)) errors.lines = "Credit cannot exceed amount after tax.";
    if (form.creditType === "Partial Credit" && parseNumber(form.partialAmountCap) <= 0) errors.partialAmountCap = "Partial credit amount is required.";
    if (!form.lines.length) errors.lines = "At least one line item is required.";
    if (totals.total <= 0) errors.totals = "Total credit must be greater than zero.";
    if (targetStatus === "Applied" && !access.canApply) errors.workflow = "Only Admin can apply credits.";
    if (targetStatus === "Applied" && activeNote?.status === "Draft") errors.workflow = "Issue before apply.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setErrorMessage(Object.values(errors)[0] || "Please fix the highlighted fields before saving.");
      setSuccessMessage("");
      return false;
    }
    return true;
  }

  function persist(targetStatus: CreditStatus, options?: { email?: boolean; download?: boolean }) {
    if (!form || !country) return;
    if (!validate(targetStatus)) return;
    try {
      const saved = saveCreditNote({
        id: form.id,
        country,
        creditNoteDate: form.creditNoteDate,
        customerId: form.customerId,
        customerName: selectedCustomer?.name || form.customerInput || "Customer",
        linkedInvoiceId: form.linkedInvoiceId,
        linkedInvoiceNo: selectedInvoice?.invoiceNo || "",
        linkedInvoiceDate: selectedInvoice?.invoiceDate || "",
        reason: form.reason,
        creditType: form.creditType,
        desiredStatus: targetStatus,
        taxRate: form.taxRate,
        placeOfSupply: form.placeOfSupply,
        registrationNumber: form.registrationNumber,
        hmrcReference: form.hmrcReference,
        salesTaxState: form.salesTaxState,
        internalNotes: form.internalNotes,
        customerNotes: form.customerNotes,
        returnToStock: form.returnToStock,
        discountPercent: parseNumber(form.discountPercent),
        partialAmountCap: parseNumber(form.partialAmountCap),
        priceAdjustmentAmount: parseNumber(form.priceAdjustmentAmount),
        invoiceBalanceBefore: selectedInvoice?.remainingBalance || 0,
        lines: form.lines,
        actor: actorName
      });

      if (options?.download) exportSingleCreditNotePdf(saved);
      if (options?.email) window.alert(`Email queued for ${saved.creditNoteNo}.`);
      setRefreshKey((prev) => prev + 1);
      setActiveNote(saved);
      setForm(formFromNote(saved));
      setDirty(false);
      setViewMode("edit");
      setSuccessMessage(`${saved.creditNoteNo} saved as ${saved.status}.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to save credit note.");
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-[1440px] flex-col gap-3">
      {country ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Country Context</p>
              <p className="text-xs text-slate-500">Credit Note is locked to the selected country.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              {COUNTRY_CONFIG[country].flag} {COUNTRY_CONFIG[country].name}
            </div>
          </div>
        </div>
      ) : (
        <CountrySelector value={country} onChange={onCountryChange} />
      )}

      {!country ? (
        <EmptyState icon={AlertTriangle} title="Select a country to continue" description="Country is mandatory before creating or viewing credit notes." />
      ) : (
        <div className={`min-h-0 flex flex-1 flex-col gap-3 transition-all duration-300 ${switching ? "translate-y-1 opacity-40" : "opacity-100"}`}>
          {!allowed ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have access to manage {COUNTRY_CONFIG[country].name} data.</div> : null}

          {viewMode === "list" ? (
            <div className="min-h-0 overflow-y-auto pr-1 pb-2">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Credit Notes</p><p className="mt-3 text-2xl font-bold text-slate-900">{summary?.count || 0}</p></div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Credited Amount</p><p className="mt-3 text-2xl font-bold text-slate-900">{formatMoney(summary?.totalAmount || 0, country)}</p></div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applied vs Pending</p><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="text-emerald-700 font-semibold">{formatMoney(summary?.appliedAmount || 0, country)}</p><p className="text-amber-700 font-semibold">{formatMoney(summary?.pendingAmount || 0, country)}</p></div></div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="text-xs font-semibold text-slate-600">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer / invoice" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                    <label className="text-xs font-semibold text-slate-600">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CreditStatus | "")} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All</option><option value="Draft">Draft</option><option value="Issued">Issued</option><option value="Applied">Applied</option></select></label>
                    <label className="text-xs font-semibold text-slate-600">Customer<select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-600">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                    <label className="text-xs font-semibold text-slate-600">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <GradientButton onClick={startCreate}><Plus className="h-4 w-4" />Create Credit Note</GradientButton>
                    <button onClick={() => exportCreditNoteSummaryPdf(filteredNotes, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><FileDown className="h-4 w-4" />Export PDF</button>
                    <button onClick={() => exportCreditNotesCsv(filteredNotes, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><FileSpreadsheet className="h-4 w-4" />Download Excel</button>
                  </div>
                </div>
              </div>

              {loading ? (
                <CreditNoteSkeleton />
              ) : (
                <CreditNoteListTable
                  notes={filteredNotes}
                  page={page}
                  pageSize={8}
                  onPageChange={setPage}
                  onView={(noteId) => openNote(noteId, "view")}
                  onEdit={(noteId) => openNote(noteId, "edit")}
                  onDownloadPdf={(noteId) => {
                    const note = getCreditNote(noteId);
                    if (note) exportSingleCreditNotePdf(note);
                  }}
                />
              )}
            </div>
          ) : form ? (
            <div className="min-h-0 flex-1">
              {editorLoading ? (
                <CreditNoteSkeleton />
              ) : (
              <CreditNoteEditor
                country={country}
                readOnly={viewMode === "view"}
                form={form}
                  activeNote={activeNote}
                  customers={customers}
                  invoices={invoices}
                  selectedInvoice={selectedInvoice}
                  totals={totals as any}
                  actorName={actorName}
                  access={access}
                  fieldErrors={fieldErrors}
                  onBack={backToList}
                  onUpdateForm={updateForm}
                  onApplyInvoice={applyInvoice}
                  onUpdateLine={updateLine}
                  onAddLine={addLine}
                  onRemoveLine={removeLine}
                  onPersist={persist}
                />
              )}
            </div>
          ) : null}

          {errorMessage ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}
          {successMessage ? <div className="rounded-2xl border border-emerald-200 px-4 py-3 text-sm text-emerald-700" style={{ background: UI.COLORS.cream }}>{successMessage}</div> : null}
          {fieldErrors.totals ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{fieldErrors.totals}</div> : null}
        </div>
      )}
    </div>
  );
}
