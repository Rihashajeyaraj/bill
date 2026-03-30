import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileDown,
  FileSpreadsheet,
  Mail,
  Plus,
  Search,
  Save,
  X
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Badge from "../../components/Badge";
import DateInput from "../../components/DateInput";
import EmptyState from "../../components/EmptyState";
import FlowCard from "../../modules/paymentIn/FlowCard";
import FlowStepTabs from "../../modules/paymentIn/FlowStepTabs";
import PaymentModePicker from "../../modules/paymentIn/PaymentModePicker";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE } from "../../modules/paymentIn/countryConfig";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../../services/roles";
import { useOrganization } from "../../context/OrganizationContext";
import { purchasesSyncFromRemote } from "../../services/purchases.service";
import { deletePaymentOutRemote, syncPaymentOutRemote } from "../../services/payments.service";
import { syncPartiesFromRemote } from "../../modules/parties/store";
import { LS_KEYS, lsGetOrganizationScoped } from "../../services/storage";
import {
  buildPaymentOutPayload,
  defaultPaymentForm,
  listSupplierAdvanceWalletHistory,
  listPaymentOut,
  mapOpenBillsByCountry,
  mapSuppliersByCountry,
  outstandingBySupplier,
  paymentInsightsBySupplier,
  removePaymentOut,
  savePaymentOut,
  summarizePaymentOut
} from "../../modules/paymentOut/store";
import { exportPaymentOutCsv, exportPaymentOutPdf, exportPaymentOutSummaryPdf } from "../../modules/paymentOut/pdf";
import {
  calculateTdsAmount,
  formatMoney,
  getTdsRateForCategory,
  isCustomTdsCategory,
  normalizeText,
  parseNumber,
  TDS_CATEGORY_OPTIONS
} from "../../modules/paymentOut/utils";
import { formatInputNumberByPreference, normalizeFormattedNumberInput } from "../../lib/formatPreferences";

const PAYMENT_MODES = ["Cash", "Net Banking", "Cheque", "Card", "UPI"];
const STATUSES = ["Draft", "Paid", "Applied"];
const FORM_STEPS = ["Supplier & Country", "Payment Details", "Review & Confirm"];

const ACTION_BAR_BASE =
  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold";

function statusBadge(status) {
  if (status === "Applied") return "success";
  if (status === "Paid") return "warning";
  return "neutral";
}

