import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Plus, Printer, Save, Search, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";

import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import FormField from "../../components/FormField";
import Badge from "../../components/Badge";
import Modal from "../../components/Modal";
import InvoicePreview from "../../components/InvoicePreview";
import DateInput from "../../components/DateInput";

import { useOrganization } from "../../context/OrganizationContext";
import {
  invoicesCreate,
  invoicesList,
  invoicesSyncFromRemote,
  invoicesUpdate
} from "../../services/invoices.service";
import { calculateTaxes } from "../../services/tax";
import { isOrganizationScopedStorageEventKey, LS_KEYS } from "../../services/storage";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { companyPeekDocumentNumber } from "../../services/company.service";
import { syncPaymentInRemote } from "../../services/payments.service";
import { fetchItemStockHistory } from "../../services/inventory.service";
import { canCreateEntries, canEditEntries } from "../../services/roles";
import { UI } from "../../theme/tokens";
import { formatMoney } from "../../modules/parties/utils";
import { getPartyCreditStatus, listParties, syncPartiesFromRemote, upsertPartyRemote } from "../../modules/parties/store";
import { computeItemStock, listItems, syncItemsFromRemote, upsertItemRemote } from "../../modules/items/store";
import {
  applyAdvanceWalletToCustomerInvoice,
  listCustomerAdvanceWalletHistory,
  outstandingByCustomer,
  paymentInsightsByCustomer,
  savePaymentIn
} from "../../modules/paymentIn/store";
import { COUNTRY_CONFIG, COUNTRY_NAME_TO_CODE } from "../../modules/paymentIn/countryConfig";
import { getInvoiceTemplateConfig } from "../../lib/templateStore";
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
import {
  formatDecimalByPreference,
  formatInputNumberByPreference,
  normalizeFormattedNumberInput,
  parseFormattedNumber
} from "../../lib/formatPreferences";

function money(n) {
  return formatDecimalByPreference(Number(n || 0));
}

