import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Search, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import PageHeader from "../../components/PageHeader";
import ActionStatusDialog from "../../components/ActionStatusDialog";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import DateInput from "../../components/DateInput";
import AllocationSelectionCard from "../../components/AllocationSelectionCard";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote, upsertPartyRemote } from "../../modules/parties/store";
import { computeItemStock, listItems, syncItemsFromRemote, upsertItemRemote } from "../../modules/items/store";
import {
  fetchSupplierAddress,
  purchasesCreate,
  purchasesGetById,
  purchasesSyncFromRemote,
  purchasesUpdate
} from "../../services/purchases.service";
import { scanInvoiceFree } from "../../services/freeInvoiceScan.service";
import { useOrganization } from "../../context/OrganizationContext";
import { calculateTaxes } from "../../services/tax";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { syncPaymentOutRemote } from "../../services/payments.service";
import {
  applySelectedAdvanceWalletEntriesToSupplierBill,
  outstandingBySupplier,
  paymentInsightsBySupplier,
  savePaymentOut,
  listSupplierAdvanceWalletEntries
} from "../../modules/paymentOut/store";
import {
  applySelectedDebitNotesToPurchaseBill,
  listDebitNotes,
  listDebitNotesForPurchaseBill,
  listDebitNotesForSupplierMatch
} from "../../modules/debitNote/store";
import { canCreateEntries, canEditEntries } from "../../services/roles";
import { companyPeekDocumentNumber } from "../../services/company.service";
import {
  getCanonicalCountryName,
  listAllCountries,
  listStatesByCountry,
  resolveCountryIsoCode
} from "../../lib/geoData";
import {
  formatDecimalByPreference,
  formatInputNumberByPreference,
  formatNumberByPreference,
  normalizeFormattedNumberInput,
  parseFormattedNumber
} from "../../lib/formatPreferences";
import { parseDateInputToIso } from "../../lib/dateUtils";

const UNIT_OPTIONS = ["pcs", "kg", "box", "pack", "ltr", "hours", "days", "months", "service"];

function normalizeUnit(unit) {
  return String(unit ?? "").trim();
}

function normalizeItemName(value) {
  return String(value || "").trim().toLowerCase();
}

function getItemSearchIdentifier(item) {
  const itemCode = String(item?.itemCode || "").trim();
  if (itemCode) return itemCode;
  return String(item?.id || "").trim();
}

function formatItemSearchLabel(item) {
  const identifier = getItemSearchIdentifier(item);
  const name = String(item?.name || "").trim();
  if (identifier && name) return `${identifier} | ${name}`;
  return name || identifier;
}

function findItemBySearchInput(items, value) {
  const normalizedValue = normalizeItemName(value);
  if (!normalizedValue) return null;
  return (
    items.find((item) => {
      const name = normalizeItemName(item?.name);
      const itemCode = normalizeItemName(item?.itemCode);
      const id = normalizeItemName(item?.id);
      const label = normalizeItemName(formatItemSearchLabel(item));
      return (
        normalizedValue === name ||
        normalizedValue === itemCode ||
        normalizedValue === id ||
        normalizedValue === label
      );
    }) || null
  );
}

function itemMatchesSearchQuery(item, query) {
  const normalizedQuery = normalizeItemName(query);
  if (!normalizedQuery) return true;
  const name = normalizeItemName(item?.name);
  const itemCode = normalizeItemName(item?.itemCode);
  const id = normalizeItemName(item?.id);
  const label = normalizeItemName(formatItemSearchLabel(item));
  return (
    name.includes(normalizedQuery) ||
    itemCode.includes(normalizedQuery) ||
    id.includes(normalizedQuery) ||
    label.includes(normalizedQuery)
  );
}

