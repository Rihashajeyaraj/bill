import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileDown, FileSpreadsheet, Plus } from "lucide-react";
import CountrySelector from "../../modules/debitNote/CountrySelector";
import DebitNoteSkeleton from "../../modules/debitNote/DebitNoteSkeleton";
import DebitNoteListTable from "../../modules/debitNote/DebitNoteListTable";
import DebitNoteEditor from "../../modules/debitNote/DebitNoteEditor";
import {
  COUNTRY_CONFIG,
  COUNTRY_OPTIONS,
  type CountryCode,
  type DebitStatus
} from "../../modules/debitNote/countryConfig";
import {
  getDebitNote,
  getSelectedDebitCountry,
  listDebitNotes,
  mapSuppliersByCountry,
  mapPurchaseInvoicesByCountry,
  saveDebitNote,
  setSelectedDebitCountry,
  summarizeDebitNotes,
  type PurchaseInvoice,
  type DebitNoteRecord
} from "../../modules/debitNote/store";
import { computeEditorTotals, defaultForm, draftLinesFromInvoice, formFromNote, formatMoney, parseNumber } from "../../modules/debitNote/utils";
import { exportDebitNoteSummaryPdf, exportDebitNotesCsv, exportSingleDebitNotePdf } from "../../modules/debitNote/pdf";
import type { DebitNoteFormState } from "../../modules/debitNote/types";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { companyGetProfile } from "../../services/company.service";
import EmptyState from "../../components/EmptyState";
import GradientButton from "../../components/GradientButton";
import { UI } from "../../theme/tokens";

type ViewMode = "list" | "create" | "edit" | "view";

function roleAccess(role: string, user: any) {
  const normalized = String(role || "").toLowerCase();
  const isAdmin = normalized.includes("owner") || normalized.includes("manager");
  if (isAdmin) {
    return {
      roleType: "Admin" as const,
      canApply: true,
      canOverride: true,
      allowedCountries: COUNTRY_OPTIONS.map((country) => country.code)
    };
  }
  const configured = Array.isArray(user?.allowedCountries)
    ? user.allowedCountries.filter((entry: string) => entry in COUNTRY_CONFIG)
    : [];
  return {
    roleType: "Staff" as const,
    canApply: false,
    canOverride: false,
    allowedCountries: configured.length ? configured : (["IN", "SL", "AE"] as CountryCode[])
  };
}

