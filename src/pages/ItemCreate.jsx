
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import Card from "../components/Card";
import FormField from "../components/FormField";
import GradientButton from "../components/GradientButton";
import Modal from "../components/Modal";
import FormSection from "../components/FormSection";
import { getNextItemCode, upsertItemRemote } from "../modules/items/store";
import { buildTaxLabel, parseNumber } from "../modules/items/utils";
import {
  defaultTrackInventoryForType,
  inferTypeFromCategory,
  normalizeItemTypeValue,
  shouldShowIndiaComplianceFields,
  shouldShowInventoryFields,
  shouldShowInventorySection,
  taxHintForCountry,
  taxRateLabelForCountry
} from "../modules/items/formRules";
import { useOrganization } from "../context/OrganizationContext";
import { useToast } from "../context/ToastContext";

const CATEGORY_KEY = "itemCategories";
const DEFAULT_CATEGORIES = ["General", "Granite", "Services", "Hardware"];
const UNITS = ["pcs", "kg", "box", "litre", "mtr", "set", "hr"];
const PRICE_TAX_MODES = [
  { value: "WITH_TAX", label: "With Tax" },
  { value: "WITHOUT_TAX", label: "Without Tax" }
];
const DISCOUNT_TYPES = [
  { value: "PERCENT", label: "Percentage" },
  { value: "AMOUNT", label: "Amount" }
];
const COUNTRY_CODE_MAP = {
  IN: "India",
  LK: "Sri Lanka",
  GB: "United Kingdom",
  IE: "Ireland",
  AE: "UAE",
  US: "USA"
};

function normalizeCompanyCountry(rawCountry, rawCountryCode) {
  const direct = String(rawCountry || "").trim();
  if (direct) return direct;
  const code = String(rawCountryCode || "")
    .trim()
    .toUpperCase();
  return COUNTRY_CODE_MAP[code] || "India";
}

function toStoreType(typeValue) {
  return normalizeItemTypeValue(typeValue) === "SERVICE" ? "Service" : "Product";
}

function createPriceLevel() {
  return {
    id: `pl_${Date.now().toString(16)}_${Math.floor(Math.random() * 1000)}`,
    label: "",
    price: 0
  };
}

function createTaxMapping(country, rate) {
  return {
    id: `tm_${Date.now().toString(16)}_${Math.floor(Math.random() * 1000)}`,
    country: String(country || "").trim(),
    rate: parseNumber(rate)
  };
}

function createDraft(type = "PRODUCT") {
  const normalizedType = normalizeItemTypeValue(type);
  return {
    type: normalizedType,
    itemName: "",
    category: "",
    unit: "",
    status: "Active",
    description: "",
    salePrice: 0,
    purchasePrice: 0,
    taxRate: 0,
    taxInclusive: false,
    hsnOrSac: "",
    trackInventory: defaultTrackInventoryForType(normalizedType),
    openingQty: 0,
    openingStockValue: 0,
    lowStockQty: 0,
    sku: "",
    barcode: "",
    priceLevels: [],
    taxMappings: [],
    salePriceTaxMode: "WITHOUT_TAX",
    purchasePriceTaxMode: "WITHOUT_TAX",
    discountValue: 0,
    discountType: "PERCENT",
    warehouse: "",
    imageUrl: "",
    itemCode: getNextItemCode(toStoreType(normalizedType))
  };
}

function readInitialCategories() {
  try {
    const raw = localStorage.getItem(CATEGORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...list]));
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

function moneyLike(value) {
  return parseNumber(value).toFixed(2);
}

