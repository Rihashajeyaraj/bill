import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import PageHeader from "../../components/PageHeader";
import DateInput from "../../components/DateInput";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote, upsertPartyRemote } from "../../modules/parties/store";
import { computeItemStock, listItems, syncItemsFromRemote } from "../../modules/items/store";
import {
  getCanonicalCountryName,
  listAllCountries,
  listStatesByCountry,
  resolveCountryIsoCode
} from "../../lib/geoData";
import {
  convertSalesProforma,
  salesProformaComputeTotals,
  salesProformaGetByIdRemote,
  salesProformaPeekNumber,
  salesProformaUpsert
} from "../../services/proformas.service";

function parseNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function lineAmount(line: any) {
  const qty = parseNumber(line?.qty);
  const rate = parseNumber(line?.rate);
  const discount = parseNumber(line?.discountAmount);
  const taxable = Math.max(0, qty * rate - discount);
  const tax = (taxable * parseNumber(line?.taxRate)) / 100;
  return Math.max(0, taxable + tax);
}

function round2(value: unknown) {
  return Math.round((parseNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizePhoneForLookup(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function extractTenDigitPhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function queryLooksPhoneLike(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^[\d\s()+-]+$/.test(text);
}

function customerAddressSummary(customer: any) {
  return [customer?.address, customer?.city, customer?.state, customer?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeItemName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getItemSearchIdentifier(item: any) {
  const itemCode = String(item?.itemCode || "").trim();
  if (itemCode) return itemCode;
  return String(item?.id || "").trim();
}

function formatItemSearchLabel(item: any) {
  const identifier = getItemSearchIdentifier(item);
  const name = String(item?.name || "").trim();
  if (identifier && name) return `${identifier} | ${name}`;
  return name || identifier;
}

function normalizeInvoiceItemType(value: unknown) {
  return String(value || "").trim().toLowerCase() === "service" ? "Service" : "Product";
}

function itemTypeBadgeClassName(type: unknown) {
  return normalizeInvoiceItemType(type) === "Service"
    ? "rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700"
    : "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700";
}

function findItemBySearchInput(items: any[], value: unknown) {
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

function itemMatchesSearchQuery(item: any, query: unknown) {
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

function createEmptyLine() {
  return {
    id: `spf_line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: "",
    itemCode: "",
    itemInput: "",
    description: "",
    qty: "",
    unit: "pcs",
    rate: "",
    discountAmount: "",
    discountPercent: "",
    taxRate: ""
  };
}

function validateSalesProformaForm(form: any) {
  const errors: any = {};
  const lineErrors: Record<string, { item?: string; qty?: string }> = {};
  let hasBlockingLineError = false;

  const proformaDate = String(form?.proformaDate || "").trim();
  if (!proformaDate) {
    errors.proformaDate = "Pro Forma Date is required.";
  }

  if (!String(form?.partyId || "").trim()) {
    errors.partyId = "Customer is required.";
  }

  let validLineCount = 0;
  const lines = Array.isArray(form?.lines) ? form.lines : [];
  lines.forEach((line: any, index: number) => {
    const lineId = String(line?.id || `line_${index + 1}`);
    const itemText = String(line?.itemId || line?.itemInput || line?.description || "").trim();
    const qty = Math.max(0, parseNumber(line?.qty));
    const nextLineErrors: { item?: string; qty?: string } = {};

    if (!itemText && qty > 0) {
      nextLineErrors.item = "Item is required.";
      hasBlockingLineError = true;
    }
    if (itemText && qty <= 0) {
      nextLineErrors.qty = "Qty must be greater than 0.";
      hasBlockingLineError = true;
    }

    if (itemText && qty > 0) {
      validLineCount += 1;
    }

    if (nextLineErrors.item || nextLineErrors.qty) {
      lineErrors[lineId] = nextLineErrors;
    }
  });

  if (!validLineCount) {
    errors.lines = "Add at least one line item with item and qty.";
  }

  if (Object.keys(lineErrors).length) {
    errors.lineErrors = lineErrors;
  }

  const hasErrors =
    !!errors.proformaDate ||
    !!errors.partyId ||
    !!errors.lines ||
    (!validLineCount && hasBlockingLineError);
  errors.hasErrors = hasErrors;
  return errors;
}

export default function SalesProformaEditor() {
  const { id = "new" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = String(id || "") === "new";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [customerCreateLoading, setCustomerCreateLoading] = useState(false);
  const [customerCreateDraft, setCustomerCreateDraft] = useState({
    name: "",
    phone: "",
    country: "",
    state: ""
  });
  const [customerCountryMenuOpen, setCustomerCountryMenuOpen] = useState(false);
  const [customerStateMenuOpen, setCustomerStateMenuOpen] = useState(false);
  const [activeLineItemSearchId, setActiveLineItemSearchId] = useState("");
  const [lineItemPopover, setLineItemPopover] = useState({
    top: 0,
    left: 0,
    width: 280,
    openUpward: false,
    maxHeight: 200
  });
  const [form, setForm] = useState<any>({
    id: "",
    proformaNo: "",
    proformaDate: "",
    validTill: "",
    dueDate: "",
    partyId: "",
    partyName: "",
    country: "",
    taxMode: "",
    supplyType: "",
    status: "DRAFT",
    convertedDocumentId: "",
    convertedAt: "",
    notes: "",
    terms: "",
    lines: [createEmptyLine()]
  });

  const selectedParty = useMemo(
    () => customers.find((entry) => String(entry?.id || "") === String(form.partyId || "")) || null,
    [customers, form.partyId]
  );
  const isReadOnlyView = String(searchParams.get("mode") || "").toLowerCase() === "view";
  const status = String(form?.status || "").toUpperCase();
  const isConverted = status === "CONVERTED" || !!String(form?.convertedDocumentId || "").trim();
  const locked = isConverted || isReadOnlyView;
  const totals = useMemo(
    () => salesProformaComputeTotals(form.lines || [], 0),
    [form.lines]
  );
  const stockByItemId = useMemo(() => {
    const lookup = new Map<string, { available: number; availableRaw: number; lowStock: boolean }>();
    (items || []).forEach((item: any) => {
      if (normalizeInvoiceItemType(item?.type) !== "Product") return;
      lookup.set(String(item?.id || ""), computeItemStock(item));
    });
    return lookup;
  }, [items]);
  const validation = useMemo(() => validateSalesProformaForm(form), [form]);
  const canSave = !saving && !loading && !locked && !validation.hasErrors;
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
  const lineItemInputClassName =
    "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm leading-5 outline-none";
  const lineItemInputRightClassName = `${lineItemInputClassName} text-right`;
  const customerSearchTerm = String(customerLookupQuery || "").trim();
  const customerLookupResults = useMemo(() => {
    const query = customerSearchTerm.toLowerCase();
    if (!query) return [];
    const phoneSearch = queryLooksPhoneLike(customerSearchTerm);
    const normalizedPhoneQuery = normalizePhoneForLookup(customerSearchTerm);
    return customers
      .filter((customer) => {
        if (phoneSearch) {
          const customerPhone = normalizePhoneForLookup(customer?.phone);
          return normalizedPhoneQuery && customerPhone && customerPhone.includes(normalizedPhoneQuery);
        }
        const text = [customer?.name, customer?.email, customer?.address]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const customerPhone = normalizePhoneForLookup(customer?.phone);
        return (
          text.includes(query) ||
          (normalizedPhoneQuery && customerPhone && customerPhone.includes(normalizedPhoneQuery))
        );
      })
      .slice(0, 8);
  }, [customers, customerSearchTerm]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        await Promise.all([syncPartiesFromRemote(), syncItemsFromRemote()]);
        if (!mounted) return;
        const partyRows = listParties().filter((entry) => {
          const partyType = String(entry?.type || "").toLowerCase();
          return partyType === "customer" || partyType === "both";
        });
        const itemRows = listItems().filter((entry) => entry?.status !== "Inactive");
        setCustomers(partyRows);
        setItems(itemRows);

        if (isNew) {
          const nextNo = await salesProformaPeekNumber(new Date().toISOString().slice(0, 10));
          if (!mounted) return;
          setForm((prev: any) => ({
            ...prev,
            proformaNo: nextNo || prev.proformaNo
          }));
        } else {
          const found = await salesProformaGetByIdRemote(id);
          if (!mounted) return;
          if (!found) {
            toast.warning("Not found", "Pro Forma Invoice does not exist.");
            navigate("/app/sales/proformas/history", { replace: true });
            return;
          }
          setForm({
            id: found.id || "",
            proformaNo: found.proformaNo || "",
            proformaDate: found.proformaDate || "",
            validTill: found.validTill || "",
            dueDate: found.dueDate || "",
            partyId: found.partyId || "",
            partyName: found.partyName || "",
            country: found.country || "",
            taxMode: found.taxMode || "",
            supplyType: found.supplyType || "",
            status: found.status || "DRAFT",
            convertedDocumentId: found.convertedDocumentId || "",
            convertedAt: found.convertedAt || "",
            notes: found.notes || "",
            terms: found.terms || "",
            lines:
              Array.isArray(found.lines) && found.lines.length
                ? found.lines.map((line: any) => {
                    const item = itemRows.find((entry) => String(entry?.id || "") === String(line?.itemId || ""));
                    return {
                      id: line?.id || createEmptyLine().id,
                      itemId: line?.itemId || "",
                      itemCode: line?.itemCode || item?.itemCode || "",
                      itemInput: item?.name || line?.description || "",
                      description: line?.description || item?.name || "",
                      qty: parseNumber(line?.qty),
                      unit: line?.unit ?? "pcs",
                      rate: parseNumber(line?.rate),
                      discountAmount: parseNumber(line?.discountAmount),
                      discountPercent: parseNumber(line?.discountPercent),
                      taxRate: parseNumber(line?.taxRate)
                    };
                  })
                : [createEmptyLine()]
          });
        }
      } catch (error: any) {
        if (!mounted) return;
        toast.error("Failed to load Pro Forma Invoice", error?.message || "Please retry.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [id, isNew, navigate, toast]);

  function updateForm(patch: any) {
    setForm((prev: any) => ({ ...prev, ...patch }));
  }

  function updateLine(lineId: string, patch: any) {
    setForm((prev: any) => ({
      ...prev,
      lines: (prev.lines || []).map((line: any) => {
        if (line.id !== lineId) return line;
        const nextPatch = typeof patch === "function" ? patch(line) : patch;
        return { ...line, ...nextPatch };
      })
    }));
  }

  function removeLine(lineId: string) {
    setForm((prev: any) => {
      const nextLines = (prev.lines || []).filter((line: any) => line.id !== lineId);
      return {
        ...prev,
        lines: nextLines.length ? nextLines : [createEmptyLine()]
      };
    });
  }

  function addLine() {
    setForm((prev: any) => ({ ...prev, lines: [...(prev.lines || []), createEmptyLine()] }));
  }

  function applyCustomerSelection(nextCustomer: any) {
    if (!nextCustomer) return;
    setCustomerSearchError("");
    updateForm({
      partyId: nextCustomer.id || "",
      partyName: nextCustomer.name || nextCustomer.displayName || "",
      country: nextCustomer.country || form.country || ""
    });
    setCustomerLookupQuery("");
    setCustomerCountryMenuOpen(false);
    setCustomerStateMenuOpen(false);
  }

  function handleCustomerLookupChange(value: string) {
    setCustomerLookupQuery(value);
    setCustomerCreateDraft((prev) => ({
      ...prev,
      name: queryLooksPhoneLike(value) ? prev.name : String(value || "").trim(),
      phone: extractTenDigitPhone(value) || prev.phone,
      country: prev.country || form.country || ""
    }));
    setCustomerSearchError("");
  }

  function handleCustomerSearch() {
    const query = String(customerSearchTerm || "").trim();
    if (query.length < 1) {
      setCustomerSearchError("Enter customer name, phone, email, or address to search.");
      return;
    }
    if (customerLookupResults.length === 1) {
      applyCustomerSelection(customerLookupResults[0]);
      return;
    }
    if (!customerLookupResults.length) {
      const phoneDraft = queryLooksPhoneLike(query)
        ? String(query || "").replace(/\D/g, "").slice(0, 10)
        : "";
      setCustomerCreateDraft((prev) => ({
        ...prev,
        name: queryLooksPhoneLike(query) ? prev.name : query,
        phone: phoneDraft || prev.phone,
        country: prev.country || form.country || ""
      }));
      setCustomerSearchError("No customer found for this search.");
      return;
    }
    setCustomerSearchError("Multiple customers found. Choose one from the list below.");
  }

  async function handleCreateCustomer() {
    const name = String(customerCreateDraft.name || "").trim();
    const phone = extractTenDigitPhone(customerCreateDraft.phone);
    const draftCountry = String(customerCreateDraft.country || form.country || "").trim();
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
        openingBalanceType: "Receivable",
        creditLimitEnabled: false,
        creditLimitType: "Amount",
        creditLimit: 0,
        creditLimitDays: 0
      });
      const nextCustomers = listParties().filter((entry) => {
        const partyType = String(entry?.type || "").toLowerCase();
        return partyType === "customer" || partyType === "both";
      });
      setCustomers(nextCustomers);
      applyCustomerSelection(created);
      setCustomerLookupQuery("");
      setCustomerCreateDraft({
        name: "",
        phone: "",
        country: form.country || "",
        state: ""
      });
      setCustomerCountryMenuOpen(false);
      setCustomerStateMenuOpen(false);
      toast.success("Customer created", `${created.name} added successfully.`);
    } catch (error: any) {
      setCustomerSearchError(error?.message || "Failed to create customer.");
    } finally {
      setCustomerCreateLoading(false);
    }
  }

  function applyCustomerCreateCountry(nextCountry: string) {
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

  function applyCustomerCreateState(nextState: string) {
    setCustomerCreateDraft((prev) => ({ ...prev, state: nextState }));
    setCustomerStateMenuOpen(false);
  }

  function resetCustomer() {
    setCustomerSearchError("");
    setCustomerLookupQuery("");
    updateForm({
      partyId: "",
      partyName: "",
      country: ""
    });
    setCustomerCreateDraft({
      name: "",
      phone: "",
      country: form.country || "",
      state: ""
    });
    setCustomerCountryMenuOpen(false);
    setCustomerStateMenuOpen(false);
  }

  function selectLineItem(line: any, item: any) {
    if (!line || !item) return;
    updateLine(line.id, {
      itemId: item?.id || "",
      itemCode: item?.itemCode || "",
      itemInput: item?.name || "",
      description: item?.name || "",
      unit: item?.unit ?? line?.unit ?? "pcs",
      rate: parseNumber(item?.salesRate ?? item?.price ?? item?.sale_price ?? line?.rate),
      taxRate: parseNumber(item?.taxRate ?? item?.metadata?.taxRate ?? item?.tax_rate ?? line?.taxRate)
    });
  }

  function handleItemInput(lineId: string, inputValue: string) {
    const match = findItemBySearchInput(items, inputValue);
    updateLine(lineId, (line: any) => {
      if (!match) {
        return {
          ...line,
          itemInput: inputValue,
          itemId: "",
          itemCode: "",
          description: String(inputValue || "").trim()
        };
      }
      return {
        ...line,
        itemInput: match?.name || inputValue,
        itemId: match?.id || "",
        itemCode: match?.itemCode || "",
        description: match?.name || "",
        unit: match?.unit ?? line?.unit ?? "pcs",
        rate: parseNumber(match?.salesRate ?? match?.price ?? match?.sale_price ?? line?.rate),
        taxRate: parseNumber(match?.taxRate ?? match?.metadata?.taxRate ?? match?.tax_rate ?? line?.taxRate)
      };
    });
  }

  function clearLineItemSelection(lineId: string) {
    updateLine(lineId, {
      itemId: "",
      itemCode: "",
      itemInput: "",
      description: ""
    });
  }

  function getLineItemSearchResults(line: any) {
    const query = normalizeItemName(line?.itemInput);
    if (!query) return [];
    return (items || []).filter((item) => itemMatchesSearchQuery(item, query)).slice(0, 8);
  }

  function updateLineItemPopoverPosition(inputElement?: HTMLInputElement | null) {
    const target =
      inputElement ||
      (activeLineItemSearchId
        ? (document.getElementById(`sales-proforma-item-input-${activeLineItemSearchId}`) as HTMLInputElement | null)
        : null);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const margin = 8;
    const gap = 6;
    const desiredHeight = 200;
    const width = Math.max(260, Math.round(rect.width));
    const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin - gap);
    const spaceAbove = Math.max(0, rect.top - margin - gap);
    const openUpward = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const fallbackSpace = Math.max(spaceAbove, spaceBelow);
    const effectiveSpace = availableSpace > 0 ? availableSpace : fallbackSpace;
    const maxHeight = Math.max(80, Math.min(desiredHeight, Math.floor(effectiveSpace || desiredHeight)));
    setLineItemPopover({
      top: openUpward ? Math.round(rect.top - gap) : Math.round(rect.bottom + gap),
      left: Math.round(left),
      width,
      openUpward,
      maxHeight
    });
  }

  const activeLineForSearch = useMemo(
    () => (form.lines || []).find((line: any) => String(line?.id || "") === String(activeLineItemSearchId || "")) || null,
    [form.lines, activeLineItemSearchId]
  );
  const activeLineSearchResults = useMemo(() => {
    if (!activeLineForSearch) return [];
    return getLineItemSearchResults(activeLineForSearch);
  }, [activeLineForSearch, items]);

  useEffect(() => {
    if (!activeLineItemSearchId) return undefined;
    updateLineItemPopoverPosition();
    const syncPopoverPosition = () => {
      updateLineItemPopoverPosition();
    };
    window.addEventListener("resize", syncPopoverPosition);
    window.addEventListener("scroll", syncPopoverPosition, true);
    return () => {
      window.removeEventListener("resize", syncPopoverPosition);
      window.removeEventListener("scroll", syncPopoverPosition, true);
    };
  }, [activeLineItemSearchId, activeLineForSearch?.itemInput, activeLineSearchResults.length]);

  async function onSave() {
    if (locked) return;
    if (validation.hasErrors) {
      toast.warning("Missing required fields", "Fix the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const cleanedLines = (form.lines || [])
        .map((line: any, index: number) => {
          const qty = Math.max(0, parseNumber(line?.qty));
          const rate = Math.max(0, parseNumber(line?.rate));
          const baseAmount = round2(qty * rate);
          let discountAmount = Math.max(0, parseNumber(line?.discountAmount));
          let discountPercent = Math.max(0, parseNumber(line?.discountPercent));
          if (discountAmount <= 0 && discountPercent > 0) {
            discountAmount = round2((baseAmount * discountPercent) / 100);
          }
          if (discountPercent <= 0 && discountAmount > 0 && baseAmount > 0) {
            discountPercent = round2((discountAmount / baseAmount) * 100);
          }
          if (discountAmount > baseAmount) {
            discountAmount = baseAmount;
            discountPercent = baseAmount > 0 ? 100 : 0;
          }
          const taxableAmount = Math.max(0, baseAmount - discountAmount);
          const taxRate = Math.max(0, parseNumber(line?.taxRate));
          const lineTotal = round2(taxableAmount + (taxableAmount * taxRate) / 100);

          return {
            ...line,
            description: String(line?.itemInput || line?.description || "").trim(),
            qty,
            rate,
            discountAmount,
            discountPercent,
            taxableAmount,
            taxRate,
            lineTotal,
            lineNo: index + 1
          };
        })
        .filter((line: any) => line.qty > 0 && (line.itemId || line.itemInput || line.description));
      if (!cleanedLines.length) {
        toast.warning("Line items required", "Add at least one line item before saving.");
        return;
      }

      const result = await salesProformaUpsert({
        ...form,
        partyName: selectedParty?.name || selectedParty?.displayName || form.partyName || "",
        country: selectedParty?.country || form.country || "",
        lines: cleanedLines,
        totals
      });
      toast.success("Pro Forma Invoice saved", result?.proformaNo || "Saved successfully.");
      if (isNew && result?.id) {
        navigate(`/app/sales/proformas/${encodeURIComponent(result.id)}`, { replace: true });
      } else {
        const refreshed = await salesProformaGetByIdRemote(result?.id || form.id);
        if (refreshed) {
          updateForm({
            id: refreshed.id || form.id,
            proformaNo: refreshed.proformaNo || form.proformaNo,
            status: refreshed.status || form.status,
            convertedDocumentId: refreshed.convertedDocumentId || form.convertedDocumentId,
            convertedAt: refreshed.convertedAt || form.convertedAt
          });
        }
      }
    } catch (error: any) {
      toast.error("Save failed", error?.message || "Could not save Pro Forma Invoice.");
    } finally {
      setSaving(false);
    }
  }

  async function onConvert() {
    if (isReadOnlyView) return;
    if (isNew || !form.id) return;
    if (isConverted) {
      toast.warning("Already converted", "This Pro Forma Invoice has already been converted.");
      return;
    }
    if (status === "EXPIRED") {
      toast.warning("Expired Pro Forma Invoice", "Expired Pro Forma Invoices cannot be converted.");
      return;
    }
    setConverting(true);
    try {
      const result = await convertSalesProforma(form.id);
      const refreshed = await salesProformaGetByIdRemote(form.id);
      if (refreshed) {
        setForm((prev: any) => ({
          ...prev,
          status: refreshed.status || "CONVERTED",
          convertedDocumentId: refreshed.convertedDocumentId || prev.convertedDocumentId,
          convertedAt: refreshed.convertedAt || prev.convertedAt
        }));
      } else {
        setForm((prev: any) => ({
          ...prev,
          status: "CONVERTED"
        }));
      }
      toast.success(
        "Converted to invoice",
        result?.invoiceNo ? `Created invoice ${result.invoiceNo}.` : "Invoice created successfully."
      );
    } catch (error: any) {
      toast.error("Conversion failed", error?.message || "Could not convert Pro Forma Invoice.");
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Pro Forma Invoice"
        subtitle="PRO FORMA INVOICE (Not a Tax Invoice)"
        right={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/app/sales/proformas/history")}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              History
            </button>
            {!isNew && !isReadOnlyView ? (
              <button
                type="button"
                onClick={() => void onConvert()}
                disabled={converting || isConverted || status === "EXPIRED"}
                className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {converting ? "Converting..." : "Convert to Invoice"}
              </button>
            ) : null}
            {!isReadOnlyView ? (
              <GradientButton
                onClick={() => void onSave()}
                disabled={!canSave}
                className="disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </GradientButton>
            ) : null}
          </div>
        }
      />

      {isConverted ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This Pro Forma Invoice is converted and is read-only.
        </div>
      ) : null}
      {!isConverted && isReadOnlyView ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Read-only view mode. Use Edit from history to modify this Pro Forma Invoice.
        </div>
      ) : null}

      <Card className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading Pro Forma Invoice details...</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm text-slate-600">
                Pro Forma Invoice No
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                  value={form.proformaNo || ""}
                  disabled
                  readOnly
                  title="Auto-generated"
                />
              </label>
              <label className="text-sm text-slate-600">
                Pro Forma Date
                <DateInput
                  className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm ${
                    validation?.proformaDate ? "border-rose-300" : "border-slate-200"
                  }`}
                  value={form.proformaDate || ""}
                  disabled={locked}
                  onChange={(nextValue) => updateForm({ proformaDate: nextValue })}
                />
                {validation?.proformaDate ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{validation.proformaDate}</p>
                ) : null}
              </label>
              <label className="text-sm text-slate-600">
                Valid Till
                <DateInput
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.validTill || ""}
                  disabled={locked}
                  onChange={(nextValue) => updateForm({ validTill: nextValue })}
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="text-sm text-slate-600">
                  Search Customer
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={customerLookupQuery}
                    disabled={locked}
                    onChange={(event) => handleCustomerLookupChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCustomerSearch();
                      }
                    }}
                    placeholder="Search by name, phone, email, or address"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={handleCustomerSearch}
                    disabled={loading || locked}
                    className="inline-flex h-[42px] items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Search className="h-4 w-4" />
                    Search
                  </button>
                  {form.partyId ? (
                    <button
                      type="button"
                      onClick={resetCustomer}
                      disabled={locked}
                      className="inline-flex h-[42px] items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              {customerSearchError ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{customerSearchError}</p>
              ) : null}
              {validation?.partyId ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{validation.partyId}</p>
              ) : null}

              {selectedParty ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                  <p className="font-semibold">{selectedParty?.name || selectedParty?.displayName || "-"}</p>
                  <p className="mt-1">{selectedParty?.phone || "-"}</p>
                  <p className="mt-1">{customerAddressSummary(selectedParty) || "-"}</p>
                </div>
              ) : null}

              {customerSearchTerm ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Matching Customers
                  </p>
                  {customerLookupResults.length ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {customerLookupResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => applyCustomerSelection(customer)}
                          disabled={locked}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30 disabled:cursor-not-allowed disabled:opacity-70"
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
                    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                      <p>No customer found for this search.</p>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          value={customerCreateDraft.name}
                          onChange={(event) =>
                            setCustomerCreateDraft((prev) => ({ ...prev, name: event.target.value }))
                          }
                          disabled={locked}
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
                          disabled={locked}
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
                            disabled={locked}
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
                            disabled={locked}
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
                        disabled={customerCreateLoading || locked}
                        className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {customerCreateLoading ? "Creating..." : "Create Customer"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Line Items</p>
                  <p className="text-xs text-slate-500">Invoice-style editable line item table.</p>
                  {validation?.lines ? (
                    <p className="mt-1 text-xs font-medium text-rose-600">{validation.lines}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={locked}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Line
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-[1080px] w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "12%" }} />
                  </colgroup>
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 align-middle font-semibold">Item</th>
                      <th className="px-3 py-2.5 align-middle text-right font-semibold">Qty</th>
                      <th className="px-3 py-2.5 align-middle font-semibold">Unit</th>
                      <th className="px-3 py-2.5 align-middle text-right font-semibold">Rate</th>
                      <th className="px-3 py-2.5 align-middle text-right font-semibold">Discount %</th>
                      <th className="px-3 py-2.5 align-middle text-right font-semibold">Discount Amt</th>
                      <th className="px-3 py-2.5 align-middle text-right font-semibold">Tax %</th>
                      <th className="px-3 py-2.5 align-middle text-right font-semibold">Amount</th>
                      <th className="px-3 py-2.5 align-middle font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.lines || []).map((line: any) => {
                      const lineError = validation?.lineErrors?.[String(line.id)] || {};
                      return (
                      <tr key={line.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <div className="relative">
                            <input
                              id={`sales-proforma-item-input-${line.id}`}
                              className={`${lineItemInputClassName} pr-9 ${
                                lineError?.item ? "border-rose-300" : "border-slate-200"
                              }`}
                              value={line.itemInput || ""}
                              disabled={locked}
                              placeholder="Search by product ID or name"
                              onFocus={(event) => {
                                setActiveLineItemSearchId(line.id);
                                updateLineItemPopoverPosition(event.currentTarget);
                              }}
                              onBlur={() => {
                                window.setTimeout(() => {
                                  setActiveLineItemSearchId((current) => (current === line.id ? "" : current));
                                }, 120);
                              }}
                              onChange={(event) => {
                                setActiveLineItemSearchId(line.id);
                                handleItemInput(line.id, event.target.value);
                                updateLineItemPopoverPosition(event.currentTarget);
                              }}
                            />
                            {(line.itemId || line.itemInput) ? (
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
                            {line.itemCode ? (
                              <p className="mt-1 text-[11px] text-slate-500">Code: {line.itemCode}</p>
                            ) : null}
                            {lineError?.item ? (
                              <p className="mt-1 text-[11px] font-medium text-rose-600">{lineError.item}</p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.001"
                            className={`${lineItemInputRightClassName} ${
                              lineError?.qty ? "border-rose-300" : "border-slate-200"
                            }`}
                            value={typeof line.qty === "number" ? (line.qty === 0 ? "" : line.qty) : (line.qty ?? "")}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { qty: event.target.value })}
                          />
                          {lineError?.qty ? (
                            <p className="mt-1 text-[11px] font-medium text-rose-600">{lineError.qty}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={lineItemInputClassName}
                            value={line.unit ?? ""}
                            disabled={locked}
                            placeholder="Unit"
                            onChange={(event) => updateLine(line.id, { unit: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={lineItemInputRightClassName}
                            value={typeof line.rate === "number" ? (line.rate === 0 ? "" : line.rate) : (line.rate ?? "")}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { rate: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={lineItemInputRightClassName}
                            value={
                              typeof line.discountPercent === "number"
                                ? (line.discountPercent === 0 ? "" : line.discountPercent)
                                : (line.discountPercent ?? "")
                            }
                            disabled={locked}
                            onChange={(event) => {
                              const discountPercent = Math.max(0, parseNumber(event.target.value));
                              const baseAmount = Math.max(0, parseNumber(line.qty) * parseNumber(line.rate));
                              const discountAmount = round2((baseAmount * discountPercent) / 100);
                              updateLine(line.id, { discountPercent, discountAmount });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={lineItemInputRightClassName}
                            value={
                              typeof line.discountAmount === "number"
                                ? (line.discountAmount === 0 ? "" : line.discountAmount)
                                : (line.discountAmount ?? "")
                            }
                            disabled={locked}
                            onChange={(event) => {
                              const baseAmount = Math.max(0, parseNumber(line.qty) * parseNumber(line.rate));
                              const rawAmount = Math.max(0, parseNumber(event.target.value));
                              const discountAmount = baseAmount > 0 ? Math.min(baseAmount, rawAmount) : rawAmount;
                              const discountPercent = baseAmount > 0 ? round2((discountAmount / baseAmount) * 100) : 0;
                              updateLine(line.id, { discountAmount, discountPercent });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={lineItemInputRightClassName}
                            value={typeof line.taxRate === "number" ? (line.taxRate === 0 ? "" : line.taxRate) : (line.taxRate ?? "")}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { taxRate: event.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex h-10 items-center justify-end rounded-xl border border-slate-200 bg-slate-50 px-3 text-right font-semibold text-slate-900">
                            {lineAmount(line).toFixed(2)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            disabled={locked}
                            className="h-10 w-full rounded-xl border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {activeLineForSearch &&
              activeLineItemSearchId &&
              normalizeItemName(activeLineForSearch.itemInput).length
                ? createPortal(
                    <div
                      className="fixed z-[130] overflow-auto rounded-xl border border-slate-100 bg-white p-1.5 shadow-soft"
                      style={{
                        top: `${lineItemPopover.top}px`,
                        left: `${lineItemPopover.left}px`,
                        width: `${lineItemPopover.width}px`,
                        maxHeight: `${lineItemPopover.maxHeight}px`,
                        transform: lineItemPopover.openUpward ? "translateY(-100%)" : "none"
                      }}
                    >
                      {activeLineSearchResults.length ? (
                        activeLineSearchResults.map((item) => {
                          const itemType = normalizeInvoiceItemType(item?.type);
                          const stockInfo = stockByItemId.get(String(item?.id || ""));
                          const outOfStock = itemType === "Product" && Number(stockInfo?.available || 0) <= 0;
                          const selected = String(activeLineForSearch?.itemId || "") === String(item?.id || "");
                          return (
                            <button
                              key={`sales-proforma-floating-${activeLineForSearch.id}-${item.id}`}
                              type="button"
                              disabled={outOfStock}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                if (outOfStock) return;
                                selectLineItem(activeLineForSearch, item);
                                setActiveLineItemSearchId("");
                              }}
                              className={`w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${
                                selected ? "ring-1 ring-slate-200" : ""
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-col gap-1">
                                  <span className="truncate text-sm text-slate-800">{formatItemSearchLabel(item)}</span>
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
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Sub Total</p>
                <p className="font-semibold text-slate-900">{totals.subTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Tax Total</p>
                <p className="font-semibold text-slate-900">{totals.taxTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Grand Total</p>
                <p className="font-semibold text-slate-900">{totals.grandTotal.toFixed(2)}</p>
              </div>
            </div>

            <label className="block text-sm text-slate-600">
              Notes
              <textarea
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                rows={3}
                value={form.notes || ""}
                disabled={locked}
                onChange={(event) => updateForm({ notes: event.target.value })}
              />
            </label>
          </div>
        )}
      </Card>
    </div>
  );
}
