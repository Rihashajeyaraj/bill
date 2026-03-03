import React, { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Save, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";

import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import FormField from "../../components/FormField";
import DataTable from "../../components/DataTable";
import Badge from "../../components/Badge";
import InvoicePreview from "../../components/InvoicePreview";

import { useOrganization } from "../../context/OrganizationContext";
import { invoicesCreate, invoicesSyncFromRemote } from "../../services/invoices.service";
import { calculateTaxes } from "../../services/tax";
import { isOrganizationScopedStorageEventKey, LS_KEYS } from "../../services/storage";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { syncPaymentInRemote } from "../../services/payments.service";
import { fetchItemStockHistory } from "../../services/inventory.service";
import { canCreateEntries } from "../../services/roles";
import { UI } from "../../theme/tokens";
import { formatMoney } from "../../modules/parties/utils";
import { getPartyCreditStatus, listParties, syncPartiesFromRemote, upsertPartyRemote } from "../../modules/parties/store";
import { computeItemStock, listItems, syncItemsFromRemote } from "../../modules/items/store";
import { outstandingByCustomer, savePaymentIn } from "../../modules/paymentIn/store";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE } from "../../modules/paymentIn/countryConfig";
import { getInvoiceTemplateConfig } from "../../lib/templateStore";
import {
  companyGetProfile,
  companyConsumeDocumentNumber,
} from "../../services/company.service";
import {
  getCanonicalCountryName,
  listAllCountries,
  listStatesByCountry,
  resolveCountryIsoCode
} from "../../lib/geoData";
import {
  listItemBarcodes,
  normalizeBarcodeLookupValue,
  syncItemBarcodesFromRemote
} from "../../services/itemBarcodes.service";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeInvoiceCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "INV";
  const withoutTrailingDigits = raw.replace(/\d+$/, "").replace(/[-\s_]+$/, "").trim();
  return withoutTrailingDigits || "INV";
}

function toInvoiceCounter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return 1;
  return Math.trunc(numeric);
}

function buildInvoiceId(code, year, counter) {
  const safeCode = normalizeInvoiceCode(code);
  const safeYear = String(year || new Date().getFullYear());
  const safeCounter = String(toInvoiceCounter(counter)).padStart(4, "0");
  return `${safeCode}-${safeYear}-${safeCounter}`;
}