function normalizePhoneForLookup(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function supplierAddressSummary(supplier) {
  return [supplier?.address, supplier?.state, supplier?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function buildBillAllocation(bill, amountPaid, tdsAmount = 0) {
  if (!bill) return [];
  const amount = Math.max(0, parseNumber(amountPaid));
  const tds = Math.max(0, parseNumber(tdsAmount));
  const cashPayable = Math.max(0, parseNumber(bill.balanceDue) - Math.min(tds, parseNumber(bill.balanceDue)));
  return [
    {
      billId: bill.id,
      billNo: bill.billNo,
      billDate: bill.billDate,
      billAmount: bill.billAmount,
      balanceDue: bill.balanceDue,
      applyAmount: Math.min(amount, cashPayable)
    }
  ];
}

function calculatedTdsInputValue(amountPaid, tdsRate) {
  return String(calculateTdsAmount(amountPaid, tdsRate));
}

function autoTdsBaseAmount(bill, allocationMode, fallbackAmount) {
  if (allocationMode === "linked") {
    const taxableAmount = Math.max(0, parseNumber(bill?.taxableAmount));
    if (taxableAmount > 0) return taxableAmount;
  }
  return Math.max(0, parseNumber(fallbackAmount));
}

function normalizePaymentMode(value) {
  const mode = String(value || "").trim();
  if (mode === "Bank Transfer") return "Net Banking";
  if (mode === "Online") return "UPI";
  if (PAYMENT_MODES.includes(mode)) return mode;
  return "Cash";
}

function paymentModeLabel(value) {
  return normalizePaymentMode(value);
}

function resolveFixedCountry(organizationCountry, organizationCountryCode) {
  const rawCode = String(organizationCountryCode || "").trim().toUpperCase();
  if (rawCode === "LK") return "SL";
  if (rawCode === "GB") return "UK";
  if (rawCode && rawCode in COUNTRY_CONFIG) return rawCode;

  const raw = String(organizationCountry || "").trim();
  if (raw && raw in COUNTRY_CONFIG) return raw;
  if (raw && COUNTRY_NAME_TO_CODE[raw]) return COUNTRY_NAME_TO_CODE[raw];
  return "IN";
}

function paymentOutFormFromRecord(record) {
  const storedAmountPaid = record?.amountPaid ?? record?.totals?.amountPaid ?? 0;
  const storedTdsAmount = record?.tdsAmount ?? record?.totals?.tdsAmount ?? 0;
  const storedCategory = record?.tdsCategory || TDS_CATEGORY_OPTIONS[0].value;
  const storedTdsRate = Math.max(0, parseNumber(record?.tdsRate ?? getTdsRateForCategory(storedCategory)));
  const inferredManual =
    typeof record?.isManual === "boolean"
      ? record.isManual
      : Math.abs(parseNumber(storedTdsAmount) - calculateTdsAmount(storedAmountPaid, storedTdsRate)) > 0.009;

  return {
    ...record,
    paymentMode: normalizePaymentMode(record?.paymentMode),
    amountPaid: storedAmountPaid,
    tdsAmount: String(storedTdsAmount),
    tdsCategory: inferredManual ? "custom" : storedCategory,
    tdsRate: String(inferredManual ? 0 : storedTdsRate),
    isManual: inferredManual,
    desiredStatus: record?.status || "Draft",
    allocationMode: record?.allocations?.length ? "linked" : "normal",
    selectedBillId: record?.allocations?.[0]?.billId || "",
    readOnly: false
  };
}

export default function PaymentOutPremium() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    country = "India",
    countryCode = "IN",
    currency = "",
    currencySymbol = ""
  } = useOrganization();
  const user = authGetUser();
  const role = authGetRole();
  const canCreatePayment = canCreateEntries(role);
  const canEditPayment = canEditEntries(role);
  const canDeletePayment = canDeleteEntries(role);
  const actorName = user?.name || user?.email || "System User";
  const fixedCountry = useMemo(() => resolveFixedCountry(country, countryCode), [country, countryCode]);
  const countryConfig = COUNTRY_CONFIG[fixedCountry] || COUNTRY_CONFIG.IN;
  const countryLabel = countryConfig.name;
  const effectiveCurrency = currency && String(currency).trim().length === 3 ? currency : countryConfig.currency;

  const [panelMode, setPanelMode] = useState("feed");
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState(defaultPaymentForm(country, effectiveCurrency));
  const [activePayment, setActivePayment] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [supplierLookupQuery, setSupplierLookupQuery] = useState("");
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const prefillBillId = searchParams.get("billId") || "";

  const payments = useMemo(() => listPaymentOut(country), [country, refreshKey]);
  const suppliers = useMemo(() => mapSuppliersByCountry(country), [country, refreshKey]);
  const bills = useMemo(() => mapOpenBillsByCountry(country), [country, refreshKey]);
  const summary = useMemo(() => summarizePaymentOut(country), [country, refreshKey]);

  const selectedSupplier = useMemo(
    () => suppliers.find((entry) => entry.id === form.supplierId) || null,
    [suppliers, form.supplierId]
  );
  const supplierBills = useMemo(
    () =>
      bills.filter(
        (entry) =>
          String(entry.supplierId) === String(form.supplierId) &&
          Math.max(0, parseNumber(entry?.balanceDue)) > 0
      ),
    [bills, form.supplierId]
  );
  const selectedBill = useMemo(() => {
    const liveBill = supplierBills.find((entry) => String(entry.id) === String(form.selectedBillId));
    if (liveBill) return liveBill;
    const savedBill = form?.allocations?.[0];
    if (!savedBill) return null;
    return {
      id: savedBill.billId,
      billNo: savedBill.billNo,
      billDate: savedBill.billDate,
      supplierId: form.supplierId,
      supplierName: form.supplierName,
      billAmount: savedBill.billAmount,
      balanceDue: savedBill.balanceDue,
      taxableAmount: savedBill.taxableAmount || 0,
      taxAmount: savedBill.taxAmount || 0
    };
  }, [form.allocations, form.selectedBillId, form.supplierId, form.supplierName, supplierBills]);
  const supplierOutstandingBefore = useMemo(
    () => (form.supplierId ? outstandingBySupplier(country, form.supplierId) : 0),
    [country, form.supplierId, refreshKey]
  );

  const amountPaid = Math.max(0, parseNumber(form.amountPaid));
  const tdsAmount = Math.max(0, parseNumber(form.tdsAmount));
  const linkedCashPayable = selectedBill
    ? Math.max(0, parseNumber(selectedBill.balanceDue) - Math.min(tdsAmount, parseNumber(selectedBill.balanceDue)))
    : 0;
  const amountApplied = form.allocations.reduce((sum, line) => sum + parseNumber(line.applyAmount), 0);
  const unappliedAmount = Math.max(0, amountPaid - amountApplied);
  const totalSettled = amountPaid + tdsAmount;
  const outstandingAfter = supplierOutstandingBefore - totalSettled;

  const filteredPayments = useMemo(() => {
    const query = normalizeText(search);
    return payments.filter((entry) => {
      const haystack = `${entry.supplierName} ${entry.paymentNo} ${entry.referenceNo || ""}`.toLowerCase();
      const matchQuery = !query || haystack.includes(query);
      const matchSupplier = !supplierFilter || entry.supplierId === supplierFilter;
      const matchStatus = !statusFilter || entry.status === statusFilter;
      const matchMode =
        !modeFilter || normalizePaymentMode(entry.paymentMode) === normalizePaymentMode(modeFilter);
      const matchFrom = fromDate ? entry.paymentDate >= fromDate : true;
      const matchTo = toDate ? entry.paymentDate <= toDate : true;
      return matchQuery && matchSupplier && matchStatus && matchMode && matchFrom && matchTo;
    });
  }, [payments, search, supplierFilter, statusFilter, modeFilter, fromDate, toDate]);

  const supplierLookupResults = useMemo(() => {
    const query = String(supplierLookupQuery || "").trim().toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(query);
    return suppliers
      .filter((supplier) => {
        const text = [
          supplier?.name,
          supplier?.email,
          supplier?.address,
          supplier?.state,
          supplier?.country
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const supplierPhone = normalizePhoneForLookup(supplier?.phone);
        return (
          text.includes(query) ||
          (normalizedPhoneQuery && supplierPhone && supplierPhone.includes(normalizedPhoneQuery))
        );
      })
      .slice(0, 8);
  }, [suppliers, supplierLookupQuery]);

  const supplierInsights = useMemo(
    () =>
      form.supplierId
        ? paymentInsightsBySupplier(country, form.supplierId)
        : { lastPaymentDate: "", advanceWallet: 0, totalPaid: 0, paymentCount: 0 },
    [country, form.supplierId, payments]
  );
  const supplierLastPayment = supplierInsights.lastPaymentDate || "";
  const supplierAdvanceWallet = Math.max(0, parseNumber(supplierInsights.advanceWallet));
  const supplierAdvanceHistory = useMemo(
    () => (form.supplierId ? listSupplierAdvanceWalletHistory(country, form.supplierId).slice(0, 12) : []),
    [country, form.supplierId, payments]
  );
  const autoCalculatedTdsAmount = useMemo(
    () => calculateTdsAmount(autoTdsBaseAmount(selectedBill, form.allocationMode, form.amountPaid), form.tdsRate),
    [selectedBill, form.allocationMode, form.amountPaid, form.tdsRate]
  );

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

  useEffect(() => {
    if (!prefillBillId) return;
    let bill = bills.find((entry) => entry.id === prefillBillId) || null;
    if (!bill) {
      const cached = lsGetOrganizationScoped(LS_KEYS.purchases, []);
      const rawBills = Array.isArray(cached) ? cached : [];
      const rawBill = rawBills.find((entry) => String(entry?.id) === String(prefillBillId));
      if (rawBill) {
        bill = {
          id: rawBill.id,
          billNo: rawBill.billNumber || rawBill.invoiceNo || rawBill.id,
          billDate: rawBill.billDate || rawBill.invoiceDate || rawBill.date || "",
          supplierId: rawBill.partyId || rawBill.supplierId || rawBill.vendorId || "",
          supplierName: rawBill.partyName || rawBill.supplierName || "Supplier",
          billAmount: Math.max(
            0,
            parseNumber(
              rawBill?.totals?.finalTotal ??
                rawBill?.totals?.grandTotal ??
                rawBill?.totals?.total ??
                rawBill?.totals?.subTotal
            )
          ),
          balanceDue: Math.max(
            0,
            parseNumber(
              rawBill?.totals?.balance ??
                rawBill?.remainingBalance ??
                rawBill?.totals?.grandTotal ??
                rawBill?.totals?.total
            )
          )
        };
      }
    }
    if (!bill) return;

    setForm(() => ({
      ...defaultPaymentForm(country, effectiveCurrency),
      supplierId: bill.supplierId,
      supplierName: bill.supplierName,
      allocationMode: "linked",
      selectedBillId: bill.id,
      allocations: buildBillAllocation(bill, 0)
    }));
    setPanelMode("flow");
    setActiveStep(1);
    setDirty(false);

    const next = new URLSearchParams(searchParams);
    next.delete("billId");
    setSearchParams(next, { replace: true });
  }, [prefillBillId, bills, country, currency, searchParams, setSearchParams]);

  function startNew() {
    if (!canCreatePayment) {
      window.alert("You do not have permission to create payment out entries.");
      return;
    }
    setForm(defaultPaymentForm(country, effectiveCurrency));
    setActivePayment(null);
    setPanelMode("flow");
    setActiveStep(0);
    setDirty(false);
    setSupplierLookupQuery("");
    setSupplierSearchError("");
  }

  function openRecord(record, mode) {
    if (mode === "edit" && !canEditPayment) {
      window.alert("You do not have permission to edit payment out entries.");
      return;
    }
    setForm(paymentOutFormFromRecord(record));
    setActivePayment(record);
    setPanelMode("flow");
    setActiveStep(mode === "view" ? 2 : 0);
    setDirty(false);
    if (mode === "view") {
      setForm((prev) => ({ ...prev, readOnly: true }));
    }
  }

  function backToList() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setPanelMode("feed");
    setActiveStep(0);
    setForm(defaultPaymentForm(country, effectiveCurrency));
    setActivePayment(null);
    setDirty(false);
    setSupplierLookupQuery("");
    setSupplierSearchError("");
  }

  function updateField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "amountPaid" && next.allocationMode === "linked" && next.selectedBillId) {
        const linkedBill =
          bills.find(
            (entry) =>
              String(entry.id) === String(next.selectedBillId) &&
              String(entry.supplierId) === String(next.supplierId)
          ) || null;
        next.allocations = buildBillAllocation(linkedBill, value, next.tdsAmount);
      }
      return next;
    });
    setDirty(true);
  }

  function handleAmountPaidChange(value) {
    setForm((prev) => {
      const next = { ...prev, amountPaid: value };
      if (next.allocationMode === "linked" && next.selectedBillId) {
        const linkedBill =
          bills.find(
            (entry) =>
              String(entry.id) === String(next.selectedBillId) &&
              String(entry.supplierId) === String(next.supplierId)
          ) || null;
        if (!next.isManual) {
          next.tdsAmount = calculatedTdsInputValue(
            autoTdsBaseAmount(linkedBill, next.allocationMode, value),
            next.tdsRate
          );
        }
        next.allocations = buildBillAllocation(linkedBill, value, next.tdsAmount);
        return next;
      }
      if (!next.isManual) {
        next.tdsAmount = calculatedTdsInputValue(
          autoTdsBaseAmount(null, next.allocationMode, value),
          next.tdsRate
        );
      }
      return next;
    });
    setDirty(true);
  }

  function handleTdsAmountChange(value) {
    setForm((prev) => {
      const next = {
        ...prev,
        tdsAmount: value,
        tdsCategory: "custom",
        tdsRate: "0",
        isManual: true
      };
      if (next.allocationMode === "linked" && next.selectedBillId) {
        const linkedBill =
          bills.find(
            (entry) =>
              String(entry.id) === String(next.selectedBillId) &&
              String(entry.supplierId) === String(next.supplierId)
          ) || null;
        next.allocations = buildBillAllocation(linkedBill, next.amountPaid, value);
      }
      return next;
    });
    setDirty(true);
  }

  function handleTdsCategoryChange(category) {
    const nextRate = getTdsRateForCategory(category);
    setForm((prev) =>
      isCustomTdsCategory(category)
        ? {
            ...prev,
            tdsCategory: category,
            tdsRate: String(nextRate),
            isManual: true
          }
        : {
            ...prev,
            tdsCategory: category,
            tdsRate: String(nextRate),
            tdsAmount: calculatedTdsInputValue(
              autoTdsBaseAmount(selectedBill, prev.allocationMode, prev.amountPaid),
              nextRate
            ),
            isManual: false,
            allocations:
              prev.allocationMode === "linked"
                ? buildBillAllocation(selectedBill, prev.amountPaid, calculatedTdsInputValue(
                    autoTdsBaseAmount(selectedBill, prev.allocationMode, prev.amountPaid),
                    nextRate
                  ))
                : prev.allocations
          }
    );
    setDirty(true);
  }

  function applyCalculatedTds() {
    setForm((prev) => {
      const nextTdsAmount = calculatedTdsInputValue(
        autoTdsBaseAmount(selectedBill, prev.allocationMode, prev.amountPaid),
        prev.tdsRate
      );
      return {
        ...prev,
        tdsAmount: nextTdsAmount,
        isManual: false,
        allocations:
          prev.allocationMode === "linked"
            ? buildBillAllocation(selectedBill, prev.amountPaid, nextTdsAmount)
            : prev.allocations
      };
    });
    setDirty(true);
  }

  function updateSupplier(supplierId) {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    setForm((prev) => ({
      ...prev,
      supplierId,
      supplierName: supplier?.name || "",
      allocationMode: "normal",
      selectedBillId: "",
      allocations: []
    }));
    setDirty(true);
  }

  function updateAllocationMode(mode) {
    setForm((prev) => {
      if (mode === "normal") {
        return {
          ...prev,
          allocationMode: "normal",
          selectedBillId: "",
          allocations: []
        };
      }
      const linkedBill = supplierBills.find((entry) => String(entry.id) === String(prev.selectedBillId)) || null;
      const next = {
        ...prev,
        allocationMode: "linked",
        allocations: buildBillAllocation(linkedBill, prev.amountPaid, prev.tdsAmount)
      };
      if (!next.isManual) {
        next.tdsAmount = calculatedTdsInputValue(
          autoTdsBaseAmount(linkedBill, next.allocationMode, next.amountPaid),
          next.tdsRate
        );
      }
      return next;
    });
    setDirty(true);
  }

  function handleBillSelection(billId) {
    const linkedBill = supplierBills.find((entry) => String(entry.id) === String(billId)) || null;
    setForm((prev) => {
      const next = {
        ...prev,
        allocationMode: "linked",
        selectedBillId: linkedBill?.id || "",
        allocations: buildBillAllocation(linkedBill, prev.amountPaid, prev.tdsAmount)
      };
      if (!next.isManual) {
        next.tdsAmount = calculatedTdsInputValue(
          autoTdsBaseAmount(linkedBill, next.allocationMode, next.amountPaid),
          next.tdsRate
        );
      }
      return next;
    });
    setDirty(true);
  }

  function applySupplierSelection(supplier) {
    if (!supplier) return;
    updateSupplier(supplier.id);
    setSupplierLookupQuery("");
    setSupplierSearchError("");
  }

  function handleSupplierLookupChange(value) {
    setSupplierLookupQuery(value);
    setSupplierSearchError("");
  }

  function handleSupplierSearch() {
    const query = String(supplierLookupQuery || "").trim();
    if (query.length < 2) {
      setSupplierSearchError("Enter at least 2 characters to search.");
      return;
    }
    if (supplierLookupResults.length === 1) {
      applySupplierSelection(supplierLookupResults[0]);
      return;
    }
    if (!supplierLookupResults.length) {
      setSupplierSearchError("No supplier found for this search.");
      return;
    }
    setSupplierSearchError("Multiple suppliers found. Choose one from the list below.");
  }

  function resetSupplierSelection() {
    setForm((prev) => ({
      ...prev,
      supplierId: "",
      supplierName: "",
      allocationMode: "normal",
      selectedBillId: "",
      allocations: []
    }));
    setDirty(true);
    setSupplierLookupQuery("");
    setSupplierSearchError("");
  }

  async function persist(status, options = {}) {
    const isEditMode = !!form?.id;
    if (isEditMode && !canEditPayment) {
      window.alert("You do not have permission to edit payment out entries.");
      return;
    }
    if (!isEditMode && !canCreatePayment) {
      window.alert("You do not have permission to create payment out entries.");
      return;
    }
    if (!form.supplierId) {
      window.alert("Select a supplier before saving.");
      return;
    }
    if (form.allocationMode === "linked" && !form.selectedBillId) {
      window.alert("Select a purchase invoice before saving.");
      return;
    }
    if (Math.max(0, parseNumber(form.amountPaid)) <= 0) {
      window.alert("Amount paid must be greater than zero.");
      return;
    }
    if (parseNumber(form.tdsAmount) < 0) {
      window.alert("TDS amount cannot be negative.");
      return;
    }
    if (Math.max(0, parseNumber(form.tdsAmount)) > Math.max(0, parseNumber(form.amountPaid))) {
      window.alert("TDS amount cannot exceed amount paid.");
      return;
    }
    try {
      const payload = buildPaymentOutPayload(
        {
          ...form,
          desiredStatus:
            form.allocationMode === "linked" && form.allocations.length ? "Applied" : status,
          supplierName: selectedSupplier?.name || form.supplierName
        },
        supplierOutstandingBefore,
        actorName
      );
      const saved = savePaymentOut(payload);
      await syncPaymentOutRemote(saved);
      if (options?.download) {
        exportPaymentOutPdf(saved);
      }
      setActivePayment(saved);
      setForm(paymentOutFormFromRecord(saved));
      setRefreshKey((prev) => prev + 1);
      setDirty(false);
      window.alert(`Payment ${saved.paymentNo} saved as ${saved.status}.`);
    } catch (error) {
      window.alert(error?.message || "Unable to save payment.");
    }
  }

  async function removeRecord(record) {
    if (!canDeletePayment) {
      window.alert("You do not have permission to delete payment out entries.");
      return;
    }
    if (String(record?.status || "") === "Applied") {
      window.alert("Applied payment out entries cannot be deleted.");
      return;
    }
    if (!window.confirm(`Delete ${record?.paymentNo || "this payment"}? This cannot be undone.`)) return;
    try {
      removePaymentOut(record.id);
      await deletePaymentOutRemote(record.id);
      if (activePayment?.id === record.id) {
        setPanelMode("feed");
        setActiveStep(0);
        setForm(defaultPaymentForm(country, effectiveCurrency));
        setActivePayment(null);
        setDirty(false);
      }
      setRefreshKey((prev) => prev + 1);
      window.alert(`Payment ${record?.paymentNo || ""} deleted.`);
    } catch (error) {
      window.alert(error?.message || "Unable to delete payment.");
    }
  }

  const readOnly = !!form.readOnly;
  const canSaveCurrentFlow = form?.id ? canEditPayment : canCreatePayment;
  const confirmStatus = form.allocationMode === "linked" && form.allocations.length ? "Applied" : "Paid";
  const hasPreviousStep = activeStep > 0;
  const hasNextStep = activeStep < FORM_STEPS.length - 1;

  return (
    <div className="mx-auto min-h-full max-w-[1360px] space-y-4 pb-32">
      <div className="z-30 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white/95 to-slate-50/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">Payment Out</p>
            <p className="text-xs text-slate-500">Pay money to suppliers</p>
          </div>
          <div className="mx-auto w-full max-w-xs rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-700 sm:mx-0 sm:flex-1 sm:max-w-sm">
            {countryLabel} | {effectiveCurrency}
          </div>
          <button
            type="button"
            onClick={startNew}
            disabled={!canCreatePayment}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New Payment
          </button>
        </div>
      </div>
      {panelMode === "feed" ? (
      <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FlowCard title="Total Payments" subtitle="Count of supplier payments">
              <p className="text-2xl font-bold text-slate-900">{summary.count}</p>
            </FlowCard>
            <FlowCard title="Cash Paid" subtitle="Actual outgoing payment">
              <p className="text-2xl font-bold text-slate-900">{formatMoney(summary.totalPaid, effectiveCurrency)}</p>
            </FlowCard>
            <FlowCard title="Total TDS" subtitle="Deducted on supplier payments">
              <p className="text-2xl font-bold text-sky-700">{formatMoney(summary.totalTds, effectiveCurrency)}</p>
            </FlowCard>
            <FlowCard title="Cash Advance Balance" subtitle="Cash kept on supplier account">
              <p className="text-2xl font-bold text-emerald-700">{formatMoney(summary.totalUnapplied, effectiveCurrency)}</p>
            </FlowCard>
          </div>

          <FlowCard>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search supplier, payment number, reference"
                  className="search-field-input h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"
                />
                <select
                  value={supplierFilter}
                  onChange={(event) => setSupplierFilter(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"
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
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"
                >
                  <option value="">All Modes</option>
                  {countryConfig.paymentModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"
                >
                  <option value="">All Status</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <DateInput
                  value={fromDate}
                  onChange={(nextValue) => setFromDate(nextValue)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"
                />
                <DateInput
                  value={toDate}
                  onChange={(nextValue) => setToDate(nextValue)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"
                />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportPaymentOutSummaryPdf(filteredPayments, country, effectiveCurrency)}
                  disabled={!filteredPayments.length}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Summary PDF
                </button>
                <button
                  type="button"
                  onClick={() => exportPaymentOutCsv(filteredPayments, effectiveCurrency, countryLabel)}
                  disabled={!filteredPayments.length}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  CSV
                </button>
            </div>
          </FlowCard>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Payment No</th>
                    <th className="px-3 py-3 font-semibold">Date</th>
                    <th className="px-3 py-3 font-semibold">Supplier</th>
                    <th className="px-3 py-3 font-semibold">Mode</th>
                    <th className="px-3 py-3 font-semibold">Reference</th>
                    <th className="px-3 py-3 font-semibold text-right">Cash Paid</th>
                    <th className="px-3 py-3 font-semibold text-right">TDS</th>
                    <th className="px-3 py-3 font-semibold text-right">Total Settled</th>
                    <th className="px-3 py-3 font-semibold text-right">Cash Advance</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.length ? (
                    filteredPayments.map((entry) => {
                      const advance = Math.max(0, parseNumber(entry?.totals?.unappliedAmount));
                      const entryTds = Math.max(0, parseNumber(entry?.totals?.tdsAmount));
                      const entryTotalSettled = Math.max(0, parseNumber(entry?.totals?.totalSettled));
                      return (
                        <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="px-3 py-3 font-semibold text-slate-900">{entry.paymentNo}</td>
                          <td className="px-3 py-3 text-slate-700">{entry.paymentDate}</td>
                          <td className="px-3 py-3 text-slate-700">{entry.supplierName}</td>
                          <td className="px-3 py-3 text-slate-700">{paymentModeLabel(entry.paymentMode)}</td>
                          <td className="px-3 py-3 text-slate-700">{entry.referenceNo || "-"}</td>
                          <td className="px-3 py-3 text-right text-slate-700">
                            {formatMoney(entry.totals?.amountPaid, effectiveCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right text-slate-700">
                            {formatMoney(entryTds, effectiveCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900">
                            {formatMoney(entryTotalSettled, effectiveCurrency)}
                          </td>
                          <td className={`px-3 py-3 text-right font-semibold ${advance ? "text-emerald-700" : "text-slate-700"}`}>
                            {advance ? formatMoney(advance, effectiveCurrency) : "-"}
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone={statusBadge(entry.status)}>{entry.status}</Badge>
                          </td>
                          <td className="px-3 py-3">
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
                                disabled={!canEditPayment}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRecord(entry)}
                                disabled={!canDeletePayment || entry.status === "Applied"}
                                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Delete
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
                      <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                        No payments found. Create a new payment to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={backToList}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          <FlowStepTabs steps={FORM_STEPS} activeStep={activeStep} onChange={setActiveStep} />

          {activeStep === 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <FlowCard title="Country Context" subtitle="Auto updates currency and payment numbering">
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                    {countryLabel}
                  </div>
                  <p className="text-sm text-slate-700">
                    Currency: <span className="font-semibold">{effectiveCurrency}</span>
                  </p>
                  <p className="text-xs text-slate-500">Payment Out is locked to {countryLabel}.</p>
                  <p className="text-sm text-slate-700">
                    Payment Number: <span className="font-semibold">{form.paymentNo || "Auto-generated on save"}</span>
                  </p>
                  <p className="text-xs text-slate-500">Payment Out flow records supplier settlements and keeps any balance as advance.</p>
                </div>
              </FlowCard>

              <FlowCard title="Supplier" subtitle="Search and pick a supplier to begin">
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Payment Date</span>
                    <DateInput
                      value={form.paymentDate}
                      onChange={(nextValue) => updateField("paymentDate", nextValue)}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      disabled={readOnly}
                    />
                  </label>
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600">Supplier Search</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={supplierLookupQuery}
                        onChange={(event) => handleSupplierLookupChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleSupplierSearch();
                          }
                        }}
                        placeholder="Search customer/supplier by name, phone, email, or address"
                        disabled={readOnly}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:bg-slate-100 sm:min-w-[220px]"
                      />
                      <button
                        type="button"
                        onClick={handleSupplierSearch}
                        disabled={readOnly}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Search className="h-3.5 w-3.5" />
                        Search
                      </button>
                    </div>
                    {supplierSearchError ? (
                      <p className="text-xs font-medium text-rose-600">{supplierSearchError}</p>
                    ) : null}
                    {supplierLookupQuery.trim() ? (
                      supplierLookupResults.length ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {supplierLookupResults.map((supplier) => (
                            <button
                              key={supplier.id}
                              type="button"
                              onClick={() => applySupplierSelection(supplier)}
                              disabled={readOnly}
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
                  </div>
                  {selectedSupplier ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                      <p className="font-semibold text-slate-900">{selectedSupplier.name || "-"}</p>
                      <p className="mt-1 text-slate-500">{selectedSupplier.phone || "-"}</p>
                      <p className="mt-1 text-slate-500">{selectedSupplier.email || "-"}</p>
                      <p className="mt-1 text-slate-500">{supplierAddressSummary(selectedSupplier) || "-"}</p>
                    </div>
                  ) : null}
                  {form.supplierId ? (
                    <button
                      type="button"
                      onClick={resetSupplierSelection}
                      disabled={readOnly}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear Selection
                    </button>
                  ) : null}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">Outstanding</p>
                      <p className="font-semibold text-slate-900">{formatMoney(supplierOutstandingBefore, effectiveCurrency)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">Last Payment</p>
                      <p className="font-semibold text-slate-900">{supplierLastPayment || "-"}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-slate-500">Available Advance Balance</p>
                      <p className="font-semibold text-emerald-700">{formatMoney(supplierAdvanceWallet, effectiveCurrency)}</p>
                    </div>
                  </div>
                  {supplierAdvanceHistory.length ? (
                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-700">Advance Wallet History</p>
                      </div>
                      <div className="max-h-52 overflow-auto">
                        <table className="w-full min-w-[720px] text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Date</th>
                              <th className="px-3 py-2 font-semibold">Payment</th>
                              <th className="px-3 py-2 font-semibold">Bill</th>
                              <th className="px-3 py-2 text-right font-semibold">Advance Added</th>
                              <th className="px-3 py-2 text-right font-semibold">Advance Used</th>
                              <th className="px-3 py-2 text-right font-semibold">Remaining Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {supplierAdvanceHistory.map((entry) => (
                              <tr key={entry.id} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-slate-700">{entry.date || "-"}</td>
                                <td className="px-3 py-2 text-slate-700">{entry.paymentNo || "-"}</td>
                                <td className="px-3 py-2 text-slate-700">{entry.billNo || "-"}</td>
                                <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                  {entry.amountAdded > 0 ? formatMoney(entry.amountAdded, effectiveCurrency) : "-"}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-sky-700">
                                  {entry.amountUsed > 0 ? formatMoney(entry.amountUsed, effectiveCurrency) : "-"}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                  {formatMoney(entry.remainingBalance, effectiveCurrency)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              </FlowCard>
            </div>
          ) : null}

          {activeStep === 1 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <FlowCard title="Payment Details" subtitle="Capture amount and mode details">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">Cash Paid</span>
                      <input
                        type="text"
                        value={formatInputNumberByPreference(form.amountPaid)}
                        onChange={(event) => handleAmountPaidChange(normalizeFormattedNumberInput(event.target.value))}
                        inputMode="decimal"
                        className="numeric-input-uniform mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-2xl font-bold text-slate-900 outline-none focus:ring-4 focus:ring-slate-200"
                        disabled={readOnly || !form.supplierId}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">TDS Amount</span>
                      <input
                        type="number"
                        min={0}
                        value={form.tdsAmount}
                        onChange={(event) => handleTdsAmountChange(event.target.value)}
                        inputMode="decimal"
                        className="numeric-input-uniform mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-2xl font-bold text-slate-900 outline-none focus:ring-4 focus:ring-slate-200"
                        disabled={readOnly || !form.supplierId}
                      />
                    </label>
                  </div>
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <label className="block min-w-0 flex-1 sm:min-w-[220px]">
                        <span className="text-xs font-semibold text-slate-600">TDS Category</span>
                        <select
                          value={form.tdsCategory}
                          disabled={readOnly || !form.supplierId}
                          onChange={(event) => handleTdsCategoryChange(event.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          {TDS_CATEGORY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.rate}%)
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="sm:text-right">
                        <p className="text-xs font-semibold text-slate-600">
                          {form.isManual
                            ? `Manual TDS: ${formatMoney(parseNumber(form.tdsAmount), effectiveCurrency)}`
                            : `Auto TDS (${parseNumber(form.tdsRate).toFixed(2)}%): ${formatMoney(autoCalculatedTdsAmount, effectiveCurrency)}`}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {form.isManual
                            ? "Manual mode is active. Select any non-custom TDS category to auto-calculate again."
                            : "Auto-calculation stays in sync until you manually edit the TDS amount."}
                        </p>
                        <button
                          type="button"
                          disabled={readOnly || form.isManual || isCustomTdsCategory(form.tdsCategory)}
                          onClick={applyCalculatedTds}
                          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Use Auto Value
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-slate-600">Is this payment for a specific invoice?</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => updateAllocationMode("linked")}
                        disabled={readOnly || !form.supplierId}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                          form.allocationMode === "linked"
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        Yes - Pay against Invoice
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAllocationMode("normal")}
                        disabled={readOnly}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                          form.allocationMode === "normal"
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        No - Normal Payment Entry
                      </button>
                    </div>
                    {!form.supplierId ? (
                      <p className="mt-2 text-xs text-slate-500">Select a supplier first to load purchase invoice options.</p>
                    ) : null}
                  </div>
                  {form.allocationMode === "linked" ? (
                    <label className="block">
                      <span className="text-xs font-semibold text-slate-600">Purchase Invoice</span>
                      <select
                        value={form.selectedBillId}
                        onChange={(event) => handleBillSelection(event.target.value)}
                        disabled={readOnly || !form.supplierId || !supplierBills.length}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">
                          {supplierBills.length
                            ? "Select purchase invoice"
                            : "No pending purchase invoices for this supplier"}
                        </option>
                        {supplierBills.map((bill) => (
                          <option key={bill.id} value={bill.id}>
                            {`Invoice - ${bill.billNo} | ${bill.billDate || "-"} | Pending: ${formatMoney(bill.balanceDue, effectiveCurrency)}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
                      Normal Payment Entry selected. This payment will be saved without linking to any purchase invoice.
                    </div>
                  )}
                  {form.allocationMode === "linked" && selectedBill ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                      <p className="font-semibold">Invoice - {selectedBill.billNo}</p>
                      <p className="mt-1">
                        Date: {selectedBill.billDate || "-"} | Pending: {formatMoney(selectedBill.balanceDue, effectiveCurrency)}
                      </p>
                      <p className="mt-1">
                        Taxable: {formatMoney(selectedBill.taxableAmount, effectiveCurrency)} | Tax: {formatMoney(selectedBill.taxAmount, effectiveCurrency)}
                      </p>
                      <p className="mt-1">
                        TDS Deducted: {formatMoney(tdsAmount, effectiveCurrency)} | Net Cash Payable: {formatMoney(linkedCashPayable, effectiveCurrency)}
                      </p>
                      <p className="mt-1">
                        Cash Applied: {formatMoney(amountApplied, effectiveCurrency)} | TDS Settled: {formatMoney(tdsAmount, effectiveCurrency)}
                      </p>
                      <p className="mt-1">Total Settled: {formatMoney(totalSettled, effectiveCurrency)}</p>
                    </div>
                  ) : null}
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Payment Mode</span>
                    <div className="mt-1">
                      <PaymentModePicker
                        options={PAYMENT_MODES}
                        value={form.paymentMode}
                        onChange={(mode) => {
                          if (readOnly) return;
                          updateField("paymentMode", mode);
                        }}
                      />
                    </div>
                  </label>
                  {form.paymentMode === "Net Banking" ? (
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
                  {form.paymentMode === "Card" || form.paymentMode === "UPI" ? (
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

              <FlowCard title="Advance Handling" subtitle="Cash advance after invoice allocation">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">Cash Advance Balance</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-700">{formatMoney(unappliedAmount, effectiveCurrency)}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {form.allocationMode === "linked"
                        ? "Any cash amount above the selected invoice pending amount stays on the supplier account as advance. TDS is treated as settlement, not cash advance."
                        : "Normal payment entries are saved without purchase invoice linking."}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">Total Settlement</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(totalSettled, effectiveCurrency)}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Cash paid {formatMoney(amountPaid, effectiveCurrency)} + TDS {formatMoney(tdsAmount, effectiveCurrency)}
                    </p>
                  </div>
                  {!form.supplierId ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      Select a supplier to continue.
                    </div>
                  ) : null}
                </div>
              </FlowCard>
            </div>
          ) : null}

          {activeStep === 2 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <FlowCard title="Review & Confirm" subtitle="Final check before posting this payment">
                <div className="space-y-3 text-sm">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Supplier</p>
                    <p className="font-semibold text-slate-900">{selectedSupplier?.name || form.supplierName || "-"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {countryLabel} | {effectiveCurrency}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-slate-500">Cash Paid</p>
                      <p className="text-base font-semibold text-slate-900">{formatMoney(amountPaid, effectiveCurrency)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-slate-500">TDS Amount</p>
                      <p className="text-base font-semibold text-sky-700">{formatMoney(tdsAmount, effectiveCurrency)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-slate-500">Total Settled</p>
                      <p className="text-base font-semibold text-emerald-700">{formatMoney(totalSettled, effectiveCurrency)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-slate-500">Cash Advance</p>
                      <p className="text-base font-semibold text-amber-700">{formatMoney(unappliedAmount, effectiveCurrency)}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Extra paid amount stays on the supplier account.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-slate-500">Payment Mode</p>
                      <p className="text-base font-semibold text-slate-900">{paymentModeLabel(form.paymentMode)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-slate-500">
                        {form.allocationMode === "linked" ? "Selected Document" : "Payment Flow"}
                      </p>
                      <p className="text-base font-semibold text-slate-900">
                        {selectedBill ? `Invoice - ${selectedBill.billNo}` : "Normal Payment Entry"}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {selectedBill
                          ? `Pending ${formatMoney(selectedBill.balanceDue, effectiveCurrency)} | Settled ${formatMoney(totalSettled, effectiveCurrency)}`
                          : "Saved without linking to any purchase invoice."}
                      </p>
                    </div>
                  </div>
                  {unappliedAmount > 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {form.allocationMode === "linked"
                        ? "Pending balance on the selected document updates automatically. Any excess amount is retained as advance."
                        : "This payment is stored as a normal payment entry without invoice allocation."}
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="text-slate-500">Supplier Outstanding After Payment</p>
                    <p className={`text-base font-semibold ${outstandingAfter <= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      {formatMoney(outstandingAfter, effectiveCurrency)}
                    </p>
                    <p className="mt-1 text-slate-500">
                      {selectedBill
                        ? "Pending amount updates automatically for the selected purchase invoice."
                        : "Normal payment entry keeps the amount unlinked."}
                    </p>
                  </div>
                </div>
              </FlowCard>

              <FlowCard title="Receipt Snapshot" subtitle="Country wording + legal labels">
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Payment Out Snapshot</p>
                  <p className="text-3xl font-bold tracking-tight text-slate-900">{formatMoney(totalSettled, effectiveCurrency)}</p>
                  <p className="text-xs text-slate-500">
                    Cash paid {formatMoney(amountPaid, effectiveCurrency)} + TDS {formatMoney(tdsAmount, effectiveCurrency)}
                  </p>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <p>Payment out flow records supplier settlements and keeps any balance as advance.</p>
                    <p className="mt-2">
                      Reference: <span className="font-semibold text-slate-800">{form.referenceNo || "-"}</span>
                    </p>
                    <p className="mt-1">
                      Payment Date: <span className="font-semibold text-slate-800">{form.paymentDate || "-"}</span>
                    </p>
                  </div>
                  {activePayment ? (
                    <button
                      type="button"
                      onClick={() => exportPaymentOutPdf(activePayment)}
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

          {panelMode === "flow" && !readOnly ? (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
                disabled={!hasPreviousStep}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setActiveStep((current) => Math.min(FORM_STEPS.length - 1, current + 1))}
                disabled={!hasNextStep}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}

          {panelMode === "flow" && !readOnly ? (
            <div className="app-floating-action-bar fixed bottom-4 right-4 z-40 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => persist(confirmStatus)}
                disabled={!canSaveCurrentFlow}
                className={`${ACTION_BAR_BASE} border border-slate-200 text-slate-700 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activePayment) {
                    exportPaymentOutPdf(activePayment);
                    return;
                  }
                  persist(confirmStatus, { download: true });
                }}
                disabled={!canSaveCurrentFlow}
                className={`${ACTION_BAR_BASE} border border-slate-200 text-slate-700 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <FileDown className="h-3.5 w-3.5" />
                Download PDF
              </button>
            </div>
          ) : null}
        </div>
      )}

      {!suppliers.length && panelMode === "feed" ? (
        <EmptyState
          title="No suppliers yet"
          description="Add suppliers in Parties before creating payment out transactions."
        />
      ) : null}
    </div>
  );
}

