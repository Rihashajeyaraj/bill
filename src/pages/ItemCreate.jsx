
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import Card from "../components/Card";
import FormField from "../components/FormField";
import GradientButton from "../components/GradientButton";
import FormSection from "../components/FormSection";
import { getNextItemCode, upsertItemRemote } from "../modules/items/store";
import { buildTaxLabel, parseNumber } from "../modules/items/utils";
import {
  normalizeItemTypeValue,
  shouldShowIndiaComplianceFields,
  taxHintForCountry,
  taxRateLabelForCountry
} from "../modules/items/formRules";
import { useOrganization } from "../context/OrganizationContext";
import { useToast } from "../context/ToastContext";
import { authGetRole } from "../services/auth.service";
import { canCreateEntries } from "../services/roles";

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

function createDraft(type = "PRODUCT", defaultTaxRate = 0) {
  const normalizedType = normalizeItemTypeValue(type);
  return {
    type: normalizedType,
    itemName: "",
    unit: "pcs",
    status: "Active",
    description: "",
    salePrice: 0,
    purchasePrice: 0,
    taxRate: Number(defaultTaxRate || 0),
    hsnOrSac: "",
    quantity: 0,
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

function moneyLike(value) {
  return parseNumber(value).toFixed(2);
}

function decimalLike(value) {
  return parseNumber(value).toFixed(2);
}

function wholeLike(value) {
  return Math.max(0, Math.trunc(parseNumber(value)));
}

function normalizeWholeInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return 0;
  return Number(digits.replace(/^0+(?=\d)/, ""));
}

function sanitizeDecimalInput(value) {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const integer = cleaned.slice(0, firstDot + 1);
  const decimal = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${integer}${decimal}`;
}

export default function ItemCreate() {
  const nav = useNavigate();
  const toast = useToast();
  const role = authGetRole();
  const canCreateItem = canCreateEntries(role);
  const { country: organizationCountry = "", countryCode: organizationCountryCode = "", profile: organizationProfile = {} } =
    useOrganization();
  const companyCountry = useMemo(
    () => normalizeCompanyCountry(organizationCountry, organizationCountryCode),
    [organizationCountry, organizationCountryCode]
  );
  const companyTaxSettings = organizationProfile?.settings?.tax || {};
  const configuredGstRate = Number(companyTaxSettings.defaultGstRate);
  const defaultGstRate = Number.isFinite(configuredGstRate) && configuredGstRate >= 0 ? configuredGstRate : 18;
  const gstRuntimeEnabled = companyCountry === "India" && companyTaxSettings.enableGst !== false;
  const forceZeroTax = companyCountry === "India" && companyTaxSettings.enableGst === false;
  const defaultItemTaxRate = gstRuntimeEnabled ? defaultGstRate : 0;

  const [form, setForm] = useState(() => createDraft("PRODUCT", defaultItemTaxRate));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const showIndiaCompliance = shouldShowIndiaComplianceFields(companyCountry) && gstRuntimeEnabled;
  const taxRateLabel = gstRuntimeEnabled ? taxRateLabelForCountry(companyCountry) : "Tax / VAT %";
  const taxHint = forceZeroTax
    ? "GST is disabled in company settings. Tax is fixed at 0%."
    : gstRuntimeEnabled
      ? taxHintForCountry(companyCountry)
      : "Use the standard tax/VAT percentage for this item.";
  const isProductType = form.type === "PRODUCT";
  const complianceCodeLabel = form.type === "SERVICE" ? "SAC" : "HSN";
  const itemTypeLabel = form.type === "SERVICE" ? "Service" : "Product";
  const lowStockWarning =
    isProductType && wholeLike(form.lowStockQty) > wholeLike(form.quantity)
      ? "Low stock alert is higher than quantity."
      : "";
  const productIdPreview = String(form.itemCode || form.sku || "").trim();
  const multiCountryEnabled =
    !!organizationProfile?.settings?.numbering?.allowCountryOverride ||
    !!organizationProfile?.settings?.preferences?.multiCurrency;
  const inputClassName =
    "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100";
  const errorClassName = "mt-1 text-xs font-medium text-rose-600";

  const summaryName = form.itemName.trim() || `Untitled ${itemTypeLabel.toLowerCase()}`;
  const summaryTaxType = gstRuntimeEnabled ? "GST" : "Tax/VAT";
  const summaryTaxRate = `${parseNumber(form.taxRate)}%`;

  useEffect(() => {
    setForm((prev) => {
      const isPristine =
        !String(prev.itemName || "").trim() &&
        !String(prev.description || "").trim() &&
        parseNumber(prev.salePrice) === 0 &&
        parseNumber(prev.purchasePrice) === 0 &&
        parseNumber(prev.taxRate) === 0 &&
        !String(prev.hsnOrSac || "").trim() &&
        (!Array.isArray(prev.priceLevels) || prev.priceLevels.length === 0) &&
        (!Array.isArray(prev.taxMappings) || prev.taxMappings.length === 0);
      if (!isPristine) return prev;
      if (parseNumber(prev.taxRate) === Number(defaultItemTaxRate || 0)) return prev;
      return { ...prev, taxRate: Number(defaultItemTaxRate || 0) };
    });
  }, [defaultItemTaxRate]);

  useEffect(() => {
    if (!forceZeroTax) return;
    setForm((prev) => {
      if (parseNumber(prev.taxRate) === 0) return prev;
      return { ...prev, taxRate: 0 };
    });
  }, [forceZeroTax]);

  function updateField(key, value) {
    setForm((prev) => {
      if (key === "taxRate" && forceZeroTax) return { ...prev, taxRate: 0 };
      return { ...prev, [key]: value };
    });
    setErrors((prev) => {
      if (!prev?.[key]) return prev;
      const next = { ...prev };
      delete next[key];
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

      return {
        ...prev,
        type: nextType,
        itemCode: keepCurrentCode ? currentCode : getNextItemCode(toStoreType(nextType)),
        quantity: nextType === "SERVICE" ? 0 : prev.quantity,
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
    if (!String(form.itemName || "").trim()) nextErrors.itemName = "This field is required";
    if (!String(form.unit || "").trim()) nextErrors.unit = "Select unit of measure.";
    if (parseNumber(form.salePrice) < 0) nextErrors.salePrice = "Sales rate cannot be negative.";
    if (parseNumber(form.purchasePrice) < 0) nextErrors.purchasePrice = "Purchase rate cannot be negative.";
    if (parseNumber(form.taxRate) < 0) nextErrors.taxRate = `${taxRateLabel} cannot be negative.`;
    if (isProductType && parseNumber(form.quantity) < 0) nextErrors.quantity = "Quantity cannot be negative.";
    if (isProductType && parseNumber(form.lowStockQty) < 0) nextErrors.lowStockQty = "Low stock alert cannot be negative.";

    setErrors(nextErrors);
    return !Object.keys(nextErrors).length;
  }

  async function saveItem(mode = "save") {
    if (saving) return;
    if (!canCreateItem) {
      toast.error("Permission denied", "You do not have permission to create items.");
      return;
    }
    if (!validate()) return;

    setSaving(true);
    setSaveError("");

    const numericTaxRate = forceZeroTax ? 0 : parseNumber(form.taxRate);
    const trimmedCode = String(form.hsnOrSac || "").trim();
    const normalizedQuantity = isProductType ? wholeLike(form.quantity) : 0;
    const normalizedPurchaseRate = parseNumber(form.purchasePrice);
    const computedOpeningStockValue = isProductType ? parseNumber(normalizedQuantity * normalizedPurchaseRate) : 0;
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
      status: form.status === "Inactive" ? "Inactive" : "Active",
      trackInventory: isProductType,
      quantity: normalizedQuantity,
      openingStock: normalizedQuantity,
      currentStock: normalizedQuantity,
      openingStockValue: computedOpeningStockValue,
      lowStockAlert: isProductType ? wholeLike(form.lowStockQty) : 0,
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
        itemCode: String(form.itemCode || "").trim(),
        sku: String(form.sku || "").trim() || String(form.itemCode || "").trim(),
        barcode: String(form.barcode || "").trim(),
        description: String(form.description || "").trim(),
        purchasePrice: parseNumber(form.purchasePrice),
        salePriceTaxMode: form.salePriceTaxMode,
        purchasePriceTaxMode: form.purchasePriceTaxMode,
        discountValue: parseNumber(form.discountValue),
        discountType: form.discountType,
        trackStock: isProductType,
        quantity: normalizedQuantity,
        openingStock: normalizedQuantity,
        openingQty: normalizedQuantity,
        currentStock: normalizedQuantity,
        openingStockValue: computedOpeningStockValue,
        lowStockQty: isProductType ? wholeLike(form.lowStockQty) : 0,
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
        setForm(createDraft(form.type, defaultItemTaxRate));
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
          {!canCreateItem ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Your role does not have item create permission.
            </div>
          ) : null}
          <FormSection title="1. Essentials" description="Core details for quick creation.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Item Name" required error={errors.itemName}>
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

              <FormField label="Product ID (Auto)">
                <input
                  value={productIdPreview}
                  className={`${inputClassName} bg-slate-50 text-slate-700`}
                  placeholder="Auto-generated"
                  readOnly
                />
                <p className="mt-1 text-xs text-slate-500">Auto-generated. Cannot be edited.</p>
              </FormField>

              {form.type === "PRODUCT" ? (
                <FormField label="Unit of Measure" error={errors.unit}>
                  <div className="relative">
                    <select
                      value={form.unit}
                      onChange={(event) => updateField("unit", event.target.value)}
                      className={`${inputClassName} appearance-none pr-10`}
                    >
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
              ) : null}

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

          <FormSection title="2. Pricing" description="Sales, purchase, tax and stock setup.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Sales Rate" error={errors.salePrice}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={String(form.salePrice ?? "")}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => updateField("salePrice", sanitizeDecimalInput(event.target.value))}
                  onBlur={() => updateField("salePrice", decimalLike(form.salePrice || 0))}
                  className={inputClassName}
                  placeholder="0.00"
                />
                {errors.salePrice ? <p className={errorClassName}>{errors.salePrice}</p> : null}
              </FormField>

              <FormField label="Purchase Rate" error={errors.purchasePrice}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={String(form.purchasePrice ?? "")}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => updateField("purchasePrice", sanitizeDecimalInput(event.target.value))}
                  onBlur={() => updateField("purchasePrice", decimalLike(form.purchasePrice || 0))}
                  className={inputClassName}
                  placeholder="0.00"
                />
                {errors.purchasePrice ? <p className={errorClassName}>{errors.purchasePrice}</p> : null}
              </FormField>

              {isProductType ? (
                <FormField label="Quantity" error={errors.quantity}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={wholeLike(form.quantity)}
                    onChange={(event) => updateField("quantity", normalizeWholeInput(event.target.value))}
                    className={inputClassName}
                    placeholder="0"
                  />
                  {errors.quantity ? <p className={errorClassName}>{errors.quantity}</p> : null}
                </FormField>
              ) : null}

              {isProductType ? (
                <FormField label="Low Stock Alert" error={errors.lowStockQty}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={wholeLike(form.lowStockQty)}
                    onChange={(event) => updateField("lowStockQty", normalizeWholeInput(event.target.value))}
                    className={inputClassName}
                    placeholder="0"
                  />
                  {errors.lowStockQty ? <p className={errorClassName}>{errors.lowStockQty}</p> : null}
                  {lowStockWarning ? <p className="mt-1 text-xs font-medium text-amber-600">{lowStockWarning}</p> : null}
                </FormField>
              ) : null}
            </div>
          </FormSection>

          <FormSection
            title="3. Tax & Compliance"
            description={taxHint}
            collapsible
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label={taxRateLabel} error={errors.taxRate}>
                <input
                  type="number"
                  min={0}
                  value={forceZeroTax ? 0 : form.taxRate}
                  onChange={(event) => updateField("taxRate", parseNumber(event.target.value))}
                  className={`${inputClassName} ${forceZeroTax ? "bg-slate-100 text-slate-500" : ""}`}
                  placeholder="0"
                  disabled={forceZeroTax}
                />
                {errors.taxRate ? <p className={errorClassName}>{errors.taxRate}</p> : null}
                {forceZeroTax ? <p className="mt-1 text-xs text-slate-500">GST is disabled. Tax is fixed at 0%.</p> : null}
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

          <FormSection title="4. Identifiers" description="Optional codes used for scanning and internal lookup." collapsible defaultOpen={false}>
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

          <FormSection title="5. Price Levels" description="Optional wholesale and tier pricing." collapsible defaultOpen={false}>
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
                      type="text"
                      inputMode="decimal"
                      value={String(level.price ?? "")}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => updatePriceLevel(level.id, { price: sanitizeDecimalInput(event.target.value) })}
                      onBlur={() => updatePriceLevel(level.id, { price: decimalLike(level.price || 0) })}
                      className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                      placeholder="0.00"
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
                  type="text"
                  inputMode="decimal"
                  value={String(form.discountValue ?? "")}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => updateField("discountValue", sanitizeDecimalInput(event.target.value))}
                  onBlur={() => updateField("discountValue", decimalLike(form.discountValue || 0))}
                  className={inputClassName}
                  placeholder="0.00"
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
                disabled={!canCreateItem || saving}
                onClick={() => {
                  void saveItem("new");
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Save & New
              </button>
              <GradientButton
                disabled={!canCreateItem || saving}
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

    </div>
  );
}