export default function DebitNotePremium() {
  const company = companyGetProfile();
  const user = authGetUser();
  const role = authGetRole();
  const access = useMemo(() => roleAccess(role, user), [role, user]);
  const actorName = user?.name || user?.email || "System User";
  const companyState = company?.address?.state || "";

  const [country, setCountry] = useState<CountryCode | "">(getSelectedDebitCountry());
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<DebitNoteFormState | null>(null);
  const [activeNote, setActiveNote] = useState<DebitNoteRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DebitStatus | "">("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const notes = useMemo(() => (country ? listDebitNotes(country) : []), [country, refreshKey]);
  const invoices = useMemo(() => (country ? mapPurchaseInvoicesByCountry(country) : []), [country, refreshKey]);
  const suppliers = useMemo(() => (country ? mapSuppliersByCountry(country) : []), [country, refreshKey]);
  const summary = useMemo(() => (country ? summarizeDebitNotes(country) : null), [country, refreshKey]);
  const selectedInvoice: PurchaseInvoice | null = useMemo(
    () => invoices.find((invoice) => invoice.id === form?.linkedPurchaseInvoiceId) || null,
    [invoices, form?.linkedPurchaseInvoiceId]
  );
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === form?.supplierId) || null,
    [suppliers, form?.supplierId]
  );
  const totals = useMemo(
    () =>
      form && country
        ? computeEditorTotals(form, country, selectedInvoice?.remainingBalance || 0, companyState)
        : { detailed: [], subtotal: 0, taxTotal: 0, total: 0, updatedPayable: 0, cgst: 0, sgst: 0, igst: 0 },
    [form, country, selectedInvoice?.remainingBalance, companyState]
  );
  const allowed = !country || access.allowedCountries.includes(country);

  const appliedCount = useMemo(() => notes.filter((note) => note.status === "Applied").length, [notes]);
  const pendingCount = useMemo(() => notes.filter((note) => note.status !== "Applied").length, [notes]);

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
        const haystack = `${note.supplierName} ${note.linkedPurchaseInvoiceNo} ${note.debitNoteNo}`.toLowerCase();
        const matchSearch = search.trim() ? haystack.includes(search.trim().toLowerCase()) : true;
        const matchStatus = statusFilter ? note.status === statusFilter : true;
        const matchSupplier = supplierFilter ? note.supplierId === supplierFilter : true;
        const matchFrom = fromDate ? note.debitNoteDate >= fromDate : true;
        const matchTo = toDate ? note.debitNoteDate <= toDate : true;
        return matchSearch && matchStatus && matchSupplier && matchFrom && matchTo;
      }),
    [notes, search, statusFilter, supplierFilter, fromDate, toDate]
  );

  function onCountryChange(next: CountryCode) {
    if (next === country) return;
    if (dirty && !window.confirm("Discard unsaved changes and switch country?")) return;
    setSwitching(true);
    window.setTimeout(() => {
      setCountry(next);
      setSelectedDebitCountry(next);
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
    const note = getDebitNote(noteId);
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

  function updateForm<K extends keyof DebitNoteFormState>(key: K, value: DebitNoteFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  function applyInvoice(invoiceId: string) {
    const invoice = invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) return;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            linkedPurchaseInvoiceId: invoiceId,
            supplierId: invoice.supplierId,
            supplierInput: invoice.supplierName,
            placeOfSupply: invoice.placeOfSupply || prev.placeOfSupply,
            taxRate: invoice.lines[0]?.taxRate || prev.taxRate,
            lines: draftLinesFromInvoice(invoice)
          }
        : prev
    );
    setDirty(true);
  }

  function updateLine(id: string, patch: any) {
    setForm((prev) => (prev ? { ...prev, lines: prev.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) } : prev));
    setDirty(true);
  }

  function addLine() {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            lines: [
              ...prev.lines,
              {
                id: `line_${Date.now().toString(16)}`,
                itemName: "",
                quantity: 1,
                rate: 0,
                taxRate: prev.taxRate,
                hsnSac: "",
                debitValueType: "Percentage",
                debitValue: 0
              }
            ]
          }
        : prev
    );
    setDirty(true);
  }

  function removeLine(id: string) {
    setForm((prev) => (prev ? { ...prev, lines: prev.lines.filter((line) => line.id !== id) } : prev));
    setDirty(true);
  }

  function validate(targetStatus: DebitStatus) {
    if (!form || !country) return false;
    const cfg = COUNTRY_CONFIG[country];
    const errors: Record<string, string> = {};

    if (!form.debitNoteDate) errors.debitNoteDate = "Debit note date is required.";
    if (!form.supplierId) errors.supplierId = "Supplier is required.";
    if (!form.linkedPurchaseInvoiceId) errors.linkedPurchaseInvoiceId = "Linked purchase invoice is mandatory.";
    if (cfg.registrationRequired && !form.registrationNumber.trim()) errors.registrationNumber = `${cfg.registrationLabel} is required.`;
    if (cfg.registrationRegex && form.registrationNumber.trim() && !cfg.registrationRegex.test(form.registrationNumber.trim())) {
      errors.registrationNumber = `Invalid ${cfg.registrationLabel} format.`;
    }
    if (country === "IN" && form.lines.some((line) => !line.hsnSac?.trim())) errors.lines = "HSN/SAC is mandatory for India.";
    if (!form.lines.length) errors.lines = "At least one line item is required.";
    if (form.debitType === "Partial Debit" && parseNumber(form.partialAmountCap) <= 0) errors.partialAmountCap = "Partial debit amount is required.";
    if (form.debitType === "Price Increase" && parseNumber(form.priceAdjustmentAmount) <= 0) errors.priceAdjustmentAmount = "Price increase amount is required.";
    if (form.debitType === "Additional Charges" && parseNumber(form.additionalChargesAmount) <= 0) errors.additionalChargesAmount = "Additional charges amount is required.";
    if (form.debitType === "Tax Adjustment" && parseNumber(form.taxAdjustmentAmount) <= 0) errors.taxAdjustmentAmount = "Tax adjustment amount is required.";
    if ((totals as any).detailed?.some((line: any) => line.validationMessage)) errors.lines = "Debit amount cannot be negative.";
    if (totals.total <= 0) errors.totals = "Total debit must be greater than zero.";
    if (targetStatus === "Applied" && !access.canApply) errors.workflow = "Only Admin can apply debits.";
    if (targetStatus === "Applied" && activeNote?.status === "Draft") errors.workflow = "Issue before apply.";

    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setErrorMessage(Object.values(errors)[0] || "Please fix the highlighted fields before saving.");
      setSuccessMessage("");
      return false;
    }
    return true;
  }

  function persist(targetStatus: DebitStatus, options?: { email?: boolean; download?: boolean }) {
    if (!form || !country) return;
    if (!validate(targetStatus)) return;
    try {
      const saved = saveDebitNote({
        id: form.id,
        country,
        debitNoteDate: form.debitNoteDate,
        supplierId: form.supplierId,
        supplierName: selectedSupplier?.name || form.supplierInput || "Supplier",
        linkedPurchaseInvoiceId: form.linkedPurchaseInvoiceId,
        linkedPurchaseInvoiceNo: selectedInvoice?.invoiceNo || "",
        linkedPurchaseInvoiceDate: selectedInvoice?.invoiceDate || "",
        reason: form.reason,
        debitType: form.debitType,
        desiredStatus: targetStatus,
        taxRate: form.taxRate,
        placeOfSupply: form.placeOfSupply,
        registrationNumber: form.registrationNumber,
        hmrcReference: form.hmrcReference,
        salesTaxState: form.salesTaxState,
        internalNotes: form.internalNotes,
        supplierNotes: form.supplierNotes,
        partialAmountCap: parseNumber(form.partialAmountCap),
        priceAdjustmentAmount: parseNumber(form.priceAdjustmentAmount),
        additionalChargesAmount: parseNumber(form.additionalChargesAmount),
        taxAdjustmentAmount: parseNumber(form.taxAdjustmentAmount),
        payableBalanceBefore: selectedInvoice?.remainingBalance || 0,
        lines: form.lines,
        actor: actorName
      });

      if (options?.download) exportSingleDebitNotePdf(saved);
      if (options?.email) window.alert(`Email queued for ${saved.debitNoteNo}.`);
      setRefreshKey((prev) => prev + 1);
      setActiveNote(saved);
      setForm(formFromNote(saved));
      setDirty(false);
      setViewMode("edit");
      setSuccessMessage(`${saved.debitNoteNo} saved as ${saved.status}.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to save debit note.");
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 pb-28">
      <CountrySelector value={country} onChange={onCountryChange} />

      {!country ? (
        <EmptyState icon={AlertTriangle} title="Select a country to continue" description="Country is mandatory before creating or viewing debit notes." />
      ) : (
        <div className={`space-y-4 transition-all duration-300 ${switching ? "translate-y-1 opacity-40" : "opacity-100"}`}>
          {!allowed ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have access to manage {COUNTRY_CONFIG[country].name} data.</div> : null}

          {viewMode === "list" ? (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Debit Notes</p><p className="mt-3 text-2xl font-bold text-slate-900">{summary?.count || 0}</p></div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Debit Amount</p><p className="mt-3 text-2xl font-bold text-slate-900">{formatMoney(summary?.totalAmount || 0, country)}</p></div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending / Applied</p><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="text-amber-700 font-semibold">{pendingCount} Pending</p><p className="text-emerald-700 font-semibold">{appliedCount} Applied</p></div></div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="text-xs font-semibold text-slate-600">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Supplier / invoice" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                    <label className="text-xs font-semibold text-slate-600">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DebitStatus | "")} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All</option><option value="Draft">Draft</option><option value="Issued">Issued</option><option value="Applied">Applied</option></select></label>
                    <label className="text-xs font-semibold text-slate-600">Supplier<select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-600">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                    <label className="text-xs font-semibold text-slate-600">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <GradientButton onClick={startCreate}><Plus className="h-4 w-4" />Create Debit Note</GradientButton>
                    <button onClick={() => exportDebitNoteSummaryPdf(filteredNotes, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><FileDown className="h-4 w-4" />Export PDF</button>
                    <button onClick={() => exportDebitNotesCsv(filteredNotes, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><FileSpreadsheet className="h-4 w-4" />Download Excel</button>
                  </div>
                </div>
              </div>

              {loading ? (
                <DebitNoteSkeleton />
              ) : (
                <DebitNoteListTable
                  notes={filteredNotes}
                  page={page}
                  pageSize={8}
                  onPageChange={setPage}
                  onView={(noteId) => openNote(noteId, "view")}
                  onEdit={(noteId) => openNote(noteId, "edit")}
                  onDownloadPdf={(noteId) => {
                    const note = getDebitNote(noteId);
                    if (note) exportSingleDebitNotePdf(note);
                  }}
                />
              )}
            </>
          ) : form ? (
            editorLoading ? (
              <DebitNoteSkeleton />
            ) : (
              <DebitNoteEditor
                country={country}
                readOnly={viewMode === "view"}
                form={form}
                activeNote={activeNote}
                suppliers={suppliers}
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
            )
          ) : null}

          {errorMessage ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}
          {successMessage ? <div className="rounded-2xl border border-emerald-200 px-4 py-3 text-sm text-emerald-700" style={{ background: UI.COLORS.cream }}>{successMessage}</div> : null}
          {fieldErrors.totals ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{fieldErrors.totals}</div> : null}
        </div>
      )}
    </div>
  );
}
