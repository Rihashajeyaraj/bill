import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "../../components/Modal";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import { getNextItemCode } from "./store";
import { buildTaxLabel, parseNumber, taxContext } from "./utils";

const UNITS = ["pcs", "kg", "box", "litre", "mtr", "set", "hr"];

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

function defaultItem(type) {
  return {
    type,
    itemCode: "",
    name: "",
    description: "",
    hsn: "",
    sac: "",
    unit: "pcs",
    salesRate: 0,
    purchaseRate: 0,
    taxRate: 0,
    taxInclusive: true,
    status: "Active",
    trackInventory: type === "Product",
    openingStock: 0,
    openingStockValue: 0,
    lowStockAlert: 0,
    categoryId: "",
    category: "",
    sku: "",
    barcode: "",
    priceLevels: [],
    taxMappings: []
  };
}

function createPriceLevel() {
  return {
    id: `pl_${Date.now().toString(16)}`,
    label: "",
    price: 0
  };
}

function createTaxMapping(country, rate) {
  return {
    id: `tm_${Date.now().toString(16)}`,
    country,
    rate
  };
}

export default function ItemFormModal({
  open,
  mode,
  country,
  categoryOptions = [],
  initialItem,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(
    initialItem ? { ...defaultItem(initialItem.type), ...initialItem } : defaultItem("Product")
  );
  const [error, setError] = useState("");
  const normalizedCategoryOptions = useMemo(
    () =>
      (Array.isArray(categoryOptions) ? categoryOptions : [])
        .map((entry) => ({
          id: String(entry?.id || "").trim(),
          name: String(entry?.name || "").trim()
        }))
        .filter((entry) => entry.id && entry.name),
    [categoryOptions]
  );

  useEffect(() => {
    if (!open) return;
    setError("");
    const next = initialItem ? { ...defaultItem(initialItem.type), ...initialItem } : defaultItem("Product");
    if (mode !== "edit" && !String(next.itemCode || "").trim()) {
      next.itemCode = getNextItemCode(next.type);
    }
    const normalizedSku = String(next.sku || next.itemCode || "").trim();
    next.sku = normalizedSku;
    if (!String(next.unit || "").trim()) {
      next.unit = "pcs";
    }
    const nextCategoryId = String(next.categoryId || "").trim();
    if (nextCategoryId) {
      const matched = normalizedCategoryOptions.find((entry) => entry.id === nextCategoryId);
      if (matched?.name) {
        next.category = matched.name;
      }
    } else {
      const byName = normalizedCategoryOptions.find(
        (entry) => entry.name.toLowerCase() === String(next.category || "").trim().toLowerCase()
      );
      if (byName?.id) {
        next.categoryId = byName.id;
        next.category = byName.name;
      }
    }
    setForm(next);
  }, [open, initialItem, mode, normalizedCategoryOptions]);

  const taxCfg = useMemo(() => taxContext(country, form.type), [country, form.type]);
  const showStock = form.type === "Product";
  const itemLabel = form.type === "Service" ? "Service" : "Product";
  const modalTitle = mode === "edit" ? `Edit ${itemLabel}` : `Create ${itemLabel}`;
  const submitLabel = mode === "edit" ? `Update ${itemLabel}` : `Create ${itemLabel}`;
  const productIdPreview = String(form.itemCode || form.sku || "").trim();
  const inputClassName =
    "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100";

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addPriceLevel() {
    setForm((prev) => ({
      ...prev,
      priceLevels: [...(prev.priceLevels || []), createPriceLevel()]
    }));
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
      taxMappings: [...(prev.taxMappings || []), createTaxMapping(country, prev.taxRate)]
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

  function handleSave() {
    if (!form.name.trim()) {
      setError("Item name is required.");
      return;
    }
    if (form.type === "Service" && !form.sac?.trim()) {
      setError("SAC code is required for services.");
      return;
    }
    setError("");
    const normalizedOpeningStock = form.trackInventory ? wholeLike(form.openingStock) : 0;
    const normalizedOpeningStockValue = form.trackInventory
      ? parseNumber(normalizedOpeningStock * parseNumber(form.purchaseRate))
      : 0;
    const next = {
      ...form,
      itemCode: form.itemCode?.trim() || "",
      sku: form.sku?.trim() || form.itemCode?.trim() || "",
      name: form.name.trim(),
      description: form.description?.trim() || "",
      hsn: form.hsn?.trim() || "",
      sac: form.sac?.trim() || "",
      unit: form.unit?.trim() || "pcs",
      salesRate: parseNumber(form.salesRate),
      purchaseRate: parseNumber(form.purchaseRate),
      taxRate: parseNumber(form.taxRate),
      openingStock: normalizedOpeningStock,
      openingStockValue: normalizedOpeningStockValue,
      lowStockAlert: wholeLike(form.lowStockAlert),
      categoryId: String(form.categoryId || "").trim(),
      category: String(form.category || "").trim(),
      priceLevels: form.priceLevels.map((level) => ({
        ...level,
        label: level.label.trim(),
        price: parseNumber(level.price)
      })),
      taxMappings: form.taxMappings.map((row) => ({
        ...row,
        country: row.country.trim(),
        rate: parseNumber(row.rate)
      }))
    };
    onSave(next);
  }

  return (
    <Modal
      open={open}
      title={modalTitle}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <GradientButton onClick={handleSave}>
              {submitLabel}
            </GradientButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Item Name">
              <input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className={inputClassName}
                placeholder="Premium marble, consulting, etc."
              />
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

            <FormField label={taxCfg.codeLabel} hint={form.type === "Service" ? "Required for Service" : "Optional"}>
              <input
                value={form.type === "Service" ? form.sac : form.hsn}
                onChange={(event) =>
                  updateField(form.type === "Service" ? "sac" : "hsn", event.target.value)
                }
                className={inputClassName}
                placeholder={form.type === "Service" ? "SAC code" : "HSN code"}
              />
            </FormField>

            {form.type === "Product" ? (
              <FormField label="Unit of Measure">
                <select
                  value={form.unit}
                  onChange={(event) => updateField("unit", event.target.value)}
                  className={inputClassName}
                >
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : null}

            <FormField label="Category">
              {normalizedCategoryOptions.length ? (
                <select
                  value={form.categoryId || ""}
                  onChange={(event) => {
                    const nextId = String(event.target.value || "").trim();
                    const matched = normalizedCategoryOptions.find((entry) => entry.id === nextId);
                    setForm((prev) => ({
                      ...prev,
                      categoryId: nextId,
                      category: matched?.name || ""
                    }));
                  }}
                  className={inputClassName}
                >
                  <option value="">Select category</option>
                  {normalizedCategoryOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.category}
                  onChange={(event) => updateField("category", event.target.value)}
                  className={inputClassName}
                  placeholder="Tiles, Services, Hardware"
                />
              )}
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

            <FormField label="Barcode" className="md:col-span-2">
              <input
                value={form.barcode}
                onChange={(event) => updateField("barcode", event.target.value)}
                className={inputClassName}
                placeholder="EAN / UPC"
              />
            </FormField>

            <FormField label="Description" className="md:col-span-2">
              <textarea
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
                className={inputClassName}
                rows={2}
                placeholder="Short description for invoices."
              />
            </FormField>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Sales Rate">
              <input
                type="text"
                inputMode="decimal"
                value={String(form.salesRate ?? "")}
                onFocus={(event) => event.target.select()}
                onChange={(event) => updateField("salesRate", sanitizeDecimalInput(event.target.value))}
                onBlur={() => updateField("salesRate", decimalLike(form.salesRate || 0))}
                className={inputClassName}
                placeholder="0.00"
              />
            </FormField>

            <FormField label="Purchase Rate">
              <input
                type="text"
                inputMode="decimal"
                value={String(form.purchaseRate ?? "")}
                onFocus={(event) => event.target.select()}
                onChange={(event) => updateField("purchaseRate", sanitizeDecimalInput(event.target.value))}
                onBlur={() => updateField("purchaseRate", decimalLike(form.purchaseRate || 0))}
                className={inputClassName}
                placeholder="0.00"
              />
            </FormField>

            <FormField label={taxCfg.label}>
              <input
                list="tax-rate-options"
                value={form.taxRate}
                onChange={(event) => updateField("taxRate", parseNumber(event.target.value))}
                className={inputClassName}
                placeholder="0"
              />
              <datalist id="tax-rate-options">
                {taxCfg.rates.map((rate) => (
                  <option key={rate} value={rate} />
                ))}
              </datalist>
              <p className="mt-2 text-xs text-slate-500">
                Default label: {buildTaxLabel(country, parseNumber(form.taxRate))}
              </p>
            </FormField>

            <FormField label="Tax Inclusive">
              <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.taxInclusive}
                  onChange={(event) => updateField("taxInclusive", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Prices include tax
              </label>
            </FormField>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          {showStock ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Track Inventory">
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.trackInventory}
                    onChange={(event) => updateField("trackInventory", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Track stock for this product
                </label>
              </FormField>

              <FormField label="Opening Stock">
                <input
                  type="text"
                  inputMode="numeric"
                  value={wholeLike(form.openingStock)}
                  onChange={(event) => updateField("openingStock", normalizeWholeInput(event.target.value))}
                  className={inputClassName}
                  disabled={!form.trackInventory}
                  placeholder="0"
                />
              </FormField>

              <FormField label="Low Stock Alert">
                <input
                  type="text"
                  inputMode="numeric"
                  value={wholeLike(form.lowStockAlert)}
                  onChange={(event) => updateField("lowStockAlert", normalizeWholeInput(event.target.value))}
                  className={inputClassName}
                  disabled={!form.trackInventory}
                  placeholder="0"
                />
              </FormField>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Inventory is disabled for services.
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Price Levels</p>
              <p className="text-xs text-slate-500">Add wholesale or tiered pricing.</p>
            </div>
            <button
              type="button"
              onClick={addPriceLevel}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
          {form.priceLevels.length ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {form.priceLevels.map((level) => (
                <div key={level.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
                  <input
                    value={level.label}
                    onChange={(event) => updatePriceLevel(level.id, { label: event.target.value })}
                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    placeholder="Wholesale"
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
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No price levels configured.</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Country Tax Mapping</p>
              <p className="text-xs text-slate-500">Override tax for specific countries.</p>
            </div>
            <button
              type="button"
              onClick={addTaxMapping}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
          {form.taxMappings.length ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    placeholder="0"
                  />
                  <button
                    type="button"
                    onClick={() => removeTaxMapping(row.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No custom tax mappings added.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
