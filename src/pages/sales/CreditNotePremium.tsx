import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, FileText, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import DateInput from "../../components/DateInput";
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
  removeCreditNote,
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
import { canApplyApprovals, canCreateEntries, canDeleteEntries, canEditEntries, roleTypeLabel } from "../../services/roles";
import { useOrganization } from "../../context/OrganizationContext";
import { invoicesSyncFromRemote } from "../../services/invoices.service";
import { creditNotesDeleteRemote, creditNotesSaveRemote } from "../../services/creditNotes.service";
import { syncPartiesFromRemote } from "../../modules/parties/store";
import { fetchInvoiceAllocationDetails } from "../../services/inventory.service";
import EmptyState from "../../components/EmptyState";
import GradientButton from "../../components/GradientButton";
import { UI } from "../../theme/tokens";
import { useGlobalLoadingBridge } from "../../hooks/useGlobalLoadingBridge";

type ViewMode = "list" | "create" | "edit" | "view";

function roleAccess(role: string, user: any) {
  const canApply = canApplyApprovals(role);
  const configured = Array.isArray(user?.allowedCountries) ? user.allowedCountries.filter((entry: string) => entry in COUNTRY_CONFIG) : [];
  return {
    roleType: roleTypeLabel(role) as "Admin" | "Staff",
    canApply,
    canOverride: canApply,
    allowedCountries: canApply ? COUNTRY_OPTIONS.map((country) => country.code) : configured.length ? configured : (["IN", "SL", "AE"] as CountryCode[])
  };
}

function computePurchaseRateFromAllocations(allocations: any[], qty: number) {
  const requestedQty = Math.max(0, parseNumber(qty));
  if (!requestedQty || !Array.isArray(allocations) || !allocations.length) return 0;

  let remaining = requestedQty;
  let usedQty = 0;
  let totalCost = 0;
  for (const row of allocations) {
    const allocatedQty = Math.max(0, parseNumber(row?.allocated_qty));
    const unitCost = Math.max(0, parseNumber(row?.unit_cost_excl_tax));
    if (allocatedQty <= 0) continue;
    const pickQty = Math.min(remaining, allocatedQty);
    if (pickQty <= 0) continue;
    usedQty += pickQty;
    totalCost += pickQty * unitCost;
    remaining -= pickQty;
    if (remaining <= 1e-6) break;
  }
  if (!usedQty) return 0;
  return Number((totalCost / usedQty).toFixed(6));
}

function resolveCreditLineKey(line: any, index: number) {
  return String(line?.id || line?.sourceInvoiceItemId || `line_${index + 1}`);
}

