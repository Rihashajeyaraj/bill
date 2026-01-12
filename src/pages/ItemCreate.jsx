import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, Search, Settings, X } from "lucide-react";
import clsx from "clsx";

import Card from "../components/Card";
import FormField from "../components/FormField";
import GradientButton from "../components/GradientButton";
import TaxDropdown from "../components/TaxDropdown";
import UnitPickerModal from "../components/UnitPickerModal";
import { itemsUpsert } from "../services/items.service";
import { api } from "../lib/api";
import { UI } from "../theme/tokens";

const DEFAULT_ITEM = {
  type: "PRODUCT",
  itemName: "",
  hsn: "",
  unit: "pcs",
  imageUrl: "",
  category: "",
  itemCode: "",
  salePrice: "",
  salePriceTaxMode: "WITHOUT_TAX",
  purchasePrice: "",
  purchasePriceTaxMode: "WITHOUT_TAX",
  discountValue: "",
  discountType: "PERCENT",
  taxLabel: "None",
  trackStock: false,
  openingQty: "",
  lowStockQty: "",
  warehouse: ""
};

const CATEGORIES = ["General", "Granite", "Services", "Hardware"];
const PRICE_TAX_MODES = [
  { value: "WITH_TAX", label: "With Tax" },
  { value: "WITHOUT_TAX", label: "Without Tax" }
];
const DISCOUNT_TYPES = [
  { value: "PERCENT", label: "Percentage" },
  { value: "AMOUNT", label: "Amount" }
];

const COUNTRY_MAP = {
  IN: "India",
  LK: "Sri Lanka",
  UK: "United Kingdom",
  GB: "United Kingdom",
  IE: "Ireland"
};

function normalizeCountry(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (trimmed.length === 2) return COUNTRY_MAP[trimmed.toUpperCase()] || trimmed;
  return trimmed;
}