export default function ItemCreate() {
  const nav = useNavigate();
  const toast = useToast();
  const { country: organizationCountry = "", countryCode: organizationCountryCode = "", profile: organizationProfile = {} } =
    useOrganization();
  const companyCountry = useMemo(
    () => normalizeCompanyCountry(organizationCountry, organizationCountryCode),
    [organizationCountry, organizationCountryCode]
  );

  const [form, setForm] = useState(() => createDraft("PRODUCT"));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState(readInitialCategories);
  const [newCategory, setNewCategory] = useState("");
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);

  const showIndiaCompliance = shouldShowIndiaComplianceFields(companyCountry);
  const taxRateLabel = taxRateLabelForCountry(companyCountry);
  const taxHint = taxHintForCountry(companyCountry);
  const showInventoryCard = shouldShowInventorySection(form.type, form.trackInventory);
  const showInventoryInputs = shouldShowInventoryFields(form.type, form.trackInventory);
  const complianceCodeLabel = form.type === "SERVICE" ? "SAC" : "HSN";
  const itemTypeLabel = form.type === "SERVICE" ? "Service" : "Product";
  const skuPreview = String(form.sku || form.itemCode || "").trim();
  const multiCountryEnabled =
    !!organizationProfile?.settings?.numbering?.allowCountryOverride ||
    !!organizationProfile?.settings?.preferences?.multiCurrency;
  const inputClassName =
    "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100";
  const errorClassName = "mt-1 text-xs font-medium text-rose-600";

  const summaryName = form.itemName.trim() || `Untitled ${itemTypeLabel.toLowerCase()}`;
  const summaryTaxType = showIndiaCompliance ? "GST" : "Tax/VAT";
  const summaryTaxRate = `${parseNumber(form.taxRate)}%`;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev?.[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function rememberCategory(name) {
    const clean = String(name || "").trim();
    if (!clean) return;
    setCategories((prev) => {
      const exists = prev.some((entry) => entry.toLowerCase() === clean.toLowerCase());
      if (exists) return prev;
      const next = [...prev, clean];
      localStorage.setItem(CATEGORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function applyType(nextTypeValue) {
    const nextType = normalizeItemTypeValue(nextTypeValue);
    setForm((prev) => {
      if (prev.type === nextType) return prev;
      const currentCode = String(prev.itemCode || "").trim();
      const expectedPrefix = nextType === "SERVICE" ? "SER-" : "PRD-";
      const keepCurrentCode = !!currentCode && currentCode.toUpperCase().startsWith(expectedPrefix);
      const nextTrackInventory =
        nextType === "SERVICE"
          ? false
          : prev.type === "SERVICE"
            ? defaultTrackInventoryForType(nextType)
            : !!prev.trackInventory;

      return {
        ...prev,
        type: nextType,
        trackInventory: nextTrackInventory,
        itemCode: keepCurrentCode ? currentCode : getNextItemCode(toStoreType(nextType)),
        openingQty: nextType === "SERVICE" ? 0 : prev.openingQty,
        openingStockValue: nextType === "SERVICE" ? 0 : prev.openingStockValue,
        lowStockQty: nextType === "SERVICE" ? 0 : prev.lowStockQty
      };
    });
  }

  function addPriceLevel() {
    setForm((prev) => ({ ...prev, priceLevels: [...prev.priceLevels, createPriceLevel()] }));
  }

  function updatePriceLevel(id, patch) {
    setForm((prev) => ({
      ...prev,
      priceLevels: prev.priceLevels.map((level) => (level.id === id ? { ...level, ...patch } : level))
    }));
  }

  function removePriceLevel(id) {
    setForm((prev) => ({
      ...prev,
      priceLevels: prev.priceLevels.filter((level) => level.id !== id)
    }));
  }

  function addTaxMapping() {
    setForm((prev) => ({
      ...prev,
      taxMappings: [...prev.taxMappings, createTaxMapping(companyCountry, prev.taxRate)]
    }));
  }

  function updateTaxMapping(id, patch) {
    setForm((prev) => ({
      ...prev,
      taxMappings: prev.taxMappings.map((row) => (row.id === id ? { ...row, ...patch } : row))
    }));
  }

  function removeTaxMapping(id) {
    setForm((prev) => ({
      ...prev,
      taxMappings: prev.taxMappings.filter((row) => row.id !== id)
    }));
  }

  function validate() {
    const nextErrors = {};
    if (!String(form.itemName || "").trim()) nextErrors.itemName = "Item name is required.";
    if (!String(form.unit || "").trim()) nextErrors.unit = "Select unit of measure.";
    if (parseNumber(form.salePrice) < 0) nextErrors.salePrice = "Sales rate cannot be negative.";
    if (parseNumber(form.purchasePrice) < 0) nextErrors.purchasePrice = "Purchase rate cannot be negative.";
    if (parseNumber(form.taxRate) < 0) nextErrors.taxRate = `${taxRateLabel} cannot be negative.`;
    if (showInventoryInputs && parseNumber(form.openingQty) < 0) nextErrors.openingQty = "Opening stock cannot be negative.";
    if (showInventoryInputs && parseNumber(form.openingStockValue) < 0) {
      nextErrors.openingStockValue = "Opening stock value cannot be negative.";
    }
    if (showInventoryInputs && parseNumber(form.lowStockQty) < 0) nextErrors.lowStockQty = "Low stock alert cannot be negative.";

    setErrors(nextErrors);
    return !Object.keys(nextErrors).length;
  }

  async function saveItem(mode = "save") {
    if (saving) return;
    if (!validate()) return;

    setSaving(true);
    setSaveError("");

    const numericTaxRate = parseNumber(form.taxRate);
    const trimmedCode = String(form.hsnOrSac || "").trim();
    const normalizedPriceLevels = form.priceLevels
      .map((row) => ({
        ...row,
        label: String(row.label || "").trim(),
        price: parseNumber(row.price)
      }))
      .filter((row) => row.label);
    const normalizedTaxMappings = (multiCountryEnabled ? form.taxMappings : [])
      .map((row) => ({
        ...row,
        country: String(row.country || "").trim(),
        rate: parseNumber(row.rate)
      }))
      .filter((row) => row.country);

    const payload = {
      name: String(form.itemName || "").trim(),
      type: toStoreType(form.type),
      description: String(form.description || "").trim(),
      unit: String(form.unit || "").trim() || "pcs",
      salesRate: parseNumber(form.salePrice),
      purchaseRate: parseNumber(form.purchasePrice),
      taxRate: numericTaxRate,
      taxLabel: buildTaxLabel(companyCountry, numericTaxRate),
      taxInclusive: !!form.taxInclusive,
      status: form.status === "Inactive" ? "Inactive" : "Active",
      trackInventory: !!showInventoryInputs,
      openingStock: showInventoryInputs ? parseNumber(form.openingQty) : 0,
      openingStockValue: showInventoryInputs ? parseNumber(form.openingStockValue) : 0,
      lowStockAlert: showInventoryInputs ? parseNumber(form.lowStockQty) : 0,
      category: String(form.category || "").trim(),
      itemCode: String(form.itemCode || "").trim(),
      sku: String(form.sku || "").trim() || String(form.itemCode || "").trim(),
      barcode: String(form.barcode || "").trim(),
      priceLevels: normalizedPriceLevels,
      taxMappings: normalizedTaxMappings,
      hsn: showIndiaCompliance && form.type === "PRODUCT" ? trimmedCode : "",
      sac: showIndiaCompliance && form.type === "SERVICE" ? trimmedCode : "",
      gstPercent: showIndiaCompliance ? numericTaxRate : 0,
      taxPercent: showIndiaCompliance ? 0 : numericTaxRate,
      hsnOrSac: showIndiaCompliance ? trimmedCode : "",
      metadata: {
        category: String(form.category || "").trim(),
        itemCode: String(form.itemCode || "").trim(),
        sku: String(form.sku || "").trim() || String(form.itemCode || "").trim(),
        barcode: String(form.barcode || "").trim(),
        description: String(form.description || "").trim(),
        purchasePrice: parseNumber(form.purchasePrice),
        taxInclusive: !!form.taxInclusive,
        salePriceTaxMode: form.taxInclusive ? "WITH_TAX" : form.salePriceTaxMode,
        purchasePriceTaxMode: form.taxInclusive ? "WITH_TAX" : form.purchasePriceTaxMode,
        discountValue: parseNumber(form.discountValue),
        discountType: form.discountType,
        trackStock: !!showInventoryInputs,
        openingStock: showInventoryInputs ? parseNumber(form.openingQty) : 0,
        openingQty: showInventoryInputs ? parseNumber(form.openingQty) : 0,
        openingStockValue: showInventoryInputs ? parseNumber(form.openingStockValue) : 0,
        lowStockQty: showInventoryInputs ? parseNumber(form.lowStockQty) : 0,
        warehouse: String(form.warehouse || "").trim(),
        imageUrl: String(form.imageUrl || "").trim(),
        gstPercent: showIndiaCompliance ? numericTaxRate : 0,
        taxPercent: showIndiaCompliance ? 0 : numericTaxRate,
        hsnOrSac: showIndiaCompliance ? trimmedCode : "",
        priceLevels: normalizedPriceLevels,
        taxMappings: normalizedTaxMappings
      }
    };

    try {
      await upsertItemRemote(payload, companyCountry);
      if (mode === "new") {
        setForm(createDraft(form.type));
      } else {
        nav("/items", { replace: true });
      }
      toast.success(`${itemTypeLabel} saved`, `Saved for ${companyCountry}.`);
    } catch (error) {
      const message = error?.message || "Failed to save item.";
      setSaveError(message);
      toast.error("Failed to save item", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] pb-32">
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => nav("/items")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-base font-semibold text-slate-900">Create Product / Service</h1>
              <p className="text-xs text-slate-500">Fast entry first, advanced controls below.</p>
            </div>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            Company Country: {companyCountry}
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 md:px-6 md:py-6">
          <FormSection title="1. Essentials" description="Core details for quick creation.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Item Name *">
                <input
                  value={form.itemName}
                  onChange={(event) => updateField("itemName", event.target.value)}
                  className={inputClassName}
                  placeholder="Premium granite slab, consulting hour"
                />
                {errors.itemName ? <p className={errorClassName}>{errors.itemName}</p> : null}
              </FormField>

              <FormField label="Type">
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  {[
                    { value: "PRODUCT", label: "Product" },
                    { value: "SERVICE", label: "Service" }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => applyType(option.value)}
                      className={clsx(
                        "rounded-xl px-3 py-2 text-sm font-semibold transition",
                        form.type === option.value ? "bg-white text-slate-900 shadow-soft" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="Category">
                <div className="flex items-center gap-2">
                  <input
                    list="item-category-options"
                    value={form.category}
                    onChange={(event) => updateField("category", event.target.value)}
                    onBlur={() => {
                      const clean = String(form.category || "").trim();
                      if (!clean) return;
                      rememberCategory(clean);
                      const inferredType = inferTypeFromCategory(clean, form.type);
                      if (inferredType !== form.type) applyType(inferredType);
                      updateField("category", clean);
                    }}
                    className={inputClassName}
                    placeholder="Tiles, Hardware, Services"
                  />
                  <button
                    type="button"
                    onClick={() => setCategoryModalOpen(true)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    title="Add category"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <datalist id="item-category-options">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </FormField>

              <FormField label="SKU / Item ID (Auto)">
                <input
                  value={skuPreview}
                  className={`${inputClassName} bg-slate-50 text-slate-700`}
                  placeholder="Auto-generated"
                  readOnly
                />
                <p className="mt-1 text-xs text-slate-500">Auto-generated. Cannot be edited.</p>
              </FormField>

              <FormField label="Unit of Measure">
                <div className="relative">
                  <select
                    value={form.unit}
                    onChange={(event) => updateField("unit", event.target.value)}
                    className={`${inputClassName} appearance-none pr-10`}
                  >
                    <option value="">Select unit</option>
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
                {errors.unit ? <p className={errorClassName}>{errors.unit}</p> : null}
              </FormField>

              <FormField label="Status">
                <select
                  value={form.status}
                  onChange={(event) => updateField("status", event.target.value)}
                  className={inputClassName}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </FormField>

              <FormField label="Description (short)">
                <textarea
                  value={form.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  rows={2}
                  className={inputClassName}
                  placeholder="Shown in invoices and reports."
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="2. Pricing" description="Rates and tax inclusion setup.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Sales Rate">
                <input
                  type="number"
                  min={0}
                  value={form.salePrice}
                  onChange={(event) => updateField("salePrice", parseNumber(event.target.value))}
                  className={inputClassName}
                  placeholder="0"
                />
                {errors.salePrice ? <p className={errorClassName}>{errors.salePrice}</p> : null}
              </FormField>

              <FormField label="Purchase Rate">
                <input
                  type="number"
                  min={0}
                  value={form.purchasePrice}
                  onChange={(event) => updateField("purchasePrice", parseNumber(event.target.value))}
                  className={inputClassName}
                  placeholder="0"
                />
                {errors.purchasePrice ? <p className={errorClassName}>{errors.purchasePrice}</p> : null}
              </FormField>

              <FormField label="Tax Inclusive" className="md:col-span-2">
                <label className="inline-flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  <span>Prices include tax</span>
                  <input
                    type="checkbox"
                    checked={form.taxInclusive}
                    onChange={(event) => updateField("taxInclusive", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </label>
              </FormField>
            </div>
          </FormSection>

          <FormSection
            title="3. Tax & Compliance"
            description={taxHint}
            collapsible
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label={taxRateLabel}>
                <input
                  type="number"
                  min={0}
                  value={form.taxRate}
                  onChange={(event) => updateField("taxRate", parseNumber(event.target.value))}
                  className={inputClassName}
                  placeholder="0"
                />
                {errors.taxRate ? <p className={errorClassName}>{errors.taxRate}</p> : null}
              </FormField>

              {showIndiaCompliance ? (
                <FormField label={`${complianceCodeLabel} (optional)`} hint="Recommended for tax filings">
                  <input
                    value={form.hsnOrSac}
                    onChange={(event) => updateField("hsnOrSac", event.target.value)}
                    className={inputClassName}
                    placeholder={form.type === "SERVICE" ? "SAC code" : "HSN code"}
                  />
                </FormField>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  HSN/SAC fields are hidden for non-India companies.
                </div>
              )}
            </div>

            {multiCountryEnabled ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Country Tax Mapping</p>
                    <p className="text-xs text-slate-500">Override tax per country when enabled.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addTaxMapping}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>

                {form.taxMappings.length ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {form.taxMappings.map((row) => (
                      <div key={row.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
                        <input
                          value={row.country}
                          onChange={(event) => updateTaxMapping(row.id, { country: event.target.value })}
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                          placeholder="Country"
                        />
                        <input
                          type="number"
                          min={0}
                          value={row.rate}
                          onChange={(event) => updateTaxMapping(row.id, { rate: parseNumber(event.target.value) })}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                          placeholder="0"
                        />
                        <button
                          type="button"
                          onClick={() => removeTaxMapping(row.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No country-specific mapping added.</p>
                )}
              </div>
            ) : null}
          </FormSection>

          {showInventoryCard ? (
            <FormSection
              title="4. Inventory"
              description="Visible for products and tracked stock."
              collapsible
              defaultOpen={form.type === "PRODUCT"}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Track Inventory" className="md:col-span-2">
                  <label className="inline-flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                    <span>Enable stock tracking for this item</span>
                    <input
                      type="checkbox"
                      checked={form.trackInventory}
                      onChange={(event) => updateField("trackInventory", event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                      disabled={form.type === "SERVICE"}
                    />
                  </label>
                </FormField>

                {showInventoryInputs ? (
                  <>
                    <FormField label="Opening Stock">
                      <input
                        type="number"
                        min={0}
                        value={form.openingQty}
                        onChange={(event) => updateField("openingQty", parseNumber(event.target.value))}
                        className={inputClassName}
                        placeholder="0"
                      />
                      {errors.openingQty ? <p className={errorClassName}>{errors.openingQty}</p> : null}
                    </FormField>

                    <FormField label="Opening Stock Value (optional)">
                      <input
                        type="number"
                        min={0}
                        value={form.openingStockValue}
                        onChange={(event) => updateField("openingStockValue", parseNumber(event.target.value))}
                        className={inputClassName}
                        placeholder="0"
                      />
                      {errors.openingStockValue ? <p className={errorClassName}>{errors.openingStockValue}</p> : null}
                    </FormField>

                    <FormField label="Low Stock Alert">
                      <input
                        type="number"
                        min={0}
                        value={form.lowStockQty}
                        onChange={(event) => updateField("lowStockQty", parseNumber(event.target.value))}
                        className={inputClassName}
                        placeholder="0"
                      />
                      {errors.lowStockQty ? <p className={errorClassName}>{errors.lowStockQty}</p> : null}
                    </FormField>
                  </>
                ) : (
                  <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                    Opening stock fields are hidden while inventory tracking is off.
                  </div>
                )}
              </div>
            </FormSection>
          ) : null}

          <FormSection title="5. Identifiers" description="Optional codes used for scanning and internal lookup." collapsible defaultOpen={false}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Barcode (EAN / UPC)" className="md:col-span-2">
                <input
                  value={form.barcode}
                  onChange={(event) => updateField("barcode", event.target.value)}
                  className={inputClassName}
                  placeholder="EAN / UPC"
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="6. Price Levels" description="Optional wholesale and tier pricing." collapsible defaultOpen={false}>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={addPriceLevel}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Price Level
              </button>
            </div>

            {form.priceLevels.length ? (
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {form.priceLevels.map((level) => (
                  <div key={level.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <input
                      value={level.label}
                      onChange={(event) => updatePriceLevel(level.id, { label: event.target.value })}
                      className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder="Wholesale / Dealer"
                    />
                    <input
                      type="number"
                      min={0}
                      value={level.price}
                      onChange={(event) => updatePriceLevel(level.id, { price: parseNumber(event.target.value) })}
                      className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => removePriceLevel(level.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No price levels configured.</p>
            )}
          </FormSection>

          <FormSection title="Advanced" description="Legacy pricing and warehousing controls." collapsible defaultOpen={false}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Sales Price Mode">
                <select
                  value={form.salePriceTaxMode}
                  onChange={(event) => updateField("salePriceTaxMode", event.target.value)}
                  className={inputClassName}
                  disabled={form.taxInclusive}
                >
                  {PRICE_TAX_MODES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Purchase Price Mode">
                <select
                  value={form.purchasePriceTaxMode}
                  onChange={(event) => updateField("purchasePriceTaxMode", event.target.value)}
                  className={inputClassName}
                  disabled={form.taxInclusive}
                >
                  {PRICE_TAX_MODES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Discount Value">
                <input
                  type="number"
                  min={0}
                  value={form.discountValue}
                  onChange={(event) => updateField("discountValue", parseNumber(event.target.value))}
                  className={inputClassName}
                  placeholder="0"
                />
              </FormField>

              <FormField label="Discount Type">
                <select
                  value={form.discountType}
                  onChange={(event) => updateField("discountType", event.target.value)}
                  className={inputClassName}
                >
                  {DISCOUNT_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Warehouse / Location">
                <input
                  value={form.warehouse}
                  onChange={(event) => updateField("warehouse", event.target.value)}
                  className={inputClassName}
                  placeholder="Main warehouse"
                />
              </FormField>

              <FormField label="Image URL">
                <input
                  value={form.imageUrl}
                  onChange={(event) => updateField("imageUrl", event.target.value)}
                  className={inputClassName}
                  placeholder="https://..."
                />
              </FormField>
            </div>
          </FormSection>
        </div>
      </Card>

      <div className="fixed bottom-4 right-4 left-4 z-30 md:left-auto md:w-[560px]">
        <div className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{summaryName}</p>
              <p className="text-xs text-slate-500">
                Sales: {moneyLike(form.salePrice)} | {summaryTaxType}: {summaryTaxRate}
              </p>
              {saveError ? <p className="mt-1 text-xs font-semibold text-rose-600">{saveError}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => nav("/items")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void saveItem("new");
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Save & New
              </button>
              <GradientButton
                disabled={saving}
                onClick={() => {
                  void saveItem("save");
                }}
                className="rounded-xl px-4 py-2 text-xs"
              >
                {saving ? "Saving..." : "Save"}
              </GradientButton>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={categoryModalOpen}
        title="Add Category"
        onClose={() => {
          setCategoryModalOpen(false);
          setNewCategory("");
        }}
        footer={
          <div className="flex justify-end">
            <GradientButton
              disabled={!newCategory.trim()}
              onClick={() => {
                const clean = newCategory.trim();
                if (!clean) return;
                rememberCategory(clean);
                updateField("category", clean);
                setNewCategory("");
                setCategoryModalOpen(false);
              }}
            >
              Create Category
            </GradientButton>
          </div>
        }
      >
        <FormField label="Category Name">
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            className={inputClassName}
            placeholder="e.g., Electrical"
          />
        </FormField>
      </Modal>
    </div>
  );
}
