import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "../../components/Modal";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import { buildTaxLabel, parseNumber, taxContext } from "./utils";

const UNITS = ["pcs", "kg", "box", "litre", "mtr", "set", "hr"];

function defaultItem(type) {
  return {
    type,
    name: "",
    description: "",
    hsn: "",
    sac: "",
    unit: "pcs",
    salesRate: 0,
    purchaseRate: 0,
    taxRate: 0,
    taxInclusive: false,
    status: "Active",
    trackInventory: type === "Product",
    openingStock: 0,
    openingStockValue: 0,
    lowStockAlert: 0,
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
  initialItem,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(
    initialItem ? { ...defaultItem(initialItem.type), ...initialItem } : defaultItem("Product")
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(initialItem ? { ...defaultItem(initialItem.type), ...initialItem } : defaultItem("Product"));
  }, [open, initialItem]);

  const taxCfg = useMemo(() => taxContext(country, form.type), [country, form.type]);
  const showStock = form.type === "Product";

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateType(next) {
    setForm((prev) => ({
      ...prev,
      type: next,
      trackInventory: next === "Product" ? prev.trackInventory : false,
      hsn: next === "Product" ? prev.hsn : "",
      sac: next === "Service" ? prev.sac : ""
    }));
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
    const next = {
      ...form,
      name: form.name.trim(),
      description: form.description?.trim() || "",
      hsn: form.hsn?.trim() || "",
      sac: form.sac?.trim() || "",
      unit: form.unit?.trim() || "pcs",
      salesRate: parseNumber(form.salesRate),
      purchaseRate: parseNumber(form.purchaseRate),
      taxRate: parseNumber(form.taxRate),
      openingStock: parseNumber(form.openingStock),
      openingStockValue: parseNumber(form.openingStockValue),
      lowStockAlert: parseNumber(form.lowStockAlert),
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
      title={mode === "edit" ? "Edit Item" : "Add Item"}
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
              {mode === "edit" ? "Update Item" : "Create Item"}
            </GradientButton>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Item Type">
          <select
            value={form.type}
            onChange={(event) => updateType(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          >
            <option value="Product">Product</option>
            <option value="Service">Service</option>
          </select>
        </FormField>

        <FormField label="Status">
          <select
            value={form.status}
            onChange={(event) => updateField("status", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </FormField>

        <FormField label="Item Name">
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="Premium marble, consulting, etc."
          />
        </FormField>

        <FormField label="Category">
          <input
            value={form.category}
            onChange={(event) => updateField("category", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="Tiles, Services, Hardware"
          />
        </FormField>

        <FormField label="Description" className="md:col-span-2">
          <textarea
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            rows={2}
            placeholder="Short description for invoices."
          />
        </FormField>

        <FormField label={taxCfg.codeLabel}>
          <input
            value={form.type === "Service" ? form.sac : form.hsn}
            onChange={(event) =>
              updateField(form.type === "Service" ? "sac" : "hsn", event.target.value)
            }
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder={form.type === "Service" ? "SAC code" : "HSN code"}
          />
          {form.type === "Service" ? (
            <p className="mt-2 text-xs text-slate-500">SAC code is mandatory for services.</p>
          ) : null}
        </FormField>

        <FormField label="Unit of Measure">
          <input
            list="item-units"
            value={form.unit}
            onChange={(event) => updateField("unit", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="pcs, kg, hr"
          />
          <datalist id="item-units">
            {UNITS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </FormField>

        <FormField label="Sales Rate">
          <input
            type="number"
            min={0}
            value={form.salesRate}
            onChange={(event) => updateField("salesRate", parseNumber(event.target.value))}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
          />
        </FormField>

        <FormField label="Purchase Rate">
          <input
            type="number"
            min={0}
            value={form.purchaseRate}
            onChange={(event) => updateField("purchaseRate", parseNumber(event.target.value))}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
          />
        </FormField>

        <FormField label={taxCfg.label}>
          <input
            list="tax-rate-options"
            value={form.taxRate}
            onChange={(event) => updateField("taxRate", parseNumber(event.target.value))}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
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

        <FormField label="Tax Inclusive?">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.taxInclusive}
              onChange={(event) => updateField("taxInclusive", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Prices include tax
          </label>
        </FormField>

        {showStock ? (
          <>
            <FormField label="Track Inventory">
              <label className="flex items-center gap-2 text-sm text-slate-600">
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
                type="number"
                min={0}
                value={form.openingStock}
                onChange={(event) => updateField("openingStock", parseNumber(event.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                disabled={!form.trackInventory}
              />
            </FormField>

            <FormField label="Opening Stock Value">
              <input
                type="number"
                min={0}
                value={form.openingStockValue}
                onChange={(event) => updateField("openingStockValue", parseNumber(event.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                disabled={!form.trackInventory}
              />
            </FormField>

            <FormField label="Low Stock Alert">
              <input
                type="number"
                min={0}
                value={form.lowStockAlert}
                onChange={(event) => updateField("lowStockAlert", parseNumber(event.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
                disabled={!form.trackInventory}
              />
            </FormField>
          </>
        ) : (
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Inventory is disabled for services.
          </div>
        )}

        <FormField label="SKU / Item Code">
          <input
            value={form.sku}
            onChange={(event) => updateField("sku", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="SKU-001"
          />
        </FormField>

        <FormField label="Barcode">
          <input
            value={form.barcode}
            onChange={(event) => updateField("barcode", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="EAN / UPC"
          />
        </FormField>

        <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Multiple Price Levels</p>
              <p className="text-xs text-slate-500">Add wholesale or tiered pricing.</p>
            </div>
            <button
              type="button"
              onClick={addPriceLevel}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Level
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
                    className="h-7 w-7 rounded-full border border-slate-200 bg-white hover:bg-rose-50 flex items-center justify-center"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No price levels configured.</p>
          )}
        </div>

        <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Country-wise Tax Mapping</p>
              <p className="text-xs text-slate-500">Override tax for specific countries.</p>
            </div>
            <button
              type="button"
              onClick={addTaxMapping}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Mapping
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
                    className="h-7 w-7 rounded-full border border-slate-200 bg-white hover:bg-rose-50 flex items-center justify-center"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No custom tax mappings added.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