function formatAddress(address) {
  if (!address) return "";
  const parts = [address.line1, address.line2, address.city, address.state, address.postalCode]
    .map((part) => (part ? String(part).trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

const VAT_RATES = {
  "Sri Lanka": 18,
  UAE: 5,
  "United Kingdom": 20,
  UK: 20,
  Ireland: 23
};
function getVatRate(country, company) {
  return company?.tax?.vatRate || VAT_RATES[country] || 0;
}

function parseRateInput(value) {
  const match = String(value || "").match(/[\d.]+/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveCurrencySymbol(symbol, currencyCode) {
  if (symbol) return symbol;
  const normalized = String(currencyCode || "").trim().toUpperCase();
  return normalized ? `${normalized} ` : "";
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

function customerAddressSummary(customer) {
  return [customer?.address, customer?.state, customer?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeItemSearchText(value) {
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

function itemMatchesSearchQuery(item, query, barcodeLookupByItemId = null) {
  const normalizedQuery = normalizeItemSearchText(query);
  if (!normalizedQuery) return true;
  const name = normalizeItemSearchText(item?.name);
  const itemCode = normalizeItemSearchText(item?.itemCode);
  const id = normalizeItemSearchText(item?.id);
  if (name.includes(normalizedQuery) || itemCode.includes(normalizedQuery) || id.includes(normalizedQuery)) {
    return true;
  }
  if (!barcodeLookupByItemId || typeof barcodeLookupByItemId.get !== "function") return false;
  const barcodeValues = barcodeLookupByItemId.get(String(item?.id || "")) || [];
  return barcodeValues.some((barcodeValue) =>
    normalizeBarcodeLookupValue(barcodeValue).includes(normalizeBarcodeLookupValue(normalizedQuery))
  );
}

function findItemBySearchInput(items, value, barcodeLookupByItemId = null) {
  const normalizedTextValue = normalizeItemSearchText(value);
  const normalizedBarcodeValue = normalizeBarcodeLookupValue(value);
  if (!normalizedTextValue && !normalizedBarcodeValue) return null;
  return (
    items.find((item) => {
      const name = normalizeItemSearchText(item?.name);
      const itemCode = normalizeItemSearchText(item?.itemCode);
      const id = normalizeItemSearchText(item?.id);
      const label = normalizeItemSearchText(formatItemSearchLabel(item));
      const barcodeValues =
        barcodeLookupByItemId && typeof barcodeLookupByItemId.get === "function"
          ? barcodeLookupByItemId.get(String(item?.id || "")) || []
          : [];
      const barcodeMatch = normalizedBarcodeValue
        ? barcodeValues.some(
            (barcodeValue) => normalizeBarcodeLookupValue(barcodeValue) === normalizedBarcodeValue
          )
        : false;
      return (
        normalizedTextValue === name ||
        normalizedTextValue === itemCode ||
        normalizedTextValue === id ||
        normalizedTextValue === label ||
        barcodeMatch
      );
    }) || null
  );
}

function isValidDateParts(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function parseDateToIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidDateParts(year, month, day)) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const dmyMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!dmyMatch) return "";
  const day = Number(dmyMatch[1]);
  const month = Number(dmyMatch[2]);
  const year = Number(dmyMatch[3]);
  if (!isValidDateParts(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatIsoToDayMonthYear(value) {
  const text = String(value || "").trim();
  const iso = parseDateToIso(text);
  if (!iso) return text;
  const [, year, month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  return `${day}/${month}/${year}`;
}

function resolvePaymentCountryCode(country, countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  if (code === "LK") return "SL";
  if (code === "GB") return "UK";
  if (code && code in COUNTRY_CONFIG) return code;
  const normalized = String(country || "").trim();
  if (COUNTRY_NAME_TO_CODE[normalized]) return COUNTRY_NAME_TO_CODE[normalized];
  if (normalized.toUpperCase() in COUNTRY_CONFIG) return normalized.toUpperCase();
  return "IN";
}

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const role = authGetRole();
  const canCreateInvoice = canCreateEntries(role);
  const { profile: company = {}, country = "", countryCode = "", currency = "", currencySymbol = "" } = useOrganization();
  const [templateConfig, setTemplateConfig] = useState(() => getInvoiceTemplateConfig());
  const isIndiaOrg = country === "India";
  const companyTaxSettings = company?.settings?.tax || {};
  const configuredGstEnabled = companyTaxSettings.enableGst;
  const configuredGstRate = Number(companyTaxSettings.defaultGstRate);
  const defaultGstRate = Number.isFinite(configuredGstRate) && configuredGstRate >= 0 ? configuredGstRate : 18;
  const gstRuntimeEnabled = isIndiaOrg && configuredGstEnabled !== false;
  const forceZeroTax = isIndiaOrg && configuredGstEnabled === false;

  const [customers, setCustomers] = useState(() =>
    listParties().filter((party) => party.type === "Customer")
  );
  const [items, setItems] = useState(() => listItems());
  const [itemBarcodes, setItemBarcodes] = useState(() => listItemBarcodes());
  const [itemSearch, setItemSearch] = useState("");

  const initialInvoiceDate = new Date().toISOString().slice(0, 10);
  const invoiceYear = new Date().getFullYear();
  const initialInvoiceCode = normalizeInvoiceCode(company?.settings?.numbering?.prefixes?.invoice || "INV");
  const initialInvoiceCounter = toInvoiceCounter(company?.settings?.numbering?.counters?.invoice || 1);
  const [invoiceDate, setInvoiceDate] = useState(initialInvoiceDate);
  const [invoiceDateInput, setInvoiceDateInput] = useState(() => formatIsoToDayMonthYear(initialInvoiceDate));
  const [invoiceCode, setInvoiceCode] = useState(initialInvoiceCode);
  const [invoiceCounter, setInvoiceCounter] = useState(initialInvoiceCounter);
  const [invoiceNo, setInvoiceNo] = useState(() =>
    buildInvoiceId(initialInvoiceCode, invoiceYear, initialInvoiceCounter)
  );
  const [partyId, setPartyId] = useState("");
  const party = useMemo(() => customers.find((c) => c.id === partyId) || null, [customers, partyId]);
  const [customerSearchPhone, setCustomerSearchPhone] = useState("");
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [customerCreateLoading, setCustomerCreateLoading] = useState(false);
  const [customerCreateDraft, setCustomerCreateDraft] = useState({
    name: "",
    phone: "",
    country: country || "",
    state: ""
  });
  const [customerCountryMenuOpen, setCustomerCountryMenuOpen] = useState(false);
  const [customerStateMenuOpen, setCustomerStateMenuOpen] = useState(false);
  const [activeLineItemSearchId, setActiveLineItemSearchId] = useState("");
  const [lineItemPopover, setLineItemPopover] = useState({ top: 0, left: 0, width: 280 });
  const [itemBatchMap, setItemBatchMap] = useState({});

  const [lines, setLines] = useState([]);
  const [lastSavedInvoiceId, setLastSavedInvoiceId] = useState("");
  const [printInvoiceData, setPrintInvoiceData] = useState(null);
  const [printQueued, setPrintQueued] = useState(false);
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(initialInvoiceDate);
  const [paidAmount, setPaidAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  const companyCountry = String(country || company?.country || company?.address?.country || "").trim();
  const customerCountry = String(party?.country || "").trim();
  const companyState = company?.address?.state || "";
  const customerState = party?.state || "";
  const allowNegativeStock = useMemo(() => {
    const raw =
      company?.settings?.inventory?.allowNegativeStock ??
      company?.settings?.preferences?.allowNegativeStock ??
      company?.settings?.allowNegativeStock ??
      company?.settings?.allow_negative_stock;
    return raw === true || String(raw || "").toLowerCase() === "true";
  }, [company]);
  const paymentCountryCode = useMemo(
    () => resolvePaymentCountryCode(country, countryCode),
    [country, countryCode]
  );
  const paymentModes = useMemo(
    () => COUNTRY_CONFIG[paymentCountryCode]?.paymentModes || ["Cash", "Bank Transfer", "Cheque", "Card", "Online Gateway"],
    [paymentCountryCode]
  );
  const companyVatRate = company?.tax?.vatRate;
  const defaultRate = gstRuntimeEnabled ? defaultGstRate : isIndiaOrg ? 0 : getVatRate(country, company);
  const [taxRate, setTaxRate] = useState(defaultRate);
  const [vatInput, setVatInput] = useState(
    gstRuntimeEnabled ? "" : `TAX ${Number.isFinite(defaultRate) ? defaultRate : 0}%`
  );
  const allCountryOptions = useMemo(() => listAllCountries(), []);
  const customerCreateStateOptions = useMemo(
    () => listStatesByCountry(customerCreateDraft.country),
    [customerCreateDraft.country]
  );
  const customerCountryQuery = String(customerCreateDraft.country || "")
    .trim()
    .toLowerCase();
  const customerStateQuery = String(customerCreateDraft.state || "")
    .trim()
    .toLowerCase();
  const customerCountryMatches = useMemo(() => {
    if (!customerCountryQuery) return [];
    return allCountryOptions
      .filter((countryOption) => countryOption.name.toLowerCase().includes(customerCountryQuery))
      .slice(0, 8);
  }, [allCountryOptions, customerCountryQuery]);
  const customerStateMatches = useMemo(() => {
    if (!customerStateQuery) return [];
    return customerCreateStateOptions
      .filter((stateOption) => stateOption.name.toLowerCase().includes(customerStateQuery))
      .slice(0, 8);
  }, [customerCreateStateOptions, customerStateQuery]);
  const suggestionMenuClassName =
    "absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl";

  const creditStatus = useMemo(() => getPartyCreditStatus(partyId), [partyId]);

  useEffect(() => {
    const syncProfiles = () => {
      setTemplateConfig(getInvoiceTemplateConfig());
    };
    const onStorage = (event) => {
      if (
        !event.key ||
        isOrganizationScopedStorageEventKey(LS_KEYS.invoiceTemplateConfig, event.key)
      ) {
        syncProfiles();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncProfiles);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncProfiles);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadLookups() {
      try {
        await Promise.all([
          syncPartiesFromRemote(),
          syncItemsFromRemote(),
          invoicesSyncFromRemote(),
          syncItemBarcodesFromRemote().catch(() => listItemBarcodes())
        ]);
      } catch {
        // Fallback to cached local data.
      } finally {
        if (!mounted) return;
        setCustomers(listParties().filter((party) => party.type === "Customer"));
        setItems(listItems());
        setItemBarcodes(listItemBarcodes());
      }
    }
    loadLookups();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const rate = gstRuntimeEnabled ? defaultGstRate : isIndiaOrg ? 0 : getVatRate(country, company);
    setTaxRate(rate);
    if (!gstRuntimeEnabled) {
      setVatInput(`TAX ${Number.isFinite(rate) ? rate : 0}%`);
    }
  }, [country, isIndiaOrg, gstRuntimeEnabled, defaultGstRate, companyVatRate]);

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
    setInvoiceNo(buildInvoiceId(invoiceCode, invoiceYear, invoiceCounter));
  }, [invoiceCode, invoiceCounter, invoiceYear]);

  useEffect(() => {
    if (!party?.phone) return;
    setCustomerSearchPhone(String(party.phone).replace(/\D/g, "").slice(-10));
  }, [party?.phone]);

  useEffect(() => {
    if (!printQueued || !printInvoiceData) return;

    const handleAfterPrint = () => {
      setPrintQueued(false);
      setPrintInvoiceData(null);
      window.removeEventListener("afterprint", handleAfterPrint);
    };

    window.addEventListener("afterprint", handleAfterPrint);
    const timerId = window.setTimeout(() => {
      window.print();
    }, 80);

    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [printQueued, printInvoiceData]);

  useEffect(() => {
    setPaymentDate(invoiceDate);
  }, [invoiceDate]);

  useEffect(() => {
    if (!paymentModes.includes(paymentMode)) {
      setPaymentMode(paymentModes[0] || "Cash");
    }
  }, [paymentMode, paymentModes]);

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
    const uniqueItemIds = Array.from(
      new Set(lines.map((line) => String(line?.itemId || "").trim()).filter(Boolean))
    );
    if (!uniqueItemIds.length) return;

    let cancelled = false;
    const missingIds = uniqueItemIds.filter((itemId) => !itemBatchMap[itemId]);
    if (!missingIds.length) return;

    Promise.all(
      missingIds.map(async (itemId) => {
        try {
          const result = await fetchItemStockHistory(itemId);
          return {
            itemId,
            batches: Array.isArray(result?.batches) ? result.batches : []
          };
        } catch {
          return { itemId, batches: [] };
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      setItemBatchMap((prev) => {
        const next = { ...prev };
        rows.forEach((row) => {
          next[row.itemId] = row.batches;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [itemBatchMap, lines]);

  useEffect(() => {
    if (!markAsPaid) {
      setPaidAmount("");
      setReferenceNo("");
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setBankAccount("");
      setPaymentNotes("");
      return;
    }
    if (paymentMode === "Cash") {
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setBankAccount("");
      return;
    }
    if (paymentMode === "Cheque") {
      setTransactionId("");
      setBankName("");
      setBankAccount("");
      return;
    }
    if (paymentMode === "Bank Transfer") {
      setChequeNo("");
      return;
    }
    if (paymentMode === "Card" || paymentMode === "UPI" || paymentMode === "Online Gateway") {
      setChequeNo("");
      setBankName("");
      setBankAccount("");
    }
  }, [markAsPaid, paymentMode]);

  function addLine() {
    setLines((p) => [
      ...p,
      {
        id: `l_${Date.now()}`,
        itemId: "",
        itemInput: "",
        selectedBatchId: "",
        priceTaxMode: "WITHOUT_TAX",
        qty: 1,
        rate: 0,
        discount: 0,
        tax: forceZeroTax ? 0 : Number(taxRate || 0)
      }
    ]);
  }

  function addLineWithItem(item) {
    if (!item) return;
    const maxAssignable = getMaxAssignableQty(item.id);
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && maxAssignable <= 0) {
      alert(`Out of stock: ${item.name}.`);
      return;
    }
    setLines((prev) => {
      const emptyIndex = prev.findIndex((line) => !line.itemId);
      const nextLine = {
        id: `l_${Date.now()}`,
        itemId: item.id,
        itemInput: formatItemSearchLabel(item),
        selectedBatchId: "",
        priceTaxMode: "WITHOUT_TAX",
        qty: Number.isFinite(maxAssignable) ? Math.min(1, maxAssignable) : 1,
        rate: item.salesRate || item.price || 0,
        discount: 0,
        tax: forceZeroTax ? 0 : Number(item.taxRate ?? taxRate ?? 0)
      };
      if (emptyIndex >= 0) {
        return prev.map((line, idx) => (idx === emptyIndex ? { ...line, ...nextLine, id: line.id } : line));
      }
      return [...prev, nextLine];
    });
  }

  function updateLine(id, patch) {
    setLines((p) =>
      p.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, ...patch };
        if (forceZeroTax) next.tax = 0;
        const parsedQty = Number(next.qty);
        if (!allowNegativeStock && next.itemId && Number.isFinite(parsedQty) && parsedQty >= 0) {
          const maxAssignable = getMaxAssignableQty(
            next.itemId,
            id,
            next.selectedBatchId || ""
          );
          if (Number.isFinite(maxAssignable) && parsedQty > maxAssignable) {
            next.qty = maxAssignable;
          }
        }
        return next;
      })
    );
  }

  function removeLine(id) {
    setLines((p) => p.filter((x) => x.id !== id));
  }

  function applyCustomerSelection(nextCustomer) {
    if (!nextCustomer) return;
    setCustomerSearchError("");
    setPartyId(nextCustomer.id);
    setCustomerSearchPhone(String(nextCustomer.phone || "").replace(/\D/g, "").slice(-10));
    setCustomerLookupQuery("");
    setCustomerCreateDraft({
      name: "",
      phone: "",
      country: country || "",
      state: ""
    });
    setCustomerCountryMenuOpen(false);
    setCustomerStateMenuOpen(false);
  }

  function handleCustomerPhoneChange(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    setCustomerSearchPhone(digits);
    setCustomerSearchError("");
    if (partyId && normalizePhoneForLookup(digits) !== normalizePhoneForLookup(party?.phone)) {
      setPartyId("");
    }
  }

  function handleCustomerLookupChange(value) {
    setCustomerLookupQuery(value);
    const draftPhone = extractTenDigitPhone(value);
    setCustomerSearchPhone(draftPhone);
    setCustomerCreateDraft((prev) => ({
      ...prev,
      name: queryLooksPhoneLike(value) ? prev.name : String(value || "").trim(),
      phone: draftPhone || prev.phone,
      country: prev.country || country || ""
    }));
    setCustomerSearchError("");
  }

  function handleCustomerSearch() {
    const query = String(customerLookupQuery || "").trim();
    if (query.length < 1) {
      setCustomerSearchError("Enter mobile number or name/email/address to search.");
      return;
    }
    if (queryLooksPhoneLike(query)) {
      const phoneDigits = extractTenDigitPhone(query);
      if (!phoneDigits) {
        setCustomerSearchError("Enter valid 10-digit mobile number.");
        return;
      }
      const normalizedPhone = normalizePhoneForLookup(phoneDigits);
      const matchedCustomer = customers.find(
        (customer) => normalizePhoneForLookup(customer?.phone) === normalizedPhone
      );
      if (!matchedCustomer) {
        setCustomerCreateDraft((prev) => ({
          ...prev,
          name: prev.name || "",
          phone: phoneDigits,
          country: prev.country || country || ""
        }));
        setCustomerSearchError("No customer found for this mobile number.");
        return;
      }
      applyCustomerSelection(matchedCustomer);
      return;
    }
    if (!customerLookupResults.length) {
      setCustomerCreateDraft((prev) => ({
        ...prev,
        name: query,
        phone: prev.phone || extractTenDigitPhone(query),
        country: prev.country || country || ""
      }));
      setCustomerSearchError("No customer found.");
      return;
    }
    if (customerLookupResults.length === 1) {
      applyCustomerSelection(customerLookupResults[0]);
      return;
    }
    setCustomerSearchError("Multiple customers found. Select one below.");
  }

  async function handleCreateCustomer() {
    const name = String(customerCreateDraft.name || "").trim();
    const phone = extractTenDigitPhone(customerCreateDraft.phone);
    const draftCountry = String(customerCreateDraft.country || country || "").trim();
    const draftState = String(customerCreateDraft.state || "").trim();
    if (!name) {
      setCustomerSearchError("Customer name is required.");
      return;
    }
    if (phone.length !== 10) {
      setCustomerSearchError("Customer mobile must be exactly 10 digits.");
      return;
    }

    setCustomerCreateLoading(true);
    setCustomerSearchError("");
    try {
      const created = await upsertPartyRemote({
        type: "Customer",
        name,
        phone,
        email: "",
        country: draftCountry,
        state: draftState,
        address: "",
        taxId: "",
        notes: "",
        openingBalance: 0,
        openingBalanceType: "Receivable",
        creditLimitEnabled: false,
        creditLimitType: "Amount",
        creditLimit: 0,
        creditLimitDays: 0
      });
      const nextCustomers = listParties().filter((entry) => entry.type === "Customer");
      setCustomers(nextCustomers);
      applyCustomerSelection(created);
      setCustomerLookupQuery("");
      setCustomerCreateDraft({
        name: "",
        phone: "",
        country: country || "",
        state: ""
      });
      setCustomerCountryMenuOpen(false);
      setCustomerStateMenuOpen(false);
    } catch (error) {
      setCustomerSearchError(error?.message || "Failed to create customer.");
    } finally {
      setCustomerCreateLoading(false);
    }
  }

  function applyCustomerCreateCountry(nextCountry) {
    const canonicalCountry = getCanonicalCountryName(nextCountry);
    const previousCountryCode = resolveCountryIsoCode(customerCreateDraft.country);
    const nextCountryCode = resolveCountryIsoCode(canonicalCountry);
    setCustomerCreateDraft((prev) => ({
      ...prev,
      country: canonicalCountry,
      state: previousCountryCode !== nextCountryCode ? "" : prev.state
    }));
    setCustomerCountryMenuOpen(false);
  }

  function applyCustomerCreateState(nextState) {
    setCustomerCreateDraft((prev) => ({ ...prev, state: nextState }));
    setCustomerStateMenuOpen(false);
  }

  function resetCustomer() {
    setPartyId("");
    setCustomerSearchPhone("");
    setCustomerLookupQuery("");
    setCustomerSearchError("");
    setCustomerCreateDraft({
      name: "",
      phone: "",
      country: country || "",
      state: ""
    });
    setCustomerCountryMenuOpen(false);
    setCustomerStateMenuOpen(false);
  }

  function handleInvoiceDateChange(value) {
    setInvoiceDateInput(value);
    const parsed = parseDateToIso(value);
    if (parsed) setInvoiceDate(parsed);
  }

  function handleInvoiceDateBlur() {
    const parsed = parseDateToIso(invoiceDateInput);
    if (parsed) {
      setInvoiceDate(parsed);
      setInvoiceDateInput(formatIsoToDayMonthYear(parsed));
      return;
    }
    setInvoiceDateInput(formatIsoToDayMonthYear(invoiceDate));
  }

  const computed = useMemo(() => {
    const selectedLines = lines.filter((line) => line?.itemId);
    const hasAnyLineTax = forceZeroTax ? false : selectedLines.some((line) => Number(line?.tax || 0) > 0);
    const fallbackRate = forceZeroTax ? 0 : hasAnyLineTax ? 0 : Number(taxRate || 0);

    const enrichedBase = selectedLines.map((l) => {
      const item = items.find((it) => it.id === l.itemId);
      const qty = Number(l.qty || 0);
      const rate = Number(l.rate || 0);
      const discount = Number(l.discount || 0);
      const taxRatePerLine = forceZeroTax ? 0 : Number(l.tax || fallbackRate || 0);
      const net = round2(Math.max(0, qty * rate - discount));
      const lineTax = round2((net * taxRatePerLine) / 100);

      return {
        ...l,
        tax: taxRatePerLine,
        priceTaxMode: "WITHOUT_TAX",
        itemName: item?.name || "XXX",
        hsn: item?.hsn || item?.sac || "XX",
        net,
        lineTax
      };
    });

    const subTotal = round2(enrichedBase.reduce((a, x) => a + x.net, 0));
    const lineTaxTotal = round2(enrichedBase.reduce((a, x) => a + x.lineTax, 0));
    const effectiveTaxRate =
      subTotal > 0 ? (lineTaxTotal / subTotal) * 100 : Number(taxRate || 0);

    const tax = calculateTaxes({
      taxableAmount: subTotal,
      taxRate: effectiveTaxRate,
      org: {
        country: isIndiaOrg && !gstRuntimeEnabled ? "Other" : companyCountry,
        state: companyState,
        gstin: company?.tax?.gstin || ""
      },
      party: {
        country: customerCountry,
        state: customerState,
        gstin: party?.gstin || party?.taxId || ""
      }
    });

    const enriched = enrichedBase.map((line) => {
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

      return {
        ...line,
        cgstAmount,
        sgstAmount,
        igstAmount,
        vatAmount,
        lineTotal: round2(line.net + line.lineTax)
      };
    });

    const grandTotal = round2(subTotal + (tax.totalTax || 0));

    return { enriched, subTotal, tax, grandTotal, effectiveTaxRate };
  }, [lines, items, companyCountry, companyState, customerCountry, customerState, taxRate, company?.tax?.gstin, party?.gstin, party?.taxId, isIndiaOrg, gstRuntimeEnabled, forceZeroTax]);

  const paymentAmount = useMemo(() => {
    if (!markAsPaid) return 0;
    const parsed = Number(paidAmount || 0);
    return round2(Math.max(0, parsed));
  }, [markAsPaid, paidAmount]);

  const pendingAmount = useMemo(
    () => round2(Math.max(0, Number(computed.grandTotal || 0) - Number(paymentAmount || 0))),
    [computed.grandTotal, paymentAmount]
  );

  const advanceAmount = useMemo(
    () => round2(Math.max(0, Number(paymentAmount || 0) - Number(computed.grandTotal || 0))),
    [paymentAmount, computed.grandTotal]
  );

  const creditLimitEnabled = !!creditStatus.party?.creditLimitEnabled;
  const creditLimitType = creditStatus.creditLimitType || "Amount";
  const projectedOutstanding =
    creditLimitEnabled && creditLimitType === "Amount"
      ? creditStatus.outstanding + computed.grandTotal
      : creditStatus.outstanding;
  const projectedAmountExceeded =
    creditLimitEnabled &&
    creditLimitType === "Amount" &&
    creditStatus.creditLimit > 0 &&
    projectedOutstanding > creditStatus.creditLimit;
  const projectedOverBy = projectedAmountExceeded
    ? projectedOutstanding - creditStatus.creditLimit
    : 0;
  const overdueWarning =
    creditLimitEnabled &&
    creditLimitType === "Days" &&
    !!creditStatus.overdueExceeded;

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

  const availableLineItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item &&
          item.status !== "Inactive" &&
          (item.type === "Product" || item.type === "Service")
      ),
    [items]
  );

  const barcodeLookupByItemId = useMemo(() => {
    const map = new Map();
    (Array.isArray(itemBarcodes) ? itemBarcodes : []).forEach((entry) => {
      const itemId = String(entry?.item_id || entry?.itemId || "").trim();
      const barcodeValue = normalizeBarcodeLookupValue(entry?.barcode_value || entry?.barcodeValue || "");
      if (!itemId || !barcodeValue) return;
      const list = map.get(itemId) || [];
      list.push(barcodeValue);
      map.set(itemId, list);
    });
    return map;
  }, [itemBarcodes]);

  const filteredItems = useMemo(() => {
    const query = normalizeItemSearchText(itemSearch);
    if (!query) return availableLineItems;
    const barcodeQuery = normalizeBarcodeLookupValue(query);
    const startsWith = availableLineItems.filter((item) => {
      const name = normalizeItemSearchText(item?.name);
      const itemCode = normalizeItemSearchText(item?.itemCode);
      const id = normalizeItemSearchText(item?.id);
      const barcodeValues = barcodeLookupByItemId.get(String(item?.id || "")) || [];
      const barcodeStartsWith = barcodeQuery
        ? barcodeValues.some((barcodeValue) => normalizeBarcodeLookupValue(barcodeValue).startsWith(barcodeQuery))
        : false;
      return name.startsWith(query) || itemCode.startsWith(query) || id.startsWith(query) || barcodeStartsWith;
    });
    if (startsWith.length) return startsWith;
    return availableLineItems.filter((item) => itemMatchesSearchQuery(item, query, barcodeLookupByItemId));
  }, [availableLineItems, itemSearch, barcodeLookupByItemId]);

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

  function getMaxAssignableQty(itemId, excludeLineId = "", preferredBatchId = "") {
    if (allowNegativeStock) return Number.POSITIVE_INFINITY;
    if (preferredBatchId) {
      return getBatchAvailableForLine(itemId, preferredBatchId, excludeLineId);
    }
    const stockInfo = stockByItemId.get(itemId);
    if (!stockInfo) return Number.POSITIVE_INFINITY;
    const reservedQty = lines.reduce((sum, line) => {
      if (excludeLineId && String(line?.id || "") === String(excludeLineId)) return sum;
      if (String(line?.itemId || "") !== String(itemId || "")) return sum;
      return sum + Math.max(0, Number(line?.qty || 0));
    }, 0);
    return Math.max(0, Number(stockInfo.available || 0) - reservedQty);
  }

  const stockValidationIssues = useMemo(() => {
    if (allowNegativeStock) return [];
    const issues = [];
    computed.enriched.forEach((line) => {
      if (!line?.itemId) return;
      const qty = Math.max(0, Number(line?.qty || 0));
      if (!qty) return;
      const stockInfo = stockByItemId.get(line.itemId);
      if (!stockInfo) return;
      if (line?.selectedBatchId) {
        const available = getBatchAvailableForLine(line.itemId, line.selectedBatchId, line.id);
        if (qty > available) {
          issues.push({
            itemId: line.itemId,
            itemName: stockInfo.itemName,
            available,
            requested: qty
          });
        }
        return;
      }
      const totalAvailable = getMaxAssignableQty(line.itemId, line.id, "");
      if (qty > totalAvailable) {
        issues.push({
          itemId: line.itemId,
          itemName: stockInfo.itemName,
          available: totalAvailable,
          requested: qty
        });
      }
    });
    return issues;
  }, [allowNegativeStock, computed.enriched, stockByItemId, lines]);

  const hasStockErrors = stockValidationIssues.length > 0;

  function formatBatchHint(itemId) {
    const rows = Array.isArray(itemBatchMap[itemId]) ? itemBatchMap[itemId] : [];
    const openRows = rows.filter((row) => Number(row?.qty_remaining || 0) > 0);
    if (!openRows.length) return "No open purchase batch found.";
    const parts = openRows.slice(0, 3).map((row) => {
      const qty = Number(row?.qty_remaining || 0);
      const cost = Number(row?.unit_cost_excl_tax || 0);
      return `${qty} @ ${money(cost)}`;
    });
    const extra = openRows.length > 3 ? ` +${openRows.length - 3} more` : "";
    return `FIFO open batches: ${parts.join(" | ")}${extra}`;
  }

  function getOpenBatchRows(itemId) {
    const rows = Array.isArray(itemBatchMap[itemId]) ? itemBatchMap[itemId] : [];
    return rows
      .filter((row) => Number(row?.qty_remaining || 0) > 0)
      .sort((a, b) => {
        const da = new Date(a?.batch_date || 0).getTime();
        const db = new Date(b?.batch_date || 0).getTime();
        return da - db;
      });
  }

  function getBatchAvailableForLine(itemId, batchId, excludeLineId = "") {
    if (!itemId || !batchId) return 0;
    const rows = getOpenBatchRows(itemId);
    const target = rows.find((row) => String(row.batch_id) === String(batchId));
    if (!target) return 0;
    const reserved = lines.reduce((sum, line) => {
      if (excludeLineId && String(line?.id || "") === String(excludeLineId)) return sum;
      if (String(line?.itemId || "") !== String(itemId || "")) return sum;
      if (String(line?.selectedBatchId || "") !== String(batchId || "")) return sum;
      return sum + Math.max(0, Number(line?.qty || 0));
    }, 0);
    return Math.max(0, Number(target?.qty_remaining || 0) - reserved);
  }

  function selectLineItem(line, matchedItem) {
    if (!matchedItem || !line) return;
    const maxAssignable = getMaxAssignableQty(matchedItem.id, line.id);
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && maxAssignable <= 0) {
      alert(`Out of stock: ${matchedItem.name}.`);
      return;
    }
    const nextQtyRaw = Number(line.qty || 0);
    const normalizedQty = Number.isFinite(nextQtyRaw) && nextQtyRaw > 0 ? nextQtyRaw : 1;
    const nextQty = Number.isFinite(maxAssignable)
      ? Math.min(normalizedQty, maxAssignable)
      : normalizedQty;
    updateLine(line.id, {
      itemInput: formatItemSearchLabel(matchedItem),
      itemId: matchedItem.id,
      selectedBatchId: "",
      priceTaxMode: "WITHOUT_TAX",
      qty: nextQty,
      rate: matchedItem?.salesRate || matchedItem?.price || 0,
      tax: forceZeroTax ? 0 : Number(matchedItem?.taxRate ?? taxRate ?? 0)
    });
  }

  function handleLineItemInput(line, inputValue) {
    const matchedItem = findItemBySearchInput(availableLineItems, inputValue, barcodeLookupByItemId);
    if (!matchedItem) {
      updateLine(line.id, { itemInput: inputValue, itemId: "", selectedBatchId: "" });
      return;
    }
    selectLineItem(line, matchedItem);
  }

  function clearLineItemSelection(lineId) {
    updateLine(lineId, { itemInput: "", itemId: "", selectedBatchId: "" });
  }

  function handleLineBatchChange(line, batchId) {
    if (!line?.itemId) return;
    const selectedId = String(batchId || "");
    if (!selectedId) {
      updateLine(line.id, {
        selectedBatchId: ""
      });
      return;
    }
    const rows = getOpenBatchRows(line.itemId);
    const picked = rows.find((row) => String(row.batch_id) === selectedId);
    const suggestedRate = Number(
      picked?.suggested_sale_rate ??
        picked?.metadata?.suggestedSaleRate ??
        line?.rate ??
        0
    );
    const maxAssignable = getMaxAssignableQty(line.itemId, line.id, selectedId);
    updateLine(line.id, {
      selectedBatchId: selectedId,
      rate: suggestedRate > 0 ? suggestedRate : line.rate,
      priceTaxMode: "WITHOUT_TAX",
      tax: forceZeroTax ? 0 : Number(picked?.tax_rate ?? line?.tax ?? taxRate ?? 0),
      qty: Number.isFinite(maxAssignable)
        ? Math.min(Math.max(0, Number(line.qty || 0)), maxAssignable)
        : line.qty
    });
  }

  function updateLineItemPopoverPosition(inputElement) {
    if (!inputElement) return;
    const rect = inputElement.getBoundingClientRect();
    const width = Math.max(260, Math.round(rect.width));
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
    const query = normalizeItemSearchText(line?.itemInput);
    const matched = query
      ? availableLineItems.filter((item) => itemMatchesSearchQuery(item, query, barcodeLookupByItemId))
      : availableLineItems;
    const selected = availableLineItems.find((item) => String(item.id) === String(line?.itemId || ""));
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
  }, [activeLineForSearch, availableLineItems, barcodeLookupByItemId]);

  const invoicePreviewData = useMemo(() => {
    const subTotal = Number(computed.subTotal || 0);
    const totalTax = Number(computed.tax?.totalTax || 0);
    const effectiveTaxRate = Number(computed.effectiveTaxRate || taxRate || 0);
    const seller = {
      name: company?.companyName || "",
      address: formatAddress(company?.address),
      gstin: company?.tax?.gstin || "",
      phone: company?.phone || "",
      email: company?.email || "",
      country: companyCountry,
      state: companyState
    };
    const buyer = {
      name: party?.name || "",
      address: party?.address || "",
      gstin: party?.gstin || party?.taxId || "",
      phone: party?.phone || "",
      country: customerCountry,
      state: customerState
    };
    return {
      title: gstRuntimeEnabled ? "Tax Invoice" : "Invoice",
      country,
      companyName: company?.companyName || "",
      currencySymbol: resolveCurrencySymbol(currencySymbol, currency),
      invoiceNo: invoiceNo || "-",
      invoiceDate,
      dueDate: invoiceDate,
      placeOfSupply: customerState,
      seller,
      buyer,
      customer: {
        name: buyer.name,
        address: buyer.address,
        phone: buyer.phone,
        country: buyer.country,
        state: buyer.state,
        gstin: buyer.gstin
      },
      taxRate: effectiveTaxRate,
      taxBreakup: computed.tax?.taxBreakup || null,
      tax: gstRuntimeEnabled
        ? {
            type: "GST",
            supplyType: computed.tax?.supplyType || "INTRA",
            sameState: computed.tax?.supplyType !== "INTER",
            cgst: Number(computed.tax?.cgst || 0),
            sgst: Number(computed.tax?.sgst || 0),
            igst: Number(computed.tax?.igst || 0),
            totalTax,
            warning: computed.tax?.warning || ""
          }
        : {
            type: "NORMAL",
            rate: effectiveTaxRate,
            taxLabel: computed.tax?.taxBreakup?.taxLabel || "TAX",
            taxAmount: totalTax,
            totalTax,
            warning: ""
          },
      items: computed.enriched.filter((line) => line?.itemId).map((line) => {
        const lineNet = Number(line.net || 0);
        const lineTaxAmount = Number(line.lineTax || 0);
        const resolvedLineRate = lineNet > 0 ? round2((lineTaxAmount / lineNet) * 100) : 0;
        return {
          id: line.id,
          name: line.itemName || "",
          hsn: line.hsn || "",
          qty: Number(line.qty || 0),
          rate: Number(line.rate || 0),
          discount: Number(line.discount || 0),
          tax: resolvedLineRate,
          taxRate: resolvedLineRate,
          taxableValue: lineNet,
          net: lineNet,
          amount: lineNet + lineTaxAmount,
          lineTax: lineTaxAmount,
          igstAmount: Number(line.igstAmount || 0),
          cgstAmount: Number(line.cgstAmount || 0),
          sgstAmount: Number(line.sgstAmount || 0),
          vatAmount: Number(line.vatAmount || 0)
        };
      }),
      totals: {
        subTotal,
        tax: totalTax,
        taxBreakup: computed.tax?.taxBreakup || null,
        total: Number(computed.grandTotal || 0),
        balance: Number(computed.grandTotal || 0)
      }
    };
  }, [
    company,
    companyCountry,
    companyState,
    computed.enriched,
    computed.grandTotal,
    computed.subTotal,
    computed.tax,
    country,
    currency,
    customerCountry,
    customerState,
    invoiceDate,
    invoiceNo,
    gstRuntimeEnabled,
    party,
    taxRate,
    computed.effectiveTaxRate
  ]);

  async function saveInvoice({ silent = false } = {}) {
    if (!canCreateInvoice) {
      alert("You do not have permission to create invoices.");
      return null;
    }
    const validComputedLines = computed.enriched.filter((line) => line?.itemId);
    if (!partyId) {
      alert("Select customer before saving invoice.");
      return null;
    }
    const normalizedInvoiceNo = String(invoiceNo || "").trim();
    if (!normalizedInvoiceNo) {
      alert("Invoice ID is required.");
      return null;
    }
    if (!validComputedLines.length) {
      alert("Add at least one line item before saving invoice.");
      return null;
    }
    const productLineItems = validComputedLines
      .map((line) => ({
        line,
        item: items.find((entry) => String(entry?.id || "") === String(line?.itemId || ""))
      }))
      .filter((entry) => entry?.item?.type === "Product" && entry?.item?.trackInventory);
    const effectiveBatchMap = { ...itemBatchMap };

    if (productLineItems.length) {
      const missingBatchIds = Array.from(
        new Set(
          productLineItems
            .map((entry) => String(entry.item.id || "").trim())
            .filter((itemId) => itemId && !effectiveBatchMap[itemId])
        )
      );
      if (missingBatchIds.length) {
        const loaded = await Promise.all(
          missingBatchIds.map(async (itemId) => {
            try {
              const result = await fetchItemStockHistory(itemId);
              return { itemId, batches: Array.isArray(result?.batches) ? result.batches : [] };
            } catch {
              return { itemId, batches: [] };
            }
          })
        );
        setItemBatchMap((prev) => {
          const next = { ...prev };
          loaded.forEach((row) => {
            next[row.itemId] = row.batches;
            effectiveBatchMap[row.itemId] = row.batches;
          });
          return next;
        });
      }
    }

    const missingBatchLine = validComputedLines.find((line) => {
      const item = items.find((entry) => String(entry?.id || "") === String(line?.itemId || ""));
      if (!item || item.type !== "Product" || !item.trackInventory) return false;
      const batchRows = effectiveBatchMap[item.id] || [];
      const openBatches = (Array.isArray(batchRows) ? batchRows : []).filter(
        (row) => Number(row?.qty_remaining || 0) > 0
      );
      return openBatches.length > 0 && !String(line?.selectedBatchId || "").trim();
    });
    if (missingBatchLine) {
      alert(`Please select batch for ${missingBatchLine.itemName || "selected item"} before saving.`);
      return null;
    }
    if (!allowNegativeStock && stockValidationIssues.length) {
      const issue = stockValidationIssues[0];
      alert(
        `Insufficient stock for ${issue.itemName}. Available ${issue.available}, requested ${issue.requested}.`
      );
      return null;
    }
    if (markAsPaid && paymentAmount <= 0) {
      alert("Enter valid paid amount.");
      return null;
    }
    if (markAsPaid && !paymentDate) {
      alert("Select payment date.");
      return null;
    }
    if (markAsPaid && paymentMode === "Cheque" && !String(chequeNo || "").trim()) {
      alert("Enter cheque number.");
      return null;
    }
    if (markAsPaid && paymentMode === "Bank Transfer") {
      if (!String(bankName || "").trim()) {
        alert("Enter bank name.");
        return null;
      }
      if (!String(bankAccount || "").trim()) {
        alert("Enter bank account.");
        return null;
      }
    }
    if (
      markAsPaid &&
      (paymentMode === "Bank Transfer" ||
        paymentMode === "Card" ||
        paymentMode === "UPI" ||
        paymentMode === "Online Gateway") &&
      !String(transactionId || "").trim()
    ) {
      alert("Enter transaction ID.");
      return null;
    }

    const seller = {
      name: company?.companyName || "",
      address: formatAddress(company?.address),
      gstin: company?.tax?.gstin || "",
      phone: company?.phone || "",
      email: company?.email || "",
      country: companyCountry,
      state: company?.address?.state || ""
    };
    const buyer = {
      name: party?.name || "",
      address: party?.address || "",
      gstin: party?.gstin || party?.taxId || "",
      phone: party?.phone || "",
      country: customerCountry,
      state: party?.state || ""
    };
    const payload = {
      invoiceDate,
      invoiceNo: normalizedInvoiceNo,
      partyId,
      partyName: party?.name || "",
      placeOfSupply: buyer.state,
      country,
      taxRate: computed.effectiveTaxRate,
      companySnapshot: company,
      seller,
      buyer,
      lines: validComputedLines,
      totals: {
        subTotal: computed.subTotal,
        tax: gstRuntimeEnabled
          ? {
              type: "GST",
              supplyType: computed.tax.supplyType,
              sameState: computed.tax.supplyType !== "INTER",
              cgst: computed.tax.cgst,
              sgst: computed.tax.sgst,
              igst: computed.tax.igst,
              totalTax: computed.tax.totalTax
            }
          : {
              type: "NORMAL",
              rate: computed.tax.taxRate,
              taxLabel: computed.tax.taxBreakup?.taxLabel || "TAX",
              taxAmount: computed.tax.taxAmount,
              totalTax: computed.tax.totalTax
            },
        taxBreakup: computed.tax.taxBreakup,
        totalTax: computed.tax.totalTax,
        grandTotal: computed.grandTotal
      },
      taxMode: computed.tax.taxMode,
      supplyType: computed.tax.supplyType || null
    };
    try {
      const savedInvoiceId = await invoicesCreate(payload);
      setLastSavedInvoiceId(savedInvoiceId || "");
      let paymentSaved = false;
      let paymentSavedAsUnapplied = false;

      if (markAsPaid && paymentAmount > 0 && savedInvoiceId) {
        try {
          const outstandingBefore = outstandingByCustomer(paymentCountryCode, partyId);
          const applyAmount = Math.min(paymentAmount, Number(computed.grandTotal || 0));
          const actor = authGetUser()?.name || authGetUser()?.email || "System User";
          const basePaymentPayload = {
            country: paymentCountryCode,
            paymentDate: paymentDate || invoiceDate,
            customerId: partyId,
            customerName: party?.name || "",
            paymentMode,
            referenceNo: referenceNo || "",
            chequeNo: paymentMode === "Cheque" ? chequeNo : "",
            bankName: paymentMode === "Bank Transfer" ? bankName : "",
            bankAccount: paymentMode === "Bank Transfer" ? bankAccount : "",
            transactionId:
              paymentMode === "Bank Transfer" ||
              paymentMode === "Card" ||
              paymentMode === "UPI" ||
              paymentMode === "Online Gateway"
                ? transactionId
                : "",
            paymentReference: referenceNo || "",
            internalNotes: paymentNotes || `Payment for invoice ${normalizedInvoiceNo}`,
            customerNotes: "",
            attachment: null,
            amountReceived: paymentAmount,
            allocations: [
              {
                invoiceId: savedInvoiceId,
                invoiceNo: normalizedInvoiceNo,
                invoiceDate,
                invoiceAmount: Number(computed.grandTotal || 0),
                balanceDue: Number(computed.grandTotal || 0),
                applyAmount
              }
            ],
            customerOutstandingBefore: outstandingBefore,
            actor
          };
          const stagedPayment = savePaymentIn({
            ...basePaymentPayload,
            desiredStatus: "Received"
          });
          const paymentRecord = savePaymentIn({
            ...basePaymentPayload,
            id: stagedPayment.id,
            desiredStatus: "Applied",
            customerOutstandingBefore: stagedPayment.totals.customerOutstandingBefore
          });
          await syncPaymentInRemote(paymentRecord);
          paymentSaved = true;
        } catch (paymentError) {
          try {
            // Fallback: keep payment visible in Payment In as unapplied if allocation mapping fails.
            const actor = authGetUser()?.name || authGetUser()?.email || "System User";
            const fallbackRecord = savePaymentIn({
              country: paymentCountryCode,
              paymentDate: paymentDate || invoiceDate,
              customerId: partyId,
              customerName: party?.name || "",
              paymentMode,
              referenceNo: referenceNo || "",
              chequeNo: paymentMode === "Cheque" ? chequeNo : "",
              bankName: paymentMode === "Bank Transfer" ? bankName : "",
              bankAccount: paymentMode === "Bank Transfer" ? bankAccount : "",
              transactionId:
                paymentMode === "Bank Transfer" ||
                paymentMode === "Card" ||
                paymentMode === "UPI" ||
                paymentMode === "Online Gateway"
                  ? transactionId
                  : "",
              paymentReference: referenceNo || "",
              internalNotes:
                paymentNotes || `Payment for invoice ${normalizedInvoiceNo} (saved as unapplied)`,
              customerNotes: "",
              attachment: null,
              desiredStatus: "Received",
              amountReceived: paymentAmount,
              allocations: [],
              customerOutstandingBefore: 0,
              actor
            });
            await syncPaymentInRemote(fallbackRecord);
            paymentSaved = true;
            paymentSavedAsUnapplied = true;
          } catch (fallbackError) {
            alert(
              `Invoice saved, but Payment In was not saved: ${
                fallbackError?.message || paymentError?.message || "Unknown payment error"
              }`
            );
          }
        }
      }

      setMarkAsPaid(false);
      setPaymentMode(paymentModes[0] || "Cash");
      setPaymentDate(invoiceDate);
      setPaidAmount("");
      setReferenceNo("");
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setBankAccount("");
      setPaymentNotes("");
      companyConsumeDocumentNumber("invoice");
      const latestProfile = companyGetProfile() || {};
      const nextInvoiceCode = normalizeInvoiceCode(
        latestProfile?.settings?.numbering?.prefixes?.invoice || invoiceCode
      );
      const nextInvoiceCounter = toInvoiceCounter(
        latestProfile?.settings?.numbering?.counters?.invoice || invoiceCounter + 1
      );
      setInvoiceCode(nextInvoiceCode);
      setInvoiceCounter(nextInvoiceCounter);
      setInvoiceNo(buildInvoiceId(nextInvoiceCode, invoiceYear, nextInvoiceCounter));
      await invoicesSyncFromRemote();

      if (!silent) {
        if (paymentSavedAsUnapplied) {
          alert("Invoice saved. Payment In saved as unapplied. You can allocate it in Payment In page.");
        } else {
          alert(paymentSaved ? "Invoice and Payment In saved successfully." : "Invoice saved successfully.");
        }
      }
      return savedInvoiceId || "";
    } catch (error) {
      alert(error?.message || "Failed to save invoice.");
      return null;
    }
  }

  async function handleSaveAndPrint() {
    if (!canCreateInvoice) {
      alert("You do not have permission to create invoices.");
      return;
    }
    const validComputedLines = computed.enriched.filter((line) => line?.itemId);
    if (!partyId) {
      alert("Select customer before saving and printing.");
      return;
    }
    if (!validComputedLines.length) {
      alert("Add at least one line item before saving and printing.");
      return;
    }

    const savedInvoiceId = await saveInvoice({ silent: true });
    if (!savedInvoiceId) return;

    setPrintInvoiceData(invoicePreviewData);
    setPrintQueued(true);
  }

  return (
    <div className="max-w-6xl">
      <div className="print-hide">
        <PageHeader
          title="Sales - Invoice"
          subtitle="Create invoice with line items and country-wise tax breakdown"
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveAndPrint}
                disabled={!canCreateInvoice || !partyId || !String(invoiceNo || "").trim() || hasStockErrors}
                className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Save & Print
              </button>
              <GradientButton
                onClick={saveInvoice}
                disabled={!canCreateInvoice || !partyId || !String(invoiceNo || "").trim() || hasStockErrors}
                className="disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                Save
              </GradientButton>
            </div>
          }
        />
      </div>
      {!canCreateInvoice ? (
        <div className="print-hide mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Your role does not have invoice create permission.
        </div>
      ) : null}
      <div className="print-hide mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/app/sales/invoice/history")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Invoice History
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card className="p-5 print-hide">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">1. Find Customer</p>
              <p className="text-xs text-slate-500">Country: {country || "—"}</p>
            </div>
            {gstRuntimeEnabled ? (
              <Badge tone="warning">GST</Badge>
            ) : country ? (
              <Badge tone="success">TAX</Badge>
            ) : (
              <Badge tone="neutral">TAX</Badge>
            )}
          </div>

          <div className="mt-4">
            <FormField label="Customer Search">
              <div className="flex flex-wrap gap-2">
                <input
                  value={customerLookupQuery}
                  onChange={(e) => handleCustomerLookupChange(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleCustomerSearch();
                    }
                  }}
                  className="min-w-[260px] flex-1 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="Enter mobile or customer name/email/address"
                />
                <button
                  type="button"
                  onClick={handleCustomerSearch}
                  className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Search className="h-4 w-4" />
                  Search
                </button>
                {partyId ? (
                  <button
                    type="button"
                    onClick={resetCustomer}
                    className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </FormField>
          </div>

          {customerSearchError ? (
            <p className="mt-3 text-xs font-medium text-rose-600">{customerSearchError}</p>
          ) : null}

          {customerLookupQuery.trim() ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Matching Customers
              </p>
              {customerLookupResults.length ? (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {customerLookupResults.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => applyCustomerSelection(customer)}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{customer.name || "-"}</p>
                        <p className="text-xs text-slate-600">{customer.phone || "-"}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{customer.email || "-"}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {customer.country || "-"}{customer.state ? ` | ${customer.state}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{customerAddressSummary(customer) || "-"}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  <p>No customer found for this search.</p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      value={customerCreateDraft.name}
                      onChange={(event) =>
                        setCustomerCreateDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Customer name"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <input
                      value={customerCreateDraft.phone}
                      onChange={(event) =>
                        setCustomerCreateDraft((prev) => ({
                          ...prev,
                          phone: String(event.target.value || "").replace(/\D/g, "").slice(0, 10)
                        }))
                      }
                      placeholder="10-digit mobile"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <div className="relative">
                      <input
                        value={customerCreateDraft.country}
                        onChange={(event) => {
                          setCustomerCreateDraft((prev) => ({ ...prev, country: event.target.value }));
                          setCustomerCountryMenuOpen(true);
                        }}
                        onFocus={() => setCustomerCountryMenuOpen(true)}
                        onBlur={(event) => {
                          applyCustomerCreateCountry(event.target.value);
                          setTimeout(() => setCustomerCountryMenuOpen(false), 80);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setCustomerCountryMenuOpen(false);
                        }}
                        placeholder="Country"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      {customerCountryMenuOpen && customerCountryQuery ? (
                        <div className={suggestionMenuClassName}>
                          {customerCountryMatches.length ? (
                            customerCountryMatches.map((countryOption) => (
                              <button
                                key={countryOption.isoCode}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  applyCustomerCreateCountry(countryOption.name);
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
                        value={customerCreateDraft.state}
                        onChange={(event) => {
                          setCustomerCreateDraft((prev) => ({ ...prev, state: event.target.value }));
                          if (customerCreateStateOptions.length) setCustomerStateMenuOpen(true);
                        }}
                        onFocus={() => {
                          if (customerCreateStateOptions.length) setCustomerStateMenuOpen(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => setCustomerStateMenuOpen(false), 80);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setCustomerStateMenuOpen(false);
                        }}
                        placeholder={customerCreateStateOptions.length ? "State / Region" : "State, province, or region"}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      {customerStateMenuOpen && customerStateQuery && customerCreateStateOptions.length ? (
                        <div className={suggestionMenuClassName}>
                          {customerStateMatches.length ? (
                            customerStateMatches.map((stateOption) => (
                              <button
                                key={`${stateOption.isoCode}_${stateOption.name}`}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  applyCustomerCreateState(stateOption.name);
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
                      void handleCreateCustomer();
                    }}
                    disabled={customerCreateLoading}
                    className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {customerCreateLoading ? "Creating..." : "Create Customer"}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          <div className={partyId ? "" : "pointer-events-none select-none opacity-50"}>
            <div className="mt-5">
              <h2 className="text-base font-semibold text-slate-900">2. Customer Details</h2>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="font-semibold text-slate-900">{party?.name || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Mobile</p>
                  <p className="font-semibold text-slate-900">{party?.phone || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="font-semibold text-slate-900">{party?.email || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Country</p>
                  <p className="font-semibold text-slate-900">{party?.country || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">State</p>
                  <p className="font-semibold text-slate-900">{party?.state || "-"}</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
                <p className="text-xs text-slate-500">Address</p>
                <p className="font-semibold text-slate-900">{party?.address || "-"}</p>
              </div>
            </div>

            <div className="mt-5">
              <h2 className="text-base font-semibold text-slate-900">3. Tax Details</h2>
              <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {gstRuntimeEnabled ? (
                    <p className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-sm text-slate-600 md:col-span-2">
                      GST is auto-calculated from company and customer country/state details. Same India state uses
                      CGST + SGST, otherwise IGST is applied.
                    </p>
                  ) : (
                    <FormField label="Tax Rate" hint="Auto tax % / Type custom">
                      <>
                        <input
                          list="vat-presets"
                          value={vatInput}
                          onChange={(e) => {
                            const next = e.target.value;
                            setVatInput(next);
                            setTaxRate(parseRateInput(next));
                          }}
                          onBlur={() => {
                            const parsed = parseRateInput(vatInput);
                            setVatInput(`TAX ${parsed}%`);
                          }}
                          className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                          style={{ "--tw-ring-color": UI.COLORS.ring }}
                          placeholder="TAX 20%"
                        />
                        <datalist id="vat-presets">
                          {[getVatRate(country, company), 0]
                            .filter((rate, idx, arr) => arr.indexOf(rate) === idx)
                            .map((rate) => (
                              <option key={`vat_${rate}`} value={`TAX ${rate}%`} />
                            ))}
                        </datalist>
                      </>
                    </FormField>
                  )}
                </div>
              </div>
            </div>

          {gstRuntimeEnabled && party && computed.tax?.warning ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {computed.tax.warning}
            </div>
          ) : null}

          {party && creditLimitEnabled ? (
            <div
              className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${
                projectedAmountExceeded || overdueWarning
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              <p className="font-semibold">Credit Monitoring</p>
              {creditLimitType === "Days" ? (
                <p className="text-xs">
                  Allowed overdue days: {creditStatus.creditLimitDays} | Current overdue:{" "}
                  {creditStatus.maxOverdueDays || 0}
                </p>
              ) : (
                <p className="text-xs">
                  Limit: {formatMoney(creditStatus.creditLimit, currency)} | Projected outstanding:{" "}
                  {formatMoney(projectedOutstanding, currency)}
                </p>
              )}
              {projectedAmountExceeded ? (
                <p className="mt-1 text-xs">
                  Amount limit exceeded by {formatMoney(projectedOverBy, currency)}.
                </p>
              ) : null}
              {overdueWarning ? (
                <p className="mt-1 text-xs">
                  Overdue days exceeded by {creditStatus.overdueByDays || 0} day(s).
                </p>
              ) : null}
              {!projectedAmountExceeded && !overdueWarning ? (
                <p className="mt-1 text-xs">Within configured limits.</p>
              ) : null}
            </div>
          ) : null}

          {lastSavedInvoiceId ? (
            <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-700">Invoice linked actions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/app/sales/payment-in?invoiceId=${encodeURIComponent(lastSavedInvoiceId)}`)
                  }
                  className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Record Payment
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/app/sales/credit-note?invoiceId=${encodeURIComponent(lastSavedInvoiceId)}`)
                  }
                  className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Create Credit Note
                </button>
              </div>
            </div>
          ) : null}

            <>
              <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <FormField label="Invoice Code">
                    <input
                      value={invoiceCode}
                      onChange={(event) => setInvoiceCode(event.target.value.toUpperCase())}
                      placeholder="INV"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                  <FormField label="Year">
                    <input
                      value={invoiceYear}
                      readOnly
                      className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm font-mono text-slate-700 outline-none"
                    />
                  </FormField>
                  <FormField label="Invoice Counter">
                    <input
                      type="number"
                      min={1}
                      value={invoiceCounter}
                      onChange={(event) => setInvoiceCounter(toInvoiceCounter(event.target.value))}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FormField label="Invoice ID (Editable)">
                    <input
                      value={invoiceNo}
                      onChange={(event) => setInvoiceNo(event.target.value)}
                      placeholder="Invoice ID"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                  <FormField label="Invoice Date">
                    <input
                      value={invoiceDateInput}
                      onChange={(e) => handleInvoiceDateChange(e.target.value)}
                      onBlur={handleInvoiceDateBlur}
                      placeholder="DD/MM/YYYY or YYYY-MM-DD"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">4. Items</h2>
                  <p className="text-xs text-slate-500">Add item rows, quantity, rate, tax and amount.</p>
                </div>
                <button
                  onClick={addLine}
                  className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add line
                </button>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="relative w-full max-w-sm">
                  <input
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder="Search by product ID or name..."
                  />
                  {itemSearch.trim().length ? (
                    <div className="absolute z-10 mt-2 w-full rounded-2xl border border-slate-100 bg-white shadow-soft p-2 max-h-52 overflow-auto">
                      {filteredItems.length ? (
                        filteredItems.map((item) => {
                          const stockInfo = stockByItemId.get(item.id);
                          const maxAssignable = getMaxAssignableQty(item.id);
                          const outOfStock = Number.isFinite(maxAssignable) && maxAssignable <= 0;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={outOfStock}
                              onMouseDown={() => {
                                if (outOfStock) return;
                                addLineWithItem(item);
                                setItemSearch("");
                              }}
                              className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span>{formatItemSearchLabel(item)}</span>
                                {stockInfo ? (
                                  <span className={`text-xs font-semibold ${outOfStock ? "text-rose-600" : "text-slate-500"}`}>
                                    Remaining: {stockInfo.available}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">Service / Not tracked</span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-2 text-sm text-slate-500">No items found</div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                <DataTable
                  columns={[
                    {
                      key: "itemId",
                      header: "Item",
                      render: (r) => {
                        return (
                          <div className="relative min-w-[250px]">
                            <input
                              value={r.itemInput || ""}
                              onFocus={(event) => {
                                setActiveLineItemSearchId(r.id);
                                updateLineItemPopoverPosition(event.currentTarget);
                              }}
                              onBlur={() => {
                                window.setTimeout(() => {
                                  setActiveLineItemSearchId((current) => (current === r.id ? "" : current));
                                }, 120);
                              }}
                              onChange={(e) => {
                                handleLineItemInput(r, e.target.value);
                                updateLineItemPopoverPosition(e.currentTarget);
                              }}
                              className="w-full rounded-xl border border-slate-100 bg-white px-2 py-1.5 pr-8 text-sm outline-none"
                              placeholder="Search by product ID or name"
                            />
                            {(r.itemId || r.itemInput) ? (
                              <button
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  clearLineItemSelection(r.id);
                                  setActiveLineItemSearchId(r.id);
                                }}
                                className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                title="Clear selected item"
                                aria-label="Clear selected item"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        );
                      }
                    },
                    {
                      key: "batch",
                      header: "Batch",
                      render: (r) => {
                        if (!r.itemId) {
                          return <span className="text-xs text-slate-400">Select item</span>;
                        }
                        const batchRows = getOpenBatchRows(r.itemId);
                        if (!batchRows.length) {
                          return <span className="text-xs text-slate-400">No open batch</span>;
                        }
                        return (
                          <select
                            value={r.selectedBatchId || ""}
                            onChange={(e) => handleLineBatchChange(r, e.target.value)}
                            className="w-44 rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-xs outline-none"
                          >
                            <option value="">Select batch</option>
                            {batchRows.map((row) => {
                              const batchId = String(row.batch_id || "");
                              const qty = Number(row.qty_remaining || 0);
                              const cost = Number(row.unit_cost_excl_tax || 0);
                              const suggested = Number(
                                row?.suggested_sale_rate ?? row?.metadata?.suggestedSaleRate ?? 0
                              );
                              const label = `${String(row.source_document_no || "BATCH").slice(0, 14)} | ${qty} @ ${money(cost)}${suggested > 0 ? ` | Sell ${money(suggested)}` : ""}`;
                              return (
                                <option key={`${r.id}-${batchId}`} value={batchId}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        );
                      }
                    },
                    {
                      key: "qty",
                      header: "Qty",
                      render: (r) => (
                        <input
                          value={r.qty}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              updateLine(r.id, { qty: raw });
                              return;
                            }
                            const parsed = Number(raw);
                            if (!Number.isFinite(parsed) || parsed < 0) {
                              updateLine(r.id, { qty: raw });
                              return;
                            }
                            if (r.itemId) {
                              const maxAssignable = getMaxAssignableQty(
                                r.itemId,
                                r.id,
                                r.selectedBatchId || ""
                              );
                              if (Number.isFinite(maxAssignable) && parsed > maxAssignable) {
                                updateLine(r.id, { qty: maxAssignable });
                                return;
                              }
                            }
                            updateLine(r.id, { qty: raw });
                          }}
                          className="w-20 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                        />
                      )
                    },
                    {
                      key: "rate",
                      header: "Rate",
                      render: (r) => (
                        <input
                          value={r.rate}
                          onChange={(e) => updateLine(r.id, { rate: e.target.value })}
                          className="w-28 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                        />
                      )
                    },
                    {
                      key: "discount",
                      header: "Discount",
                      render: (r) => (
                        <input
                          value={r.discount}
                          onChange={(e) => updateLine(r.id, { discount: e.target.value })}
                          className="w-28 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                        />
                      )
                    },
                    {
                      key: "tax",
                      header: "Tax %",
                      render: (r) => (
                        <input
                          value={forceZeroTax ? 0 : r.tax}
                          onChange={(e) => {
                            if (forceZeroTax) return;
                            updateLine(r.id, { tax: e.target.value });
                          }}
                          className="w-20 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none disabled:bg-slate-100 disabled:text-slate-500"
                          disabled={forceZeroTax}
                        />
                      )
                    },
                    {
                      key: "net",
                      header: "Net Amount",
                      render: (r) => {
                        const qty = Number(r.qty || 0);
                        const rate = Number(r.rate || 0);
                        const discount = Number(r.discount || 0);
                        return money(round2(Math.max(0, qty * rate - discount)));
                      }
                    },
                    {
                      key: "amount",
                      header: "Total Amount",
                      render: (r) => {
                        const qty = Number(r.qty || 0);
                        const rate = Number(r.rate || 0);
                        const discount = Number(r.discount || 0);
                        const taxRateValue = forceZeroTax ? 0 : Number(r.tax || 0);
                        const net = round2(Math.max(0, qty * rate - discount));
                        return money(round2(net + (net * taxRateValue) / 100));
                      }
                    },
                    {
                      key: "rm",
                      header: "",
                      render: (r) => (
                        <button
                          onClick={() => removeLine(r.id)}
                          className="rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-xs font-semibold hover:bg-rose-50"
                        >
                          Remove
                        </button>
                      )
                    }
                  ]}
                  rows={lines}
                  allowOverflow
                  emptyText="Add items to invoice"
                />
                {activeLineForSearch &&
                activeLineItemSearchId &&
                normalizeItemSearchText(activeLineForSearch.itemInput).length
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
                            const maxAssignable = getMaxAssignableQty(item.id, activeLineForSearch.id);
                            const outOfStock = Number.isFinite(maxAssignable) && maxAssignable <= 0;
                            return (
                              <button
                                key={`invoice-line-floating-${activeLineForSearch.id}-${item.id}`}
                                type="button"
                                disabled={outOfStock}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  if (outOfStock) return;
                                  selectLineItem(activeLineForSearch, item);
                                  setActiveLineItemSearchId("");
                                }}
                                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{formatItemSearchLabel(item)}</span>
                                    {stockInfo ? (
                                      <span className={`text-[11px] font-semibold ${outOfStock ? "text-rose-600" : "text-slate-500"}`}>
                                        Remaining: {stockInfo.available}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-400">Service / Not tracked</span>
                                    )}
                                  </div>
                                  {item?.type === "Product" ? (
                                    <span className="text-[10px] text-slate-500">{formatBatchHint(item.id)}</span>
                                  ) : null}
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
                {hasStockErrors ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {stockValidationIssues.slice(0, 3).map((issue) => (
                      <p key={issue.itemId}>
                        {issue.itemName}: requested {issue.requested}, available {issue.available}
                      </p>
                    ))}
                    {stockValidationIssues.length > 3 ? <p>More items have stock shortages.</p> : null}
                  </div>
                ) : null}
              </div>
            </>
          </div>
        </Card>

        {!partyId ? (
          <Card className="p-6">
            <p className="text-sm text-slate-600">
              Search and select customer first. Invoice form is visible but disabled until customer is selected.
            </p>
          </Card>
        ) : null}

        <div className={partyId ? "" : "pointer-events-none select-none opacity-50"}>
          <Card className="p-5">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Payment on Invoice</h3>
                <p className="mt-1 text-xs text-slate-500">Capture received amount now or keep it pending.</p>

                <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setMarkAsPaid(false)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      !markAsPaid ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Not Received
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarkAsPaid(true)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      markAsPaid ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Received
                  </button>
                </div>

                {markAsPaid ? (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Amount Received">
                    <input
                      type="number"
                      min="0"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      placeholder="Enter received amount"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                  <FormField label="Payment Mode">
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    >
                      {paymentModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Payment Date">
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                  <FormField label="Reference No">
                    <input
                      value={referenceNo}
                      onChange={(e) => setReferenceNo(e.target.value)}
                      placeholder="Enter payment reference"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                  {paymentMode === "Cheque" ? (
                    <FormField label="Cheque No" className="md:col-span-2">
                      <input
                        value={chequeNo}
                        onChange={(e) => setChequeNo(e.target.value)}
                        placeholder="Enter cheque number"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                      />
                    </FormField>
                  ) : null}
                  {paymentMode === "Bank Transfer" ? (
                    <>
                      <FormField label="Bank Name">
                        <input
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="Enter bank name"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                          style={{ "--tw-ring-color": UI.COLORS.ring }}
                        />
                      </FormField>
                      <FormField label="Bank Account">
                        <input
                          value={bankAccount}
                          onChange={(e) => setBankAccount(e.target.value)}
                          placeholder="Enter bank account"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                          style={{ "--tw-ring-color": UI.COLORS.ring }}
                        />
                      </FormField>
                    </>
                  ) : null}
                  {paymentMode === "Bank Transfer" ||
                  paymentMode === "Card" ||
                  paymentMode === "UPI" ||
                  paymentMode === "Online Gateway" ? (
                    <FormField label="Transaction ID" className="md:col-span-2">
                      <input
                        value={transactionId}
                        onChange={(e) => setTransactionId(e.target.value)}
                        placeholder="Enter transaction ID"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                      />
                    </FormField>
                  ) : null}
                  <FormField label="Notes" className="md:col-span-2">
                    <input
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      placeholder="Optional internal note"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                  </FormField>
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    Payment will stay pending. You can record it later in Payment In.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Invoice Summary</p>
                <p className="text-xs text-slate-500 mt-1">
                  Bill template is shown only when you click Save & Print.
                </p>

              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-600">Sub Total</span>
                <span className="font-semibold text-slate-900">{money(computed.subTotal)}</span>
              </div>
              {computed.tax.taxMode === "GST" ? (
                computed.tax.supplyType === "INTER" ? (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">IGST</span>
                    <span className="font-semibold text-slate-900">
                      {money(Number(computed.tax.igst || computed.tax.totalTax || 0))}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">CGST + SGST</span>
                    <span className="font-semibold text-slate-900">
                      {money(Number(computed.tax.cgst || 0) + Number(computed.tax.sgst || 0))}
                    </span>
                  </div>
                )
              ) : (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">{computed.tax.taxBreakup?.taxLabel || "TAX"}</span>
                  <span className="font-semibold text-slate-900">{money(computed.tax.taxAmount)}</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-base">
                <span className="font-semibold text-slate-900">Grand Total</span>
                <span className="font-semibold text-slate-900">{money(computed.grandTotal)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-600">Paid Now</span>
                <span className="font-semibold text-emerald-700">{money(paymentAmount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-600">Balance Due</span>
                <span className="font-semibold text-rose-700">{money(pendingAmount)}</span>
              </div>
              {advanceAmount > 0 ? (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Advance</span>
                  <span className="font-semibold text-emerald-700">{money(advanceAmount)}</span>
                </div>
              ) : null}

                <div className="mt-4">
                  <GradientButton
                    className="w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={saveInvoice}
                    disabled={!canCreateInvoice || !partyId || !String(invoiceNo || "").trim() || hasStockErrors}
                  >
                    <Save className="h-4 w-4" />
                    Save Invoice
                  </GradientButton>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {printInvoiceData ? (
        <div className="hidden print:block print-sheet">
          <div className="invoice-preview">
            <InvoicePreview
              templateId={templateConfig.templateId}
              styleConfig={{
                primaryColor: templateConfig.primaryColor,
                bgColor: templateConfig.bgColor,
                fontFamily: templateConfig.fontFamily,
                logoUrl: templateConfig.logoUrl,
                logoPosition: templateConfig.logoPosition
              }}
              invoiceData={printInvoiceData}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

