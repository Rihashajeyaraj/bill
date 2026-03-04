import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote, upsertPartyRemote } from "../../modules/parties/store";
import { listItems, syncItemsFromRemote } from "../../modules/items/store";
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
    qty: 1,
    unit: "pcs",
    rate: 0,
    discountAmount: 0,
    discountPercent: 0,
    taxRate: 0
  };
}

export default function SalesProformaEditor() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = String(id || "") === "new";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customerSearchPhone, setCustomerSearchPhone] = useState("");
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
  const [form, setForm] = useState<any>({
    id: "",
    proformaNo: "",
    proformaDate: new Date().toISOString().slice(0, 10),
    validTill: "",
    dueDate: "",
    partyId: "",
    partyName: "",
    country: "",
    taxMode: "",
    supplyType: "",
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
  const locked = !!String(form?.convertedDocumentId || "").trim();
  const totals = useMemo(
    () => salesProformaComputeTotals(form.lines || [], 0),
    [form.lines]
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
  const customerSearchTerm = useMemo(() => {
    const lookupText = String(customerLookupQuery || "").trim();
    if (lookupText) return lookupText;
    return String(customerSearchPhone || "").trim();
  }, [customerLookupQuery, customerSearchPhone]);
  const customerLookupResults = useMemo(() => {
    const query = customerSearchTerm.toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(customerSearchTerm);
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
            proformaDate: found.proformaDate || new Date().toISOString().slice(0, 10),
            validTill: found.validTill || "",
            dueDate: found.dueDate || "",
            partyId: found.partyId || "",
            partyName: found.partyName || "",
            country: found.country || "",
            taxMode: found.taxMode || "",
            supplyType: found.supplyType || "",
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
                      qty: parseNumber(line?.qty) || 1,
                      unit: line?.unit || "pcs",
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

  useEffect(() => {
    if (!selectedParty?.phone) return;
    setCustomerSearchPhone(String(selectedParty.phone).replace(/\D/g, "").slice(-10));
  }, [selectedParty?.phone]);

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

  function handleCustomerPhoneChange(value: string) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    setCustomerSearchPhone(digits);
    setCustomerCreateDraft((prev) => ({
      ...prev,
      phone: digits || prev.phone,
      country: prev.country || form.country || ""
    }));
    setCustomerSearchError("");
    if (
      form.partyId &&
      normalizePhoneForLookup(digits) !== normalizePhoneForLookup(selectedParty?.phone || "")
    ) {
      updateForm({
        partyId: "",
        partyName: "",
        country: form.country || ""
      });
    }
  }

  function handleCustomerLookupChange(value: string) {
    setCustomerLookupQuery(value);
    setCustomerSearchPhone(extractTenDigitPhone(value));
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
      setCustomerSearchError("Enter mobile number or name/email/address to search.");
      return;
    }
    if (queryLooksPhoneLike(query)) {
      const phoneDigits = extractTenDigitPhone(query);
      if (!phoneDigits) {
        setCustomerSearchError("Enter a valid 10-digit customer mobile number.");
        return;
      }
      const normalizedQuery = normalizePhoneForLookup(phoneDigits);
      const matchedCustomer = customers.find(
        (customer) => normalizePhoneForLookup(customer?.phone) === normalizedQuery
      );
      if (!matchedCustomer) {
        setCustomerCreateDraft((prev) => ({
          ...prev,
          name: prev.name || "",
          phone: phoneDigits,
          country: prev.country || form.country || ""
        }));
        setCustomerSearchError("No customer found for this mobile number.");
        return;
      }
      applyCustomerSelection(matchedCustomer);
      return;
    }
    if (customerLookupResults.length === 1) {
      applyCustomerSelection(customerLookupResults[0]);
      return;
    }
    if (!customerLookupResults.length) {
      setCustomerCreateDraft((prev) => ({
        ...prev,
        name: query,
        phone: prev.phone || extractTenDigitPhone(query),
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
    setCustomerSearchPhone("");
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
      unit: item?.unit || line?.unit || "pcs",
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
        unit: match?.unit || line?.unit || "pcs",
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

  const activeLineForSearch = useMemo(
    () => (form.lines || []).find((line: any) => String(line?.id || "") === String(activeLineItemSearchId || "")) || null,
    [form.lines, activeLineItemSearchId]
  );
  const activeLineSearchResults = useMemo(() => {
    if (!activeLineForSearch) return [];
    return getLineItemSearchResults(activeLineForSearch);
  }, [activeLineForSearch, items]);

  async function onSave() {
    if (locked) return;
    if (!form.partyId) {
      toast.warning("Customer required", "Select a customer before saving.");
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
    if (isNew || !form.id) return;
    if (String(form?.convertedDocumentId || "").trim()) {
      toast.warning("Already converted", "This Pro Forma Invoice has already been converted.");
      return;
    }
    setConverting(true);
    try {
      const result = await convertSalesProforma(form.id);
      toast.success(
        "Converted to invoice",
        result?.invoiceNo ? `Created invoice ${result.invoiceNo}.` : "Invoice created successfully."
      );
      navigate(
        `/app/sales/invoice/history${result?.invoiceId ? `?invoiceId=${encodeURIComponent(result.invoiceId)}` : ""}`
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
            {!isNew ? (
              <button
                type="button"
                onClick={() => void onConvert()}
                disabled={converting || locked}
                className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {converting ? "Converting..." : "Convert to Invoice"}
              </button>
            ) : null}
            <GradientButton
              onClick={() => void onSave()}
              disabled={saving || loading || locked}
              className="disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Pro Forma Invoice"}
            </GradientButton>
          </div>
        }
      />

      {locked ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This Pro Forma Invoice is converted and is read-only.
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
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.proformaDate || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ proformaDate: event.target.value })}
                />
              </label>
              <label className="text-sm text-slate-600">
                Valid Till
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.validTill || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ validTill: event.target.value })}
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                <label className="text-sm text-slate-600">
                  Customer Lookup
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
                    placeholder="Search by phone, name, email, address"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Mobile (10 digit)
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={customerSearchPhone}
                    disabled={locked}
                    onChange={(event) => handleCustomerPhoneChange(event.target.value)}
                    placeholder="e.g. 9876543210"
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
                <table className="min-w-[1240px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Item</th>
                      <th className="px-2 py-2 font-semibold text-right">Qty</th>
                      <th className="px-2 py-2 font-semibold">Unit</th>
                      <th className="px-2 py-2 font-semibold text-right">Rate</th>
                      <th className="px-2 py-2 font-semibold text-right">Discount %</th>
                      <th className="px-2 py-2 font-semibold text-right">Discount Amt</th>
                      <th className="px-2 py-2 font-semibold text-right">Tax %</th>
                      <th className="px-2 py-2 font-semibold text-right">Amount</th>
                      <th className="px-2 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.lines || []).map((line: any) => (
                      <tr key={line.id} className="border-t border-slate-100">
                        <td className="px-2 py-2">
                          <div className="relative">
                            <input
                              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 pr-8 text-sm"
                              value={line.itemInput || ""}
                              disabled={locked}
                              placeholder="Search by item name or code"
                              onFocus={() => setActiveLineItemSearchId(line.id)}
                              onBlur={() => {
                                window.setTimeout(() => {
                                  setActiveLineItemSearchId((current) => (current === line.id ? "" : current));
                                }, 120);
                              }}
                              onChange={(event) => {
                                setActiveLineItemSearchId(line.id);
                                handleItemInput(line.id, event.target.value);
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
                            {activeLineItemSearchId === line.id && normalizeItemName(line.itemInput).length ? (
                              <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-100 bg-white p-1.5 shadow-soft">
                                {activeLineSearchResults.length ? (
                                  activeLineSearchResults.map((item) => (
                                    <button
                                      key={`sales-proforma-line-${line.id}-${item.id}`}
                                      type="button"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        selectLineItem(line, item);
                                        setActiveLineItemSearchId("");
                                      }}
                                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                    >
                                      {formatItemSearchLabel(item)}
                                    </button>
                                  ))
                                ) : (
                                  <div className="px-2 py-1.5 text-xs text-slate-500">No items found</div>
                                )}
                              </div>
                            ) : null}
                            {line.itemCode ? (
                              <p className="mt-1 text-[11px] text-slate-500">Code: {line.itemCode}</p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.001"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.qty}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { qty: parseNumber(event.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                            value={line.unit || "pcs"}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { unit: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.rate}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { rate: parseNumber(event.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.discountPercent}
                            disabled={locked}
                            onChange={(event) => {
                              const discountPercent = Math.max(0, parseNumber(event.target.value));
                              const baseAmount = Math.max(0, parseNumber(line.qty) * parseNumber(line.rate));
                              const discountAmount = round2((baseAmount * discountPercent) / 100);
                              updateLine(line.id, { discountPercent, discountAmount });
                            }}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.discountAmount}
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
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.taxRate}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { taxRate: parseNumber(event.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-semibold text-slate-900">
                          {lineAmount(line).toFixed(2)}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            disabled={locked}
                            className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