function parseTaxRate(label) {
  const match = String(label || "").match(/@([0-9.]+)%/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

export default function ItemCreate() {
  const nav = useNavigate();
  const [item, setItem] = useState(DEFAULT_ITEM);
  const [tab, setTab] = useState("pricing");
  const [unitOpen, setUnitOpen] = useState(false);
  const [companyCountry, setCompanyCountry] = useState("India");

  useEffect(() => {
    let active = true;
    async function loadCountry() {
      try {
        const res = await api.get("/api/company");
        const data = res.data || {};
        const normalized = normalizeCountry(
          data.country || data.country_name || data.countryCode || data.country_code
        );
        if (active && normalized) setCompanyCountry(normalized);
      } catch {
        const fallback = normalizeCountry(localStorage.getItem("companyCountryCode"));
        if (active && fallback) setCompanyCountry(fallback);
      }
    }
    loadCountry();
    return () => {
      active = false;
    };
  }, []);

  const isIndia = useMemo(() => companyCountry === "India", [companyCountry]);
  const isValid = item.itemName.trim().length > 0;

  function updateItem(patch) {
    setItem((prev) => ({ ...prev, ...patch }));
  }

  function toggleType() {
    updateItem({ type: item.type === "PRODUCT" ? "SERVICE" : "PRODUCT" });
  }

  function handleAssignCode() {
    const stamp = Math.floor(1000 + Math.random() * 9000);
    updateItem({ itemCode: `ITM-${stamp}` });
  }

  function handleLogoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateItem({ imageUrl: reader.result });
    reader.readAsDataURL(file);
  }

  function saveItem(mode) {
    if (!isValid) return;
    const taxRate = parseTaxRate(item.taxLabel);
    itemsUpsert({
      name: item.itemName,
      type: item.type === "PRODUCT" ? "Product" : "Service",
      price: Number(item.salePrice || 0),
      unit: item.unit || "pcs",
      taxRate,
      taxLabel: item.taxLabel,
      stockQty: item.trackStock ? Number(item.openingQty || 0) : 0,
      hsn: item.type === "PRODUCT" ? item.hsn : "",
      sac: item.type === "SERVICE" ? item.hsn : "",
      metadata: {
        category: item.category,
        itemCode: item.itemCode,
        salePriceTaxMode: item.salePriceTaxMode,
        purchasePrice: item.purchasePrice,
        purchasePriceTaxMode: item.purchasePriceTaxMode,
        discountValue: item.discountValue,
        discountType: item.discountType,
        trackStock: item.trackStock,
        lowStockQty: item.lowStockQty,
        warehouse: item.warehouse,
        imageUrl: item.imageUrl
      }
    });
    localStorage.setItem("itemsDraft", JSON.stringify(item));
    if (mode === "new") {
      setItem(DEFAULT_ITEM);
      setTab("pricing");
      return;
    }
    nav("/items", { replace: true });
  }

  return (
    <div className="max-w-6xl">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-lg font-semibold text-slate-900">Add Item</h1>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <button
                type="button"
                onClick={() => updateItem({ type: "PRODUCT" })}
                className={clsx(item.type === "PRODUCT" ? "text-slate-900" : "text-slate-400")}
              >
                Product
              </button>
              <button
                type="button"
                onClick={toggleType}
                className="relative h-6 w-11 rounded-full border border-slate-200 bg-slate-100"
                aria-pressed={item.type === "SERVICE"}
              >
                <span
                  className={clsx(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
                    item.type === "SERVICE" ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => updateItem({ type: "SERVICE" })}
                className={clsx(item.type === "SERVICE" ? "text-slate-900" : "text-slate-400")}
              >
                Service
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="h-9 w-9 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 flex items-center justify-center">
              <Settings className="h-4 w-4 text-slate-500" />
            </button>
            <button
              onClick={() => nav("/items")}
              className="h-9 w-9 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 flex items-center justify-center"
            >
              <X className="h-4 w-4 text-slate-600" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5">
            <FormField label="Item Name *">
              <input
                value={item.itemName}
                onChange={(e) => updateItem({ itemName: e.target.value })}
                className="w-full rounded-3xl border border-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
                placeholder="Enter item name"
              />
            </FormField>
          </div>

          <div className="lg:col-span-3">
            <FormField label="Item HSN (optional)">
              <div className="relative">
                <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  value={item.hsn}
                  onChange={(e) => updateItem({ hsn: e.target.value })}
                  className="w-full rounded-3xl border border-slate-100 px-4 py-2.5 text-sm outline-none"
                  placeholder="HSN code"
                />
              </div>
            </FormField>
          </div>

          <div className="lg:col-span-2">
            <FormField label="Unit">
              <button
                type="button"
                onClick={() => setUnitOpen(true)}
                className="w-full rounded-3xl border border-slate-100 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                {item.unit ? `Select Unit (${item.unit})` : "Select Unit"}
              </button>
            </FormField>
          </div>

          <div className="lg:col-span-2">
            <FormField label="Item Image">
              <label className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-3xl border border-slate-100 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50">
                <ImagePlus className="h-4 w-4" />
                Add Item Image
                <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
              </label>
            </FormField>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4">
            <FormField label="Category">
              <select
                value={item.category}
                onChange={(e) => updateItem({ category: e.target.value })}
                className="w-full rounded-3xl border border-slate-100 bg-white px-4 py-2.5 text-sm outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="lg:col-span-4">
            <FormField label="Item Code">
              <input
                value={item.itemCode}
                onChange={(e) => updateItem({ itemCode: e.target.value })}
                className="w-full rounded-3xl border border-slate-100 px-4 py-2.5 text-sm outline-none"
                placeholder="Item code"
              />
            </FormField>
          </div>

          <div className="lg:col-span-2 flex items-end">
            <button
              type="button"
              onClick={handleAssignCode}
              className="w-full rounded-3xl border border-slate-100 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Assign Code
            </button>
          </div>
        </div>

        <div className="mt-6 border-b border-slate-100 flex gap-6">
          <button
            type="button"
            onClick={() => setTab("pricing")}
            className={clsx(
              "pb-3 text-sm font-semibold",
              tab === "pricing"
                ? "text-rose-500 border-b-2 border-rose-500"
                : "text-slate-400 border-b-2 border-transparent"
            )}
          >
            Pricing
          </button>
          <button
            type="button"
            onClick={() => setTab("stock")}
            className={clsx(
              "pb-3 text-sm font-semibold",
              tab === "stock"
                ? "text-rose-500 border-b-2 border-rose-500"
                : "text-slate-400 border-b-2 border-transparent"
            )}
          >
            Stock
          </button>
        </div>

        {tab === "pricing" ? (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-3xl border border-slate-100 p-4">
                <p className="text-sm font-semibold text-slate-900">Sale Price</p>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={item.salePrice}
                    onChange={(e) => updateItem({ salePrice: e.target.value })}
                    className="rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none"
                    placeholder="Sale Price"
                  />
                  <select
                    value={item.salePriceTaxMode}
                    onChange={(e) => updateItem({ salePriceTaxMode: e.target.value })}
                    className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  >
                    {PRICE_TAX_MODES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={item.discountValue}
                    onChange={(e) => updateItem({ discountValue: e.target.value })}
                    className="rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none"
                    placeholder="Disc. On Sale Price"
                  />
                  <select
                    value={item.discountType}
                    onChange={(e) => updateItem({ discountType: e.target.value })}
                    className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  >
                    {DISCOUNT_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">
                  + Add Wholesale Price
                </button>
              </div>

              <div className="rounded-3xl border border-slate-100 p-4">
                <p className="text-sm font-semibold text-slate-900">Purchase Price</p>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={item.purchasePrice}
                    onChange={(e) => updateItem({ purchasePrice: e.target.value })}
                    className="rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none"
                    placeholder="Purchase Price"
                  />
                  <select
                    value={item.purchasePriceTaxMode}
                    onChange={(e) => updateItem({ purchasePriceTaxMode: e.target.value })}
                    className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  >
                    {PRICE_TAX_MODES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 p-4">
              <p className="text-sm font-semibold text-slate-900">
                {isIndia ? "GST / IGST" : "VAT"}
              </p>
              <div className="mt-3 max-w-xs">
                <TaxDropdown
                  country={companyCountry}
                  value={item.taxLabel}
                  onChange={(val) => updateItem({ taxLabel: val })}
                  className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-3xl border border-slate-100 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={item.trackStock}
                onChange={(e) => updateItem({ trackStock: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Track stock
            </label>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Opening Stock Qty">
                <input
                  value={item.openingQty}
                  onChange={(e) => updateItem({ openingQty: e.target.value })}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none"
                  disabled={!item.trackStock}
                />
              </FormField>

              <FormField label="Low Stock Alert Qty">
                <input
                  value={item.lowStockQty}
                  onChange={(e) => updateItem({ lowStockQty: e.target.value })}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none"
                  disabled={!item.trackStock}
                />
              </FormField>

              <FormField label="Unit">
                <input
                  value={item.unit}
                  readOnly
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none"
                />
              </FormField>

              <FormField label="Warehouse / Location">
                <input
                  value={item.warehouse}
                  onChange={(e) => updateItem({ warehouse: e.target.value })}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none"
                  disabled={!item.trackStock}
                />
              </FormField>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => saveItem("new")}
            disabled={!isValid}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save & New
          </button>
          <GradientButton onClick={() => saveItem("save")} disabled={!isValid}>
            Save
          </GradientButton>
        </div>
      </Card>

      <UnitPickerModal
        open={unitOpen}
        value={item.unit}
        onClose={() => setUnitOpen(false)}
        onSelect={(unit) => updateItem({ unit })}
      />
    </div>
  );
}