export default function CreditNotePremium() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile: company = {}, country: organizationCountry, countryCode: organizationCountryCode } = useOrganization();
  const user = authGetUser();
  const role = authGetRole();
  const access = useMemo(() => roleAccess(role, user), [role, user]);
  const canCreateNote = canCreateEntries(role);
  const canEditNote = canEditEntries(role);
  const canDeleteNote = canDeleteEntries(role);
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

    const saved = getSelectedCreditCountry();
    if (saved && access.allowedCountries.includes(saved)) return saved;

    return access.allowedCountries[0] || "";
  }

  const [country, setCountry] = useState<CountryCode | "">(resolveInitialCountry);
  const gstDisabledInSettings = company?.settings?.tax?.enableGst === false;
  const forceZeroTax = country === "IN" && gstDisabledInSettings;
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
  const [savingStatus, setSavingStatus] = useState<CreditStatus | null>(null);
  const [allocationByInvoiceItemId, setAllocationByInvoiceItemId] = useState<Record<string, any[]>>({});
  const [allocationsLoading, setAllocationsLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const filterInputClassName =
    "mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none";
  const filterLabelClassName = "min-w-0 flex-1 text-xs font-semibold text-slate-600 sm:min-w-[170px]";
  const actionIconButtonClassName =
    "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  useGlobalLoadingBridge(loading || editorLoading || switching, "credit-note");

  const notes = useMemo(() => (country ? listCreditNotes(country) : []), [country, refreshKey]);
  const invoices = useMemo(() => (country ? mapInvoicesByCountry(country) : []), [country, refreshKey]);
  const customers = useMemo(() => (country ? mapCustomersByCountry(country) : []), [country, refreshKey]);
  const summary = useMemo(() => (country ? summarizeCreditNotes(country) : null), [country, refreshKey]);
  const effectiveForm = useMemo(() => {
    if (!form) return null;
    if (!forceZeroTax) return form;
    return {
      ...form,
      taxRate: 0,
      lines: (form.lines || []).map((line) => ({ ...line, taxRate: 0 }))
    };
  }, [form, forceZeroTax]);
  const selectedInvoice: CreditInvoice | null = useMemo(() => invoices.find((invoice) => invoice.id === form?.linkedInvoiceId) || null, [invoices, form?.linkedInvoiceId]);
  const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === form?.customerId) || null, [customers, form?.customerId]);
  const totals = useMemo(
    () => {
      if (!effectiveForm || !country) {
        return {
          detailed: [],
          subtotal: 0,
          taxTotal: 0,
          total: 0,
          maxRefundTotal: 0,
          refundMode: "FULL" as const,
          remaining: 0,
          cgst: 0,
          sgst: 0,
          igst: 0
        };
      }
      const invoiceTotal = Array.isArray(selectedInvoice?.lines)
        ? selectedInvoice.lines.reduce(
            (sum, line) =>
              sum +
              Math.max(
                0,
                parseNumber(
                  (line as any)?.amountAfterTax ??
                    parseNumber((line as any)?.quantity) * parseNumber((line as any)?.rate)
                )
              ),
            0
          )
        : 0;
      const invoiceAmountBase = invoiceTotal > 0 ? invoiceTotal : parseNumber(selectedInvoice?.remainingBalance || 0);
      return computeEditorTotals(effectiveForm, country, invoiceAmountBase, companyState);
    },
    [effectiveForm, country, selectedInvoice?.lines, selectedInvoice?.remainingBalance, companyState]
  );
  const allowed = !country || access.allowedCountries.includes(country);
  const prefillInvoiceId = searchParams.get("invoiceId") || "";
  const selectedInvoiceCreditSummary = useMemo(() => {
    const invoiceId = String(form?.linkedInvoiceId || "").trim();
    if (!invoiceId) {
      return {
        totalNotes: 0,
        appliedNotes: 0,
        issuedNotes: 0,
        draftNotes: 0,
        appliedAmount: 0,
        soldQty: 0,
        creditedQty: 0,
        availableQty: 0
      };
    }
    const invoiceNotes = notes.filter(
      (note) => String(note?.linkedInvoiceId || "") === invoiceId
    );
    const appliedNotes = invoiceNotes.filter((note) => String(note?.status || "") === "Applied");
    const issuedNotes = invoiceNotes.filter((note) => String(note?.status || "") === "Issued");
    const draftNotes = invoiceNotes.filter((note) => String(note?.status || "") === "Draft");
    const soldQty = (selectedInvoice?.lines || []).reduce(
      (sum: number, line: any) => sum + Math.max(0, parseNumber(line?.quantity)),
      0
    );
    const creditedQty = (selectedInvoice?.lines || []).reduce(
      (sum: number, line: any) => sum + Math.max(0, parseNumber(line?.creditedQty)),
      0
    );
    const availableQty = (selectedInvoice?.lines || []).reduce(
      (sum: number, line: any) =>
        sum +
        Math.max(
          0,
          parseNumber(
            line?.availableReturnQty !== undefined && line?.availableReturnQty !== null
              ? line.availableReturnQty
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
      soldQty,
      creditedQty,
      availableQty
    };
  }, [form?.linkedInvoiceId, notes, selectedInvoice?.lines]);

  useEffect(() => {
    if (!country) return;
    setSelectedCreditCountry(country);
  }, [country]);

  useEffect(() => {
    if (!forceZeroTax) return;
    setForm((prev) => {
      if (!prev) return prev;
      const hasNonZeroFormTax = parseNumber(prev.taxRate) !== 0;
      const hasNonZeroLineTax = (prev.lines || []).some((line) => parseNumber(line?.taxRate) !== 0);
      if (!hasNonZeroFormTax && !hasNonZeroLineTax) return prev;
      return {
        ...prev,
        taxRate: 0,
        lines: (prev.lines || []).map((line) => ({ ...line, taxRate: 0 }))
      };
    });
  }, [forceZeroTax]);

  useEffect(() => {
    let mounted = true;
    async function syncReferenceData() {
      if (!country) return;
      try {
        await Promise.all([syncPartiesFromRemote(), invoicesSyncFromRemote()]);
      } catch {
        // Premium module continues with local cache if remote sync fails.
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
    if (!country) return;
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 220);
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
    if (!country || !prefillInvoiceId) return;
    const invoice = invoices.find((entry) => entry.id === prefillInvoiceId);
    if (!invoice) return;

    setViewMode("create");
    setActiveNote(null);
    setForm((prev) => {
      const base = prev || defaultForm(country, company);
      return {
        ...base,
        creditType: "Full Credit",
        discountPercent: "",
        partialAmountCap: "",
        priceAdjustmentAmount: "",
        refundMode: "FULL",
        partialRefundAmount: "",
        linkedInvoiceId: invoice.id,
        customerId: invoice.customerId,
        customerInput: invoice.customerName,
        placeOfSupply: invoice.placeOfSupply || base.placeOfSupply,
        taxRate: forceZeroTax ? 0 : invoice.lines[0]?.taxRate || base.taxRate,
        lines: draftLinesFromInvoice(invoice).map((line) => ({
          ...line,
          taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
          creditType: "Percentage",
          creditValue: 0
        }))
      };
    });
    setDirty(false);
    setFieldErrors({});
    setErrorMessage("");
    setSuccessMessage("");

    const next = new URLSearchParams(searchParams);
    next.delete("invoiceId");
    setSearchParams(next, { replace: true });
  }, [country, prefillInvoiceId, invoices, company, searchParams, setSearchParams, forceZeroTax]);

  useEffect(() => {
    const linkedInvoiceId = String(form?.linkedInvoiceId || "").trim();
    if (!linkedInvoiceId) {
      setAllocationByInvoiceItemId({});
      setAllocationsLoading(false);
      return;
    }
    let cancelled = false;
    setAllocationsLoading(true);
    fetchInvoiceAllocationDetails(linkedInvoiceId)
      .then((rows) => {
        if (cancelled) return;
        const grouped: Record<string, any[]> = {};
        (Array.isArray(rows) ? rows : []).forEach((row) => {
          const key = String(row?.invoice_item_id || "").trim();
          if (!key) return;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(row);
        });
        setAllocationByInvoiceItemId(grouped);
      })
      .catch(() => {
        if (cancelled) return;
        setAllocationByInvoiceItemId({});
      })
      .finally(() => {
        if (!cancelled) setAllocationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form?.linkedInvoiceId]);

  const filteredNotes = useMemo(
    () =>
      notes.filter((note) => {
        const haystack = `${note.customerName} ${note.linkedInvoiceNo} ${note.creditNoteNo}`.toLowerCase();
        const matchSearch = search.trim() ? haystack.includes(search.trim().toLowerCase()) : true;
        const matchFrom = fromDate ? note.creditNoteDate >= fromDate : true;
        const matchTo = toDate ? note.creditNoteDate <= toDate : true;
        return matchSearch && matchFrom && matchTo;
      }),
    [notes, search, fromDate, toDate]
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
    if (!canCreateNote) {
      setErrorMessage("You do not have permission to create credit notes.");
      setSuccessMessage("");
      return;
    }
    setEditorLoading(true);
    const baseForm = defaultForm(country, company);
    setForm({
      ...baseForm,
      taxRate: forceZeroTax ? 0 : baseForm.taxRate,
      creditType: "Full Credit",
      discountPercent: "",
      partialAmountCap: "",
      priceAdjustmentAmount: "",
      refundMode: "FULL",
      partialRefundAmount: ""
    });
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
    if (mode === "edit" && note.sourceSystem === "legacy") {
      setErrorMessage("Legacy credit notes are read-only on this page.");
      setSuccessMessage("");
      return;
    }
    if (mode === "edit" && !canEditNote) {
      setErrorMessage("You do not have permission to edit credit notes.");
      setSuccessMessage("");
      return;
    }
    if (mode === "edit" && note.status === "Applied") return;
    setEditorLoading(true);
    const hydrated = formFromNote(note);
    setForm({
      ...hydrated,
      taxRate: forceZeroTax ? 0 : hydrated.taxRate,
      creditType: "Full Credit",
      discountPercent: "",
      partialAmountCap: "",
      priceAdjustmentAmount: "",
      refundMode:
        hydrated.refundMode === "PARTIAL" || hydrated.refundMode === "NONE"
          ? hydrated.refundMode
          : "FULL",
      partialRefundAmount: hydrated.partialRefundAmount || "",
      lines: (hydrated.lines || []).map((line) => ({
        ...line,
        taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
        creditType: "Percentage",
        creditValue: 0
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

  function updateForm<K extends keyof CreditNoteFormState>(key: K, value: CreditNoteFormState[K]) {
    setForm((prev) => {
      if (!prev) return prev;
      if (key === "taxRate" && forceZeroTax) {
        return { ...prev, taxRate: 0 };
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
    setForm((prev) =>
      prev
        ? {
            ...prev,
            creditType: "Full Credit",
            discountPercent: "",
            partialAmountCap: "",
            priceAdjustmentAmount: "",
            refundMode: "FULL",
            partialRefundAmount: "",
            linkedInvoiceId: invoiceId,
            customerId: invoice.customerId,
            customerInput: invoice.customerName,
            placeOfSupply: invoice.placeOfSupply || prev.placeOfSupply,
            taxRate: forceZeroTax ? 0 : invoice.lines[0]?.taxRate || prev.taxRate,
            lines: draftLinesFromInvoice(invoice).map((line) => ({
              ...line,
              taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
              creditType: "Percentage",
              creditValue: 0
            }))
          }
        : prev
    );
    setDirty(true);
  }

  function updateLine(id: string, patch: any) {
    const targetId = String(id || "");
    setForm((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.map((line, index) => {
              const lineId = resolveCreditLineKey(line, index);
              if (lineId !== targetId) {
                return line;
              }
              return {
                ...line,
                id: lineId,
                sourceInvoiceItemId: String((line as any)?.sourceInvoiceItemId || lineId),
                ...patch,
                taxRate: forceZeroTax ? 0 : parseNumber((patch as any)?.taxRate ?? line.taxRate),
                creditType: "Percentage",
                creditValue: 0
              };
            })
          }
        : prev
    );
    setDirty(true);
  }

  function addLine() {
    if (!form) return;
    if (form.linkedInvoiceId) return;
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
                returnCondition: "",
                purchaseRate: 0,
                creditType: "Percentage",
                creditValue: 0
              }
            ]
          }
        : prev
    );
    setDirty(true);
  }

  function removeLine(id: string) {
    const targetId = String(id || "");
    setForm((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.filter((line, index) => resolveCreditLineKey(line, index) !== targetId)
          }
        : prev
    );
    setDirty(true);
  }

  function validate(targetStatus: CreditStatus) {
    if (!form || !country) return false;
    const errors: Record<string, string> = {};
    if (!form.creditNoteDate) errors.creditNoteDate = "Credit note date is required.";
    if (!form.customerId) errors.customerId = "Customer is required.";
    if (!form.linkedInvoiceId) errors.linkedInvoiceId = "Linked invoice is mandatory.";
    if ((totals as any).detailed?.some((line: any) => line.validationMessage)) errors.lines = "Credit cannot exceed amount after tax.";
    if (!form.lines.length) errors.lines = "At least one line item is required.";
    if (
      form.lines.some(
        (line) =>
          parseNumber(line.quantity) > 0 &&
          line.returnCondition !== "REUSABLE" &&
          line.returnCondition !== "NOT_REUSABLE"
      )
    ) {
      errors.lines = "Select reusable or not reusable for each returned line.";
    }
    if ((form.refundMode === "FULL" || form.refundMode === "PARTIAL") && totals.maxRefundTotal <= 0) {
      errors.totals = "Return value must be greater than zero.";
    }
    if (targetStatus === "Applied" && !access.canApply) {
      errors.workflow = "You do not have approval permission to apply credits.";
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

  async function persist(targetStatus: CreditStatus, options?: { email?: boolean; download?: boolean }) {
    if (!form || !country) return;
    if (savingStatus) return;
    const isEditMode = !!form?.id;
    if (isEditMode && !canEditNote) {
      setErrorMessage("You do not have permission to edit credit notes.");
      setSuccessMessage("");
      return;
    }
    if (!isEditMode && !canCreateNote) {
      setErrorMessage("You do not have permission to create credit notes.");
      setSuccessMessage("");
      return;
    }
    if (!validate(targetStatus)) return;
    setSavingStatus(targetStatus);
    const effectiveFormForSave = forceZeroTax
      ? {
          ...form,
          taxRate: 0,
          lines: (form.lines || []).map((line) => ({ ...line, taxRate: 0 }))
        }
      : form;
    try {
      let savedLocallyOnly = false;
      let remoteSyncMessage = "";
      const saved = saveCreditNote({
        id: effectiveFormForSave.id,
        country,
        creditNoteDate: effectiveFormForSave.creditNoteDate,
        customerId: effectiveFormForSave.customerId,
        customerName: selectedCustomer?.name || effectiveFormForSave.customerInput || "Customer",
        linkedInvoiceId: effectiveFormForSave.linkedInvoiceId,
        linkedInvoiceNo: selectedInvoice?.invoiceNo || "",
        linkedInvoiceDate: selectedInvoice?.invoiceDate || "",
        reason: effectiveFormForSave.reason,
        creditType: "Full Credit",
        desiredStatus: targetStatus,
        taxRate: forceZeroTax ? 0 : effectiveFormForSave.taxRate,
        placeOfSupply: effectiveFormForSave.placeOfSupply,
        registrationNumber: effectiveFormForSave.registrationNumber,
        hmrcReference: effectiveFormForSave.hmrcReference,
        salesTaxState: effectiveFormForSave.salesTaxState,
        internalNotes: effectiveFormForSave.internalNotes,
        customerNotes: effectiveFormForSave.customerNotes,
        refundMode: effectiveFormForSave.refundMode,
        partialRefundAmount: effectiveFormForSave.refundMode === "PARTIAL" ? totals.total : 0,
        discountPercent: 0,
        partialAmountCap: 0,
        priceAdjustmentAmount: 0,
        invoiceBalanceBefore: selectedInvoice?.remainingBalance || 0,
        lines: (effectiveFormForSave.lines || []).map((line) => {
          const allocationKey = String(line.sourceInvoiceItemId || line.id || "").trim();
          const allocations = allocationByInvoiceItemId[allocationKey] || [];
          const purchaseRate = computePurchaseRateFromAllocations(allocations, line.quantity);
          return {
            ...line,
            taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
            purchaseRate: purchaseRate || parseNumber((line as any).purchaseRate),
            returnAllocations: (Array.isArray(allocations) ? allocations : []).map((row: any) => ({
              allocationId: row?.allocation_id || "",
              batchId: row?.batch_id || "",
              batchDate: row?.batch_date || "",
              batchDocumentNo: row?.batch_document_no || "",
              allocatedQty: parseNumber(row?.allocated_qty),
              unitCostExclTax: parseNumber(row?.unit_cost_excl_tax),
              unitCostInclTax: parseNumber(row?.unit_cost_incl_tax)
            })),
            returnCondition:
              line.returnCondition === "REUSABLE" || line.returnCondition === "NOT_REUSABLE"
                ? line.returnCondition
                : "",
            creditType: "Percentage",
            creditValue: 0
          };
        }),
        actor: actorName
      });

      try {
        await creditNotesSaveRemote(saved);
      } catch (remoteError: any) {
        savedLocallyOnly = true;
        remoteSyncMessage =
          remoteError?.message || "Supabase denied access. Saved in local storage only.";
      }

      if (options?.download) exportSingleCreditNotePdf(saved);
      if (options?.email) window.alert(`Email queued for ${saved.creditNoteNo}.`);
      setRefreshKey((prev) => prev + 1);
      setActiveNote(saved);
      const nextSavedForm = formFromNote(saved);
      setForm(
        forceZeroTax
          ? {
              ...nextSavedForm,
              taxRate: 0,
              lines: nextSavedForm.lines.map((line) => ({ ...line, taxRate: 0 }))
            }
          : nextSavedForm
      );
      setForm((prev) =>
        prev
          ? {
              ...prev,
              creditType: "Full Credit",
              discountPercent: "",
              partialAmountCap: "",
              priceAdjustmentAmount: "",
              refundMode: saved.refundMode || "FULL",
              partialRefundAmount: saved.refundMode === "PARTIAL" ? String(saved.partialRefundAmount || "") : "",
              lines: (prev.lines || []).map((line) => ({
                ...line,
                taxRate: forceZeroTax ? 0 : parseNumber(line.taxRate),
                creditType: "Percentage",
                creditValue: 0
              }))
            }
          : prev
      );
      setDirty(false);
      setViewMode("edit");
      setSuccessMessage(
        savedLocallyOnly
          ? `${saved.creditNoteNo} saved locally as ${saved.status}.`
          : `${saved.creditNoteNo} saved as ${saved.status}.`
      );
      setErrorMessage(savedLocallyOnly ? remoteSyncMessage : "");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to save credit note.");
      setSuccessMessage("");
    } finally {
      setSavingStatus(null);
    }
  }

  async function removeNote(noteId: string) {
    const note = getCreditNote(noteId);
    if (!note) return;
    if (!canDeleteNote) {
      setErrorMessage("You do not have permission to delete credit notes.");
      setSuccessMessage("");
      return;
    }
    if (note.status === "Applied") {
      setErrorMessage("Applied credit notes cannot be deleted.");
      setSuccessMessage("");
      return;
    }
    const confirmed = window.confirm(`Delete ${note.creditNoteNo}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      removeCreditNote(noteId);
      await creditNotesDeleteRemote(note);
      if (activeNote?.id === noteId) {
        setViewMode("list");
        setActiveNote(null);
        setForm(null);
        setDirty(false);
      }
      setRefreshKey((prev) => prev + 1);
      setSuccessMessage(`${note.creditNoteNo} deleted successfully.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to delete credit note.");
      setSuccessMessage("");
    }
  }

  return (
    <div className="mx-auto min-h-full max-w-[1440px] space-y-3 pb-36">
      {country ? (
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 p-3.5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Credit Note</p>
              <p className="text-xs text-slate-500">Create and manage customer credit adjustments for {COUNTRY_CONFIG[country].name}.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              {COUNTRY_CONFIG[country].name}
            </div>
          </div>
        </div>
      ) : (
        <CountrySelector value={country} onChange={onCountryChange} />
      )}

      {!country ? (
        <EmptyState icon={AlertTriangle} title="Select a country to continue" description="Country is mandatory before creating or viewing credit notes." />
      ) : (
        <div className={`flex flex-col gap-3 transition-all duration-300 ${switching ? "translate-y-1 opacity-40" : "opacity-100"}`}>
          {!allowed ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have access to manage {COUNTRY_CONFIG[country].name} data.</div> : null}
          {forceZeroTax ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              GST is disabled in Company Settings. Credit Note tax is locked to 0%.
            </div>
          ) : null}

          {viewMode === "list" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="h-full rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Credit Notes</p>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{summary?.count || 0}</p>
                </div>
                <div className="h-full rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Credited Amount</p>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{formatMoney(summary?.totalAmount || 0, country)}</p>
                </div>
                <div className="h-full rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applied vs Pending</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Applied</p>
                      <p className="mt-1 font-semibold text-emerald-700">{formatMoney(summary?.appliedAmount || 0, country)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pending</p>
                      <p className="mt-1 font-semibold text-amber-700">{formatMoney(summary?.pendingAmount || 0, country)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-0 flex-[1_1_620px] flex-wrap items-end gap-3">
                    <label className={filterLabelClassName}>
                      Search
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by customer, invoice no, or credit note no"
                        className={`${filterInputClassName} search-field-input`}
                      />
                    </label>
                    <label className={filterLabelClassName}>
                      From date
                      <DateInput
                        value={fromDate}
                        onChange={(nextValue) => setFromDate(nextValue)}
                        className={filterInputClassName}
                      />
                    </label>
                    <label className={filterLabelClassName}>
                      To date
                      <DateInput
                        value={toDate}
                        onChange={(nextValue) => setToDate(nextValue)}
                        className={filterInputClassName}
                      />
                    </label>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <GradientButton className="h-10 px-4 py-0" onClick={startCreate} disabled={!canCreateNote}>
                      <Plus className="h-4 w-4" />
                      Create Credit Note
                    </GradientButton>
                    <button
                      type="button"
                      title="Export PDF"
                      aria-label="Export PDF"
                      onClick={() => exportCreditNoteSummaryPdf(filteredNotes, country)}
                      className={actionIconButtonClassName}
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Download Excel"
                      aria-label="Download Excel"
                      onClick={() => exportCreditNotesCsv(filteredNotes, country)}
                      className={actionIconButtonClassName}
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                    </button>
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
                  onDelete={removeNote}
                  canEdit={canEditNote}
                  canDelete={canDeleteNote}
                  onDownloadPdf={(noteId) => {
                    const note = getCreditNote(noteId);
                    if (note) exportSingleCreditNotePdf(note);
                  }}
                />
              )}
            </div>
          ) : form ? (
            <div className="space-y-3">
              {String(form?.linkedInvoiceId || "").trim() && selectedInvoiceCreditSummary.totalNotes > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    This invoice already has credit notes ({selectedInvoiceCreditSummary.totalNotes})
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    Applied: {selectedInvoiceCreditSummary.appliedNotes}, Issued: {selectedInvoiceCreditSummary.issuedNotes}, Draft: {selectedInvoiceCreditSummary.draftNotes}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    Applied amount: {formatMoney(selectedInvoiceCreditSummary.appliedAmount, country)} | Qty credited: {selectedInvoiceCreditSummary.creditedQty} / {selectedInvoiceCreditSummary.soldQty} | Qty available: {selectedInvoiceCreditSummary.availableQty}
                  </p>
                </div>
              ) : null}
              {editorLoading ? (
                <CreditNoteSkeleton />
              ) : (
                <CreditNoteEditor
                  country={country}
                  readOnly={viewMode === "view"}
                  form={effectiveForm || form}
                  activeNote={activeNote}
                  customers={customers}
                  invoices={invoices}
                  selectedInvoice={selectedInvoice}
                  totals={totals as any}
                  actorName={actorName}
                  access={access}
                  fieldErrors={fieldErrors}
                  savingStatus={savingStatus}
                  allocationByInvoiceItemId={allocationByInvoiceItemId}
                  allocationsLoading={allocationsLoading}
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
