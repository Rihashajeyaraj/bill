import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileDown, FileSpreadsheet, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import CountrySelector from "../../modules/debitNote/CountrySelector";
import DebitNoteSkeleton from "../../modules/debitNote/DebitNoteSkeleton";
import DebitNoteListTable from "../../modules/debitNote/DebitNoteListTable";
import DebitNoteEditor from "../../modules/debitNote/DebitNoteEditor";
import {
  COUNTRY_CONFIG,
  COUNTRY_NAME_TO_CODE,
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
import { canApplyApprovals, roleTypeLabel } from "../../services/roles";
import { useOrganization } from "../../context/OrganizationContext";
import { purchasesSyncFromRemote } from "../../services/purchases.service";
import { debitNotesSaveRemote } from "../../services/debitNotes.service";
import { saveItemReturnAction } from "../../services/itemReturns.service";
import { syncPartiesFromRemote } from "../../modules/parties/store";
import EmptyState from "../../components/EmptyState";
import GradientButton from "../../components/GradientButton";
import { UI } from "../../theme/tokens";
import { useGlobalLoadingBridge } from "../../hooks/useGlobalLoadingBridge";

type ViewMode = "list" | "create" | "edit" | "view";

function roleAccess(role: string, user: any) {
  const canApply = canApplyApprovals(role);
  const configured = Array.isArray(user?.allowedCountries)
    ? user.allowedCountries.filter((entry: string) => entry in COUNTRY_CONFIG)
    : [];
  return {
    roleType: roleTypeLabel(role) as "Admin" | "Staff",
    canApply,
    canOverride: canApply,
    allowedCountries: canApply ? COUNTRY_OPTIONS.map((country) => country.code) : configured.length ? configured : (["IN", "SL", "AE"] as CountryCode[])
  };
}

export default function DebitNotePremium() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile: company = {}, country: organizationCountry, countryCode: organizationCountryCode } = useOrganization();
  const user = authGetUser();
  const role = authGetRole();
  const access = useMemo(() => roleAccess(role, user), [role, user]);
  const actorName = user?.name || user?.email || "System User";
  const companyState = company?.address?.state || "";

  function resolveInitialCountry(): CountryCode | "" {
    const mappedFromCountryCode = organizationCountryCode === "LK" ? "SL" : organizationCountryCode === "GB" ? "UK" : organizationCountryCode;
    if (
      mappedFromCountryCode &&
      mappedFromCountryCode in COUNTRY_CONFIG &&
      access.allowedCountries.includes(mappedFromCountryCode as CountryCode)
    ) {
      return mappedFromCountryCode as CountryCode;
    }

    const companyCountryRaw = organizationCountry || company?.country || company?.address?.country || "";
    const mappedCompanyCountry =
      (companyCountryRaw in COUNTRY_CONFIG
        ? (companyCountryRaw as CountryCode)
        : COUNTRY_NAME_TO_CODE[String(companyCountryRaw || "").trim()]) || "";
    if (mappedCompanyCountry && access.allowedCountries.includes(mappedCompanyCountry)) {
      return mappedCompanyCountry;
    }

    const saved = getSelectedDebitCountry();
    if (saved && access.allowedCountries.includes(saved)) return saved;

    return access.allowedCountries[0] || "";
  }

  const [country, setCountry] = useState<CountryCode | "">(resolveInitialCountry);
  const gstDisabledInSettings = company?.settings?.tax?.enableGst === false;
  const forceZeroTax = country === "IN" && gstDisabledInSettings;
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
  const [savingStatus, setSavingStatus] = useState<DebitStatus | null>(null);
  const [linkedReturnRef, setLinkedReturnRef] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DebitStatus | "">("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  useGlobalLoadingBridge(loading || editorLoading || switching, "debit-note");

  const notes = useMemo(() => (country ? listDebitNotes(country) : []), [country, refreshKey]);
  const invoices = useMemo(() => (country ? mapPurchaseInvoicesByCountry(country) : []), [country, refreshKey]);
  const suppliers = useMemo(() => (country ? mapSuppliersByCountry(country) : []), [country, refreshKey]);
  const summary = useMemo(() => (country ? summarizeDebitNotes(country) : null), [country, refreshKey]);
  const effectiveForm = useMemo(() => {
    if (!form) return null;
    if (!forceZeroTax) return form;
    return {
      ...form,
      taxRate: 0,
      lines: (form.lines || []).map((line) => ({ ...line, taxRate: 0 })),
      taxAdjustmentAmount: "0"
    };
  }, [form, forceZeroTax]);
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
      effectiveForm && country
        ? computeEditorTotals(effectiveForm, country, selectedInvoice?.remainingBalance || 0, companyState)
        : { detailed: [], subtotal: 0, taxTotal: 0, total: 0, updatedPayable: 0, cgst: 0, sgst: 0, igst: 0 },
    [effectiveForm, country, selectedInvoice?.remainingBalance, companyState]
  );
  const allowed = !country || access.allowedCountries.includes(country);
  const prefillBillId = searchParams.get("billId") || "";
  const prefillItemId = searchParams.get("itemId") || "";
  const prefillQty = parseNumber(searchParams.get("qty") || 0);
  const prefillReason = searchParams.get("reason") || "";
  const prefillReturnRef = searchParams.get("returnRef") || "";
  const selectedInvoiceDebitSummary = useMemo(() => {
    const invoiceId = String(form?.linkedPurchaseInvoiceId || "").trim();
    if (!invoiceId) {
      return {
        totalNotes: 0,
        appliedNotes: 0,
        issuedNotes: 0,
        draftNotes: 0,
        appliedAmount: 0,
        billQty: 0,
        debitedQty: 0,
        availableQty: 0
      };
    }
    const invoiceNotes = notes.filter(
      (note) => String(note?.linkedPurchaseInvoiceId || "") === invoiceId
    );
    const appliedNotes = invoiceNotes.filter((note) => String(note?.status || "") === "Applied");
    const issuedNotes = invoiceNotes.filter((note) => String(note?.status || "") === "Issued");
    const draftNotes = invoiceNotes.filter((note) => String(note?.status || "") === "Draft");
    const billQty = (selectedInvoice?.lines || []).reduce(
      (sum: number, line: any) => sum + Math.max(0, parseNumber(line?.quantity)),
      0
    );
    const debitedQty = (selectedInvoice?.lines || []).reduce(
      (sum: number, line: any) => sum + Math.max(0, parseNumber(line?.debitedQty)),
      0
    );
    const availableQty = (selectedInvoice?.lines || []).reduce(
      (sum: number, line: any) =>
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
    return {
      totalNotes: invoiceNotes.length,
      appliedNotes: appliedNotes.length,
      issuedNotes: issuedNotes.length,
      draftNotes: draftNotes.length,
      appliedAmount: appliedNotes.reduce(
        (sum, note) => sum + Math.max(0, parseNumber(note?.totals?.total)),
        0
      ),
      billQty,
      debitedQty,
      availableQty
    };
  }, [form?.linkedPurchaseInvoiceId, notes, selectedInvoice?.lines]);

  const appliedCount = useMemo(() => notes.filter((note) => note.status === "Applied").length, [notes]);
  const pendingCount = useMemo(() => notes.filter((note) => note.status !== "Applied").length, [notes]);

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 220);
    return () => window.clearTimeout(timer);
  }, [country, refreshKey]);

  useEffect(() => {
    if (!country) return;
    setSelectedDebitCountry(country);
  }, [country]);

  useEffect(() => {
    if (!forceZeroTax) return;
    setForm((prev) => {
      if (!prev) return prev;
      const hasNonZeroFormTax = parseNumber(prev.taxRate) !== 0;
      const hasNonZeroLineTax = (prev.lines || []).some((line) => parseNumber(line?.taxRate) !== 0);
      const hasTaxAdjustment = parseNumber(prev.taxAdjustmentAmount) !== 0;
      if (!hasNonZeroFormTax && !hasNonZeroLineTax && !hasTaxAdjustment) return prev;
      return {
        ...prev,
        taxRate: 0,
        taxAdjustmentAmount: "0",
        lines: (prev.lines || []).map((line) => ({ ...line, taxRate: 0 }))
      };
    });
  }, [forceZeroTax]);

  useEffect(() => {
    let mounted = true;
    async function syncReferenceData() {
      if (!country) return;
      try {
        await Promise.all([syncPartiesFromRemote(), purchasesSyncFromRemote()]);
      } catch {
        // Keep local cache on sync failure.
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
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!country || !prefillBillId) return;
    const bill = invoices.find((entry) => entry.id === prefillBillId);
    if (!bill) return;

    setViewMode("create");
    setActiveNote(null);
    setLinkedReturnRef(prefillReturnRef || "");
    setForm((prev) => {
      const base = prev || defaultForm(country, company);
      const invoiceLines = draftLinesFromInvoice(bill).map((line) => ({
        ...line,
        taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
        debitValueType: "Percentage",
        debitValue: 0
      }));
      let filteredLines = invoiceLines;
      if (prefillItemId) {
        const matched = invoiceLines.filter((line) => String(line?.itemId || "") === String(prefillItemId));
        filteredLines = matched.length ? matched : invoiceLines;
      }
      if (prefillQty > 0 && filteredLines.length === 1) {
        filteredLines = filteredLines.map((line) => ({
          ...line,
          quantity: Math.min(Math.max(0, parseNumber(line.sourcePurchaseQty)), prefillQty)
        }));
      }
      return {
        ...base,
        debitType: "Full Debit",
        partialAmountCap: "",
        priceAdjustmentAmount: "",
        additionalChargesAmount: "",
        taxAdjustmentAmount: forceZeroTax ? "0" : "",
        linkedPurchaseInvoiceId: bill.id,
        supplierId: bill.supplierId,
        supplierInput: bill.supplierName,
        reason: prefillReason || base.reason,
        placeOfSupply: bill.placeOfSupply || base.placeOfSupply,
        taxRate: forceZeroTax ? 0 : bill.lines[0]?.taxRate || base.taxRate,
        lines: filteredLines
      };
    });
    setDirty(false);
    setFieldErrors({});
    setErrorMessage("");
    setSuccessMessage("");

    const next = new URLSearchParams(searchParams);
    next.delete("billId");
    next.delete("itemId");
    next.delete("qty");
    next.delete("reason");
    next.delete("batchId");
    next.delete("returnRef");
    setSearchParams(next, { replace: true });
  }, [country, prefillBillId, prefillItemId, prefillQty, prefillReason, prefillReturnRef, invoices, company, searchParams, setSearchParams, forceZeroTax]);

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
    const baseForm = defaultForm(country, company);
    setForm({
      ...baseForm,
      taxRate: forceZeroTax ? 0 : baseForm.taxRate,
      debitType: "Full Debit",
      partialAmountCap: "",
      priceAdjustmentAmount: "",
      additionalChargesAmount: "",
      taxAdjustmentAmount: forceZeroTax ? "0" : ""
    });
    setActiveNote(null);
    setLinkedReturnRef("");
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
    setLinkedReturnRef("");
    const hydrated = formFromNote(note);
    setForm({
      ...hydrated,
      taxRate: forceZeroTax ? 0 : hydrated.taxRate,
      debitType: "Full Debit",
      partialAmountCap: "",
      priceAdjustmentAmount: "",
      additionalChargesAmount: "",
      taxAdjustmentAmount: forceZeroTax ? "0" : "",
      lines: (hydrated.lines || []).map((line) => ({
        ...line,
        taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
        debitValueType: "Percentage",
        debitValue: 0
      }))
    });
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
    setForm((prev) => {
      if (!prev) return prev;
      if (forceZeroTax && (key === "taxRate" || key === "taxAdjustmentAmount")) {
        return { ...prev, taxRate: 0, taxAdjustmentAmount: "0" };
      }
      return { ...prev, [key]: value };
    });
    setDirty(true);
  }

  function applyInvoice(invoiceId: string) {
    if (!invoiceId) {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              linkedPurchaseInvoiceId: "",
              lines: []
            }
          : prev
      );
      setDirty(true);
      return;
    }
    const invoice = invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) return;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            debitType: "Full Debit",
            partialAmountCap: "",
            priceAdjustmentAmount: "",
            additionalChargesAmount: "",
            taxAdjustmentAmount: forceZeroTax ? "0" : "",
            linkedPurchaseInvoiceId: invoiceId,
            supplierId: invoice.supplierId,
            supplierInput: invoice.supplierName,
            placeOfSupply: invoice.placeOfSupply || prev.placeOfSupply,
            taxRate: forceZeroTax ? 0 : invoice.lines[0]?.taxRate || prev.taxRate,
            lines: draftLinesFromInvoice(invoice).map((line) => ({
              ...line,
              taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
              debitValueType: "Percentage",
              debitValue: 0
            }))
          }
        : prev
    );
    setDirty(true);
  }

  function updateLine(id: string, patch: any) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.map((line) =>
              line.id === id
                ? {
                    ...line,
                    ...patch,
                    taxRate: forceZeroTax ? 0 : parseNumber((patch as any)?.taxRate ?? line.taxRate),
                    debitValueType: "Percentage",
                    debitValue: 0
                  }
                : line
            )
          }
        : prev
    );
    setDirty(true);
  }

  function addLine() {
    if (!form) return;
    if (form.linkedPurchaseInvoiceId) return;
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
                taxRate: forceZeroTax ? 0 : prev.taxRate,
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
    const errors: Record<string, string> = {};

    if (!form.debitNoteDate) errors.debitNoteDate = "Debit note date is required.";
    if (!form.supplierId) errors.supplierId = "Supplier is required.";
    if (!form.linkedPurchaseInvoiceId) errors.linkedPurchaseInvoiceId = "Linked purchase invoice is mandatory.";
    if (!form.lines.length) errors.lines = "At least one line item is required.";
    if ((totals as any).detailed?.some((line: any) => line.validationMessage)) errors.lines = "Debit amount cannot be negative.";
    if (totals.total <= 0) errors.totals = "Total debit must be greater than zero.";
    if (targetStatus === "Applied" && !access.canApply) {
      errors.workflow = "You do not have approval permission to apply debits.";
    }
    const currentStatus = activeNote?.status || "Draft";
    if (targetStatus === "Applied" && currentStatus !== "Issued" && currentStatus !== "Applied") {
      errors.workflow = "Issue before apply.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setErrorMessage(Object.values(errors)[0] || "Please fix the highlighted fields before saving.");
      setSuccessMessage("");
      return false;
    }
    return true;
  }

  async function persist(targetStatus: DebitStatus, options?: { email?: boolean; download?: boolean }) {
    if (!form || !country) return;
    if (savingStatus) return;
    if (!validate(targetStatus)) return;
    setSavingStatus(targetStatus);
    const effectiveFormForSave = forceZeroTax
      ? {
          ...form,
          taxRate: 0,
          taxAdjustmentAmount: "0",
          lines: (form.lines || []).map((line) => ({ ...line, taxRate: 0 }))
        }
      : form;
    try {
      const saved = saveDebitNote({
        id: effectiveFormForSave.id,
        country,
        debitNoteDate: effectiveFormForSave.debitNoteDate,
        supplierId: effectiveFormForSave.supplierId,
        supplierName: selectedSupplier?.name || effectiveFormForSave.supplierInput || "Supplier",
        linkedPurchaseInvoiceId: effectiveFormForSave.linkedPurchaseInvoiceId,
        linkedPurchaseInvoiceNo: selectedInvoice?.invoiceNo || "",
        linkedPurchaseInvoiceDate: selectedInvoice?.invoiceDate || "",
        reason: effectiveFormForSave.reason,
        debitType: "Full Debit",
        desiredStatus: targetStatus,
        taxRate: forceZeroTax ? 0 : effectiveFormForSave.taxRate,
        placeOfSupply: effectiveFormForSave.placeOfSupply,
        registrationNumber: effectiveFormForSave.registrationNumber,
        hmrcReference: effectiveFormForSave.hmrcReference,
        salesTaxState: effectiveFormForSave.salesTaxState,
        internalNotes: effectiveFormForSave.internalNotes,
        supplierNotes: effectiveFormForSave.supplierNotes,
        partialAmountCap: 0,
        priceAdjustmentAmount: 0,
        additionalChargesAmount: 0,
        taxAdjustmentAmount: 0,
        payableBalanceBefore: selectedInvoice?.remainingBalance || 0,
        lines: (effectiveFormForSave.lines || []).map((line) => ({
          ...line,
          taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
          debitValueType: "Percentage",
          debitValue: 0
        })),
        actor: actorName
      });

      await debitNotesSaveRemote(saved);

      if (linkedReturnRef && saved?.status !== "Draft") {
        saveItemReturnAction({
          returnRef: linkedReturnRef,
          action: "RETURN_TO_SUPPLIER",
          supplierId: saved?.supplierId || "",
          notes: `Linked debit note ${saved.debitNoteNo || ""}`.trim()
        });
      }

      if (options?.download) exportSingleDebitNotePdf(saved);
      if (options?.email) window.alert(`Email queued for ${saved.debitNoteNo}.`);
      setRefreshKey((prev) => prev + 1);
      setActiveNote(saved);
      const nextSavedForm = formFromNote(saved);
      setForm(
        forceZeroTax
          ? {
              ...nextSavedForm,
              taxRate: 0,
              taxAdjustmentAmount: "0",
              lines: nextSavedForm.lines.map((line) => ({ ...line, taxRate: 0 }))
            }
          : nextSavedForm
      );
      setForm((prev) =>
        prev
          ? {
            ...prev,
              debitType: "Full Debit",
              partialAmountCap: "",
              priceAdjustmentAmount: "",
              additionalChargesAmount: "",
              taxAdjustmentAmount: forceZeroTax ? "0" : "",
              lines: (prev.lines || []).map((line) => ({
                ...line,
                taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
                debitValueType: "Percentage",
                debitValue: 0
              }))
            }
          : prev
      );
      setDirty(false);
      setViewMode("edit");
      setSuccessMessage(`${saved.debitNoteNo} saved as ${saved.status}.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to save debit note.");
    } finally {
      setSavingStatus(null);
    }
  }

  return (
    <div className="mx-auto min-h-full max-w-[1440px] space-y-3 pb-36">
      {country ? (
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 p-3.5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Debit Note</p>
              <p className="text-xs text-slate-500">Create and manage supplier debit adjustments for {COUNTRY_CONFIG[country].name}.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              {COUNTRY_CONFIG[country].flag} {COUNTRY_CONFIG[country].code} {COUNTRY_CONFIG[country].name}
            </div>
          </div>
        </div>
      ) : (
        <CountrySelector value={country} onChange={onCountryChange} />
      )}

      {!country ? (
        <EmptyState icon={AlertTriangle} title="Select a country to continue" description="Country is mandatory before creating or viewing debit notes." />
      ) : (
        <div className={`flex flex-col gap-3 transition-all duration-300 ${switching ? "translate-y-1 opacity-40" : "opacity-100"}`}>
          {!allowed ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have access to manage {COUNTRY_CONFIG[country].name} data.</div> : null}
          {forceZeroTax ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              GST is disabled in Company Settings. Debit Note tax is locked to 0%.
            </div>
          ) : null}

          {viewMode === "list" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Debit Notes</p><p className="mt-3 text-2xl font-bold text-slate-900">{summary?.count || 0}</p></div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Debit Amount</p><p className="mt-3 text-2xl font-bold text-slate-900">{formatMoney(summary?.totalAmount || 0, country)}</p></div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending / Applied</p><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="text-amber-700 font-semibold">{pendingCount} Pending</p><p className="text-emerald-700 font-semibold">{appliedCount} Applied</p></div></div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="text-xs font-semibold text-slate-600">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Supplier, invoice, debit note no" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
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
            </div>
          ) : form ? (
            <div>
              {String(form?.linkedPurchaseInvoiceId || "").trim() && selectedInvoiceDebitSummary.totalNotes > 0 ? (
                <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  <p className="font-semibold">
                    This purchase bill already has debit notes ({selectedInvoiceDebitSummary.totalNotes})
                  </p>
                  <p className="mt-1">
                    Applied: {selectedInvoiceDebitSummary.appliedNotes}, Issued: {selectedInvoiceDebitSummary.issuedNotes}, Draft: {selectedInvoiceDebitSummary.draftNotes}
                  </p>
                  <p className="mt-1">
                    Applied amount: {formatMoney(selectedInvoiceDebitSummary.appliedAmount, country)} | Qty debited: {selectedInvoiceDebitSummary.debitedQty} / {selectedInvoiceDebitSummary.billQty} | Qty available: {selectedInvoiceDebitSummary.availableQty}
                  </p>
                </div>
              ) : null}
              {editorLoading ? (
                <DebitNoteSkeleton />
              ) : (
                <DebitNoteEditor
                  country={country}
                  readOnly={viewMode === "view"}
                  form={effectiveForm || form}
                  activeNote={activeNote}
                  suppliers={suppliers}
                  invoices={invoices}
                  selectedInvoice={selectedInvoice}
                  totals={totals as any}
                  actorName={actorName}
                  access={access}
                  fieldErrors={fieldErrors}
                  savingStatus={savingStatus}
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
