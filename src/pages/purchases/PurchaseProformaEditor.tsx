import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
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
  convertPurchaseProforma,
  getPurchaseProformaStatusOptions,
  purchaseProformaComputeTotals,
  purchaseProformaGetByIdRemote,
  purchaseProformaPeekNumber,
  purchaseProformaUpsert
} from "../../services/proformas.service";

function parseNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function lineAmount(line: any) {
  const qty = parseNumber(line?.qty);
  const rate = parseNumber(line?.rate);
  const taxable = Math.max(0, qty * rate);
  const tax = (taxable * parseNumber(line?.taxRate)) / 100;
  return Math.max(0, taxable + tax);
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

function supplierAddressSummary(supplier: any) {
  return [supplier?.address, supplier?.city, supplier?.state, supplier?.country]
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
    id: `ppf_line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: "",
    itemCode: "",
    itemInput: "",
    description: "",
    qty: 1,
    rate: 0,
    taxRate: 0
  };
}

const PURCHASE_STATUS_OPTIONS = getPurchaseProformaStatusOptions();

export default function PurchaseProformaEditor() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = String(id || "") === "new";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [supplierSearchPhone, setSupplierSearchPhone] = useState("");
  const [supplierLookupQuery, setSupplierLookupQuery] = useState("");
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const [supplierCreateLoading, setSupplierCreateLoading] = useState(false);
  const [supplierCreateDraft, setSupplierCreateDraft] = useState({
    name: "",
    phone: "",
    country: "",
    state: ""
  });
  const [supplierCountryMenuOpen, setSupplierCountryMenuOpen] = useState(false);
  const [supplierStateMenuOpen, setSupplierStateMenuOpen] = useState(false);
  const [activeLineItemSearchId, setActiveLineItemSearchId] = useState("");
  const [form, setForm] = useState<any>({
    id: "",
    proformaNo: "",
    proformaDate: new Date().toISOString().slice(0, 10),
    validTill: "",
    dueDate: "",
    supplierId: "",
    partyName: "",
    partyAddress: "",
    phone: "",
    country: "",
    paymentType: "Unpaid",
    taxMode: "",
    supplyType: "",
    status: "DRAFT",
    lines: [createEmptyLine()]
  });

  const selectedSupplier = useMemo(
    () => suppliers.find((entry) => String(entry?.id || "") === String(form.supplierId || "")) || null,
    [suppliers, form.supplierId]
  );
  const locked = String(form?.status || "").toUpperCase() === "CONVERTED";
  const totals = useMemo(() => purchaseProformaComputeTotals(form.lines || []), [form.lines]);
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
  const supplierSearchTerm = useMemo(() => {
    const lookupText = String(supplierLookupQuery || "").trim();
    if (lookupText) return lookupText;
    return String(supplierSearchPhone || "").trim();
  }, [supplierLookupQuery, supplierSearchPhone]);
  const supplierLookupResults = useMemo(() => {
    const query = supplierSearchTerm.toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(supplierSearchTerm);
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
  }, [suppliers, supplierSearchTerm]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        await Promise.all([syncPartiesFromRemote(), syncItemsFromRemote()]);
        if (!mounted) return;
        const partyRows = listParties().filter((entry) => {
          const partyType = String(entry?.type || "").toLowerCase();
          return partyType === "supplier" || partyType === "both";
        });
        const itemRows = listItems().filter((entry) => entry?.status !== "Inactive");
        setSuppliers(partyRows);
        setItems(itemRows);

        if (isNew) {
          const nextNo = await purchaseProformaPeekNumber(new Date().toISOString().slice(0, 10));
          if (!mounted) return;
          setForm((prev: any) => ({
            ...prev,
            proformaNo: nextNo || prev.proformaNo
          }));
        } else {
          const found = await purchaseProformaGetByIdRemote(id);
          if (!mounted) return;
          if (!found) {
            toast.warning("Not found", "Purchase proforma does not exist.");
            navigate("/app/purchase/proformas/history", { replace: true });
            return;
          }
          setForm({
            id: found.id || "",
            proformaNo: found.proformaNo || "",
            proformaDate: found.proformaDate || new Date().toISOString().slice(0, 10),
            validTill: found.validTill || "",
            dueDate: found.dueDate || "",
            supplierId: found.supplierId || "",
            partyName: found.partyName || "",
            partyAddress: found.partyAddress || "",
            phone: found.phone || "",
            country: found.country || "",
            paymentType: found.paymentType || "Unpaid",
            taxMode: found.taxMode || "",
            supplyType: found.supplyType || "",
            status: found.status || "DRAFT",
            lines:
              Array.isArray(found.lines) && found.lines.length
                ? found.lines.map((line: any) => ({
                    id: line?.id || createEmptyLine().id,
                    itemId: line?.itemId || "",
                    itemCode: line?.itemCode || "",
                    itemInput: line?.itemName || line?.description || "",
                    description: line?.description || "",
                    qty: parseNumber(line?.qty) || 1,
                    rate: parseNumber(line?.rate),
                    taxRate: parseNumber(line?.taxRate)
                  }))
                : [createEmptyLine()]
          });
        }
      } catch (error: any) {
        if (!mounted) return;
        toast.error("Failed to load purchase proforma", error?.message || "Please retry.");
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
    if (!selectedSupplier?.phone) return;
    setSupplierSearchPhone(String(selectedSupplier.phone).replace(/\D/g, "").slice(-10));
  }, [selectedSupplier?.phone]);

  function applySupplierSelection(nextSupplier: any) {
    if (!nextSupplier) return;
    setSupplierSearchError("");
    updateForm({
      supplierId: nextSupplier.id || "",
      partyName: nextSupplier.name || nextSupplier.displayName || "",
      partyAddress: nextSupplier.address || "",
      phone: nextSupplier.phone || "",
      country: nextSupplier.country || form.country || ""
    });
    setSupplierLookupQuery("");
    setSupplierCountryMenuOpen(false);
    setSupplierStateMenuOpen(false);
  }

  function handleSupplierPhoneChange(value: string) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    setSupplierSearchPhone(digits);
    setSupplierCreateDraft((prev) => ({
      ...prev,
      phone: digits || prev.phone,
      country: prev.country || form.country || ""
    }));
    setSupplierSearchError("");
    if (
      form.supplierId &&
      normalizePhoneForLookup(digits) !== normalizePhoneForLookup(selectedSupplier?.phone || form.phone || "")
    ) {
      updateForm({
        supplierId: "",
        partyName: "",
        partyAddress: "",
        phone: "",
        country: form.country || ""
      });
    }
  }

  function handleSupplierLookupChange(value: string) {
    setSupplierLookupQuery(value);
    setSupplierSearchPhone(extractTenDigitPhone(value));
    setSupplierCreateDraft((prev) => ({
      ...prev,
      name: queryLooksPhoneLike(value) ? prev.name : String(value || "").trim(),
      phone: extractTenDigitPhone(value) || prev.phone,
      country: prev.country || form.country || ""
    }));
    setSupplierSearchError("");
  }

  function handleSupplierSearch() {
    const query = String(supplierSearchTerm || "").trim();
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
          country: prev.country || form.country || ""
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
        country: prev.country || form.country || ""
      }));
      setSupplierSearchError("No supplier found for this search.");
      return;
    }
    setSupplierSearchError("Multiple suppliers found. Choose one from the list below.");
  }

  async function handleCreateSupplier() {
    const name = String(supplierCreateDraft.name || "").trim();
    const phone = extractTenDigitPhone(supplierCreateDraft.phone);
    const draftCountry = String(supplierCreateDraft.country || form.country || "").trim();
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
      const nextSuppliers = listParties().filter((entry) => {
        const partyType = String(entry?.type || "").toLowerCase();
        return partyType === "supplier" || partyType === "both";
      });
      setSuppliers(nextSuppliers);
      applySupplierSelection(created);
      setSupplierLookupQuery("");
      setSupplierCreateDraft({
        name: "",
        phone: "",
        country: form.country || "",
        state: ""
      });
      setSupplierCountryMenuOpen(false);
      setSupplierStateMenuOpen(false);
      toast.success("Supplier created", `${created.name} added successfully.`);
    } catch (error: any) {
      setSupplierSearchError(error?.message || "Failed to create supplier.");
    } finally {
      setSupplierCreateLoading(false);
    }
  }

  function applySupplierCreateCountry(nextCountry: string) {
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

  function applySupplierCreateState(nextState: string) {
    setSupplierCreateDraft((prev) => ({ ...prev, state: nextState }));
    setSupplierStateMenuOpen(false);
  }

  function resetSupplier() {
    setSupplierSearchError("");
    setSupplierSearchPhone("");
    setSupplierLookupQuery("");
    updateForm({
      supplierId: "",
      partyName: "",
      partyAddress: "",
      phone: "",
      country: ""
    });
    setSupplierCreateDraft({
      name: "",
      phone: "",
      country: form.country || "",
      state: ""
    });
    setSupplierCountryMenuOpen(false);
    setSupplierStateMenuOpen(false);
  }

  function selectLineItem(line: any, item: any) {
    if (!line || !item) return;
    updateLine(line.id, {
      itemId: item?.id || "",
      itemCode: item?.itemCode || "",
      itemInput: item?.name || "",
      description: item?.name || "",
      rate: parseNumber(item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.purchase_price ?? line?.rate),
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
        rate: parseNumber(match?.purchaseRate ?? match?.metadata?.purchasePrice ?? match?.purchase_price ?? line?.rate),
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
    if (!form.supplierId) {
      toast.warning("Supplier required", "Select a supplier before saving.");
      return;
    }
    setSaving(true);
    try {
      const cleanedLines = (form.lines || [])
        .map((line: any, index: number) => ({
          ...line,
          description: String(line?.itemInput || line?.description || "").trim(),
          qty: parseNumber(line?.qty),
          rate: parseNumber(line?.rate),
          taxRate: parseNumber(line?.taxRate),
          taxInclusive: false,
          lineNo: index + 1
        }))
        .filter((line: any) => line.qty > 0 && (line.itemId || line.itemInput || line.description));
      if (!cleanedLines.length) {
        toast.warning("Line items required", "Add at least one line item before saving.");
        return;
      }

      const result = await purchaseProformaUpsert({
        ...form,
        partyName: selectedSupplier?.name || selectedSupplier?.displayName || form.partyName || "",
        partyAddress: selectedSupplier?.address || form.partyAddress || "",
        phone: selectedSupplier?.phone || form.phone || "",
        lines: cleanedLines,
        totals
      });
      toast.success("Purchase proforma saved", result?.proformaNo || "Saved successfully.");
      if (isNew && result?.id) {
        navigate(`/app/purchase/proformas/${encodeURIComponent(result.id)}`, { replace: true });
      } else {
        const refreshed = await purchaseProformaGetByIdRemote(result?.id || form.id);
        if (refreshed) {
          updateForm({
            id: refreshed.id || form.id,
            proformaNo: refreshed.proformaNo || form.proformaNo,
            status: refreshed.status || form.status
          });
        }
      }
    } catch (error: any) {
      toast.error("Save failed", error?.message || "Could not save purchase proforma.");
    } finally {
      setSaving(false);
    }
  }

  async function onConvert() {
    const status = String(form?.status || "").toUpperCase();
    if (isNew || !form.id) return;
    if (status === "CONVERTED") {
      toast.warning("Already converted", "This proforma has already been converted.");
      return;
    }
    if (status === "EXPIRED") {
      toast.warning("Expired proforma", "Expired proformas cannot be converted.");
      return;
    }
    setConverting(true);
    try {
      const result = await convertPurchaseProforma(form.id);
      toast.success(
        "Converted to purchase bill",
        result?.billNo ? `Created bill ${result.billNo}.` : "Purchase bill created successfully."
      );
      navigate(`/app/purchase/history${result?.billId ? `?billId=${encodeURIComponent(result.billId)}` : ""}`);
    } catch (error: any) {
      toast.error("Conversion failed", error?.message || "Could not convert purchase proforma.");
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Purchase Proforma"
        subtitle="Draft purchase intent until converted to final bill"
        right={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/app/purchase/proformas/history")}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              History
            </button>
            {!isNew ? (
              <button
                type="button"
                onClick={() => void onConvert()}
                disabled={converting || locked || String(form?.status || "").toUpperCase() === "EXPIRED"}
                className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {converting ? "Converting..." : "Convert to Bill"}
              </button>
            ) : null}
            <GradientButton
              onClick={() => void onSave()}
              disabled={saving || loading || locked}
              className="disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Proforma"}
            </GradientButton>
          </div>
        }
      />

      {locked ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This proforma is converted and is read-only.
        </div>
      ) : null}

      <Card className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading proforma details...</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm text-slate-600">
                Proforma No
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                  value={form.proformaNo || ""}
                  disabled
                  readOnly
                  title="Auto-generated"
                />
              </label>
              <label className="text-sm text-slate-600">
                Proforma Date
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
              <label className="text-sm text-slate-600">
                Status
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.status || "DRAFT"}
                  disabled={locked}
                  onChange={(event) => updateForm({ status: event.target.value })}
                >
                  {PURCHASE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600">
                Payment Type
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.paymentType || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ paymentType: event.target.value })}
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                <label className="text-sm text-slate-600">
                  Supplier Lookup
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={supplierLookupQuery}
                    disabled={locked}
                    onChange={(event) => handleSupplierLookupChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleSupplierSearch();
                      }
                    }}
                    placeholder="Search by phone, name, email, address"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Mobile (10 digit)
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={supplierSearchPhone}
                    disabled={locked}
                    onChange={(event) => handleSupplierPhoneChange(event.target.value)}
                    placeholder="e.g. 9876543210"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={handleSupplierSearch}
                    disabled={loading || locked}
                    className="inline-flex h-[42px] items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Search className="h-4 w-4" />
                    Search
                  </button>
                  {form.supplierId ? (
                    <button
                      type="button"
                      onClick={resetSupplier}
                      disabled={locked}
                      className="inline-flex h-[42px] items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              {supplierSearchError ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{supplierSearchError}</p>
              ) : null}

              {selectedSupplier ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                  <p className="font-semibold">{selectedSupplier?.name || selectedSupplier?.displayName || "-"}</p>
                  <p className="mt-1">{selectedSupplier?.phone || "-"}</p>
                  <p className="mt-1">{supplierAddressSummary(selectedSupplier) || "-"}</p>
                </div>
              ) : null}

              {supplierSearchTerm ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Matching Suppliers
                  </p>
                  {supplierLookupResults.length ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {supplierLookupResults.map((supplier) => (
                        <button
                          key={supplier.id}
                          type="button"
                          onClick={() => applySupplierSelection(supplier)}
                          disabled={locked}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30 disabled:cursor-not-allowed disabled:opacity-70"
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
                    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                      <p>No supplier found for this search.</p>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          value={supplierCreateDraft.name}
                          onChange={(event) =>
                            setSupplierCreateDraft((prev) => ({ ...prev, name: event.target.value }))
                          }
                          disabled={locked}
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
                          disabled={locked}
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
                            disabled={locked}
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
                            disabled={locked}
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
                        disabled={supplierCreateLoading || locked}
                        className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {supplierCreateLoading ? "Creating..." : "Create Supplier"}
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
                  <p className="text-xs text-slate-500">Use the same pricing flow as Purchase Bill (tax exclusive only).</p>
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

              <div className="space-y-3">
                {(form.lines || []).map((line: any, index: number) => (
                  <div key={line.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-600">Row {index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={locked}
                        className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <label className="text-xs text-slate-600 xl:col-span-2">
                        Item
                        <div className="relative">
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 pr-8 text-sm"
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
                              className="absolute right-1.5 top-[9px] inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
                                    key={`proforma-line-${line.id}-${item.id}`}
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
                        </div>
                        {line.itemCode ? (
                          <p className="mt-1 text-[11px] text-slate-500">Code: {line.itemCode}</p>
                        ) : null}
                      </label>

                      <label className="text-xs text-slate-600">
                        Qty
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                          value={line.qty}
                          disabled={locked}
                          onChange={(event) => updateLine(line.id, { qty: parseNumber(event.target.value) })}
                        />
                      </label>

                      <label className="text-xs text-slate-600">
                        Rate
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                          value={line.rate}
                          disabled={locked}
                          onChange={(event) => updateLine(line.id, { rate: parseNumber(event.target.value) })}
                        />
                      </label>

                      <label className="text-xs text-slate-600">
                        Tax %
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                          value={line.taxRate}
                          disabled={locked}
                          onChange={(event) => updateLine(line.id, { taxRate: parseNumber(event.target.value) })}
                        />
                      </label>
                    </div>

                    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-right">
                      <p className="text-[11px] text-slate-500">Line Amount</p>
                      <p className="text-sm font-semibold text-slate-900">{lineAmount(line).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Status</p>
                <p className="font-semibold text-slate-900">{String(form.status || "DRAFT").toUpperCase()}</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
