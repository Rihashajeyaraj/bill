import React, { useEffect, useMemo, useState } from "react";
import { Plus, Save, Search, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote, upsertPartyRemote } from "../../modules/parties/store";
import { computeItemStock, listItems, syncItemsFromRemote, upsertItemRemote } from "../../modules/items/store";
import {
  fetchSupplierAddress,
  purchasesCreate
} from "../../services/purchases.service";
import { useOrganization } from "../../context/OrganizationContext";
import { calculateTaxes } from "../../services/tax";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { syncPaymentOutRemote } from "../../services/payments.service";
import { outstandingBySupplier, savePaymentOut } from "../../modules/paymentOut/store";
import { canCreateEntries } from "../../services/roles";
import {
  getCanonicalCountryName,
  listAllCountries,
  listStatesByCountry,
  resolveCountryIsoCode
} from "../../lib/geoData";

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
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  const role = authGetRole();
  const canCreatePurchase = canCreateEntries(role);
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
  const [saving, setSaving] = useState(false);
  const party = useMemo(() => suppliers.find((x) => x.id === partyId) || null, [suppliers, partyId]);

  const [phone, setPhone] = useState(party?.phone || "");
  const [supplierSearchPhone, setSupplierSearchPhone] = useState("");
  const [supplierLookupQuery, setSupplierLookupQuery] = useState("");
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [supplierCreateLoading, setSupplierCreateLoading] = useState(false);
  const [supplierCreateDraft, setSupplierCreateDraft] = useState({
    name: "",
    phone: "",
    country: country || "",
    state: ""
  });
  const [supplierCountryMenuOpen, setSupplierCountryMenuOpen] = useState(false);
  const [supplierStateMenuOpen, setSupplierStateMenuOpen] = useState(false);
  const [supplierAddress, setSupplierAddress] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [generateBarcodes, setGenerateBarcodes] = useState(true);
  const [lines, setLines] = useState(() => [createLine(defaultLineTaxRate)]);
  const [activeLineItemSearchId, setActiveLineItemSearchId] = useState("");
  const [lineItemPopover, setLineItemPopover] = useState({ top: 0, left: 0, width: 280 });
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const [roundOffValue, setRoundOffValue] = useState("0.00");
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [paymentType, setPaymentType] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const paymentAmount = useMemo(() => {
    if (!markAsPaid) return 0;
    const parsedAmount = Number(paidAmount || 0);
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

  function clearFormError(field) {
    setFormErrors((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
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

  async function handleCreateSupplier() {
    const name = String(supplierCreateDraft.name || "").trim();
    const phone = extractTenDigitPhone(supplierCreateDraft.phone);
    const draftCountry = String(supplierCreateDraft.country || country || "").trim();
    const draftState = String(supplierCreateDraft.state || "").trim();

    if (!name) {
      setSupplierSearchError("Supplier name is required.");
      return;
    }
    if (phone.length !== 10) {
      setSupplierSearchError("Supplier mobile must be exactly 10 digits.");
      return;
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
        address: "",
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
        state: ""
      });
      setSupplierCountryMenuOpen(false);
      setSupplierStateMenuOpen(false);
      toast.success("Supplier created", `${created.name} added successfully.`);
    } catch (error) {
      setSupplierSearchError(error?.message || "Failed to create supplier.");
    } finally {
      setSupplierCreateLoading(false);
    }
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
      state: ""
    });
    setSupplierCountryMenuOpen(false);
    setSupplierStateMenuOpen(false);
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

  const pendingAmount = useMemo(
    () => round2(Math.max(0, Number(computed.finalTotal || 0) - Number(paymentAmount || 0))),
    [computed.finalTotal, paymentAmount]
  );
  const advanceAmount = useMemo(
    () => round2(Math.max(0, Number(paymentAmount || 0) - Number(computed.finalTotal || 0))),
    [paymentAmount, computed.finalTotal]
  );

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
    if (!canCreatePurchase) {
      toast.error("Permission denied", "You do not have permission to create purchase bills.");
      return;
    }
    const normalizedBillNumber = String(billNumber || "").trim();
    const nextErrors = {};
    if (!partyId) nextErrors.supplier = "This field is required";
    if (!normalizedBillNumber) nextErrors.billNumber = "This field is required";
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

      const qtyExceededLine = validLines.find((line) => {
        const matchedItem = purchasableItems.find(
          (item) => String(item.id) === String(line.itemId)
        );
        if (!matchedItem) return false;
        const itemQty = Number(matchedItem?.quantity ?? matchedItem?.currentStock ?? 0);
        return itemQty > 0 && Number(line.qty || 0) > itemQty;
      });
      if (qtyExceededLine) {
        const matchedItem = purchasableItems.find(
          (item) => String(item.id) === String(qtyExceededLine.itemId)
        );
        const itemQty = Number(matchedItem?.quantity ?? matchedItem?.currentStock ?? 0);
        toast.error(
          "Quantity exceeds item qty",
          `"${matchedItem?.name || "Item"}" has qty ${itemQty}, but ${Number(qtyExceededLine.qty || 0)} was entered.`
        );
        return;
      }

      const effectiveBillNumber = normalizedBillNumber;
      const effectivePaymentType = markAsPaid ? paymentType : "Unpaid";
      const createdBillId = await purchasesCreate({
        country,
        partyId,
        partyName: party?.name || "",
        phone,
        billNumber: effectiveBillNumber,
        billDate,
        paymentType: effectivePaymentType,
        partyAddress: supplierAddress,
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

      let paymentSaved = false;
      let paymentSavedUnapplied = false;
      if (paymentAmount > 0) {
        try {
          const payableBefore = outstandingBySupplier(country, partyId);
          const applyAmount = Math.min(paymentAmount, Number(computed.finalTotal || 0));
          const paymentOutRecord = savePaymentOut({
            country,
            paymentDate: paymentDate || billDate,
            supplierId: partyId,
            supplierName: party?.name || "",
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
            amountPaid: paymentAmount,
            allocations: [
              {
                billId: createdBillId,
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
              supplierId: partyId,
              supplierName: party?.name || "",
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
                paymentNotes || `Payment from purchase bill ${effectiveBillNumber} (saved as unapplied)`,
              attachment: null,
              desiredStatus: "Paid",
              amountPaid: paymentAmount,
              allocations: [],
              supplierOutstandingBefore: 0,
              actor: authGetUser()?.name || authGetUser()?.email || "System User"
            });
            await syncPaymentOutRemote(fallbackRecord);
            paymentSaved = true;
            paymentSavedUnapplied = true;
          } catch (fallbackError) {
            toast.warning(
              "Bill saved but payment not linked",
              fallbackError?.message || paymentError?.message || "Payment record could not be saved."
            );
          }
        }
      }

      if (paymentSavedUnapplied) {
        toast.success(
          "Purchase bill saved",
          `Bill ${effectiveBillNumber} saved. Payment saved as unapplied in Payment Out.`
        );
      } else if (paymentSaved) {
        toast.success(
          "Purchase bill saved",
          `Bill ${effectiveBillNumber} and Payment Out saved successfully.`
        );
      } else {
        toast.success("Purchase bill saved", `Bill ${effectiveBillNumber} saved successfully.`);
      }
      setBillNumber("");
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
    } catch (error) {
      toast.error("Failed to save purchase bill", error?.message || "Could not save bill.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Purchase Bill" subtitle="Search supplier by mobile and create the bill." />
      {!canCreatePurchase ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Your role does not have purchase-bill create permission.
        </div>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/app/purchase/history")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Purchase History
        </button>
      </div>

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
                className="min-w-[260px] flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
          <FormField label="Invoice / Bill ID" required error={formErrors.billNumber}>
            <input
              value={billNumber}
              onChange={(e) => {
                clearFormError("billNumber");
                setBillNumber(e.target.value);
              }}
              placeholder="Enter Invoice / Bill ID"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-blue-100"
            />
            {formErrors.billNumber ? <p className="mt-1 text-xs text-rose-600">{formErrors.billNumber}</p> : null}
          </FormField>
          <FormField label="Bill Date" required error={formErrors.billDate}>
            <input
              type="date"
              value={billDate}
              onChange={(e) => {
                clearFormError("billDate");
                setBillDate(e.target.value);
              }}
              className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
            />
            {formErrors.billDate ? <p className="mt-1 text-xs text-rose-600">{formErrors.billDate}</p> : null}
          </FormField>
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
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
            disabled={!canCreatePurchase}
            className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Row
          </button>
        </div>
        {formErrors.lines ? <p className="mt-2 text-xs text-rose-600">{formErrors.lines}</p> : null}

        <div className="relative mt-4 overflow-x-auto overflow-y-visible rounded-2xl border border-slate-100">
          <table className="min-w-[920px] w-full text-left text-sm">
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
                <th className="px-3 py-3 font-semibold text-right">Net Amount</th>
                <th className="px-3 py-3 font-semibold text-right">Total Amount</th>
                <th className="px-3 py-3 font-semibold text-right"></th>
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
                        className="w-full rounded-xl border border-slate-100 bg-white px-2.5 py-2 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-100"
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
                      type="number"
                      min="0"
                      value={line.qty}
                      onChange={(e) => {
                        const enteredQty = Number(e.target.value);
                        if (line.itemId) {
                          const matchedItem = purchasableItems.find(
                            (item) => String(item.id) === String(line.itemId)
                          );
                          const itemQty = Number(matchedItem?.quantity ?? matchedItem?.currentStock ?? 0);
                          if (matchedItem && itemQty > 0 && enteredQty > itemQty) {
                            toast.warning(
                              "Quantity exceeds item qty",
                              `Cannot enter ${enteredQty}. Maximum allowed is ${itemQty}.`
                            );
                            updateLine(line.id, { qty: itemQty });
                            return;
                          }
                        }
                        updateLine(line.id, { qty: e.target.value });
                      }}
                      className="w-20 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                      onBlur={(e) => updateLine(line.id, { unit: normalizeUnit(e.target.value) })}
                      list="purchase-bill-unit-options"
                      className="w-24 rounded-xl border border-slate-100 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Unit"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.rate}
                      onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                      className="w-24 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      value={line.saleRate ?? ""}
                      onChange={(e) => updateLine(line.id, { saleRate: e.target.value })}
                      className="w-28 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      value={line.lowStockAlert ?? 0}
                      onChange={(e) => updateLine(line.id, { lowStockAlert: e.target.value })}
                      className="w-32 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
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
                      className="w-24 rounded-xl border border-slate-100 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                      disabled={forceZeroTax}
                    />
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-slate-800">
                    {money(line.lineSubTotal)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-900">
                    {money(line.amount)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="h-8 w-8 rounded-full border border-slate-100 bg-white hover:bg-rose-50 flex items-center justify-center"
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
                      const remainingText = stockInfo ? `Remaining: ${stockInfo.available}` : "Service / Not tracked";
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
                    type="number"
                    min="0"
                    value={paidAmount}
                    onChange={(e) => {
                      clearFormError("paidAmount");
                      setPaidAmount(e.target.value);
                    }}
                    placeholder="Enter paid amount"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
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
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => {
                      clearFormError("paymentDate");
                      setPaymentDate(e.target.value);
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
                {advanceAmount > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Advance</span>
                    <span className="font-semibold text-emerald-700">{money(advanceAmount)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            void save();
          }}
          disabled={!canCreatePurchase || saving || loading}
          className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Purchase Bill"}
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