function displayNumericInput(value) {
  return formatInputNumberByPreference(value);
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
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
const UNIT_OPTIONS = ["pcs", "kg", "box", "pack", "ltr", "hours", "days", "months", "service"];
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

function normalizeInvoiceItemType(value) {
  return String(value || "").trim().toLowerCase() === "service" ? "Service" : "Product";
}

function itemTypeBadgeClassName(type) {
  return normalizeInvoiceItemType(type) === "Service"
    ? "rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700"
    : "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700";
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
  const [searchParams] = useSearchParams();
  const role = authGetRole();
  const canCreateInvoice = canCreateEntries(role);
  const canEditInvoice = canEditEntries(role);
  const editInvoiceId = String(searchParams.get("edit") || "").trim();
  const printInvoiceId = String(searchParams.get("print") || "").trim();
  const previewInvoiceId = String(searchParams.get("preview") || "").trim();
  const activeInvoiceId = editInvoiceId || printInvoiceId || previewInvoiceId;
  const isEditMode = !!editInvoiceId;
  const isPrintMode = !!printInvoiceId;
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
  const [lineItemMode, setLineItemMode] = useState("Product");

  const initialInvoiceDate = "";
  const [invoiceDate, setInvoiceDate] = useState(initialInvoiceDate);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [partyId, setPartyId] = useState("");
  const party = useMemo(() => customers.find((c) => c.id === partyId) || null, [customers, partyId]);
  const [customerSearchPhone, setCustomerSearchPhone] = useState("");
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [formErrors, setFormErrors] = useState({});
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
  const [loadedInvoiceId, setLoadedInvoiceId] = useState("");
  const [loadedInvoiceRecord, setLoadedInvoiceRecord] = useState(null);
  const [loadingExistingInvoice, setLoadingExistingInvoice] = useState(false);
  const [lastSavedInvoiceId, setLastSavedInvoiceId] = useState("");
  const [printInvoiceData, setPrintInvoiceData] = useState(null);
  const [printQueued, setPrintQueued] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const printContainerRef = useRef(null);
  const pendingPrintWindowRef = useRef(null);
  const previewAutoOpenedRef = useRef(false);
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [useAvailableAdvance, setUseAvailableAdvance] = useState(false);

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
  const [taxRate, setTaxRate] = useState("");
  const [vatInput, setVatInput] = useState("");
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

  function clearFormError(field) {
    setFormErrors((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

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
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    if (!activeInvoiceId) {
      setLoadedInvoiceId("");
      setLoadedInvoiceRecord(null);
      setLoadingExistingInvoice(false);
      return;
    }
    if (loadedInvoiceId === activeInvoiceId) {
      return;
    }

    let cancelled = false;

    async function loadExistingInvoice() {
      setLoadingExistingInvoice(true);
      try {
        let records = invoicesList();
        let matched =
          records.find((entry) => String(entry?.id || "").trim() === activeInvoiceId) || null;

        if (!matched) {
          const synced = await invoicesSyncFromRemote();
          records = Array.isArray(synced) ? synced : invoicesList();
          matched =
            records.find((entry) => String(entry?.id || "").trim() === activeInvoiceId) || null;
        }

        if (cancelled) return;
        if (!matched) {
          alert("Invoice not found.");
          navigate("/app/sales/invoice/history", { replace: true });
          return;
        }

        hydrateInvoiceEditor(matched, items);
      } catch (error) {
        if (cancelled) return;
        alert(error?.message || "Failed to load invoice.");
        navigate("/app/sales/invoice/history", { replace: true });
      } finally {
        if (!cancelled) {
          setLoadingExistingInvoice(false);
        }
      }
    }

    void loadExistingInvoice();
    return () => {
      cancelled = true;
    };
  }, [activeInvoiceId, items, loadedInvoiceId, navigate]);

  useEffect(() => {
    if (forceZeroTax) {
      setTaxRate(0);
      setVatInput("");
      return;
    }
    setTaxRate("");
    setVatInput("");
  }, [country, isIndiaOrg, gstRuntimeEnabled, defaultGstRate, companyVatRate, forceZeroTax]);

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
    if (!party?.phone) return;
    setCustomerSearchPhone(String(party.phone).replace(/\D/g, "").slice(-10));
  }, [party?.phone]);

  useEffect(() => {
    if (!printQueued || !printInvoiceData) return;
    let cancelled = false;
    let closeWatcher = null;
    let printWindow = null;

    async function openPrintWindow() {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const markup = printContainerRef.current?.innerHTML || "";
        if (markup.trim()) {
          printWindow = pendingPrintWindowRef.current;
          if (printWindow && printWindow.closed) {
            printWindow = null;
          }
          if (!printWindow) {
            printWindow = window.open("", "_blank");
          }
          pendingPrintWindowRef.current = null;
          if (!printWindow) break;

          const copiedStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
            .map((node) => node.outerHTML)
            .join("\n");
          const title = String(printInvoiceData?.invoiceNo || "invoice").trim() || "invoice";
          const escapedTitle = title.replace(/[<>&"]/g, (char) => {
            if (char === "<") return "&lt;";
            if (char === ">") return "&gt;";
            if (char === "&") return "&amp;";
            return "&quot;";
          });

          printWindow.document.open();
          printWindow.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <base href="${window.location.origin}" />
    ${copiedStyles}
  </head>
  <body>
    <div class="print-sheet">
      ${markup}
    </div>
  </body>
</html>`);
          printWindow.document.close();
          printWindow.onload = () => {
            window.setTimeout(() => {
              if (printWindow?.closed) return;
              printWindow.focus();
              printWindow.print();
            }, 200);
          };
          printWindow.onafterprint = () => {
            if (!printWindow?.closed) {
              printWindow.close();
            }
          };
          closeWatcher = window.setInterval(() => {
            if (!printWindow || !printWindow.closed) return;
            window.clearInterval(closeWatcher);
            setPrintQueued(false);
            setPrintInvoiceData(null);
          }, 300);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        if (cancelled) return;
      }

      setPrintQueued(false);
      setPrintInvoiceData(null);
      window.setTimeout(() => window.print(), 80);
    }

    void openPrintWindow();

    return () => {
      cancelled = true;
      if (closeWatcher) {
        window.clearInterval(closeWatcher);
      }
      pendingPrintWindowRef.current = null;
      if (printWindow && !printWindow.closed) {
        printWindow.close();
      }
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
    if (String(invoiceNo || "").trim()) return;
    const nextInvoiceNo = companyPeekDocumentNumber("invoice", { dateValue: invoiceDate });
    if (nextInvoiceNo) {
      setInvoiceNo(nextInvoiceNo);
    }
  }, [invoiceDate, invoiceNo]);

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
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.paidAmount;
        delete next.paymentDate;
        delete next.chequeNo;
        delete next.bankName;
        delete next.bankAccount;
        delete next.transactionId;
        return next;
      });
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
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.chequeNo;
        delete next.bankName;
        delete next.bankAccount;
        delete next.transactionId;
        return next;
      });
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setBankAccount("");
      return;
    }
    if (paymentMode === "Cheque") {
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.bankName;
        delete next.bankAccount;
        delete next.transactionId;
        return next;
      });
      setTransactionId("");
      setBankName("");
      setBankAccount("");
      return;
    }
    if (paymentMode === "Bank Transfer") {
      clearFormError("chequeNo");
      setChequeNo("");
      return;
    }
    if (paymentMode === "Card" || paymentMode === "UPI" || paymentMode === "Online Gateway") {
      setFormErrors((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.chequeNo;
        delete next.bankName;
        delete next.bankAccount;
        return next;
      });
      setChequeNo("");
      setBankName("");
      setBankAccount("");
    }
  }, [markAsPaid, paymentMode]);

  useEffect(() => {
    setFormErrors((prev) => {
      if (!prev || !Object.keys(prev).length) return prev;
      const next = { ...prev };
      let changed = false;

      if (next.customer && partyId) {
        delete next.customer;
        changed = true;
      }
      if (next.invoiceNo && String(invoiceNo || "").trim()) {
        delete next.invoiceNo;
        changed = true;
      }
      if (next.invoiceDate && String(invoiceDate || "").trim()) {
        delete next.invoiceDate;
        changed = true;
      }
      if (next.paidAmount && (!markAsPaid || Number(paidAmount || 0) > 0)) {
        delete next.paidAmount;
        changed = true;
      }
      if (next.paymentDate && (!markAsPaid || String(paymentDate || "").trim())) {
        delete next.paymentDate;
        changed = true;
      }
      if (next.chequeNo && (!markAsPaid || paymentMode !== "Cheque" || String(chequeNo || "").trim())) {
        delete next.chequeNo;
        changed = true;
      }
      if (next.bankName && (!markAsPaid || paymentMode !== "Bank Transfer" || String(bankName || "").trim())) {
        delete next.bankName;
        changed = true;
      }
      if (next.bankAccount && (!markAsPaid || paymentMode !== "Bank Transfer" || String(bankAccount || "").trim())) {
        delete next.bankAccount;
        changed = true;
      }
      const needsTransactionId =
        markAsPaid &&
        (paymentMode === "Bank Transfer" ||
          paymentMode === "Card" ||
          paymentMode === "UPI" ||
          paymentMode === "Online Gateway");
      if (next.transactionId && (!needsTransactionId || String(transactionId || "").trim())) {
        delete next.transactionId;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [
    bankAccount,
    bankName,
    chequeNo,
    invoiceDate,
    invoiceNo,
    markAsPaid,
    paidAmount,
    partyId,
    paymentDate,
    paymentMode,
    transactionId
  ]);

  function addLine() {
    setLines((p) => [
      ...p,
      {
        id: `l_${Date.now()}`,
        itemId: "",
        itemInput: "",
        selectedBatchId: "",
        hsnInput: "",
        priceTaxMode: "WITHOUT_TAX",
        unit: "pcs",
        qty: 1,
        rate: 0,
        discount: 0,
        tax: forceZeroTax ? 0 : ""
      }
    ]);
  }

  function addLineWithItem(item) {
    if (!item) return;
    const itemType = normalizeInvoiceItemType(item?.type);
    const maxAssignable = itemType === "Product" ? getMaxAssignableQty(item.id) : Number.POSITIVE_INFINITY;
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && maxAssignable <= 0) {
      alert(`Out of stock: ${item.name}.`);
      return;
    }
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && maxAssignable < 1) {
      showInsufficientStockAlert(item.id, maxAssignable, 1, item.name || "Item");
    }
    setLines((prev) => {
      const emptyIndex = prev.findIndex((line) => !line.itemId);
      const nextLine = {
        id: `l_${Date.now()}`,
        itemId: item.id,
        itemInput: formatItemSearchLabel(item),
        selectedBatchId: "",
        hsnInput: itemType === "Service" ? item?.sac || item?.hsn || "" : "",
        priceTaxMode: "WITHOUT_TAX",
        unit: item?.unit ?? "pcs",
        qty: Number.isFinite(maxAssignable) ? Math.min(1, maxAssignable) : 1,
        rate: item.salesRate || item.price || 0,
        discount: 0,
        tax: forceZeroTax ? 0 : ""
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
    clearFormError("customer");
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
    clearFormError("customer");
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
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next.customer;
      return next;
    });
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

  function toEditableInvoiceLines(invoiceLines, availableItems) {
    const itemByIdMap = new Map(
      (Array.isArray(availableItems) ? availableItems : []).map((item) => [String(item?.id || ""), item])
    );

    return (Array.isArray(invoiceLines) ? invoiceLines : []).map((line, index) => {
      const matchedItem = itemByIdMap.get(String(line?.itemId || "")) || null;
      const resolvedType = matchedItem
        ? normalizeInvoiceItemType(matchedItem?.type)
        : normalizeInvoiceItemType(line?.itemType || "");
      return {
        id: String(line?.id || `l_${Date.now()}_${index}`),
        itemId: String(line?.itemId || ""),
        itemInput: matchedItem
          ? formatItemSearchLabel(matchedItem)
          : String(line?.itemName || line?.description || "").trim(),
        selectedBatchId: String(line?.selectedBatchId || line?.manual_batch_id || "").trim(),
        hsnInput: String(line?.hsn || line?.hsnSac || "").trim(),
        priceTaxMode:
          String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX" ? "WITH_TAX" : "WITHOUT_TAX",
        unit: String(line?.unit || matchedItem?.unit || "pcs").trim() || "pcs",
        qty: Number(line?.qty || line?.quantity || 0),
        rate: Number(line?.rate || line?.unitPrice || 0),
        discount: Number(line?.discountAmount ?? line?.discount ?? 0),
        tax: forceZeroTax ? 0 : Number(line?.taxRate ?? line?.tax ?? 0),
        itemType: resolvedType
      };
    });
  }

  function hydrateInvoiceEditor(invoiceRecord, availableItems = items) {
    if (!invoiceRecord) return;
    setLoadedInvoiceRecord(invoiceRecord);
    setInvoiceDate(String(invoiceRecord?.invoiceDate || "").trim());
    setInvoiceNo(String(invoiceRecord?.invoiceNo || "").trim());
    setPartyId(String(invoiceRecord?.partyId || "").trim());
    setLines(toEditableInvoiceLines(invoiceRecord?.lines, availableItems));
    const resolvedTaxRate =
      Number(
        invoiceRecord?.taxRate ??
          invoiceRecord?.totals?.tax?.rate ??
          invoiceRecord?.totals?.tax?.taxRate ??
          invoiceRecord?.totals?.taxBreakup?.taxRate ??
          0
      ) || 0;
    setTaxRate(forceZeroTax ? 0 : resolvedTaxRate);
    setVatInput(forceZeroTax ? "" : resolvedTaxRate > 0 ? `TAX ${resolvedTaxRate}%` : "");
    setMarkAsPaid(false);
    setPaidAmount("");
    setReferenceNo("");
    setTransactionId("");
    setChequeNo("");
    setBankName("");
    setBankAccount("");
    setPaymentNotes("");
    setFormErrors({});
    setLastSavedInvoiceId(String(invoiceRecord?.id || "").trim());
    setLoadedInvoiceId(String(invoiceRecord?.id || "").trim());
  }

  function computeInvoiceSummary(sourceLines, sourceItems) {
    const itemByIdMap = new Map(
      (Array.isArray(sourceItems) ? sourceItems : []).map((item) => [String(item?.id || ""), item])
    );
    const selectedLines = (Array.isArray(sourceLines) ? sourceLines : []).filter((line) => {
      if (line?.itemId) return true;
      const typedName = String(line?.itemInput || line?.itemName || "").trim();
      if (!typedName) return false;
      return resolveLineItemType(line, itemByIdMap) === "Service";
    });
    const hasAnyLineTax = forceZeroTax ? false : selectedLines.some((line) => Number(line?.tax || 0) > 0);
    const fallbackRate = forceZeroTax ? 0 : hasAnyLineTax ? 0 : Number(taxRate || 0);

    const enrichedBase = selectedLines.map((line) => {
      const item = itemByIdMap.get(String(line?.itemId || "")) || null;
      const itemType = item
        ? normalizeInvoiceItemType(item?.type)
        : resolveLineItemType(line, itemByIdMap);
      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const discount = Number(line.discount || 0);
      const hasExplicitLineTax =
        line?.tax !== "" && line?.tax !== null && line?.tax !== undefined && Number.isFinite(Number(line?.tax));
      const taxRatePerLine = forceZeroTax ? 0 : hasExplicitLineTax ? Number(line.tax || 0) : Number(fallbackRate || 0);
      const net = round2(Math.max(0, qty * rate - discount));
      const lineTax = round2((net * taxRatePerLine) / 100);
      const codeFromItem = itemType === "Service" ? item?.sac || item?.hsn || "" : item?.hsn || item?.sac || "";
      const codeFromLine = String(line?.hsnInput || "").trim();
      const fallbackItemName = String(line?.itemInput || line?.itemName || "").trim();

      return {
        ...line,
        tax: taxRatePerLine,
        priceTaxMode: "WITHOUT_TAX",
        itemName: item?.name || fallbackItemName || "Service",
        itemType,
        hsn: itemType === "Service" ? codeFromLine || codeFromItem : codeFromItem,
        net,
        lineTax
      };
    });

    const subTotal = round2(enrichedBase.reduce((a, x) => a + x.net, 0));
    const lineTaxTotal = round2(enrichedBase.reduce((a, x) => a + x.lineTax, 0));
    const effectiveTaxRate = subTotal > 0 ? (lineTaxTotal / subTotal) * 100 : Number(taxRate || 0);

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
  }

  const computed = useMemo(
    () => computeInvoiceSummary(lines, items),
    [lines, items, companyCountry, companyState, customerCountry, customerState, taxRate, company?.tax?.gstin, party?.gstin, party?.taxId, isIndiaOrg, gstRuntimeEnabled, forceZeroTax]
  );

  const paymentAmount = useMemo(() => {
    if (!markAsPaid) return 0;
    const parsed = parseFormattedNumber(paidAmount || 0);
    return round2(Math.max(0, parsed));
  }, [markAsPaid, paidAmount]);

  const customerPaymentInsights = useMemo(
    () => paymentInsightsByCustomer(resolvePaymentCountryCode(customerCountry, party?.countryCode || ""), partyId),
    [customerCountry, party?.countryCode, partyId]
  );
  const customerAdvanceHistory = useMemo(
    () => (partyId ? listCustomerAdvanceWalletHistory(paymentCountryCode, partyId).slice(0, 8) : []),
    [partyId, paymentCountryCode]
  );
  const customerAdvanceWallet = round2(Number(customerPaymentInsights?.advanceWallet || 0));
  const maxAdvanceUsable = useMemo(
    () => round2(Math.min(customerAdvanceWallet, Number(computed.grandTotal || 0))),
    [customerAdvanceWallet, computed.grandTotal]
  );
  const advanceAppliedFromWallet = useMemo(
    () => (useAvailableAdvance ? maxAdvanceUsable : 0),
    [useAvailableAdvance, maxAdvanceUsable]
  );
  const balanceAfterExistingAdvance = useMemo(
    () => round2(Math.max(0, Number(computed.grandTotal || 0) - advanceAppliedFromWallet)),
    [computed.grandTotal, advanceAppliedFromWallet]
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
    Math.max(0, customerAdvanceWallet - advanceAppliedFromWallet) + advanceAmount
  );
  const finalPayableAmount = useMemo(
    () => round2(Math.max(0, Number(computed.grandTotal || 0) - advanceAppliedFromWallet)),
    [computed.grandTotal, advanceAppliedFromWallet]
  );

  useEffect(() => {
    setUseAvailableAdvance(false);
  }, [partyId]);

  useEffect(() => {
    if (!customerAdvanceWallet) {
      setUseAvailableAdvance(false);
    }
  }, [customerAdvanceWallet]);

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

  const itemById = useMemo(
    () => new Map((Array.isArray(items) ? items : []).map((item) => [String(item?.id || ""), item])),
    [items]
  );

  const modeFilteredLineItems = useMemo(
    () =>
      availableLineItems.filter(
        (item) => normalizeInvoiceItemType(item?.type) === normalizeInvoiceItemType(lineItemMode)
      ),
    [availableLineItems, lineItemMode]
  );
  const dynamicBatchColumnHeader =
    normalizeInvoiceItemType(lineItemMode) === "Service" ? "HSN / SAC" : "Batch";

  function resolveLineItemType(line, sourceItemMap = itemById) {
    const matchedItem = sourceItemMap.get(String(line?.itemId || ""));
    if (!matchedItem) return normalizeInvoiceItemType(lineItemMode);
    return normalizeInvoiceItemType(matchedItem?.type);
  }

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
    if (!query) return modeFilteredLineItems;
    const barcodeQuery = normalizeBarcodeLookupValue(query);
    const startsWith = modeFilteredLineItems.filter((item) => {
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
    return modeFilteredLineItems.filter((item) => itemMatchesSearchQuery(item, query, barcodeLookupByItemId));
  }, [modeFilteredLineItems, itemSearch, barcodeLookupByItemId]);

  function buildStockMap(sourceItems) {
    const map = new Map();
    (Array.isArray(sourceItems) ? sourceItems : []).forEach((item) => {
      if (item?.type !== "Product" || !item?.trackInventory) return;
      map.set(item.id, {
        itemId: item.id,
        itemName: item.name || "Item",
        ...computeItemStock(item)
      });
    });
    return map;
  }

  const stockByItemId = useMemo(() => buildStockMap(items), [items]);

  function getMaxAssignableQtyFromSource(
    itemId,
    sourceLines,
    stockMap,
    excludeLineId = "",
    preferredBatchId = ""
  ) {
    if (allowNegativeStock) return Number.POSITIVE_INFINITY;
    if (preferredBatchId) {
      return getBatchAvailableForLineFromSource(itemId, preferredBatchId, sourceLines, excludeLineId);
    }
    const stockInfo = stockMap.get(itemId);
    if (!stockInfo) return Number.POSITIVE_INFINITY;
    const reservedQty = (Array.isArray(sourceLines) ? sourceLines : []).reduce((sum, line) => {
      if (excludeLineId && String(line?.id || "") === String(excludeLineId)) return sum;
      if (String(line?.itemId || "") !== String(itemId || "")) return sum;
      return sum + Math.max(0, Number(line?.qty || 0));
    }, 0);
    return Math.max(0, Number(stockInfo.available || 0) - reservedQty);
  }

  function getMaxAssignableQty(itemId, excludeLineId = "", preferredBatchId = "") {
    return getMaxAssignableQtyFromSource(itemId, lines, stockByItemId, excludeLineId, preferredBatchId);
  }

  function collectStockValidationIssues(enrichedLines, sourceLines, stockMap) {
    if (allowNegativeStock) return [];
    const issues = [];
    (Array.isArray(enrichedLines) ? enrichedLines : []).forEach((line) => {
      if (!line?.itemId) return;
      const qty = Math.max(0, Number(line?.qty || 0));
      if (!qty) return;
      const stockInfo = stockMap.get(line.itemId);
      if (!stockInfo) return;
      if (line?.selectedBatchId) {
        const available = getBatchAvailableForLineFromSource(
          line.itemId,
          line.selectedBatchId,
          sourceLines,
          line.id
        );
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
      const totalAvailable = getMaxAssignableQtyFromSource(
        line.itemId,
        sourceLines,
        stockMap,
        line.id,
        ""
      );
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
  }

  const stockValidationIssues = useMemo(() => {
    return collectStockValidationIssues(computed.enriched, lines, stockByItemId);
  }, [allowNegativeStock, computed.enriched, stockByItemId, lines]);
  const stockAlertDedupRef = useRef({ key: "", at: 0 });

  const hasStockErrors = stockValidationIssues.length > 0;
  const invoiceItemGridClassName =
    "grid grid-cols-[minmax(260px,2.6fr)_minmax(180px,1.7fr)_minmax(88px,0.8fr)_minmax(92px,0.9fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(96px,0.85fr)_minmax(124px,1fr)_minmax(124px,1fr)] gap-3";
  const invoiceLineInputClassName =
    "h-10 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 text-center text-sm leading-5 outline-none";
  const invoiceLineInputRightClassName = `${invoiceLineInputClassName} tabular-nums`;

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

  function getBatchAvailableForLineFromSource(itemId, batchId, sourceLines, excludeLineId = "") {
    if (!itemId || !batchId) return 0;
    const rows = getOpenBatchRows(itemId);
    const target = rows.find((row) => String(row.batch_id) === String(batchId));
    if (!target) return 0;
    const reserved = (Array.isArray(sourceLines) ? sourceLines : []).reduce((sum, line) => {
      if (excludeLineId && String(line?.id || "") === String(excludeLineId)) return sum;
      if (String(line?.itemId || "") !== String(itemId || "")) return sum;
      if (String(line?.selectedBatchId || "") !== String(batchId || "")) return sum;
      return sum + Math.max(0, Number(line?.qty || 0));
    }, 0);
    return Math.max(0, Number(target?.qty_remaining || 0) - reserved);
  }

  function getBatchAvailableForLine(itemId, batchId, excludeLineId = "") {
    return getBatchAvailableForLineFromSource(itemId, batchId, lines, excludeLineId);
  }

  function getStockAlertItemName(itemId, fallbackName = "") {
    const stockName = String(stockByItemId.get(itemId)?.itemName || "").trim();
    if (stockName) return stockName;
    const listedName = String(
      (items || []).find((entry) => String(entry?.id || "") === String(itemId || ""))?.name || ""
    ).trim();
    if (listedName) return listedName;
    return String(fallbackName || "Item").trim() || "Item";
  }

  function showInsufficientStockAlert(itemId, available, requested, fallbackName = "") {
    const safeAvailable = Math.max(0, Number(available || 0));
    const safeRequested = Math.max(0, Number(requested || 0));
    if (!Number.isFinite(safeAvailable) || !Number.isFinite(safeRequested) || safeRequested <= safeAvailable) {
      return;
    }
    const itemName = getStockAlertItemName(itemId, fallbackName);
    const key = `${itemId}|${round2(safeAvailable)}|${round2(safeRequested)}`;
    const now = Date.now();
    if (stockAlertDedupRef.current.key === key && now - stockAlertDedupRef.current.at < 1200) {
      return;
    }
    stockAlertDedupRef.current = { key, at: now };
    alert(
      `Insufficient stock for product: ${itemName}. Available: ${round2(safeAvailable)}, Requested: ${round2(safeRequested)}.`
    );
  }

  function selectLineItem(line, matchedItem) {
    if (!matchedItem || !line) return;
    const itemType = normalizeInvoiceItemType(matchedItem?.type);
    const maxAssignable =
      itemType === "Product"
        ? getMaxAssignableQty(matchedItem.id, line.id)
        : Number.POSITIVE_INFINITY;
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && maxAssignable <= 0) {
      alert(`Out of stock: ${matchedItem.name}.`);
      return;
    }
    const nextQtyRaw = Number(line.qty || 0);
    const normalizedQty = Number.isFinite(nextQtyRaw) && nextQtyRaw > 0 ? nextQtyRaw : 1;
    const nextQty = Number.isFinite(maxAssignable)
      ? Math.min(normalizedQty, maxAssignable)
      : normalizedQty;
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && normalizedQty > nextQty) {
      showInsufficientStockAlert(matchedItem.id, maxAssignable, normalizedQty, matchedItem.name || "Item");
    }
    updateLine(line.id, {
      itemInput: formatItemSearchLabel(matchedItem),
      itemId: matchedItem.id,
      selectedBatchId: "",
      hsnInput: itemType === "Service" ? matchedItem?.sac || matchedItem?.hsn || line?.hsnInput || "" : "",
      priceTaxMode: "WITHOUT_TAX",
      unit: matchedItem?.unit ?? line?.unit ?? "pcs",
      qty: nextQty,
      rate: matchedItem?.salesRate || matchedItem?.price || 0,
      tax: forceZeroTax ? 0 : ""
    });
  }

  function handleLineItemInput(line, inputValue) {
    const matchedItem = findItemBySearchInput(modeFilteredLineItems, inputValue, barcodeLookupByItemId);
    if (!matchedItem) {
      updateLine(line.id, { itemInput: inputValue, itemId: "", selectedBatchId: "" });
      return;
    }
    selectLineItem(line, matchedItem);
  }

  function clearLineItemSelection(lineId) {
    updateLine(lineId, { itemInput: "", itemId: "", selectedBatchId: "", hsnInput: "" });
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
    if (Number.isFinite(maxAssignable) && maxAssignable <= 0) {
      alert("Selected batch has zero available stock.");
      return;
    }
    const currentQty = Math.max(0, Number(line.qty || 0));
    if (!allowNegativeStock && Number.isFinite(maxAssignable) && currentQty > maxAssignable) {
      showInsufficientStockAlert(line.itemId, maxAssignable, currentQty, line.itemInput || "Item");
    }
    updateLine(line.id, {
      selectedBatchId: selectedId,
      rate: suggestedRate > 0 ? suggestedRate : line.rate,
      priceTaxMode: "WITHOUT_TAX",
      tax: forceZeroTax ? 0 : line?.tax ?? "",
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
      ? modeFilteredLineItems.filter((item) => itemMatchesSearchQuery(item, query, barcodeLookupByItemId))
      : modeFilteredLineItems;
    const selected = modeFilteredLineItems.find((item) => String(item.id) === String(line?.itemId || ""));
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
  }, [activeLineForSearch, modeFilteredLineItems, barcodeLookupByItemId]);

  function buildInvoicePreviewData(fallbackRecord = null) {
    const fallbackTotals =
      fallbackRecord?.totals && typeof fallbackRecord.totals === "object" ? fallbackRecord.totals : {};
    const fallbackTaxObject =
      fallbackTotals?.tax && typeof fallbackTotals.tax === "object" ? fallbackTotals.tax : {};
    const fallbackTaxBreakup =
      fallbackTotals?.taxBreakup && typeof fallbackTotals.taxBreakup === "object"
        ? fallbackTotals.taxBreakup
        : null;
    const liveItems = computed.enriched.filter((line) => line?.itemId);
    const fallbackItems = Array.isArray(fallbackRecord?.lines) ? fallbackRecord.lines : [];
    const previewItemsSource = liveItems.length ? liveItems : fallbackItems;
    const subTotal = Number(computed.subTotal || fallbackTotals?.subTotal || 0);
    const totalTax = Number(computed.tax?.totalTax || fallbackTaxObject?.totalTax || fallbackTotals?.taxTotal || 0);
    const effectiveTaxRate = Number(
      computed.effectiveTaxRate ||
        taxRate ||
        fallbackRecord?.taxRate ||
        fallbackTaxObject?.taxRate ||
        fallbackTaxObject?.rate ||
        fallbackTaxBreakup?.taxRate ||
        0
    );
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
      name: party?.name || fallbackRecord?.buyer?.name || fallbackRecord?.partyName || "",
      address: party?.address || fallbackRecord?.buyer?.address || "",
      gstin: party?.gstin || party?.taxId || fallbackRecord?.buyer?.gstin || "",
      phone: party?.phone || fallbackRecord?.buyer?.phone || fallbackRecord?.phone || "",
      country: customerCountry || fallbackRecord?.buyer?.country || fallbackRecord?.country || "",
      state: customerState || fallbackRecord?.buyer?.state || fallbackRecord?.placeOfSupply || ""
    };
    return {
      title: gstRuntimeEnabled ? "Tax Invoice" : "Invoice",
      country,
      companyName: company?.companyName || "",
      companyLogoUrl: company?.logoBase64 || "",
      currencySymbol: resolveCurrencySymbol(currencySymbol, currency),
      invoiceNo: invoiceNo || fallbackRecord?.invoiceNo || "-",
      invoiceDate: invoiceDate || fallbackRecord?.invoiceDate || "",
      dueDate: invoiceDate || fallbackRecord?.dueDate || fallbackRecord?.invoiceDate || "",
      placeOfSupply: customerState || fallbackRecord?.placeOfSupply || buyer.state,
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
      taxBreakup: computed.tax?.taxBreakup || fallbackTaxBreakup,
      tax: gstRuntimeEnabled
        ? {
            type: "GST",
            supplyType: computed.tax?.supplyType || fallbackRecord?.supplyType || fallbackTaxBreakup?.supplyType || "INTRA",
            sameState:
              (computed.tax?.supplyType || fallbackRecord?.supplyType || fallbackTaxBreakup?.supplyType || "INTRA") !== "INTER",
            cgst: Number(computed.tax?.cgst || fallbackTaxObject?.cgst || 0),
            sgst: Number(computed.tax?.sgst || fallbackTaxObject?.sgst || 0),
            igst: Number(computed.tax?.igst || fallbackTaxObject?.igst || 0),
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
      items: previewItemsSource.map((line) => {
        const lineNet = Number(line.net ?? line.taxableValue ?? line.lineSubTotal ?? 0);
        const lineTaxAmount = Number(
          line.lineTax ??
            line.taxAmount ??
            Number(line.cgstAmount || 0) +
              Number(line.sgstAmount || 0) +
              Number(line.igstAmount || 0) +
              Number(line.vatAmount || 0)
        );
        const resolvedLineRate = lineNet > 0 ? round2((lineTaxAmount / lineNet) * 100) : 0;
        return {
          id: line.id,
          name: line.itemName || line.name || line.description || "",
          hsn: line.hsn || line.hsnSac || line.sac || "",
          qty: Number(line.qty || 0),
          rate: Number(line.rate || 0),
          discount: Number(line.discount ?? line.discountAmount ?? 0),
          tax: Number(line.tax ?? line.taxRate ?? resolvedLineRate),
          taxRate: Number(line.taxRate ?? line.tax ?? resolvedLineRate),
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
        tax: gstRuntimeEnabled
          ? {
              ...(fallbackTaxObject || {}),
              ...(computed.tax || {}),
              totalTax
            }
          : totalTax,
        taxBreakup: computed.tax?.taxBreakup || fallbackTaxBreakup,
        total: Number(computed.grandTotal || fallbackTotals?.grandTotal || fallbackTotals?.total || 0),
        balance: Number(
          fallbackRecord?.remainingBalance ??
            fallbackTotals?.balance ??
            computed.grandTotal ??
            fallbackTotals?.grandTotal ??
            fallbackTotals?.total ??
            0
        )
      }
    };
  }

  const invoicePreviewData = useMemo(() => buildInvoicePreviewData(loadedInvoiceRecord), [
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
    loadedInvoiceRecord,
    party,
    taxRate,
    computed.effectiveTaxRate
  ]);

  useEffect(() => {
    if (!isPrintMode || !loadedInvoiceId || loadingExistingInvoice) return;
    setPrintInvoiceData(invoicePreviewData);
    setPrintQueued(true);
  }, [invoicePreviewData, isPrintMode, loadedInvoiceId, loadingExistingInvoice]);

  useEffect(() => {
    if (!previewInvoiceId || !loadedInvoiceId || loadingExistingInvoice || previewAutoOpenedRef.current) return;
    setPreviewOpen(true);
    previewAutoOpenedRef.current = true;
  }, [previewInvoiceId, loadedInvoiceId, loadingExistingInvoice]);

  async function resolveInvoiceLinesWithItems(sourceLines) {
    const nextLines = [];
    let didCreateService = false;
    let nextItems = listItems();
    const itemsById = new Map(nextItems.map((item) => [String(item?.id || ""), item]));
    const itemsByName = new Map(
      nextItems
        .filter((item) => item?.name)
        .map((item) => [normalizeItemSearchText(item.name).replace(/\s+/g, " "), item])
    );
    const itemsByCode = new Map(
      nextItems
        .filter((item) => item?.itemCode)
        .map((item) => [normalizeItemSearchText(item.itemCode), item])
    );

    function rememberItem(item) {
      if (!item) return;
      itemsById.set(String(item?.id || ""), item);
      if (item?.name) {
        itemsByName.set(normalizeItemSearchText(item.name).replace(/\s+/g, " "), item);
      }
      if (item?.itemCode) {
        itemsByCode.set(normalizeItemSearchText(item.itemCode), item);
      }
    }

    for (const line of Array.isArray(sourceLines) ? sourceLines : []) {
      const typedInput = String(line?.itemInput || "").trim();
      const normalizedTypedKey = normalizeItemSearchText(typedInput).replace(/\s+/g, " ");
      const directById = itemsById.get(String(line?.itemId || "")) || null;
      const directByInput = typedInput
        ? findItemBySearchInput(nextItems, typedInput, barcodeLookupByItemId) ||
          itemsByCode.get(normalizeItemSearchText(typedInput)) ||
          itemsByName.get(normalizedTypedKey) ||
          null
        : null;
      const matched = directById || directByInput;

      if (matched) {
        const matchedType = normalizeInvoiceItemType(matched?.type);
        nextLines.push({
          ...line,
          itemId: matched.id,
          itemInput: formatItemSearchLabel(matched),
          selectedBatchId: matchedType === "Product" ? line?.selectedBatchId || "" : "",
          hsnInput:
            matchedType === "Service"
              ? String(line?.hsnInput || matched?.sac || matched?.hsn || "").trim()
              : ""
        });
        continue;
      }

      if (!typedInput) {
        nextLines.push({ ...line, itemId: "", selectedBatchId: "", hsnInput: String(line?.hsnInput || "").trim() });
        continue;
      }

      if (normalizeInvoiceItemType(lineItemMode) !== "Service") {
        nextLines.push({ ...line, itemId: "", selectedBatchId: "", hsnInput: "" });
        continue;
      }

      const createdId = await upsertItemRemote(
        {
          name: typedInput,
          type: "Service",
          description: "",
          hsn: "",
          sac: String(line?.hsnInput || "").trim(),
          unit: line?.unit ?? "pcs",
          salesRate: Number(line?.rate || 0),
          purchaseRate: 0,
          taxRate: forceZeroTax ? 0 : Number(line?.tax || 0),
          status: "Active",
          trackInventory: false,
          openingStock: 0,
          lowStockAlert: 0,
          category: ""
        },
        country
      );
      didCreateService = true;
      nextItems = listItems();
      const createdItem =
        nextItems.find((item) => String(item?.id || "") === String(createdId || "")) ||
        nextItems.find(
          (item) =>
            normalizeItemSearchText(item?.name || "").replace(/\s+/g, " ") === normalizedTypedKey
        ) ||
        null;
      if (!createdItem) {
        throw new Error(`Failed to create service item for "${typedInput}".`);
      }
      rememberItem(createdItem);
      nextLines.push({
        ...line,
        itemId: createdItem.id,
        itemInput: formatItemSearchLabel(createdItem),
        selectedBatchId: "",
        hsnInput: String(line?.hsnInput || createdItem?.sac || createdItem?.hsn || "").trim()
      });
    }

    return { lines: nextLines, items: didCreateService ? nextItems : items, didCreateService };
  }

  async function saveInvoice({ silent = false } = {}) {
    if (isEditMode ? !canEditInvoice : !canCreateInvoice) {
      alert(isEditMode ? "You do not have permission to edit invoices." : "You do not have permission to create invoices.");
      return null;
    }

    const suggestedInvoiceNo = String(
      companyPeekDocumentNumber("invoice", { dateValue: invoiceDate }) || ""
    ).trim();
    const normalizedInvoiceNo = String(invoiceNo || "").trim() || suggestedInvoiceNo;
    const isManualInvoiceNo = !!String(invoiceNo || "").trim() && String(invoiceNo || "").trim() !== suggestedInvoiceNo;
    const nextErrors = {};
    if (!partyId) nextErrors.customer = "This field is required";
    if (!normalizedInvoiceNo) nextErrors.invoiceNo = "This field is required";
    if (normalizedInvoiceNo && isManualInvoiceNo) {
      const duplicateExists = invoicesList().some(
        (entry) =>
          String(entry?.id || "").trim() !== String(activeInvoiceId || "").trim() &&
          String(entry?.invoiceNo || "").trim().toLowerCase() === normalizedInvoiceNo.toLowerCase()
      );
      if (duplicateExists) nextErrors.invoiceNo = "Invoice number already exists";
    }
    if (!String(invoiceDate || "").trim()) nextErrors.invoiceDate = "This field is required";
    if (markAsPaid && paymentAmount <= 0) nextErrors.paidAmount = "This field is required";
    if (markAsPaid && !paymentDate) nextErrors.paymentDate = "This field is required";
    if (markAsPaid && paymentMode === "Cheque" && !String(chequeNo || "").trim()) {
      nextErrors.chequeNo = "This field is required";
    }
    if (markAsPaid && paymentMode === "Bank Transfer") {
      if (!String(bankName || "").trim()) {
        nextErrors.bankName = "This field is required";
      }
      if (!String(bankAccount || "").trim()) {
        nextErrors.bankAccount = "This field is required";
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
      nextErrors.transactionId = "This field is required";
    }
    if (Object.keys(nextErrors).length) {
      setFormErrors(nextErrors);
      return null;
    }
    setFormErrors({});

    let effectiveLines = lines;
    let effectiveItems = items;
    try {
      const resolved = await resolveInvoiceLinesWithItems(lines);
      effectiveLines = resolved.lines;
      effectiveItems = resolved.items;
      if (resolved.didCreateService) {
        setItems(effectiveItems);
      }
      setLines(effectiveLines);
    } catch (resolveError) {
      alert(resolveError?.message || "Failed to resolve invoice items.");
      return null;
    }
    const effectiveComputed = computeInvoiceSummary(effectiveLines, effectiveItems);
    const validComputedLines = effectiveComputed.enriched.filter((line) => line?.itemId);
    if (!validComputedLines.length) {
      setFormErrors((prev) => ({ ...prev, lines: "This field is required" }));
      return null;
    }
    clearFormError("lines");
    const effectiveStockByItemId = buildStockMap(effectiveItems);
    const effectiveStockIssues = collectStockValidationIssues(
      effectiveComputed.enriched,
      effectiveLines,
      effectiveStockByItemId
    );
    const productLineItems = validComputedLines
      .map((line) => ({
        line,
        item: effectiveItems.find((entry) => String(entry?.id || "") === String(line?.itemId || ""))
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
      const item = effectiveItems.find((entry) => String(entry?.id || "") === String(line?.itemId || ""));
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
    if (!allowNegativeStock && effectiveStockIssues.length) {
      const issue = effectiveStockIssues[0];
      alert(
        `Insufficient stock for product: ${issue.itemName}. Available: ${issue.available}, Requested: ${issue.requested}.`
      );
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
      taxRate: effectiveComputed.effectiveTaxRate,
      companySnapshot: company,
      seller,
      buyer,
      lines: validComputedLines,
      totals: {
        subTotal: effectiveComputed.subTotal,
        tax: gstRuntimeEnabled
          ? {
              type: "GST",
              supplyType: effectiveComputed.tax.supplyType,
              sameState: effectiveComputed.tax.supplyType !== "INTER",
              cgst: effectiveComputed.tax.cgst,
              sgst: effectiveComputed.tax.sgst,
              igst: effectiveComputed.tax.igst,
              totalTax: effectiveComputed.tax.totalTax
            }
          : {
              type: "NORMAL",
              rate: effectiveComputed.tax.taxRate,
              taxLabel: effectiveComputed.tax.taxBreakup?.taxLabel || "TAX",
              taxAmount: effectiveComputed.tax.taxAmount,
              totalTax: effectiveComputed.tax.totalTax
            },
        taxBreakup: effectiveComputed.tax.taxBreakup,
        totalTax: effectiveComputed.tax.totalTax,
        grandTotal: effectiveComputed.grandTotal
      },
      taxMode: effectiveComputed.tax.taxMode,
      supplyType: effectiveComputed.tax.supplyType || null
    };
    try {
      const savedInvoiceId = isEditMode
        ? await invoicesUpdate(activeInvoiceId, payload)
        : await invoicesCreate(payload);
      setLastSavedInvoiceId(savedInvoiceId || "");
      if (savedInvoiceId && partyId && advanceAppliedFromWallet > 0) {
        applyAdvanceWalletToCustomerInvoice({
          country: paymentCountryCode,
          customerId: partyId,
          invoiceId: savedInvoiceId,
          invoiceNo: normalizedInvoiceNo,
          invoiceDate,
          invoiceAmount: Number(effectiveComputed.grandTotal || 0),
          maxApplyAmount: advanceAppliedFromWallet,
          actor: authGetUser()?.name || authGetUser()?.email || "System User"
        });
      }
      let paymentSaved = false;
      let paymentSavedAsUnapplied = false;

      if (markAsPaid && paymentAmount > 0 && savedInvoiceId) {
        try {
          const outstandingBefore = outstandingByCustomer(paymentCountryCode, partyId);
          const applyAmount = Math.min(
            paymentAmount,
            Math.max(0, Number(effectiveComputed.grandTotal || 0) - advanceAppliedFromWallet)
          );
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
                invoiceAmount: Number(effectiveComputed.grandTotal || 0),
                balanceDue: Number(effectiveComputed.grandTotal || 0),
                applyAmount
              }
            ],
            customerOutstandingBefore: outstandingBefore,
            actor
          };
          const stagedPayment = savePaymentIn({
            ...basePaymentPayload,
            desiredStatus: "Confirmed"
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
            // Fallback: keep the payment visible in Payment In even if invoice linking fails.
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
                paymentNotes || `Payment for invoice ${normalizedInvoiceNo} (saved as advance balance)`,
              customerNotes: "",
              attachment: null,
              desiredStatus: "Confirmed",
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
      setFormErrors({});
      await invoicesSyncFromRemote();
      if (isEditMode) {
        setInvoiceNo(normalizedInvoiceNo);
        setLoadedInvoiceId(String(savedInvoiceId || activeInvoiceId || "").trim());
      } else {
        setInvoiceNo(companyPeekDocumentNumber("invoice", { dateValue: invoiceDate }));
      }

      if (!silent) {
        if (paymentSavedAsUnapplied) {
          alert("Invoice saved. Payment In saved as advance balance.");
        } else {
          alert(
            paymentSaved
              ? "Invoice and Payment In saved successfully."
              : isEditMode
                ? "Invoice updated successfully."
                : "Invoice saved successfully."
          );
        }
        navigate("/app/sales/invoice/history");
      }
      return savedInvoiceId || "";
    } catch (error) {
      if (String(error?.message || "").trim().toLowerCase() === "invoice number already exists") {
        setFormErrors((prev) => ({ ...prev, invoiceNo: "Invoice number already exists" }));
      } else {
        alert(error?.message || "Failed to save invoice.");
      }
      return null;
    }
  }

  async function handleSaveAndPrint() {
    if (isEditMode ? !canEditInvoice : !canCreateInvoice) {
      alert(isEditMode ? "You do not have permission to edit invoices." : "You do not have permission to create invoices.");
      return;
    }

    const preopenedWindow = window.open("", "_blank");
    if (!preopenedWindow) {
      alert("Popup blocked. Please allow popups for this site to print the invoice.");
      return;
    }
    preopenedWindow.document.write(`<!DOCTYPE html><html><head><title>Preparing invoice...</title></head><body style="font-family: Arial, sans-serif; padding: 24px;">Preparing invoice print preview...</body></html>`);
    preopenedWindow.document.close();
    pendingPrintWindowRef.current = preopenedWindow;

    const savedInvoiceId = await saveInvoice({ silent: true });
    if (!savedInvoiceId) {
      if (pendingPrintWindowRef.current && !pendingPrintWindowRef.current.closed) {
        pendingPrintWindowRef.current.close();
      }
      pendingPrintWindowRef.current = null;
      return;
    }

    let savedRecord =
      invoicesList().find((entry) => String(entry?.id || "").trim() === String(savedInvoiceId).trim()) || null;
    if (!savedRecord) {
      try {
        const synced = await invoicesSyncFromRemote();
        savedRecord =
          (Array.isArray(synced) ? synced : []).find(
            (entry) => String(entry?.id || "").trim() === String(savedInvoiceId).trim()
          ) || null;
      } catch {
        // Fall back to current editor state if refresh fails.
      }
    }

    if (savedRecord) {
      setLoadedInvoiceRecord(savedRecord);
    }
    setPrintInvoiceData(savedRecord ? buildInvoicePreviewData(savedRecord) : invoicePreviewData);
    setPrintQueued(true);
  }

  function handleViewInvoice() {
    setPreviewOpen(true);
  }

  return (
    <div className="max-w-6xl">
      <div className="print-hide">
        <PageHeader
          title={isEditMode ? "Sales - Edit Invoice" : "Sales - Invoice"}
          subtitle={
            isEditMode
              ? "Update invoice details, save changes, or open the print preview."
              : "Create invoice with line items and country-wise tax breakdown"
          }
          className="lg:items-center"
          right={
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
              <button
                type="button"
                onClick={() => navigate("/app/sales/invoice/history")}
                className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                Invoice History
              </button>
              <button
                type="button"
                onClick={handleViewInvoice}
                disabled={loadingExistingInvoice}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <Eye className="h-4 w-4" />
                View
              </button>
              <button
                onClick={handleSaveAndPrint}
                disabled={(isEditMode ? !canEditInvoice : !canCreateInvoice) || hasStockErrors || loadingExistingInvoice}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 text-sm font-semibold hover:bg-slate-50 sm:w-auto"
              >
                <Printer className="h-4 w-4" />
                {isEditMode ? "Save & Print" : "Save & Print"}
              </button>
              <GradientButton
                onClick={saveInvoice}
                disabled={(isEditMode ? !canEditInvoice : !canCreateInvoice) || hasStockErrors || loadingExistingInvoice}
                className="h-11 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <Save className="h-4 w-4" />
                {isEditMode ? "Save Changes" : "Save"}
              </GradientButton>
            </div>
          }
        />
      </div>
      <div className="print-hide">
        {loadingExistingInvoice ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Loading invoice details...
          </div>
        ) : null}
        {!(isEditMode ? canEditInvoice : canCreateInvoice) ? (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {isEditMode
            ? "Your role does not have invoice edit permission."
            : "Your role does not have invoice create permission."}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4">
          <Card className="p-5">
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
            <FormField label="Customer Search" required error={formErrors.customer}>
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
                  className="min-w-0 flex-1 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 sm:min-w-[260px]"
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
              {formErrors.customer ? <p className="mt-2 text-xs text-rose-600">{formErrors.customer}</p> : null}
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
                      GST split is calculated from company and customer country/state details after you enter a tax
                      rate on the line item. Same-state India uses CGST + SGST, otherwise IGST is applied.
                    </p>
                  ) : (
                    <FormField label="Tax Rate" hint={`Optional. Select default tax or type custom (${defaultRate}%)`}>
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
                          placeholder="Leave empty or select tax"
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FormField label="Invoice Number" required error={formErrors.invoiceNo}>
                    <input
                      value={invoiceNo}
                      onChange={(event) => {
                        clearFormError("invoiceNo");
                        setInvoiceNo(event.target.value);
                      }}
                      placeholder="Auto generated, editable if needed"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono text-slate-700 outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                    <p className="mt-1 text-xs text-slate-500">Invoice number is generated automatically, and you can edit it if needed.</p>
                    {formErrors.invoiceNo ? <p className="mt-1 text-xs text-rose-600">{formErrors.invoiceNo}</p> : null}
                  </FormField>
                  <FormField label="Invoice Date" required error={formErrors.invoiceDate}>
                    <DateInput
                      value={invoiceDate}
                      onRawChange={() => clearFormError("invoiceDate")}
                      onChange={(nextValue) => setInvoiceDate(nextValue)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                    {formErrors.invoiceDate ? <p className="mt-1 text-xs text-rose-600">{formErrors.invoiceDate}</p> : null}
                  </FormField>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">4. Items</h2>
                  <p className="text-xs text-slate-500">Add item rows, quantity, rate, tax and amount.</p>
                  <div className="mt-2 inline-flex rounded-xl border border-slate-200 bg-white p-1">
                    {["Product", "Service"].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setLineItemMode(mode);
                          setItemSearch("");
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                          lineItemMode === mode ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={addLine}
                  className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add line
                </button>
              </div>
              {formErrors.lines ? <p className="mt-2 text-xs text-rose-600">{formErrors.lines}</p> : null}

              <div className="mt-3 flex items-center gap-3">
                <div className="relative w-full max-w-sm">
                  <input
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder={
                      lineItemMode === "Service"
                        ? "Search by service ID or name..."
                        : "Search by product ID or name..."
                    }
                  />
                  {itemSearch.trim().length ? (
                    <div className="absolute z-10 mt-2 w-full rounded-2xl border border-slate-100 bg-white shadow-soft p-2 max-h-52 overflow-auto">
                      {filteredItems.length ? (
                        filteredItems.map((item) => {
                          const stockInfo = stockByItemId.get(item.id);
                          const itemType = normalizeInvoiceItemType(item?.type);
                          const maxAssignable =
                            itemType === "Product"
                              ? getMaxAssignableQty(item.id)
                              : Number.POSITIVE_INFINITY;
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
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-col gap-1">
                                  <span className="truncate">{formatItemSearchLabel(item)}</span>
                                  <span className={itemTypeBadgeClassName(itemType)}>{itemType}</span>
                                </div>
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
                <Card className="overflow-visible">
                  <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
                    <div className="overflow-x-auto">
                      <div className="min-w-[1280px]">
                        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5">
                          <div className={`${invoiceItemGridClassName} items-center text-center text-xs font-semibold text-slate-600`}>
                            <span>Item</span>
                            <span>{dynamicBatchColumnHeader}</span>
                            <span>Qty</span>
                            <span>Unit</span>
                            <span>Rate</span>
                            <span>Discount</span>
                            <span>Tax %</span>
                            <span>Net Amount</span>
                            <span>Total Amount</span>
                          </div>
                        </div>

                        {lines.length ? (
                          <div className="divide-y divide-slate-100">
                            {lines.map((r) => {
                              const selectedItem = itemById.get(String(r?.itemId || "")) || null;
                              const rowType = resolveLineItemType(r);
                              const qty = Number(r.qty || 0);
                              const rate = Number(r.rate || 0);
                              const discount = Number(r.discount || 0);
                              const taxRateValue = forceZeroTax ? 0 : Number(r.tax || 0);
                              const net = round2(Math.max(0, qty * rate - discount));
                              const total = round2(net + (net * taxRateValue) / 100);

                              return (
                                <div key={r.id} className="px-3 py-2.5">
                                  <div className={`${invoiceItemGridClassName} items-start text-center`}>
                                    <div className="min-w-0">
                                      <div className="relative">
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
                                          className={`${invoiceLineInputClassName} pr-9`}
                                          placeholder={
                                            rowType === "Service"
                                              ? "Search by service ID or name"
                                              : "Search by product ID or name"
                                          }
                                        />
                                        {(r.itemId || r.itemInput) ? (
                                          <button
                                            type="button"
                                            onMouseDown={(event) => {
                                              event.preventDefault();
                                              clearLineItemSelection(r.id);
                                              setActiveLineItemSearchId(r.id);
                                            }}
                                            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                            title="Clear selected item"
                                            aria-label="Clear selected item"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 flex items-center justify-center gap-2">
                                        <span className={itemTypeBadgeClassName(rowType)}>
                                          {selectedItem ? normalizeInvoiceItemType(selectedItem?.type) : rowType}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => removeLine(r.id)}
                                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>

                                    <div className="min-w-0">
                                      {rowType === "Service" ? (
                                        <input
                                          value={r.hsnInput || ""}
                                          onChange={(e) => updateLine(r.id, { hsnInput: e.target.value, selectedBatchId: "" })}
                                          className={invoiceLineInputClassName}
                                          placeholder="HSN / SAC"
                                        />
                                      ) : !r.itemId ? (
                                        <div className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-xs text-slate-400">
                                          Select product
                                        </div>
                                      ) : (() => {
                                        const batchRows = getOpenBatchRows(r.itemId);
                                        if (!batchRows.length) {
                                          return (
                                            <div className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-xs text-slate-400">
                                              No open batch
                                            </div>
                                          );
                                        }
                                        return (
                                          <select
                                            value={r.selectedBatchId || ""}
                                            onChange={(e) => handleLineBatchChange(r, e.target.value)}
                                            className={`${invoiceLineInputClassName} text-xs`}
                                          >
                                            <option value="">Select batch</option>
                                            {batchRows.map((row) => {
                                              const batchId = String(row.batch_id || "");
                                              const availableQty = getBatchAvailableForLine(r.itemId, batchId, r.id);
                                              const isUnavailable = availableQty <= 0;
                                              const suggested = Number(
                                                row?.suggested_sale_rate ?? row?.metadata?.suggestedSaleRate ?? 0
                                              );
                                              const label = `${String(row.source_document_no || "BATCH").slice(0, 14)} | Avl ${availableQty}${suggested > 0 ? ` | Sell ${money(suggested)}` : ""}`;
                                              return (
                                                <option key={`${r.id}-${batchId}`} value={batchId} disabled={isUnavailable}>
                                                  {label}
                                                </option>
                                              );
                                            })}
                                          </select>
                                        );
                                      })()}
                                    </div>

                                    <input
                                      type="text"
                                      value={displayNumericInput(r.qty)}
                                      onChange={(e) => {
                                        const raw = normalizeFormattedNumberInput(e.target.value);
                                        if (raw === "") {
                                          updateLine(r.id, { qty: raw });
                                          return;
                                        }
                                        const parsed = parseFormattedNumber(raw);
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
                                            showInsufficientStockAlert(
                                              r.itemId,
                                              maxAssignable,
                                              parsed,
                                              r.itemInput || "Item"
                                            );
                                            updateLine(r.id, { qty: maxAssignable });
                                            return;
                                          }
                                        }
                                        updateLine(r.id, { qty: raw });
                                      }}
                                      className={invoiceLineInputRightClassName}
                                      inputMode="decimal"
                                    />

                                    <input
                                      value={r.unit ?? ""}
                                      onChange={(e) => updateLine(r.id, { unit: e.target.value })}
                                      list="invoice-unit-options"
                                      className={invoiceLineInputClassName}
                                      placeholder="Unit"
                                    />

                                    <input
                                      type="text"
                                      value={displayNumericInput(r.rate)}
                                      onChange={(e) =>
                                        updateLine(r.id, { rate: normalizeFormattedNumberInput(e.target.value) })
                                      }
                                      className={invoiceLineInputRightClassName}
                                      inputMode="decimal"
                                    />

                                    <input
                                      type="text"
                                      value={displayNumericInput(r.discount)}
                                      onChange={(e) =>
                                        updateLine(r.id, { discount: normalizeFormattedNumberInput(e.target.value) })
                                      }
                                      className={invoiceLineInputRightClassName}
                                      inputMode="decimal"
                                    />

                                    <input
                                      value={forceZeroTax ? 0 : r.tax}
                                      onChange={(e) => {
                                        if (forceZeroTax) return;
                                        updateLine(r.id, { tax: e.target.value });
                                      }}
                                      className={`${invoiceLineInputRightClassName} disabled:bg-slate-100 disabled:text-slate-500`}
                                      disabled={forceZeroTax}
                                      inputMode="decimal"
                                    />

                                    <div className="flex h-10 min-w-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold tabular-nums text-slate-700">
                                      {money(net)}
                                    </div>

                                    <div className="flex h-10 min-w-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold tabular-nums text-slate-900">
                                      {money(total)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="px-3 py-6 text-sm text-slate-500">Add items to invoice</div>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
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
                            const itemType = normalizeInvoiceItemType(item?.type);
                            const stockInfo = stockByItemId.get(item.id);
                            const maxAssignable =
                              itemType === "Product"
                                ? getMaxAssignableQty(item.id, activeLineForSearch.id)
                                : Number.POSITIVE_INFINITY;
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
                                <div className="flex flex-col">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-col gap-1">
                                      <span className="truncate">{formatItemSearchLabel(item)}</span>
                                      <span className={itemTypeBadgeClassName(itemType)}>{itemType}</span>
                                    </div>
                                    {stockInfo ? (
                                      <span className={`text-[11px] font-semibold ${outOfStock ? "text-rose-600" : "text-slate-500"}`}>
                                        Remaining: {stockInfo.available}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-slate-400">Service / Not tracked</span>
                                    )}
                                  </div>
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
                <datalist id="invoice-unit-options">
                  {UNIT_OPTIONS.map((unitOption) => (
                    <option key={unitOption} value={unitOption} />
                  ))}
                </datalist>
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
                  <FormField label="Amount Received" required error={formErrors.paidAmount}>
                    <input
                      type="text"
                      value={displayNumericInput(paidAmount)}
                      onChange={(e) => {
                        clearFormError("paidAmount");
                        setPaidAmount(normalizeFormattedNumberInput(e.target.value));
                      }}
                      placeholder="Enter received amount"
                      inputMode="decimal"
                      className="numeric-input-uniform w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                    {formErrors.paidAmount ? <p className="mt-1 text-xs text-rose-600">{formErrors.paidAmount}</p> : null}
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
                  {customerAdvanceWallet > 0 ? (
                    <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Customer Advance Balance</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Available Advance Balance: {money(customerAdvanceWallet)}
                      </p>
                      <label className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                        <input
                          type="checkbox"
                          checked={useAvailableAdvance}
                          onChange={(event) => setUseAvailableAdvance(event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                        />
                        Use Available Advance Balance
                      </label>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                          <p>Invoice Total: <span className="font-semibold text-slate-900">{money(computed.grandTotal)}</span></p>
                          <p className="mt-1">Advance Used: <span className="font-semibold text-emerald-700">{money(advanceAppliedFromWallet)}</span></p>
                          <p className="mt-1">Updated Balance Due: <span className="font-semibold text-rose-700">{money(finalPayableAmount)}</span></p>
                        </div>
                        <div className="rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                          <p>Remaining Wallet Balance: <span className="font-semibold text-amber-700">{money(Math.max(0, customerAdvanceWallet - advanceAppliedFromWallet))}</span></p>
                          <p className="mt-1">Paid Now: <span className="font-semibold text-emerald-700">{money(paymentAmount)}</span></p>
                          <p className="mt-1">Final Payable: <span className="font-semibold text-rose-700">{money(finalPayableAmount)}</span></p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <FormField label="Payment Date" required error={formErrors.paymentDate}>
                    <DateInput
                      value={paymentDate}
                      onChange={(nextValue) => {
                        clearFormError("paymentDate");
                        setPaymentDate(nextValue);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    />
                    {formErrors.paymentDate ? <p className="mt-1 text-xs text-rose-600">{formErrors.paymentDate}</p> : null}
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
                    <FormField label="Cheque No" required error={formErrors.chequeNo} className="md:col-span-2">
                      <input
                        value={chequeNo}
                        onChange={(e) => {
                          clearFormError("chequeNo");
                          setChequeNo(e.target.value);
                        }}
                        placeholder="Enter cheque number"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                      />
                      {formErrors.chequeNo ? <p className="mt-1 text-xs text-rose-600">{formErrors.chequeNo}</p> : null}
                    </FormField>
                  ) : null}
                  {paymentMode === "Bank Transfer" ? (
                    <>
                      <FormField label="Bank Name" required error={formErrors.bankName}>
                        <input
                          value={bankName}
                          onChange={(e) => {
                            clearFormError("bankName");
                            setBankName(e.target.value);
                          }}
                          placeholder="Enter bank name"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                          style={{ "--tw-ring-color": UI.COLORS.ring }}
                        />
                        {formErrors.bankName ? <p className="mt-1 text-xs text-rose-600">{formErrors.bankName}</p> : null}
                      </FormField>
                      <FormField label="Bank Account" required error={formErrors.bankAccount}>
                        <input
                          value={bankAccount}
                          onChange={(e) => {
                            clearFormError("bankAccount");
                            setBankAccount(e.target.value);
                          }}
                          placeholder="Enter bank account"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                          style={{ "--tw-ring-color": UI.COLORS.ring }}
                        />
                        {formErrors.bankAccount ? <p className="mt-1 text-xs text-rose-600">{formErrors.bankAccount}</p> : null}
                      </FormField>
                    </>
                  ) : null}
                  {paymentMode === "Bank Transfer" ||
                  paymentMode === "Card" ||
                  paymentMode === "UPI" ||
                  paymentMode === "Online Gateway" ? (
                    <FormField label="Transaction ID" required error={formErrors.transactionId} className="md:col-span-2">
                      <input
                        value={transactionId}
                        onChange={(e) => {
                          clearFormError("transactionId");
                          setTransactionId(e.target.value);
                        }}
                        placeholder="Enter transaction ID"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                      />
                      {formErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{formErrors.transactionId}</p> : null}
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
                  <>
                    {customerAdvanceWallet > 0 ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">Customer Advance Balance</p>
                        <p className="mt-1 text-xs text-slate-600">
                          Available Advance Balance: {money(customerAdvanceWallet)}
                        </p>
                        <label className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={useAvailableAdvance}
                            onChange={(event) => setUseAvailableAdvance(event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                          />
                          Use Available Advance Balance
                        </label>
                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                            <p>Invoice Total: <span className="font-semibold text-slate-900">{money(computed.grandTotal)}</span></p>
                            <p className="mt-1">Advance Used: <span className="font-semibold text-emerald-700">{money(advanceAppliedFromWallet)}</span></p>
                          </div>
                          <div className="rounded-2xl border border-amber-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                            <p>Remaining Wallet Balance: <span className="font-semibold text-amber-700">{money(Math.max(0, customerAdvanceWallet - advanceAppliedFromWallet))}</span></p>
                            <p className="mt-1">Updated Balance Due: <span className="font-semibold text-rose-700">{money(finalPayableAmount)}</span></p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      Payment will stay pending. You can record it later in Payment In.
                    </p>
                  </>
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
              {customerAdvanceWallet > 0 ? (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Available Advance Balance</span>
                  <span className="font-semibold text-amber-700">{money(customerAdvanceWallet)}</span>
                </div>
              ) : null}
              {customerAdvanceWallet > 0 ? (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Use Available Advance</span>
                  <span className="font-semibold text-slate-900">
                    {useAvailableAdvance ? "Enabled" : "Disabled"}
                  </span>
                </div>
              ) : null}
              {advanceAppliedFromWallet > 0 ? (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Advance Used</span>
                  <span className="font-semibold text-emerald-700">{money(advanceAppliedFromWallet)}</span>
                </div>
              ) : null}
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
                  <span className="text-slate-600">Advance Added</span>
                  <span className="font-semibold text-emerald-700">{money(advanceAmount)}</span>
                </div>
              ) : null}
              {projectedAdvanceWallet > 0 || customerAdvanceWallet > 0 || advanceAppliedFromWallet > 0 ? (
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Remaining Wallet Balance</span>
                  <span className="font-semibold text-amber-700">{money(projectedAdvanceWallet)}</span>
                </div>
              ) : null}
              {customerAdvanceWallet > 0 || advanceAppliedFromWallet > 0 ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Available Advance</span>
                    <span className="font-semibold text-amber-700">{money(customerAdvanceWallet)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Advance Used</span>
                    <span className="font-semibold text-emerald-700">{money(advanceAppliedFromWallet)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Remaining Wallet Balance</span>
                    <span className="font-semibold text-amber-700">{money(Math.max(0, customerAdvanceWallet - advanceAppliedFromWallet))}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Final Payable Amount</span>
                    <span className="font-semibold text-rose-700">{money(finalPayableAmount)}</span>
                  </div>
                </div>
              ) : null}

              {customerAdvanceHistory.length ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-700">Advance Payment History</p>
                  </div>
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full min-w-[620px] text-left text-xs">
                      <thead className="bg-white text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 font-semibold">Invoice</th>
                          <th className="px-3 py-2 text-right font-semibold">Amount Added</th>
                          <th className="px-3 py-2 text-right font-semibold">Amount Used</th>
                          <th className="px-3 py-2 text-right font-semibold">Remaining Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerAdvanceHistory.map((entry) => (
                          <tr key={entry.id} className="border-t border-slate-200">
                            <td className="px-3 py-2 text-slate-700">{entry.date || "-"}</td>
                            <td className="px-3 py-2 text-slate-700">{entry.invoiceNo || "-"}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                              {entry.amountAdded > 0 ? money(entry.amountAdded) : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-sky-700">
                              {entry.amountUsed > 0 ? money(entry.amountUsed) : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-900">
                              {money(entry.remainingBalance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              </div>
            </div>
          </Card>
        </div>
      </div>
      </div>

      <Modal
        open={previewOpen}
        title="Invoice Preview"
        onClose={() => setPreviewOpen(false)}
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        }
      >
        <div className="rounded-3xl bg-white p-2 sm:p-4">
          <div className="invoice-preview">
            <InvoicePreview
              templateId={templateConfig.templateId}
              styleConfig={{
                primaryColor: templateConfig.primaryColor,
                bgColor: templateConfig.bgColor,
                fontFamily: templateConfig.fontFamily,
                logoUrl: templateConfig.logoUrl || company?.logoBase64 || "",
                logoPosition: templateConfig.logoPosition
              }}
              invoiceData={invoicePreviewData}
            />
          </div>
        </div>
      </Modal>

      {printInvoiceData ? (
        <div ref={printContainerRef} className="hidden print:block print-sheet">
          <div className="invoice-preview">
            <InvoicePreview
              templateId={templateConfig.templateId}
              styleConfig={{
                primaryColor: templateConfig.primaryColor,
                bgColor: templateConfig.bgColor,
                fontFamily: templateConfig.fontFamily,
                logoUrl: templateConfig.logoUrl || company?.logoBase64 || "",
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