function normalizePhoneForLookup(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function extractTenDigitPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function queryLooksPhoneLike(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^[\d\s()+-]+$/.test(text);
}

function money(n) {
  return formatDecimalByPreference(n, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function wholeNumber(n) {
  return formatNumberByPreference(n, {
    maximumFractionDigits: 0
  });
}

function displayNumericInput(value) {
  return formatInputNumberByPreference(value);
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function isValidRoundOffInput(value) {
  return /^-?\d*(\.\d{0,2})?$/.test(String(value || ""));
}

function nonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Number(fallback || 0));
  return Math.max(0, numeric);
}

function supplierAddressSummary(supplier) {
  return [supplier?.address, supplier?.city, supplier?.state, supplier?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function formatCompactDate(value) {
  const text = String(value || "").trim();
  return text || "-";
}

function findSupplierImportMatch(suppliers, importedName, importedPhone) {
  const phoneDigits = extractTenDigitPhone(importedPhone);
  if (phoneDigits) {
    const phoneMatch = suppliers.find(
      (supplier) => normalizePhoneForLookup(supplier?.phone) === normalizePhoneForLookup(phoneDigits)
    );
    if (phoneMatch) return phoneMatch;
  }

  const normalizedImportedName = normalizeItemName(importedName);
  if (!normalizedImportedName) return null;

  return (
    suppliers.find((supplier) => normalizeItemName(supplier?.name) === normalizedImportedName) ||
    suppliers.find((supplier) => {
      const supplierName = normalizeItemName(supplier?.name);
      return (
        supplierName.length >= 3 &&
        (supplierName.includes(normalizedImportedName) || normalizedImportedName.includes(supplierName))
      );
    }) ||
    null
  );
}

function getItemLowStockAlert(item) {
  return nonNegativeNumber(item?.lowStockAlert ?? item?.metadata?.lowStockQty ?? item?.metadata?.lowStockAlert, 0);
}

function createLine(defaultTaxRate = 0) {
  return {
    id: `line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: "",
    itemCode: "",
    itemName: "",
    itemInput: "",
    qty: 1,
    unit: "pcs",
    rate: 0,
    saleRate: 0,
    lowStockAlert: 0,
    priceTaxMode: "WITHOUT_TAX",
    tax: Number(defaultTaxRate || 0)
  };
}

export default function PurchaseBill() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invoiceScanInputRef = useRef(null);
  const role = authGetRole();
  const canCreatePurchase = canCreateEntries(role);
  const canEditPurchase = canEditEntries(role);
  const editBillId = String(searchParams.get("billId") || "").trim();
  const isEditMode = !!editBillId;
  const canSavePurchase = isEditMode ? canEditPurchase : canCreatePurchase;
  const { country = "", currency = "", profile: company = {} } = useOrganization();
  const isIndiaOrg = country === "India";
  const companyTaxSettings = company?.settings?.tax || {};
  const configuredGstRate = Number(companyTaxSettings.defaultGstRate);
  const defaultGstRate = Number.isFinite(configuredGstRate) && configuredGstRate >= 0 ? configuredGstRate : 18;
  const gstRuntimeEnabled = isIndiaOrg && companyTaxSettings.enableGst !== false;
  const forceZeroTax = isIndiaOrg && companyTaxSettings.enableGst === false;
  const defaultLineTaxRate = gstRuntimeEnabled ? defaultGstRate : 0;
  const toast = useToast();
  const [suppliers, setSuppliers] = useState(() =>
    listParties().filter((party) => party.type === "Supplier")
  );
  const [items, setItems] = useState(() => listItems());
  const [partyId, setPartyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [editBillLoading, setEditBillLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const party = useMemo(() => suppliers.find((x) => x.id === partyId) || null, [suppliers, partyId]);

  const [phone, setPhone] = useState(party?.phone || "");
  const [supplierSearchPhone, setSupplierSearchPhone] = useState("");
  const [supplierLookupQuery, setSupplierLookupQuery] = useState("");
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [invoiceScanning, setInvoiceScanning] = useState(false);
  const [invoiceScanMeta, setInvoiceScanMeta] = useState(null);
  const [scannedInvoiceTotal, setScannedInvoiceTotal] = useState("");
  const [supplierCreateLoading, setSupplierCreateLoading] = useState(false);
  const [supplierCreateDraft, setSupplierCreateDraft] = useState({
    name: "",
    phone: "",
    country: country || "",
    state: "",
    city: "",
    address: ""
  });
  const [supplierCountryMenuOpen, setSupplierCountryMenuOpen] = useState(false);
  const [supplierStateMenuOpen, setSupplierStateMenuOpen] = useState(false);
  const [supplierAddress, setSupplierAddress] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billNumberManuallyEdited, setBillNumberManuallyEdited] = useState(false);
  const [billDate, setBillDate] = useState("");
  const [generateBarcodes, setGenerateBarcodes] = useState(true);
  const [editingPaymentType, setEditingPaymentType] = useState("Unpaid");
  const [saveStatusDialog, setSaveStatusDialog] = useState({
    open: false,
    title: "",
    message: "",
    tone: "success",
    onClose: null
  });
  const [lines, setLines] = useState(() => [createLine(defaultLineTaxRate)]);
  const [activeLineItemSearchId, setActiveLineItemSearchId] = useState("");
  const [lineItemPopover, setLineItemPopover] = useState({ top: 0, left: 0, width: 280 });
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const [roundOffValue, setRoundOffValue] = useState("0.00");
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [paymentType, setPaymentType] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [useAvailableDebitNotes, setUseAvailableDebitNotes] = useState(false);
  const [selectedAdvancePaymentIds, setSelectedAdvancePaymentIds] = useState([]);
  const [selectedDebitNoteIds, setSelectedDebitNoteIds] = useState([]);
  const [advanceWalletPickerOpen, setAdvanceWalletPickerOpen] = useState(false);
  const [debitNotePickerOpen, setDebitNotePickerOpen] = useState(false);
  const paymentAmount = useMemo(() => {
    if (!markAsPaid) return 0;
    const parsedAmount = parseFormattedNumber(paidAmount || 0);
    return round2(Math.max(0, parsedAmount));
  }, [paidAmount, markAsPaid]);
  const companyCountry = String(country || company?.country || company?.address?.country || "").trim();
  const supplierCountry = String(party?.country || "").trim();
  const purchasableItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item &&
          item.status !== "Inactive" &&
          (item.type === "Product" || item.type === "Service")
      ),
    [items]
  );
  const stockByItemId = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      if (item?.type !== "Product" || !item?.trackInventory) return;
      map.set(item.id, {
        itemId: item.id,
        itemName: item.name || "Item",
        ...computeItemStock(item)
      });
    });
    return map;
  }, [items]);
  const allCountryOptions = useMemo(() => listAllCountries(), []);
  const supplierCreateStateOptions = useMemo(
    () => listStatesByCountry(supplierCreateDraft.country),
    [supplierCreateDraft.country]
  );
  const supplierCountryQuery = String(supplierCreateDraft.country || "")
    .trim()
    .toLowerCase();
  const supplierStateQuery = String(supplierCreateDraft.state || "")
    .trim()
    .toLowerCase();
  const supplierCountryMatches = useMemo(() => {
    if (!supplierCountryQuery) return [];
    return allCountryOptions
      .filter((countryOption) => countryOption.name.toLowerCase().includes(supplierCountryQuery))
      .slice(0, 8);
  }, [allCountryOptions, supplierCountryQuery]);
  const supplierStateMatches = useMemo(() => {
    if (!supplierStateQuery) return [];
    return supplierCreateStateOptions
      .filter((stateOption) => stateOption.name.toLowerCase().includes(supplierStateQuery))
      .slice(0, 8);
  }, [supplierCreateStateOptions, supplierStateQuery]);
  const suggestionMenuClassName =
    "absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl";

  function hydrateBillForEdit(bill) {
    const existingLines = Array.isArray(bill?.lines) ? bill.lines : [];
    const roundOffAmount = Number(bill?.totals?.roundOff || 0);

    setPartyId(String(bill?.partyId || ""));
    setPhone(String(bill?.phone || ""));
    setSupplierSearchPhone(String(bill?.phone || "").replace(/\D/g, "").slice(-10));
    setSupplierLookupQuery(String(bill?.partyName || ""));
    setSupplierSearchError("");
    setSupplierAddress(String(bill?.partyAddress || ""));
    setBillNumber(String(bill?.billNumber || ""));
    setBillNumberManuallyEdited(true);
    setBillDate(String(bill?.billDate || ""));
    setGenerateBarcodes(true);
    setEditingPaymentType(String(bill?.paymentType || "Unpaid"));
    setLines(
      existingLines.length
        ? existingLines.map((line, index) => ({
            ...createLine(forceZeroTax ? 0 : defaultLineTaxRate),
            id: line?.id || `line_${Date.now()}_${index}`,
            itemId: String(line?.itemId || ""),
            itemCode: String(line?.itemCode || ""),
            itemName: String(line?.itemName || ""),
            itemInput: String(line?.itemName || ""),
            qty: Number(line?.qty || 0),
            unit: normalizeUnit(line?.unit || "pcs"),
            rate: Number(line?.rate || 0),
            saleRate: Number(line?.saleRate || 0),
            lowStockAlert: nonNegativeNumber(line?.lowStockAlert, 0),
            priceTaxMode:
              line?.taxInclusive === true ||
              String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX"
                ? "WITH_TAX"
                : "WITHOUT_TAX",
            tax: forceZeroTax ? 0 : Number(line?.tax ?? 0)
          }))
        : [createLine(forceZeroTax ? 0 : defaultLineTaxRate)]
    );
    setRoundOffEnabled(Math.abs(roundOffAmount) > 0);
    setRoundOffValue(roundOffAmount.toFixed(2));
    setMarkAsPaid(false);
    setPaymentType("Cash");
    setPaymentDate(String(bill?.billDate || ""));
    setPaidAmount("");
    setReferenceNo("");
    setTransactionId("");
    setChequeNo("");
    setBankName("");
    setPaymentNotes("");
    setFormErrors({});
  }

  function clearFormError(field) {
    setFormErrors((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function showSaveStatusDialog({ title, message, tone = "success", onClose }) {
    setSaveStatusDialog({
      open: true,
      title,
      message,
      tone,
      onClose: typeof onClose === "function" ? onClose : null
    });
  }

  function closeSaveStatusDialog() {
    const nextAction = saveStatusDialog.onClose;
    setSaveStatusDialog({
      open: false,
      title: "",
      message: "",
      tone: "success",
      onClose: null
    });
    if (typeof nextAction === "function") nextAction();
  }

  useEffect(() => {
    let mounted = true;
    async function loadLookups() {
      setLoading(true);
      try {
        await Promise.all([
          syncPartiesFromRemote(),
          syncItemsFromRemote()
        ]);
        if (!mounted) return;
        const nextSuppliers = listParties().filter((entry) => entry.type === "Supplier");
        const nextItems = listItems();
        setSuppliers(nextSuppliers);
        setItems(nextItems);
        setPartyId((prev) => prev || "");
        setLines((prev) => {
          if (!prev.length) return [createLine(defaultLineTaxRate)];
          const hasSelectedItem = prev.some((line) => !!line.itemId || !!line.itemName);
          return hasSelectedItem ? prev : [createLine(defaultLineTaxRate)];
        });
      } catch (error) {
        toast.error("Failed to load suppliers/items", error?.message || "Using local cached data.");
        if (!mounted) return;
        const cachedSuppliers = listParties().filter((entry) => entry.type === "Supplier");
        const cachedItems = listItems();
        setSuppliers(cachedSuppliers);
        setItems(cachedItems);
        setPartyId((prev) => prev || "");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadLookups();
    return () => {
      mounted = false;
    };
  }, [toast, defaultLineTaxRate]);

  useEffect(() => {
    if (!isEditMode) return undefined;

    let mounted = true;
    async function loadBillForEdit() {
      setEditBillLoading(true);
      try {
        let matched = purchasesGetById(editBillId);
        if (!matched) {
          const synced = await purchasesSyncFromRemote();
          matched =
            (Array.isArray(synced) ? synced : []).find(
              (entry) => String(entry?.id || "").trim() === editBillId
            ) || null;
        }
        if (!mounted) return;
        if (!matched) {
          toast.error("Purchase bill not found", "The selected purchase bill could not be loaded.");
          navigate("/app/purchase/history", { replace: true });
          return;
        }
        hydrateBillForEdit(matched);
      } catch (error) {
        if (!mounted) return;
        toast.error("Failed to load purchase bill", error?.message || "Could not open edit mode.");
        navigate("/app/purchase/history", { replace: true });
      } finally {
        if (mounted) setEditBillLoading(false);
      }
    }

    void loadBillForEdit();
    return () => {
      mounted = false;
    };
  }, [defaultLineTaxRate, editBillId, forceZeroTax, isEditMode, navigate, toast]);

  useEffect(() => {
    let mounted = true;
    async function hydrateSupplierDetails() {
      setPhone(party?.phone || "");
      if (!partyId) {
        setSupplierAddress("");
        return;
      }

      const fallbackAddress = party?.address || "";
      setSupplierAddress(fallbackAddress);
      try {
        const resolvedAddress = await fetchSupplierAddress(partyId);
        if (mounted) setSupplierAddress(resolvedAddress || fallbackAddress);
      } catch {
        if (mounted) setSupplierAddress(fallbackAddress);
      }
    }
    hydrateSupplierDetails();
    return () => {
      mounted = false;
    };
  }, [party?.phone, party?.address, partyId]);

  useEffect(() => {
    if (!party?.phone) return;
    setSupplierSearchPhone(String(party.phone).replace(/\D/g, "").slice(-10));
  }, [party?.phone]);

  useEffect(() => {
    if (!forceZeroTax) return;
    setLines((prev) =>
      prev.map((line) => {
        if (Number(line?.tax || 0) === 0) return line;
        return { ...line, tax: 0 };
      })
    );
  }, [forceZeroTax]);

  useEffect(() => {
    setPaymentDate(billDate);
  }, [billDate]);

  useEffect(() => {
    if (billNumberManuallyEdited) return;
    const nextBillNumber = String(
      companyPeekDocumentNumber("purchase", { dateValue: billDate || new Date() }) || ""
    ).trim();
    if (nextBillNumber && nextBillNumber !== billNumber) {
      setBillNumber(nextBillNumber);
    }
  }, [billDate, billNumber, billNumberManuallyEdited]);

  useEffect(() => {
    if (!markAsPaid) {
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.paidAmount;
        delete next.paymentDate;
        delete next.bankName;
        delete next.transactionId;
        delete next.chequeNo;
        return next;
      });
      setPaidAmount("");
      setReferenceNo("");
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setPaymentNotes("");
      return;
    }
    if (paymentType === "Cash") {
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.bankName;
        delete next.transactionId;
        delete next.chequeNo;
        return next;
      });
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      return;
    }
    if (paymentType === "Bank Transfer") {
      clearFormError("chequeNo");
      setChequeNo("");
      return;
    }
    if (paymentType === "Cheque") {
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.bankName;
        delete next.transactionId;
        return next;
      });
      setBankName("");
      setTransactionId("");
      return;
    }
    if (paymentType === "Card" || paymentType === "Online") {
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.bankName;
        delete next.chequeNo;
        return next;
      });
      setBankName("");
      setChequeNo("");
    }
  }, [markAsPaid, paymentType]);

  useEffect(() => {
    setFormErrors((prev) => {
      if (!prev || !Object.keys(prev).length) return prev;
      const next = { ...prev };
      let changed = false;

      if (next.supplier && partyId) {
        delete next.supplier;
        changed = true;
      }
      if (next.billNumber && String(billNumber || "").trim()) {
        delete next.billNumber;
        changed = true;
      }
      if (next.billDate && String(billDate || "").trim()) {
        delete next.billDate;
        changed = true;
      }
      if (next.paidAmount && (!markAsPaid || paymentAmount > 0)) {
        delete next.paidAmount;
        changed = true;
      }
      if (next.paymentDate && (!markAsPaid || String(paymentDate || "").trim())) {
        delete next.paymentDate;
        changed = true;
      }
      if (next.bankName && (!markAsPaid || paymentType !== "Bank Transfer" || String(bankName || "").trim())) {
        delete next.bankName;
        changed = true;
      }
      if (
        next.transactionId &&
        (!markAsPaid ||
          !["Bank Transfer", "Card", "Online"].includes(paymentType) ||
          String(transactionId || "").trim())
      ) {
        delete next.transactionId;
        changed = true;
      }
      if (next.chequeNo && (!markAsPaid || paymentType !== "Cheque" || String(chequeNo || "").trim())) {
        delete next.chequeNo;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [
    bankName,
    billDate,
    billNumber,
    chequeNo,
    markAsPaid,
    partyId,
    paymentAmount,
    paymentDate,
    paymentType,
    transactionId
  ]);

  useEffect(() => {
    if (!activeLineItemSearchId) return undefined;
    const closePopover = () => setActiveLineItemSearchId("");
    window.addEventListener("scroll", closePopover, true);
    window.addEventListener("resize", closePopover);
    return () => {
      window.removeEventListener("scroll", closePopover, true);
      window.removeEventListener("resize", closePopover);
    };
  }, [activeLineItemSearchId]);

  useEffect(() => {
    if (!formErrors?.lines) return;
    const hasValidLine = lines.some((line) => !!String(line?.itemId || "").trim());
    if (hasValidLine) clearFormError("lines");
  }, [formErrors?.lines, lines]);

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
          supplier?.city,
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

  function updateLine(id, patch) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const nextPatch = typeof patch === "function" ? patch(line) : patch;
        const next = { ...line, ...nextPatch };
        if (forceZeroTax) next.tax = 0;
        return next;
      })
    );
  }

  function selectLineItem(line, item) {
    if (!line || !item) return;
    const purchaseRate = Number(
      item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.price ?? 0
    );
    updateLine(line.id, {
      itemInput: item.name || "",
      itemName: item.name,
      itemId: item.id,
      itemCode: item.itemCode || "",
      unit: normalizeUnit(item?.unit ?? line?.unit ?? "pcs"),
      rate: purchaseRate,
      saleRate: Number(item?.salesRate ?? item?.price ?? 0),
      lowStockAlert: getItemLowStockAlert(item),
      tax: forceZeroTax ? 0 : Number(item.taxRate ?? defaultLineTaxRate),
      priceTaxMode: "WITHOUT_TAX"
    });
  }

  function handleItemInput(id, inputValue) {
    const match = findItemBySearchInput(purchasableItems, inputValue);
    updateLine(id, (line) => {
      if (!match) {
        return {
          ...line,
          itemInput: inputValue,
          itemName: inputValue,
          itemId: "",
          itemCode: "",
          lowStockAlert: 0
        };
      }
      return {
        ...line,
        itemInput: match.name || inputValue,
        itemName: match.name,
        itemId: match.id,
        itemCode: match.itemCode || "",
        unit: normalizeUnit(match?.unit ?? line?.unit ?? "pcs"),
        rate: Number(match?.purchaseRate ?? match?.metadata?.purchasePrice ?? match?.price ?? 0),
        saleRate: Number(match?.salesRate ?? match?.price ?? 0),
        lowStockAlert: getItemLowStockAlert(match),
        tax: forceZeroTax ? 0 : Number(match.taxRate ?? defaultLineTaxRate),
        priceTaxMode: "WITHOUT_TAX"
      };
    });
  }

  function clearLineItemSelection(lineId) {
    updateLine(lineId, {
      itemId: "",
      itemCode: "",
      itemName: "",
      itemInput: "",
      lowStockAlert: 0
    });
  }

  function updateLineItemPopoverPosition(inputElement) {
    if (!inputElement) return;
    const rect = inputElement.getBoundingClientRect();
    const width = Math.max(240, Math.round(rect.width));
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || Math.round(rect.width) || 320;
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    setLineItemPopover({
      top: Math.round(rect.bottom + 6),
      left: Math.round(left),
      width
    });
  }

  function getLineItemSearchResults(line) {
    const query = normalizeItemName(line?.itemInput);
    if (!query) return [];
    const matched = purchasableItems.filter((item) => itemMatchesSearchQuery(item, query));
    const selected = purchasableItems.find((item) => String(item.id) === String(line?.itemId || ""));
    if (!selected) return matched.slice(0, 8);
    if (matched.some((item) => String(item.id) === String(selected.id))) return matched.slice(0, 8);
    return [selected, ...matched].slice(0, 8);
  }

  const activeLineForSearch = useMemo(
    () => lines.find((line) => String(line?.id || "") === String(activeLineItemSearchId || "")) || null,
    [lines, activeLineItemSearchId]
  );
  const activeLineSearchResults = useMemo(() => {
    if (!activeLineForSearch) return [];
    return getLineItemSearchResults(activeLineForSearch);
  }, [activeLineForSearch, purchasableItems]);

  function getLineItemDefaults(line) {
    if (!line?.itemId) return null;
    const item = purchasableItems.find((entry) => String(entry.id) === String(line.itemId));
    if (!item) return null;
    const defaultRate = Number(item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.price ?? 0);
    return { defaultRate, item };
  }

  function addLine() {
    setLines((prev) => [...prev, createLine(defaultLineTaxRate)]);
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function applySupplierSelection(nextSupplier) {
    if (!nextSupplier) return;
    setSupplierSearchError("");
    clearFormError("supplier");
    setPartyId(nextSupplier.id);
    setPhone(nextSupplier.phone || "");
    setSupplierAddress(nextSupplier.address || "");
    setSupplierSearchPhone(String(nextSupplier.phone || "").replace(/\D/g, "").slice(-10));
    setSupplierLookupQuery("");
    setSupplierCountryMenuOpen(false);
    setSupplierStateMenuOpen(false);
  }

  function handleSupplierPhoneChange(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    setSupplierSearchPhone(digits);
    setSupplierSearchError("");
    if (partyId && normalizePhoneForLookup(digits) !== normalizePhoneForLookup(phone)) {
      setPartyId("");
      setPhone("");
      setSupplierAddress("");
    }
  }

  function handleSupplierLookupChange(value) {
    setSupplierLookupQuery(value);
    clearFormError("supplier");
    setSupplierSearchPhone(extractTenDigitPhone(value));
    setSupplierCreateDraft((prev) => ({
      ...prev,
      name: queryLooksPhoneLike(value) ? prev.name : String(value || "").trim(),
      phone: extractTenDigitPhone(value) || prev.phone,
      country: prev.country || country || ""
    }));
    setSupplierSearchError("");
  }

  function handleSupplierSearch() {
    const query = String(supplierLookupQuery || "").trim();
    if (query.length < 1) {
      setSupplierSearchError("Enter mobile number or name/email/address to search.");
      return;
    }
    if (queryLooksPhoneLike(query)) {
      const phoneDigits = extractTenDigitPhone(query);
      if (!phoneDigits) {
        setSupplierSearchError("Enter a valid 10-digit supplier mobile number.");
        return;
      }
      const normalizedQuery = normalizePhoneForLookup(phoneDigits);
      const matchedSupplier = suppliers.find(
        (supplier) => normalizePhoneForLookup(supplier?.phone) === normalizedQuery
      );
      if (!matchedSupplier) {
        setSupplierCreateDraft((prev) => ({
          ...prev,
          name: prev.name || "",
          phone: phoneDigits,
          country: prev.country || country || ""
        }));
        setSupplierSearchError("No supplier found for this mobile number.");
        return;
      }
      applySupplierSelection(matchedSupplier);
      return;
    }
    if (supplierLookupResults.length === 1) {
      applySupplierSelection(supplierLookupResults[0]);
      return;
    }
    if (!supplierLookupResults.length) {
      setSupplierCreateDraft((prev) => ({
        ...prev,
        name: query,
        phone: prev.phone || extractTenDigitPhone(query),
        country: prev.country || country || ""
      }));
      setSupplierSearchError("No supplier found for this search.");
      return;
    }
    setSupplierSearchError("Multiple suppliers found. Choose one from the list below.");
  }

  async function createSupplierFromDraft() {
    const fallbackLookupName = queryLooksPhoneLike(supplierLookupQuery)
      ? ""
      : String(supplierLookupQuery || "").trim();
    const name = String(supplierCreateDraft.name || fallbackLookupName || "").trim();
    const phone = extractTenDigitPhone(supplierCreateDraft.phone);
    const draftCountry = String(supplierCreateDraft.country || country || "").trim();
    const draftState = String(supplierCreateDraft.state || "").trim();
    const draftCity = String(supplierCreateDraft.city || "").trim();
    const draftAddress = String(supplierCreateDraft.address || "").trim();

    if (!name) {
      setSupplierSearchError("Supplier name is required.");
      return null;
    }
    if (phone.length !== 10) {
      setSupplierSearchError("Supplier mobile must be exactly 10 digits.");
      return null;
    }

    setSupplierCreateLoading(true);
    setSupplierSearchError("");
    try {
      const created = await upsertPartyRemote({
        type: "Supplier",
        contactType: "Individual",
        customerType: "Individual",
        name,
        phone,
        email: "",
        country: draftCountry,
        state: draftState,
        city: draftCity,
        address: draftAddress,
        taxId: "",
        notes: "",
        openingBalance: 0,
        openingBalanceType: "Payable",
        creditLimitEnabled: false,
        creditLimitType: "Amount",
        creditLimit: 0,
        creditLimitDays: 0
      });
      const nextSuppliers = listParties().filter((entry) => entry.type === "Supplier");
      setSuppliers(nextSuppliers);
      applySupplierSelection(created);
      setSupplierLookupQuery("");
      setSupplierCreateDraft({
        name: "",
        phone: "",
        country: country || "",
        state: "",
        city: "",
        address: ""
      });
      setSupplierCountryMenuOpen(false);
      setSupplierStateMenuOpen(false);
      toast.success("Supplier created", `${created.name} added successfully.`);
      return created;
    } catch (error) {
      setSupplierSearchError(error?.message || "Failed to create supplier.");
      return null;
    } finally {
      setSupplierCreateLoading(false);
    }
  }

  async function handleCreateSupplier() {
    return createSupplierFromDraft();
  }

  function applySupplierCreateCountry(nextCountry) {
    const canonicalCountry = getCanonicalCountryName(nextCountry);
    const previousCountryCode = resolveCountryIsoCode(supplierCreateDraft.country);
    const nextCountryCode = resolveCountryIsoCode(canonicalCountry);
    setSupplierCreateDraft((prev) => ({
      ...prev,
      country: canonicalCountry,
      state: previousCountryCode !== nextCountryCode ? "" : prev.state
    }));
    setSupplierCountryMenuOpen(false);
  }

  function applySupplierCreateState(nextState) {
    setSupplierCreateDraft((prev) => ({ ...prev, state: nextState }));
    setSupplierStateMenuOpen(false);
  }

  function resetSupplier() {
    setPartyId("");
    clearFormError("supplier");
    setPhone("");
    setSupplierAddress("");
    setSupplierSearchError("");
    setSupplierSearchPhone("");
    setSupplierLookupQuery("");
    setSupplierCreateDraft({
      name: "",
      phone: "",
      country: country || "",
      state: "",
      city: "",
      address: ""
    });
    setSupplierCountryMenuOpen(false);
    setSupplierStateMenuOpen(false);
  }

  function clearScannedInvoice(options = {}) {
    const resetAutofill = options?.resetAutofill !== false;
    setInvoiceScanMeta(null);
    setScannedInvoiceTotal("");
    if (!resetAutofill) return;

    resetSupplier();
    clearFormError("billNumber");
    clearFormError("billDate");
    setBillNumberManuallyEdited(false);
    setBillNumber(String(companyPeekDocumentNumber("purchase", { dateValue: new Date() }) || ""));
    setBillDate("");
    setPaymentDate("");
    setLines([createLine(defaultLineTaxRate)]);
    clearFormError("lines");
  }

  function applyImportedLines(importedItems) {
    if (!Array.isArray(importedItems) || !importedItems.length) return;
    setLines(
      importedItems.map((item) => ({
        ...createLine(defaultLineTaxRate),
        itemInput: item?.description || "",
        itemName: item?.description || "",
        qty: nonNegativeNumber(item?.qty, 1) || 1,
        unit: normalizeUnit(item?.unit || "pcs"),
        rate: nonNegativeNumber(item?.rate, 0),
        saleRate: 0,
        lowStockAlert: 0,
        tax: forceZeroTax ? 0 : nonNegativeNumber(item?.tax, defaultLineTaxRate)
      }))
    );
    clearFormError("lines");
  }

  async function applyImportedSupplier(parsed) {
    const parsedSupplierName = parsed?.supplier || parsed?.supplierName || "";
    const parsedSupplierPhone = parsed?.supplierPhone || "";
    const matchedSupplier = findSupplierImportMatch(
      suppliers,
      parsedSupplierName,
      parsedSupplierPhone
    );

    if (matchedSupplier) {
      const nextSupplierPayload = {
        ...matchedSupplier,
        city: matchedSupplier?.city || parsed?.city || "",
        state: matchedSupplier?.state || parsed?.state || "",
        address: matchedSupplier?.address || parsed?.address || "",
        country: matchedSupplier?.country || parsed?.country || country || ""
      };

      let effectiveSupplier = matchedSupplier;
      const hasScannedLocation =
        Boolean(parsed?.city || parsed?.state || parsed?.address || parsed?.country) &&
        (nextSupplierPayload.city !== matchedSupplier?.city ||
          nextSupplierPayload.state !== matchedSupplier?.state ||
          nextSupplierPayload.address !== matchedSupplier?.address ||
          nextSupplierPayload.country !== matchedSupplier?.country);

      if (hasScannedLocation) {
        try {
          effectiveSupplier = await upsertPartyRemote(nextSupplierPayload);
          const nextSuppliers = listParties().filter((entry) => entry.type === "Supplier");
          setSuppliers(nextSuppliers);
        } catch {
          effectiveSupplier = nextSupplierPayload;
        }
      }

      applySupplierSelection(effectiveSupplier);
      return {
        matchedSupplierName: effectiveSupplier.name || "",
        supplierResolved: true
      };
    }

    setPartyId("");
    setPhone("");
    setSupplierAddress("");
    setSupplierLookupQuery(parsedSupplierPhone || parsedSupplierName || "");
    setSupplierCreateDraft((prev) => ({
      ...prev,
      name: parsedSupplierName || prev.name || "",
      phone: extractTenDigitPhone(parsedSupplierPhone || prev.phone || ""),
      country: parsed?.country || prev.country || country || "",
      state: parsed?.state || prev.state || "",
      city: parsed?.city || prev.city || "",
      address: parsed?.address || prev.address || ""
    }));

    if (parsedSupplierName || parsedSupplierPhone) {
      setSupplierSearchError(
        "Supplier from PDF was not matched. Select an existing supplier or create a new supplier before saving."
      );
    }

    return {
      matchedSupplierName: "",
      supplierResolved: false
    };
  }

  async function applyScannedInvoice(parsed, fileName) {
    const supplierResult = await applyImportedSupplier(parsed);
    const scannedDateIso = parseDateInputToIso(parsed?.date || "");

    if (parsed?.invoiceNumber) {
      clearFormError("billNumber");
      setBillNumberManuallyEdited(true);
      setBillNumber(parsed.invoiceNumber);
    }
    if (scannedDateIso) {
      clearFormError("billDate");
      setBillDate(scannedDateIso);
      setPaymentDate(scannedDateIso);
    }
    if (parsed?.total) {
      setScannedInvoiceTotal(parsed.total);
    }
    if (Array.isArray(parsed?.items) && parsed.items.length) {
      applyImportedLines(parsed.items);
    }

    setInvoiceScanMeta({
      fileName,
      supplierName: parsed?.supplier || "",
      matchedSupplierName: supplierResult.matchedSupplierName,
      invoiceNumber: parsed?.invoiceNumber || "",
      date: scannedDateIso || parsed?.date || "",
      total: parsed?.total || "",
      itemCount: Array.isArray(parsed?.items) ? parsed.items.length : 0,
      confidence: Number(parsed?.confidence || 0),
      warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
      supplierResolved: supplierResult.supplierResolved,
      extractionMethod: parsed?.meta?.extractionMethod || "",
      validation: parsed?.validation || { valid: false, issues: [] }
    });
  }

  async function handleInvoiceScanChange(event) {
    const selectedFile = event?.target?.files?.[0];
    if (!selectedFile) return;

    setInvoiceScanning(true);
    setSupplierSearchError("");
    try {
      const parsed = await scanInvoiceFree(selectedFile);
      await applyScannedInvoice(parsed, selectedFile.name || "invoice-scan");

      const warningCount = Array.isArray(parsed?.warnings) ? parsed.warnings.length : 0;
      const hasParsedFields = Boolean(parsed?.invoiceNumber || parsed?.date || parsed?.supplier || parsed?.total);
      if (hasParsedFields) {
        toast.success(
          "Invoice scanned",
          warningCount
            ? `Autofill completed with ${warningCount} warning${warningCount > 1 ? "s" : ""}. Review the values before saving.`
            : "Invoice fields were filled. You can edit everything before saving."
        );
      } else {
        toast.error("Scan needs manual review", "No reliable values were detected. Enter the bill manually.");
      }
    } catch (error) {
      clearScannedInvoice({ resetAutofill: false });
      toast.error("Invoice scan failed", error?.message || "Could not read the selected file.");
    } finally {
      setInvoiceScanning(false);
      if (event?.target) {
        event.target.value = "";
      }
    }
  }

  const computed = useMemo(() => {
    const detailedBase = lines.map((line) => {
      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const taxRate = forceZeroTax ? 0 : Number(line.tax || 0);
      const lineSubTotal = round2(Math.max(0, qty * rate));
      const lineTax = round2((lineSubTotal * taxRate) / 100);
      return { ...line, lineSubTotal, lineTax, amount: round2(lineSubTotal + lineTax) };
    });

    const totalQty = detailedBase.reduce((sum, line) => sum + Number(line.qty || 0), 0);
    const subTotal = round2(detailedBase.reduce((sum, line) => sum + line.lineSubTotal, 0));
    const lineTaxTotal = round2(detailedBase.reduce((sum, line) => sum + line.lineTax, 0));
    const effectiveRate = subTotal > 0 ? (lineTaxTotal / subTotal) * 100 : 0;
    const tax = calculateTaxes({
      taxableAmount: subTotal,
      taxRate: effectiveRate,
      org: {
        country: isIndiaOrg && !gstRuntimeEnabled ? "Other" : companyCountry,
        state: company?.address?.state || "",
        gstin: ""
      },
      party: {
        country: supplierCountry,
        state: party?.state || "",
        gstin: ""
      }
    });

    const detailed = detailedBase.map((line) => {
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;
      let vatAmount = 0;
      if (tax.taxMode === "GST") {
        if (tax.supplyType === "INTER") {
          igstAmount = line.lineTax;
        } else {
          cgstAmount = round2(line.lineTax / 2);
          sgstAmount = round2(line.lineTax - cgstAmount);
        }
      } else {
        vatAmount = line.lineTax;
      }
      return { ...line, cgstAmount, sgstAmount, igstAmount, vatAmount };
    });

    const taxTotal = tax.totalTax;
    const grandTotal = round2(subTotal + taxTotal);
    const parsedRoundOff = Number(roundOffValue);
    const roundOff = roundOffEnabled && Number.isFinite(parsedRoundOff) ? round2(parsedRoundOff) : 0;
    const finalTotal = round2(grandTotal + roundOff);
    return { detailed, totalQty, subTotal, tax, taxTotal, grandTotal, roundOff, finalTotal, effectiveRate };
  }, [lines, roundOffEnabled, roundOffValue, companyCountry, company?.address?.state, supplierCountry, party?.state, party?.gstin, party?.taxId, isIndiaOrg, gstRuntimeEnabled, forceZeroTax]);

  const supplierPaymentInsights = useMemo(
    () => paymentInsightsBySupplier(country, partyId),
    [country, partyId]
  );
  const supplierAdvanceWallet = round2(Number(supplierPaymentInsights?.advanceWallet || 0));
  const supplierAdvanceEntries = useMemo(
    () => listSupplierAdvanceWalletEntries(country, partyId),
    [country, partyId, supplierPaymentInsights?.advanceWallet]
  );
  const selectedAdvancePaymentIdSet = useMemo(
    () => new Set((Array.isArray(selectedAdvancePaymentIds) ? selectedAdvancePaymentIds : []).map((entry) => String(entry || "").trim()).filter(Boolean)),
    [selectedAdvancePaymentIds]
  );
  const shouldAutoApplySupplierAdvance =
    !isEditMode && (Array.isArray(selectedAdvancePaymentIds) ? selectedAdvancePaymentIds.length : 0) > 0;
  const selectedAdvancePaymentBalance = useMemo(
    () =>
      round2(
        supplierAdvanceEntries.reduce((sum, entry) => {
          if (!selectedAdvancePaymentIdSet.has(String(entry.paymentId || "").trim())) return sum;
          return sum + Math.max(0, Number(entry.availableAmount || 0));
        }, 0)
      ),
    [selectedAdvancePaymentIdSet, supplierAdvanceEntries]
  );
  const advanceAppliedFromWallet = useMemo(
    () =>
      shouldAutoApplySupplierAdvance
        ? round2(Math.min(selectedAdvancePaymentBalance, Number(computed.finalTotal || 0)))
        : 0,
    [selectedAdvancePaymentBalance, computed.finalTotal, shouldAutoApplySupplierAdvance]
  );
  const linkedDebitNotes = useMemo(
    () => (isEditMode ? listDebitNotesForPurchaseBill(country, editBillId) : []),
    [country, editBillId, isEditMode]
  );
  const supplierDebitNotes = useMemo(
    () =>
      !isEditMode && (partyId || party?.name)
        ? listDebitNotesForSupplierMatch(country, partyId, party?.name || "")
        : [],
    [country, isEditMode, partyId, party?.name]
  );
  const allDebitNotes = useMemo(
    () => (!isEditMode ? listDebitNotes(country).filter((entry) => String(entry?.status || "") !== "Draft") : []),
    [country, isEditMode]
  );
  const visibleDebitNotes = isEditMode
    ? linkedDebitNotes
    : supplierDebitNotes.length
      ? supplierDebitNotes
      : allDebitNotes;
  const selectedDebitNoteIdSet = useMemo(
    () => new Set((Array.isArray(selectedDebitNoteIds) ? selectedDebitNoteIds : []).map((entry) => String(entry || "").trim()).filter(Boolean)),
    [selectedDebitNoteIds]
  );
  const selectedDebitNoteBalance = useMemo(
    () =>
      round2(
        visibleDebitNotes.reduce((sum, entry) => {
          if (!selectedDebitNoteIdSet.has(String(entry.id || "").trim())) return sum;
          return sum + Math.max(0, Number((entry.availableAmount ?? entry.totalAmount) || 0));
        }, 0)
      ),
    [selectedDebitNoteIdSet, visibleDebitNotes]
  );
  const debitNotesUsedAmount = useMemo(
    () => (useAvailableDebitNotes ? round2(Math.min(selectedDebitNoteBalance, Number(computed.finalTotal || 0))) : 0),
    [useAvailableDebitNotes, selectedDebitNoteBalance, computed.finalTotal]
  );

  useEffect(() => {
    setSelectedAdvancePaymentIds([]);
    setUseAvailableDebitNotes(false);
    setSelectedDebitNoteIds([]);
  }, [partyId, isEditMode]);
  useEffect(() => {
    setUseAvailableDebitNotes(
      (Array.isArray(selectedAdvancePaymentIds) ? selectedAdvancePaymentIds.length : 0) > 0 ||
      (Array.isArray(selectedDebitNoteIds) ? selectedDebitNoteIds.length : 0) > 0
    );
  }, [selectedAdvancePaymentIds, selectedDebitNoteIds]);
  const balanceAfterExistingAdvance = useMemo(
    () => round2(Math.max(0, Number(computed.finalTotal || 0) - advanceAppliedFromWallet - debitNotesUsedAmount)),
    [computed.finalTotal, advanceAppliedFromWallet, debitNotesUsedAmount]
  );
  const pendingAmount = useMemo(
    () => round2(Math.max(0, balanceAfterExistingAdvance - Number(paymentAmount || 0))),
    [balanceAfterExistingAdvance, paymentAmount]
  );
  const advanceAmount = useMemo(
    () => round2(Math.max(0, Number(paymentAmount || 0) - balanceAfterExistingAdvance)),
    [paymentAmount, balanceAfterExistingAdvance]
  );
  const projectedAdvanceWallet = round2(
    Math.max(0, supplierAdvanceWallet - advanceAppliedFromWallet) + advanceAmount
  );
  const supplierAdvancePreviewRows = useMemo(() => {
    const actualApplyOrder = [...supplierAdvanceEntries].sort((left, right) => {
      const leftDate = String(left?.paymentDate || "");
      const rightDate = String(right?.paymentDate || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return String(left?.paymentNo || "").localeCompare(String(right?.paymentNo || ""));
    });
    const previewByPaymentId = new Map();
    let remainingBillBalance = round2(Number(computed.finalTotal || 0));

    actualApplyOrder.forEach((entry) => {
      const paymentId = String(entry?.paymentId || "").trim();
      const availableAmount = round2(Number(entry?.availableAmount || 0));
      const isSelected = selectedAdvancePaymentIdSet.has(paymentId);
      const billBalanceBefore = remainingBillBalance;
      const appliedToBill =
        shouldAutoApplySupplierAdvance && isSelected
          ? round2(Math.min(availableAmount, remainingBillBalance))
          : 0;
      remainingBillBalance = round2(Math.max(0, remainingBillBalance - appliedToBill));
      const billBalanceAfter = remainingBillBalance;

      let settlementStatus = "Available";
      if (isSelected && !shouldAutoApplySupplierAdvance) settlementStatus = "Selected";
      if (appliedToBill > 0) settlementStatus = billBalanceAfter <= 0 ? "Fully Settled" : "Applied";

      previewByPaymentId.set(paymentId, {
        ...entry,
        isSelected,
        appliedToBill,
        entryBalanceAfter: round2(Math.max(0, availableAmount - appliedToBill)),
        billBalanceBefore,
        billBalanceAfter,
        settlementStatus
      });
    });

    return supplierAdvanceEntries.map((entry) => {
      const paymentId = String(entry?.paymentId || "").trim();
      return (
        previewByPaymentId.get(paymentId) || {
          ...entry,
          isSelected: false,
          appliedToBill: 0,
          entryBalanceAfter: round2(Number(entry?.availableAmount || 0)),
          billBalanceBefore: round2(Number(computed.finalTotal || 0)),
          billBalanceAfter: round2(Number(computed.finalTotal || 0)),
          settlementStatus: "Available"
        }
      );
    });
  }, [supplierAdvanceEntries, computed.finalTotal, selectedAdvancePaymentIdSet, shouldAutoApplySupplierAdvance]);

  async function resolveLinesWithItems(detailedLines) {
    const nextLines = [];
    const itemsById = new Map(items.map((item) => [String(item.id || ""), item]));
    const itemsByName = new Map(
      items
        .filter((item) => item?.name)
        .map((item) => [normalizeItemName(item.name), item])
    );
    const itemsByCode = new Map(
      items
        .filter((item) => item?.itemCode)
        .map((item) => [normalizeItemName(item.itemCode), item])
    );
    const toNumber = (value) => Number(value || 0);
    const getItemPurchaseRate = (item) =>
      toNumber(item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.price ?? 0);
    const getItemSalesRate = (item) => toNumber(item?.salesRate ?? item?.price ?? 0);
    const getLineTaxInclusive = () => false;
    const getLineTaxRate = (line, item) =>
      forceZeroTax ? 0 : toNumber(line?.tax ?? item?.taxRate ?? defaultLineTaxRate);
    const getLineLowStockAlert = (line, item, itemType) => {
      if (itemType === "Service") return 0;
      return nonNegativeNumber(
        line?.lowStockAlert ?? line?.lowStockThreshold,
        item?.lowStockAlert ?? item?.metadata?.lowStockQty ?? 0
      );
    };
    const shouldSyncItemFromLine = (item, line) => {
      if (!item) return true;
      const nextUnit = normalizeUnit(line?.unit ?? item?.unit ?? "pcs");
      const nextSalesRate = toNumber(line?.saleRate ?? line?.rate ?? getItemSalesRate(item));
      const nextTaxRate = getLineTaxRate(line, item);
      const nextTaxInclusive = getLineTaxInclusive(line, item);
      const itemType = item?.type === "Service" ? "Service" : "Product";
      const nextTrackInventory = itemType === "Product" ? item?.trackInventory ?? true : false;
      const nextLowStockAlert = getLineLowStockAlert(line, item, itemType);
      return (
        !String(item?.itemCode || "").trim() ||
        normalizeUnit(item?.unit) !== nextUnit ||
        Math.abs(getItemSalesRate(item) - nextSalesRate) > 1e-6 ||
        Math.abs(toNumber(item?.taxRate) - nextTaxRate) > 1e-6 ||
        Math.abs(toNumber(item?.lowStockAlert ?? item?.metadata?.lowStockQty ?? 0) - nextLowStockAlert) > 1e-6 ||
        Boolean(item?.taxInclusive) !== nextTaxInclusive ||
        Boolean(item?.trackInventory) !== nextTrackInventory
      );
    };
    const rememberItem = (item) => {
      if (!item) return;
      itemsById.set(String(item.id || ""), item);
      if (item.name) {
        itemsByName.set(normalizeItemName(item.name), item);
      }
      if (item.itemCode) {
        itemsByCode.set(normalizeItemName(item.itemCode), item);
      }
    };
    const ensureItemFromLine = async (item, line, fallbackName = "") => {
      const resolvedName = String(item?.name || line?.itemName || fallbackName || "").trim();
      if (!resolvedName) return item || null;
      if (item && !shouldSyncItemFromLine(item, line)) return item;

      const itemType = item?.type === "Service" ? "Service" : "Product";
      const nextLowStockAlert = getLineLowStockAlert(line, item, itemType);
      const savedId = await upsertItemRemote(
        {
          id: item?.id,
          itemCode: item?.itemCode || "",
          name: resolvedName,
          type: itemType,
          description: item?.description || "",
          hsn: itemType === "Product" ? item?.hsn || "" : "",
          sac: itemType === "Service" ? item?.sac || "" : "",
          unit: normalizeUnit(line?.unit ?? item?.unit ?? "pcs"),
          salesRate: toNumber(line?.saleRate ?? line?.rate ?? getItemSalesRate(item)),
          purchaseRate: getItemPurchaseRate(item),
          taxRate: getLineTaxRate(line, item),
          taxInclusive: getLineTaxInclusive(line, item),
          status: item?.status || "Active",
          trackInventory: itemType === "Product" ? item?.trackInventory ?? true : false,
          openingStock: toNumber(item?.openingStock ?? item?.metadata?.openingStock ?? item?.metadata?.openingQty ?? 0),
          lowStockAlert: nextLowStockAlert,
          category: item?.category || "",
          sku: item?.sku || item?.itemCode || "",
          barcode: item?.barcode || ""
        },
        country
      );
      const refreshed =
        listItems().find((entry) => String(entry.id) === String(savedId || item?.id || "")) || item || null;
      rememberItem(refreshed);
      return refreshed;
    };

    for (const line of detailedLines) {
      if (line.itemId) {
        const matched = await ensureItemFromLine(
          itemsById.get(String(line.itemId || "")),
          line,
          line.itemName || ""
        );
        nextLines.push({
          ...line,
          itemId: matched?.id || line.itemId || "",
          itemName: line.itemName || matched?.name || "",
          itemCode: line.itemCode || matched?.itemCode || "",
          itemInput: matched?.name || line.itemName || "",
          lowStockAlert: getLineLowStockAlert(line, matched, matched?.type === "Service" ? "Service" : "Product")
        });
        continue;
      }

      const typedInput = String(line.itemInput || line.itemName || "").trim();
      if (!typedInput) {
        nextLines.push({ ...line, itemId: "", itemCode: "", itemInput: "" });
        continue;
      }

      const directMatch =
        findItemBySearchInput(items, typedInput) ||
        itemsByCode.get(normalizeItemName(typedInput)) ||
        itemsByName.get(normalizeItemName(typedInput));
      const existing = await ensureItemFromLine(directMatch, line, typedInput);
      if (existing) {
        nextLines.push({
          ...line,
          itemId: existing.id,
          itemCode: existing.itemCode || "",
          itemName: existing.name,
          itemInput: existing.name || typedInput,
          unit: normalizeUnit(existing?.unit ?? line?.unit),
          lowStockAlert: getLineLowStockAlert(line, existing, existing?.type === "Service" ? "Service" : "Product")
        });
        continue;
      }

      const typedName = typedInput;
      const created = await ensureItemFromLine(null, line, typedName);

      nextLines.push({
        ...line,
        itemId: created?.id || "",
        itemCode: created?.itemCode || "",
        itemName: created?.name || typedName,
        itemInput: created?.name || typedName,
        unit: normalizeUnit(created?.unit ?? line?.unit),
        lowStockAlert: getLineLowStockAlert(line, created, created?.type === "Service" ? "Service" : "Product")
      });
    }

    return nextLines;
  }

  async function save() {
    if (!canSavePurchase) {
      toast.error(
        "Permission denied",
        isEditMode
          ? "You do not have permission to edit purchase bills."
          : "You do not have permission to create purchase bills."
      );
      return;
    }
    let effectivePartyId = String(partyId || "").trim();
    let effectiveParty = party;
    let effectivePhone = String(phone || "").trim();
    let effectiveSupplierAddress = String(supplierAddress || "").trim();

    if (!effectivePartyId) {
      const quickDraftName = String(
        supplierCreateDraft.name || (queryLooksPhoneLike(supplierLookupQuery) ? "" : supplierLookupQuery)
      ).trim();
      const quickDraftPhone = extractTenDigitPhone(supplierCreateDraft.phone || supplierLookupQuery || "");
      if (quickDraftName && quickDraftPhone.length === 10) {
        const createdSupplier = await createSupplierFromDraft();
        if (createdSupplier?.id) {
          effectivePartyId = String(createdSupplier.id || "").trim();
          effectiveParty = createdSupplier;
          effectivePhone = String(createdSupplier.phone || quickDraftPhone || "").trim();
          effectiveSupplierAddress = String(createdSupplier.address || "").trim();
        }
      }
    }

    const normalizedBillNumber = String(billNumber || "").trim();
    const autoGeneratedBillNumber = String(
      companyPeekDocumentNumber("purchase", { dateValue: billDate || new Date() }) || ""
    ).trim();
    const effectiveRequestedBillNumber = billNumberManuallyEdited ? normalizedBillNumber : normalizedBillNumber || autoGeneratedBillNumber;
    const nextErrors = {};
    if (!effectivePartyId) nextErrors.supplier = "This field is required";
    if (!effectiveRequestedBillNumber) nextErrors.billNumber = "This field is required";
    if (!String(billDate || "").trim()) nextErrors.billDate = "This field is required";
    if (markAsPaid && !paymentDate) nextErrors.paymentDate = "This field is required";
    if (markAsPaid && paymentAmount <= 0) nextErrors.paidAmount = "This field is required";
    if (markAsPaid && paymentType === "Bank Transfer" && !String(bankName || "").trim()) {
      nextErrors.bankName = "This field is required";
    }
    if (
      markAsPaid &&
      (paymentType === "Bank Transfer" || paymentType === "Card" || paymentType === "Online") &&
      !String(transactionId || "").trim()
    ) {
      nextErrors.transactionId = "This field is required";
    }
    if (markAsPaid && paymentType === "Cheque" && !String(chequeNo || "").trim()) {
      nextErrors.chequeNo = "This field is required";
    }
    if (Object.keys(nextErrors).length) {
      setFormErrors(nextErrors);
      return;
    }
    setFormErrors({});

    setSaving(true);
    try {
      const resolvedLines = await resolveLinesWithItems(computed.detailed);
      const resolvedById = new Map(resolvedLines.map((line) => [line.id, line]));
      setLines((prev) =>
        prev.map((line) => {
          const resolved = resolvedById.get(line.id);
          if (!resolved) return line;
          return {
            ...line,
            itemId: resolved.itemId || "",
            itemCode: resolved.itemCode || "",
            itemName: resolved.itemName || "",
            itemInput: resolved.itemInput || resolved.itemName || "",
            unit: normalizeUnit(resolved.unit),
            rate: Number(resolved.rate || 0),
            saleRate: Number(resolved.saleRate || 0),
            lowStockAlert: nonNegativeNumber(resolved.lowStockAlert ?? line.lowStockAlert, 0),
            tax: forceZeroTax ? 0 : Number(resolved.tax || 0)
          };
        })
      );
      setItems(listItems());

      const validLines = resolvedLines
        .filter((line) => line.itemId)
        .map((line) => (forceZeroTax ? { ...line, tax: 0 } : line));
      if (!validLines.length) {
        setFormErrors((prev) => ({ ...prev, lines: "This field is required" }));
        return;
      }
      clearFormError("lines");

      const effectiveBillNumber = effectiveRequestedBillNumber;
      const effectivePaymentType = isEditMode ? editingPaymentType : markAsPaid ? paymentType : "Unpaid";
      const savedBillId = isEditMode
        ? await purchasesUpdate(editBillId, {
            country,
            partyId: effectivePartyId,
            partyName: effectiveParty?.name || "",
            phone: effectivePhone,
            billNumber: effectiveBillNumber,
            billDate,
            paymentType: effectivePaymentType,
            partyAddress: effectiveSupplierAddress,
            lines: validLines,
            totals: {
              totalQty: computed.totalQty,
              subTotal: computed.subTotal,
              taxTotal: computed.taxTotal,
              tax: computed.tax,
              taxBreakup: computed.tax.taxBreakup,
              taxRate: computed.effectiveRate,
              roundOff: computed.roundOff,
              grandTotal: computed.finalTotal
            },
            taxMode: computed.tax.taxMode,
            supplyType: computed.tax.supplyType || null
          })
        : await purchasesCreate({
            country,
            partyId: effectivePartyId,
            partyName: effectiveParty?.name || "",
            phone: effectivePhone,
            billNumber: effectiveBillNumber,
            billDate,
            paymentType: effectivePaymentType,
            partyAddress: effectiveSupplierAddress,
            lines: validLines,
            totals: {
              totalQty: computed.totalQty,
              subTotal: computed.subTotal,
              taxTotal: computed.taxTotal,
              tax: computed.tax,
              taxBreakup: computed.tax.taxBreakup,
              taxRate: computed.effectiveRate,
              roundOff: computed.roundOff,
              grandTotal: computed.finalTotal
            },
            taxMode: computed.tax.taxMode,
            supplyType: computed.tax.supplyType || null,
            barcodeOptions: {
              enabled: generateBarcodes,
              mode: "unit"
            }
          });

      if (shouldAutoApplySupplierAdvance && savedBillId && advanceAppliedFromWallet > 0) {
        const autoAppliedAdvanceRecords = applySelectedAdvanceWalletEntriesToSupplierBill({
          country,
          supplierId: effectivePartyId,
          billId: savedBillId,
          billNo: effectiveBillNumber,
          billDate,
          billAmount: Number(computed.finalTotal || 0),
          selectedPaymentIds: selectedAdvancePaymentIds,
          maxApplyAmount: advanceAppliedFromWallet,
          actor: authGetUser()?.name || authGetUser()?.email || "System User"
        });
        if (autoAppliedAdvanceRecords.length) {
          await Promise.all(
            autoAppliedAdvanceRecords.map((record) => syncPaymentOutRemote(record))
          );
        }
      }
      if (!isEditMode && savedBillId && debitNotesUsedAmount > 0) {
        applySelectedDebitNotesToPurchaseBill({
          country,
          supplierId: effectivePartyId,
          billId: savedBillId,
          billNo: effectiveBillNumber,
          billDate,
          billAmount: Number(computed.finalTotal || 0),
          selectedNoteIds: selectedDebitNoteIds,
          maxApplyAmount: debitNotesUsedAmount,
          actor: authGetUser()?.name || authGetUser()?.email || "System User"
        });
      }

      let paymentSaved = false;
      let paymentSavedUnapplied = false;
      let partialSaveErrorMessage = "";
      const remainingCashPayable = round2(
        Math.max(0, Number(computed.finalTotal || 0) - advanceAppliedFromWallet - debitNotesUsedAmount)
      );
      const effectiveCashPaymentAmount = round2(Math.min(paymentAmount, remainingCashPayable));
      if (!isEditMode && effectiveCashPaymentAmount > 0) {
        try {
          const payableBefore = outstandingBySupplier(country, effectivePartyId);
          const applyAmount = Math.min(effectiveCashPaymentAmount, remainingCashPayable);
          const paymentOutRecord = savePaymentOut({
            country,
            paymentDate: paymentDate || billDate,
            supplierId: effectivePartyId,
            supplierName: effectiveParty?.name || "",
            currency: currency || "",
            paymentMode: paymentType,
            referenceNo: referenceNo || "",
            chequeNo: paymentType === "Cheque" ? chequeNo : "",
            bankName: paymentType === "Bank Transfer" ? bankName : "",
            transactionId:
              paymentType === "Bank Transfer" || paymentType === "Card" || paymentType === "Online"
                ? transactionId
                : "",
            paymentReference: referenceNo || "",
            internalNotes: paymentNotes || `Payment from purchase bill ${effectiveBillNumber}`,
            attachment: null,
            desiredStatus: "Applied",
            amountPaid: effectiveCashPaymentAmount,
            allocations: [
              {
                billId: savedBillId,
                billNo: effectiveBillNumber,
                billDate,
                billAmount: Number(computed.finalTotal || 0),
                balanceDue: Number(computed.finalTotal || 0),
                applyAmount
              }
            ],
            supplierOutstandingBefore: payableBefore,
            actor: authGetUser()?.name || authGetUser()?.email || "System User"
          });
          await syncPaymentOutRemote(paymentOutRecord);
          paymentSaved = true;
        } catch (paymentError) {
          try {
            const fallbackRecord = savePaymentOut({
              country,
              paymentDate: paymentDate || billDate,
              supplierId: effectivePartyId,
              supplierName: effectiveParty?.name || "",
              currency: currency || "",
              paymentMode: paymentType,
              referenceNo: referenceNo || "",
              chequeNo: paymentType === "Cheque" ? chequeNo : "",
              bankName: paymentType === "Bank Transfer" ? bankName : "",
              transactionId:
                paymentType === "Bank Transfer" || paymentType === "Card" || paymentType === "Online"
                  ? transactionId
                  : "",
              paymentReference: referenceNo || "",
              internalNotes:
                paymentNotes || `Payment from purchase bill ${effectiveBillNumber} (saved as advance balance)`,
              attachment: null,
              desiredStatus: "Paid",
              amountPaid: effectiveCashPaymentAmount,
              allocations: [],
              supplierOutstandingBefore: 0,
              actor: authGetUser()?.name || authGetUser()?.email || "System User"
            });
            await syncPaymentOutRemote(fallbackRecord);
            paymentSaved = true;
            paymentSavedUnapplied = true;
          } catch (fallbackError) {
            partialSaveErrorMessage =
              fallbackError?.message || paymentError?.message || "Payment record could not be saved.";
          }
        }
      }

      const saveMessage = partialSaveErrorMessage
        ? `Bill ${effectiveBillNumber} saved, but Payment Out was not saved: ${partialSaveErrorMessage}`
        : paymentSavedUnapplied
          ? `Bill ${effectiveBillNumber} saved. Payment saved as advance balance in Payment Out.`
          : paymentSaved
            ? `Bill ${effectiveBillNumber} and Payment Out saved successfully.`
            : isEditMode
              ? `Bill ${effectiveBillNumber} updated successfully.`
              : `Bill ${effectiveBillNumber} saved successfully.`;
      setBillNumber(String(companyPeekDocumentNumber("purchase", { dateValue: billDate || new Date() }) || ""));
      setBillNumberManuallyEdited(false);
      setMarkAsPaid(false);
      setPaymentType("Cash");
      setPaymentDate(billDate);
      setPaidAmount("");
      setReferenceNo("");
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setPaymentNotes("");
      setFormErrors({});
      showSaveStatusDialog({
        title: partialSaveErrorMessage ? "Save completed with errors" : "Success",
        message: saveMessage,
        tone: partialSaveErrorMessage ? "error" : "success",
        onClose: () => navigate("/app/purchase/history")
      });
    } catch (error) {
      showSaveStatusDialog({
        title: "Save failed",
        message: error?.message || "Could not save bill.",
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <ActionStatusDialog
        open={saveStatusDialog.open}
        title={saveStatusDialog.title}
        message={saveStatusDialog.message}
        tone={saveStatusDialog.tone}
        onClose={closeSaveStatusDialog}
      />
      <PageHeader
        title={isEditMode ? "Edit Purchase Bill" : "Purchase Bill"}
        subtitle={
          isEditMode
            ? "Update the selected purchase bill and save your changes."
            : "Search supplier by mobile and create the bill."
        }
        className="lg:items-center"
        right={
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end lg:w-auto">
            <input
              ref={invoiceScanInputRef}
              type="file"
              accept="application/pdf,.pdf,image/png,.png,image/jpeg,.jpg,.jpeg,.xlsx,.xls,.csv,text/csv"
              onChange={(event) => {
                void handleInvoiceScanChange(event);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => invoiceScanInputRef.current?.click()}
              disabled={invoiceScanning || saving}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {invoiceScanning ? "Scanning..." : "Scan Invoice"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/purchase/history")}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
            >
              Purchase History
            </button>
          </div>
        }
      />
      {!canSavePurchase ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {isEditMode
            ? "Your role does not have purchase-bill edit permission."
            : "Your role does not have purchase-bill create permission."}
        </div>
      ) : null}
      {editBillLoading ? (
        <Card className="p-4">
          <p className="text-sm text-slate-500">Loading purchase bill for editing...</p>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Free Invoice Scan</h2>
            <p className="mt-1 text-xs text-slate-500">
              Upload a purchase invoice PDF, JPG, PNG, Excel, or CSV to autofill supplier, invoice number, date, total, and line items. You can modify every scanned value before saving.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              PDFs are read from embedded text when possible. Images use free OCR. Line items are ignored on purpose so the scan focuses on header accuracy.
            </p>
          </div>
          {invoiceScanMeta ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 md:max-w-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-slate-900">{invoiceScanMeta.fileName}</p>
                <button
                  type="button"
                  onClick={() => clearScannedInvoice()}
                  className="inline-flex shrink-0 items-center rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Remove Scan
                </button>
              </div>
              <p className="mt-1">Mode: {invoiceScanMeta.extractionMethod || "free-scan"}</p>
              <p className="mt-1">Confidence: {wholeNumber(invoiceScanMeta.confidence)}%</p>
              <p className="mt-1">Items: {wholeNumber(invoiceScanMeta.itemCount || 0)}</p>
              <p className="mt-1">
                Supplier: {invoiceScanMeta.matchedSupplierName || invoiceScanMeta.supplierName || "Not detected"}
              </p>
              <p className="mt-1">Invoice No: {invoiceScanMeta.invoiceNumber || "Not detected"}</p>
              <p className="mt-1">Invoice Date: {invoiceScanMeta.date || "Not detected"}</p>
              <p className="mt-1">
                Final Total: {invoiceScanMeta.total ? money(invoiceScanMeta.total) : "Not detected"}
              </p>
              {!invoiceScanMeta.supplierResolved ? (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-amber-800">
                  Confirm or create the supplier before you save this bill.
                </p>
              ) : null}
              {!invoiceScanMeta.validation?.valid ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-amber-800">
                  Some values need manual review before save.
                </div>
              ) : null}
              {invoiceScanMeta.warnings?.length ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-amber-800">
                  {invoiceScanMeta.warnings[0]}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-slate-900">1. Find Supplier</h2>
        <p className="mt-1 text-xs text-slate-500">
          Use one search box for mobile, name, email, or address. If not found, create supplier directly.
        </p>

        <div className="mt-4">
          <FormField label="Supplier Search" required error={formErrors.supplier}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={supplierLookupQuery}
                autoFocus
                onChange={(event) => handleSupplierLookupChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSupplierSearch();
                  }
                }}
                placeholder="Enter mobile or supplier name/email/address"
                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100 sm:min-w-[260px]"
              />
              <button
                type="button"
                onClick={handleSupplierSearch}
                disabled={loading}
                className="inline-flex h-[42px] items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Search className="h-4 w-4" />
                Search
              </button>
              {partyId ? (
                <button
                  type="button"
                  onClick={resetSupplier}
                  className="inline-flex h-[42px] items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {formErrors.supplier ? <p className="mt-2 text-xs text-rose-600">{formErrors.supplier}</p> : null}
          </FormField>
        </div>

        {supplierSearchError ? (
          <p className="mt-2 text-xs font-medium text-rose-600">{supplierSearchError}</p>
        ) : null}

        {supplierLookupQuery.trim() ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Matching Suppliers
            </p>
            {supplierLookupResults.length ? (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                {supplierLookupResults.map((supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    onClick={() => applySupplierSelection(supplier)}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{supplier.name || "-"}</p>
                      <p className="text-xs text-slate-600">{supplier.phone || "-"}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{supplier.email || "-"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {supplier.country || "-"}{supplier.state ? ` | ${supplier.state}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{supplierAddressSummary(supplier) || "-"}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                <p>No supplier found for this search.</p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={supplierCreateDraft.name}
                    onChange={(event) =>
                      setSupplierCreateDraft((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Supplier name"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <input
                    value={supplierCreateDraft.phone}
                    onChange={(event) =>
                      setSupplierCreateDraft((prev) => ({
                        ...prev,
                        phone: String(event.target.value || "").replace(/\D/g, "").slice(0, 10)
                      }))
                    }
                    placeholder="10-digit mobile"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <div className="relative">
                    <input
                      value={supplierCreateDraft.country}
                      onChange={(event) => {
                        setSupplierCreateDraft((prev) => ({ ...prev, country: event.target.value }));
                        setSupplierCountryMenuOpen(true);
                      }}
                      onFocus={() => setSupplierCountryMenuOpen(true)}
                      onBlur={(event) => {
                        applySupplierCreateCountry(event.target.value);
                        setTimeout(() => setSupplierCountryMenuOpen(false), 80);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setSupplierCountryMenuOpen(false);
                      }}
                      placeholder="Country"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    {supplierCountryMenuOpen && supplierCountryQuery ? (
                      <div className={suggestionMenuClassName}>
                        {supplierCountryMatches.length ? (
                          supplierCountryMatches.map((countryOption) => (
                            <button
                              key={countryOption.isoCode}
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applySupplierCreateCountry(countryOption.name);
                              }}
                              className="w-full rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                            >
                              {countryOption.name}
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-500">No matching countries</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative">
                    <input
                      value={supplierCreateDraft.state}
                      onChange={(event) => {
                        setSupplierCreateDraft((prev) => ({ ...prev, state: event.target.value }));
                        if (supplierCreateStateOptions.length) setSupplierStateMenuOpen(true);
                      }}
                      onFocus={() => {
                        if (supplierCreateStateOptions.length) setSupplierStateMenuOpen(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => setSupplierStateMenuOpen(false), 80);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setSupplierStateMenuOpen(false);
                      }}
                      placeholder={supplierCreateStateOptions.length ? "State / Region" : "State, province, or region"}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    {supplierStateMenuOpen && supplierStateQuery && supplierCreateStateOptions.length ? (
                      <div className={suggestionMenuClassName}>
                        {supplierStateMatches.length ? (
                          supplierStateMatches.map((stateOption) => (
                            <button
                              key={`${stateOption.isoCode}_${stateOption.name}`}
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applySupplierCreateState(stateOption.name);
                              }}
                              className="w-full rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                            >
                              {stateOption.name}
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-500">No matching states/regions</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <input
                    value={supplierCreateDraft.city}
                    onChange={(event) =>
                      setSupplierCreateDraft((prev) => ({ ...prev, city: event.target.value }))
                    }
                    placeholder="City"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <input
                    value={supplierCreateDraft.address}
                    onChange={(event) =>
                      setSupplierCreateDraft((prev) => ({ ...prev, address: event.target.value }))
                    }
                    placeholder="Address"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100 sm:col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void handleCreateSupplier();
                  }}
                  disabled={supplierCreateLoading}
                  className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {supplierCreateLoading ? "Creating..." : "Create Supplier"}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      <div className={partyId ? "" : "pointer-events-none select-none opacity-50"}>
          <Card className="p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">2. Supplier Details</h2>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="font-semibold text-slate-900">{party?.name || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Mobile</p>
                  <p className="font-semibold text-slate-900">{phone || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Country</p>
                  <p className="font-semibold text-slate-900">{party?.country || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">City</p>
                  <p className="font-semibold text-slate-900">{party?.city || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">State</p>
                  <p className="font-semibold text-slate-900">{party?.state || "-"}</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
                <p className="text-xs text-slate-500">Address</p>
                <p className="font-semibold text-slate-900">{supplierAddress || "-"}</p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
          <FormField label="Invoice / Bill ID" required error={formErrors.billNumber}>
            <div className="flex gap-2">
              <input
                value={billNumber}
                onChange={(e) => {
                  clearFormError("billNumber");
                  setBillNumberManuallyEdited(true);
                  setBillNumber(e.target.value);
                }}
                placeholder="Auto generated bill number"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => {
                  clearFormError("billNumber");
                  setBillNumberManuallyEdited(false);
                  setBillNumber(
                    String(companyPeekDocumentNumber("purchase", { dateValue: billDate || new Date() }) || "")
                  );
                }}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Auto
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Bill number is auto generated by default. Once you edit it, auto-fill stops until you press Auto again.
            </p>
            {formErrors.billNumber ? <p className="mt-1 text-xs text-rose-600">{formErrors.billNumber}</p> : null}
          </FormField>
          <FormField label="Bill Date" required error={formErrors.billDate}>
            <DateInput
              value={billDate}
              onChange={(nextValue) => {
                clearFormError("billDate");
                setBillDate(nextValue);
              }}
              className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
            />
            {formErrors.billDate ? <p className="mt-1 text-xs text-rose-600">{formErrors.billDate}</p> : null}
          </FormField>
          <FormField label="Scanned Invoice Total">
            <input
              value={scannedInvoiceTotal}
              onChange={(e) => setScannedInvoiceTotal(e.target.value)}
              placeholder="Auto-filled from scan"
              inputMode="decimal"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-blue-100"
            />
          </FormField>
          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={generateBarcodes}
                  onChange={(event) => setGenerateBarcodes(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Generate Barcode on Save
              </label>
              <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                One barcode per unit quantity
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">3. Items</h2>
            <p className="text-xs text-slate-500">Add item rows, quantity, unit, rate, sell rate, low stock threshold, tax, net amount and total amount.</p>
          </div>
          <button
            type="button"
            onClick={addLine}
            disabled={!canSavePurchase}
            className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Row
          </button>
        </div>
        {formErrors.lines ? <p className="mt-2 text-xs text-rose-600">{formErrors.lines}</p> : null}

        <div className="relative mt-4 overflow-x-auto overflow-y-visible rounded-2xl border border-slate-100">
          <table className="min-w-[1280px] w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[52px]" />
              <col className="w-[260px]" />
              <col className="w-[96px]" />
              <col className="w-[96px]" />
              <col className="w-[112px]" />
              <col className="w-[124px]" />
              <col className="w-[148px]" />
              <col className="w-[96px]" />
              <col className="w-[128px]" />
              <col className="w-[128px]" />
              <col className="w-[60px]" />
            </colgroup>
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Item</th>
                <th className="px-3 py-3 font-semibold">Qty</th>
                <th className="px-3 py-3 font-semibold">Unit</th>
                <th className="px-3 py-3 font-semibold">Rate</th>
                <th className="px-3 py-3 font-semibold">Sell Rate</th>
                <th className="px-3 py-3 font-semibold">Low Stock Threshold</th>
                <th className="px-3 py-3 font-semibold">Tax %</th>
                <th className="px-3 py-3 font-semibold">Net Amount</th>
                <th className="px-3 py-3 font-semibold">Total Amount</th>
                <th className="px-3 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={11}>
                    Loading items...
                  </td>
                </tr>
              ) : computed.detailed.map((line, index) => (
                <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-3">
                    <div className="relative min-w-[220px]">
                      <input
                        value={line.itemInput || line.itemName || ""}
                        onFocus={(event) => {
                          setActiveLineItemSearchId(line.id);
                          updateLineItemPopoverPosition(event.currentTarget);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            setActiveLineItemSearchId((current) => (current === line.id ? "" : current));
                          }, 120);
                        }}
                        onChange={(e) => {
                          setActiveLineItemSearchId(line.id);
                          handleItemInput(line.id, e.target.value);
                          updateLineItemPopoverPosition(e.currentTarget);
                        }}
                        className="w-full rounded-xl border border-slate-100 bg-white px-2.5 py-2 pr-8 text-center text-sm outline-none focus:ring-2 focus:ring-blue-100"
                        placeholder="Search by product name or code"
                      />
                      {(line.itemId || line.itemInput || line.itemName) ? (
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            clearLineItemSelection(line.id);
                            setActiveLineItemSearchId(line.id);
                          }}
                          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="Clear selected item"
                          aria-label="Clear selected item"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="text"
                      value={displayNumericInput(line.qty)}
                      onChange={(e) => {
                        const rawValue = normalizeFormattedNumberInput(e.target.value);
                        const enteredQty = parseFormattedNumber(rawValue);
                        if (line.itemId) {
                        }
                        updateLine(line.id, { qty: rawValue });
                      }}
                      className="w-full min-w-0 rounded-xl border border-slate-100 px-3 py-2 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                      onBlur={(e) => updateLine(line.id, { unit: normalizeUnit(e.target.value) })}
                      list="purchase-bill-unit-options"
                      className="w-full min-w-0 rounded-xl border border-slate-100 bg-white px-3 py-2 text-center text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Unit"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="text"
                      value={displayNumericInput(line.rate)}
                      onChange={(e) =>
                        updateLine(line.id, { rate: normalizeFormattedNumberInput(e.target.value) })
                      }
                      className="w-full min-w-0 rounded-xl border border-slate-100 px-3 py-2 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="text"
                      value={displayNumericInput(line.saleRate)}
                      onChange={(e) =>
                        updateLine(line.id, { saleRate: normalizeFormattedNumberInput(e.target.value) })
                      }
                      className="w-full min-w-0 rounded-xl border border-slate-100 px-3 py-2 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      value={line.lowStockAlert ?? 0}
                      onChange={(e) => updateLine(line.id, { lowStockAlert: e.target.value })}
                      className="w-full min-w-0 rounded-xl border border-slate-100 px-3 py-2 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={forceZeroTax ? 0 : line.tax}
                      onChange={(e) => {
                        if (forceZeroTax) return;
                        updateLine(line.id, { tax: e.target.value });
                      }}
                      className="w-full min-w-0 rounded-xl border border-slate-100 bg-white px-3 py-2 text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                      disabled={forceZeroTax}
                    />
                  </td>
                  <td className="px-3 py-3 font-medium tabular-nums text-slate-800">
                    {money(line.lineSubTotal)}
                  </td>
                  <td className="px-3 py-3 font-semibold tabular-nums text-slate-900">
                    {money(line.amount)}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border border-slate-100 bg-white hover:bg-rose-50"
                      title="Delete row"
                    >
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {activeLineForSearch &&
          activeLineItemSearchId &&
          normalizeItemName(activeLineForSearch.itemInput).length
            ? createPortal(
                <div
                  className="fixed z-[130] rounded-xl border border-slate-100 bg-white p-1.5 shadow-soft"
                  style={{
                    top: `${lineItemPopover.top}px`,
                    left: `${lineItemPopover.left}px`,
                    width: `${lineItemPopover.width}px`
                  }}
                >
                  {activeLineSearchResults.length ? (
                    activeLineSearchResults.map((item) => {
                      const stockInfo = stockByItemId.get(item.id);
                      const remainingText = stockInfo
                        ? `Remaining: ${wholeNumber(stockInfo.available)}`
                        : "Service / Not tracked";
                      const remainingClass = stockInfo
                        ? Number(stockInfo.available || 0) <= 0
                          ? "text-rose-600"
                          : "text-slate-500"
                        : "text-slate-400";
                      return (
                        <button
                          key={`purchase-line-floating-${activeLineForSearch.id}-${item.id}`}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectLineItem(activeLineForSearch, item);
                            setActiveLineItemSearchId("");
                          }}
                          className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span>{formatItemSearchLabel(item)}</span>
                              <span className={`text-[11px] font-semibold ${remainingClass}`}>{remainingText}</span>
                            </div>
                            <span className="text-[10px] text-slate-500">
                              Last purchase: {money(item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.price ?? 0)}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-2 py-1.5 text-xs text-slate-500">No items found</div>
                  )}
                </div>,
                document.body
              )
            : null}
          <datalist id="purchase-bill-unit-options">
            {UNIT_OPTIONS.map((unitOption) => (
              <option key={unitOption} value={unitOption} />
            ))}
          </datalist>
        </div>
        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isEditMode ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Payment Handling</h3>
              <p className="mt-1 text-xs text-slate-500">
                Bill edits update the purchase entry only. Use Payment Out from Purchase History to manage linked payments.
              </p>
            </div>
          ) : (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Payment on Purchase</h3>
            <p className="mt-1 text-xs text-slate-500">Choose whether payment is done now.</p>

            <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setMarkAsPaid(false)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  !markAsPaid ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                Not Paid
              </button>
              <button
                type="button"
                onClick={() => setMarkAsPaid(true)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  markAsPaid ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                Paid
              </button>
            </div>

            {markAsPaid ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Amount Paid" required error={formErrors.paidAmount}>
                  <input
                    type="text"
                    value={displayNumericInput(paidAmount)}
                    onChange={(e) => {
                      clearFormError("paidAmount");
                      setPaidAmount(normalizeFormattedNumberInput(e.target.value));
                    }}
                    placeholder="Enter paid amount"
                    inputMode="decimal"
                    className="numeric-input-uniform w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                  {formErrors.paidAmount ? <p className="mt-1 text-xs text-rose-600">{formErrors.paidAmount}</p> : null}
                </FormField>
                <FormField label="Payment Method">
                  <select
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  >
                    <option>Cash</option>
                    <option>Bank Transfer</option>
                    <option>Cheque</option>
                    <option>Card</option>
                    <option>Online</option>
                  </select>
                </FormField>
                <FormField label="Payment Date" required error={formErrors.paymentDate}>
                  <DateInput
                    value={paymentDate}
                    onChange={(nextValue) => {
                      clearFormError("paymentDate");
                      setPaymentDate(nextValue);
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                  {formErrors.paymentDate ? <p className="mt-1 text-xs text-rose-600">{formErrors.paymentDate}</p> : null}
                </FormField>
                <FormField label="Reference No">
                  <input
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="Enter payment reference"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </FormField>

                {paymentType === "Bank Transfer" ? (
                  <>
                    <FormField label="Bank Name" required error={formErrors.bankName}>
                      <input
                        value={bankName}
                        onChange={(e) => {
                          clearFormError("bankName");
                          setBankName(e.target.value);
                        }}
                        placeholder="Enter bank name"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                      />
                      {formErrors.bankName ? <p className="mt-1 text-xs text-rose-600">{formErrors.bankName}</p> : null}
                    </FormField>
                    <FormField label="Transaction ID" required error={formErrors.transactionId}>
                      <input
                        value={transactionId}
                        onChange={(e) => {
                          clearFormError("transactionId");
                          setTransactionId(e.target.value);
                        }}
                        placeholder="Enter transaction ID"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                      />
                      {formErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{formErrors.transactionId}</p> : null}
                    </FormField>
                  </>
                ) : null}

                {paymentType === "Cheque" ? (
                  <FormField label="Cheque Number" required error={formErrors.chequeNo} className="md:col-span-2">
                    <input
                      value={chequeNo}
                      onChange={(e) => {
                        clearFormError("chequeNo");
                        setChequeNo(e.target.value);
                      }}
                      placeholder="Enter cheque number"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                    />
                    {formErrors.chequeNo ? <p className="mt-1 text-xs text-rose-600">{formErrors.chequeNo}</p> : null}
                  </FormField>
                ) : null}

                {paymentType === "Card" ? (
                  <FormField label="Transaction ID" required error={formErrors.transactionId} className="md:col-span-2">
                    <input
                      value={transactionId}
                      onChange={(e) => {
                        clearFormError("transactionId");
                        setTransactionId(e.target.value);
                      }}
                      placeholder="Enter card transaction ID"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                    />
                    {formErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{formErrors.transactionId}</p> : null}
                  </FormField>
                ) : null}

                {paymentType === "Online" ? (
                  <FormField label="Transaction ID" required error={formErrors.transactionId} className="md:col-span-2">
                    <input
                      value={transactionId}
                      onChange={(e) => {
                        clearFormError("transactionId");
                        setTransactionId(e.target.value);
                      }}
                      placeholder="Enter online transaction ID"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                    />
                    {formErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{formErrors.transactionId}</p> : null}
                  </FormField>
                ) : null}

                <FormField label="Notes" className="md:col-span-2">
                  <input
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Optional internal note"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </FormField>
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                Payment will stay pending. You can record it later in Payment Out.
              </p>
            )}
          </div>
          )}

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
            <p className="mt-1 text-xs text-slate-500">Auto-calculated totals and payable balance.</p>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Total Quantity</span>
                <span className="font-semibold text-slate-900">{money(computed.totalQty)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-semibold text-slate-900">{money(computed.subTotal)}</span>
              </div>
              {computed.tax.taxMode === "GST" ? (
                computed.tax.supplyType === "INTER" ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">GST Total</span>
                    <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">CGST</span>
                      <span className="font-semibold text-slate-900">{money(computed.tax.cgst)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">SGST</span>
                      <span className="font-semibold text-slate-900">{money(computed.tax.sgst)}</span>
                    </div>
                  </>
                )
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Tax Total</span>
                  <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
                </div>
              )}
              {gstRuntimeEnabled && computed.tax.warning ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {computed.tax.warning}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={roundOffEnabled}
                    onChange={(e) => setRoundOffEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Round Off
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={roundOffValue}
                  onChange={(e) => {
                    const nextValue = String(e.target.value || "");
                    if (!isValidRoundOffInput(nextValue)) return;
                    setRoundOffValue(nextValue);
                  }}
                  onBlur={() => {
                    const text = String(roundOffValue || "").trim();
                    if (!text || text === "-" || text === "." || text === "-.") {
                      setRoundOffValue("0.00");
                      return;
                    }
                    const parsed = Number(text);
                    if (!Number.isFinite(parsed)) {
                      setRoundOffValue("0.00");
                      return;
                    }
                    setRoundOffValue(round2(parsed).toFixed(2));
                  }}
                  disabled={!roundOffEnabled}
                  className="w-24 rounded-xl border border-slate-200 px-2 py-1.5 text-sm outline-none disabled:bg-slate-100"
                />
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Grand Total (Before Round Off)</span>
                  <span className="font-semibold text-slate-900">{money(computed.grandTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Round Off</span>
                  <span className={`font-semibold ${computed.roundOff < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {computed.roundOff > 0 ? "+" : ""}
                    {money(computed.roundOff)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Final Grand Total</span>
                  <span className="font-semibold text-slate-900">{money(computed.finalTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Paid Now</span>
                  <span className="font-semibold text-emerald-700">{money(paymentAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Balance Due</span>
                  <span className="font-semibold text-rose-700">{money(pendingAmount)}</span>
                </div>
                {supplierAdvanceWallet > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Existing Advance Wallet</span>
                    <span className="font-semibold text-emerald-700">{money(supplierAdvanceWallet)}</span>
                  </div>
                ) : null}
                {advanceAppliedFromWallet > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Advance Applied Now</span>
                    <span className="font-semibold text-emerald-700">{money(advanceAppliedFromWallet)}</span>
                  </div>
                ) : null}
                {advanceAmount > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Advance From This Bill</span>
                    <span className="font-semibold text-emerald-700">{money(advanceAmount)}</span>
                  </div>
                ) : null}
                {projectedAdvanceWallet > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Advance Wallet After Save</span>
                    <span className="font-semibold text-emerald-700">{money(projectedAdvanceWallet)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {!isEditMode && supplierAdvanceEntries.length ? (
              <div className="mt-4">
                <AllocationSelectionCard
                  accent="sky"
                  title="Supplier Advance Wallet"
                  subtitle="Choose which advance payments should reduce this bill."
                  countLabel="Selected"
                  countValue={money(selectedAdvancePaymentBalance)}
                  availableLabel="Available Advance Balance"
                  availableAmount={money(supplierAdvanceWallet)}
                  selectedAmount={money(selectedAdvancePaymentBalance)}
                  appliedAmount={money(advanceAppliedFromWallet)}
                  remainingAmount={money(Math.max(0, selectedAdvancePaymentBalance - advanceAppliedFromWallet))}
                  updatedTotal={money(balanceAfterExistingAdvance)}
                  updatedTotalLabel="Updated Balance Due"
                  statusLabel="Bill Status"
                  statusValue={balanceAfterExistingAdvance <= 0 ? "Fully Settled" : "Balance Pending"}
                  statusTone={balanceAfterExistingAdvance <= 0 ? "success" : "warning"}
                  buttonLabel="Select Advance Entries"
                  modalTitle="Supplier Advance Wallet"
                  modalSubtitle="Pick the exact payment entries to use on this bill."
                  rows={supplierAdvancePreviewRows}
                  open={advanceWalletPickerOpen}
                  onOpen={() => setAdvanceWalletPickerOpen(true)}
                  onClose={() => setAdvanceWalletPickerOpen(false)}
                  columns={[
                    { key: "paymentNo", label: "Payment" },
                    { key: "paymentDate", label: "Date" },
                    { key: "amountPaid", label: "Payment Amount", align: "right", render: (row) => money(row.amountPaid) },
                    {
                      key: "availableAmount",
                      label: "Available",
                      align: "right",
                      render: (row) => (
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{money(row.availableAmount)}</p>
                          {row.billNo ? <p className="text-[10px] text-slate-500">From {row.billNo}</p> : null}
                        </div>
                      )
                    },
                    { key: "appliedToBill", label: "Applied to Bill", align: "right", render: (row) => money(row.appliedToBill) },
                    { key: "entryBalanceAfter", label: "Balance Left", align: "right", render: (row) => money(row.entryBalanceAfter) },
                    { key: "billBalanceAfter", label: "Bill Due After", align: "right", render: (row) => money(row.billBalanceAfter) },
                    {
                      key: "settlementStatus",
                      label: "Status",
                      render: (row) => (
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
                            row.settlementStatus === "Fully Settled"
                              ? "bg-emerald-50 text-emerald-700"
                              : row.settlementStatus === "Applied"
                                ? "bg-sky-50 text-sky-700"
                                : row.isSelected
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {row.settlementStatus}
                        </span>
                      )
                    }
                  ]}
                  renderRowCheckbox={(row, checkboxClass) => {
                    const rowChecked = selectedAdvancePaymentIdSet.has(String(row.paymentId || ""));
                    return (
                      <label className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={rowChecked}
                          onChange={(event) => {
                            const nextChecked = event.target.checked;
                            setSelectedAdvancePaymentIds((prev) => {
                              const next = new Set((Array.isArray(prev) ? prev : []).map((value) => String(value || "")));
                              if (nextChecked) next.add(String(row.paymentId || ""));
                              else next.delete(String(row.paymentId || ""));
                              return Array.from(next);
                            });
                          }}
                          className={`h-4 w-4 rounded border-slate-300 ${checkboxClass}`}
                        />
                        <span className="text-[11px] font-semibold">{rowChecked ? "Selected" : "Select"}</span>
                      </label>
                    );
                  }}
                />
              </div>
            ) : null}

            {!isEditMode && partyId && !visibleDebitNotes.length ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                No debit notes found for this supplier.
              </div>
            ) : null}
            {visibleDebitNotes.length ? (
              <div className="mt-4">
                <AllocationSelectionCard
                  accent="sky"
                  title="Supplier Debit Notes"
                  subtitle="Choose which debit notes should reduce this bill."
                  countLabel="Selected"
                  countValue={money(selectedDebitNoteBalance)}
                  availableLabel="Available Debit Note Balance"
                  availableAmount={money(round2(visibleDebitNotes.reduce((sum, entry) => sum + Math.max(0, Number((entry.availableAmount ?? entry.totalAmount) || 0)), 0)))}
                  selectedAmount={money(selectedDebitNoteBalance)}
                  appliedAmount={money(debitNotesUsedAmount)}
                  remainingAmount={money(Math.max(0, selectedDebitNoteBalance - debitNotesUsedAmount))}
                  updatedTotal={money(balanceAfterExistingAdvance)}
                  updatedTotalLabel="Updated Balance Due"
                  buttonLabel="Select Debit Notes"
                  modalTitle="Supplier Debit Notes"
                  modalSubtitle="Pick the exact debit notes to apply on this bill."
                  rows={visibleDebitNotes}
                  open={debitNotePickerOpen}
                  onOpen={() => setDebitNotePickerOpen(true)}
                  onClose={() => setDebitNotePickerOpen(false)}
                  columns={[
                    { key: "debitNoteNo", label: "Debit Note" },
                    { key: "debitNoteDate", label: "Date" },
                    { key: "linkedPurchaseInvoiceNo", label: "Source Bill" },
                    { key: "totalAmount", label: "Amount", align: "right", render: (row) => money(row.totalAmount) },
                    { key: "availableAmount", label: "Available", align: "right", render: (row) => money(row.availableAmount ?? row.totalAmount) }
                  ]}
                  renderRowCheckbox={(row, checkboxClass) => {
                    const rowChecked = row.usedOnBill || selectedDebitNoteIdSet.has(String(row.id || ""));
                    const rowDisabled = row.usedOnBill || isEditMode;
                    return (
                      <label className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={rowChecked}
                          disabled={rowDisabled}
                          onChange={(event) => {
                            const nextChecked = event.target.checked;
                            setSelectedDebitNoteIds((prev) => {
                              const next = new Set((Array.isArray(prev) ? prev : []).map((value) => String(value || "")));
                              if (nextChecked) next.add(String(row.id || ""));
                              else next.delete(String(row.id || ""));
                              return Array.from(next);
                            });
                          }}
                          className={`h-4 w-4 rounded border-slate-300 ${checkboxClass}`}
                        />
                        <span className="text-[11px] font-semibold">{row.usedOnBill ? "Used" : "Use"}</span>
                      </label>
                    );
                  }}
                />
              </div>
            ) : null}
            {visibleDebitNotes.length ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">
                      {isEditMode ? "Debit Notes Against This Bill" : "Supplier Debit Notes"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {isEditMode
                        ? "Debit note date, amount, bill no, and whether it is already used on this purchase bill."
                        : "Date, amount, bill no, and whether this debit note should be used on this purchase bill."}
                    </p>
                  </div>
                  <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                    Selected: {money(selectedDebitNoteBalance)}
                  </span>
                </div>
                <div className="border-b border-slate-200 bg-sky-50/60 px-3 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {isEditMode ? "Bill Debit Notes" : "Supplier Debit Notes"}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Available Debit Note Balance: {money(
                          round2(
                            visibleDebitNotes.reduce(
                              (sum, entry) => sum + Math.max(0, Number(entry.totalAmount || 0)),
                              0
                            )
                          )
                        )}
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={useAvailableDebitNotes}
                        onChange={(event) => setUseAvailableDebitNotes(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400"
                      />
                      Apply Available Debit Note
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                      <p>Purchase Total: <span className="font-semibold text-slate-900">{money(computed.finalTotal)}</span></p>
                      <p className="mt-1">Debit Notes Used: <span className="font-semibold text-sky-700">{money(debitNotesUsedAmount)}</span></p>
                    </div>
                    <div className="rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                      <p>Remaining Debit Balance: <span className="font-semibold text-sky-700">{money(Math.max(0, selectedDebitNoteBalance - debitNotesUsedAmount))}</span></p>
                      <p className="mt-1">Updated Balance Due: <span className="font-semibold text-rose-700">{money(balanceAfterExistingAdvance)}</span></p>
                    </div>
                  </div>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="bg-white text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Debit Note</th>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Bill No</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-right font-semibold">Used Here</th>
                        <th className="px-3 py-2 font-semibold">Use</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDebitNotes.map((entry) => {
                        const rowChecked = entry.usedOnBill || selectedDebitNoteIdSet.has(String(entry.id || ""));
                        const rowDisabled = entry.usedOnBill || isEditMode;
                        return (
                          <tr key={entry.id} className="border-t border-slate-200 bg-white">
                            <td className="px-3 py-2 font-semibold text-slate-900">{entry.debitNoteNo || "-"}</td>
                            <td className="px-3 py-2 text-slate-700">{formatCompactDate(entry.debitNoteDate)}</td>
                            <td className="px-3 py-2 text-slate-700">{entry.linkedPurchaseInvoiceNo || "-"}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">{money(entry.totalAmount)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-sky-700">
                              {entry.usedOnBill ? money(entry.totalAmount) : rowChecked && useAvailableDebitNotes ? money(Math.min(Number(entry.totalAmount || 0), Number(computed.finalTotal || 0))) : "-"}
                            </td>
                            <td className="px-3 py-2">
                              <label className="inline-flex items-center gap-2 text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={rowChecked}
                                  disabled={rowDisabled}
                                  onChange={(event) => {
                                    const nextChecked = event.target.checked;
                                    setSelectedDebitNoteIds((prev) => {
                                      const next = new Set((Array.isArray(prev) ? prev : []).map((value) => String(value || "")));
                                      if (nextChecked) {
                                        next.add(String(entry.id || ""));
                                      } else {
                                        next.delete(String(entry.id || ""));
                                      }
                                      setUseAvailableDebitNotes(next.size > 0);
                                      return Array.from(next);
                                    });
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400"
                                />
                                <span className="text-[11px] font-semibold">
                                  {entry.usedOnBill ? "Used" : "Use"}
                                </span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            void save();
          }}
          disabled={!canSavePurchase || saving || loading || editBillLoading}
          className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : isEditMode ? "Save Changes" : "Save Purchase Bill"}
        </button>
      </div>
      </div>
      {!partyId ? (
        <Card className="p-6">
          <p className="text-sm text-slate-600">
            Search and select supplier first. Purchase form is visible but disabled until supplier is selected.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
