import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, ImagePlus, PencilLine } from "lucide-react";
import clsx from "clsx";

import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import FormField from "../components/FormField";
import InvoicePreview from "../components/InvoicePreview";
import DateInput from "../components/DateInput";
import { computeIndiaGST, computeVAT } from "../services/tax";
import {
  DEFAULT_TEMPLATE_CONFIG,
  getInvoiceTemplateConfig,
  setInvoiceTemplateConfig,
  setInvoiceTemplateCompleted
} from "../lib/templateStore";
import {
  companyLoadMyOrganization,
  companySaveProfileRemote,
  companyUpdateProfile
} from "../services/company.service";
import { useOrganization } from "../context/OrganizationContext";
import { UI } from "../theme/tokens";
import { APP_FONT_OPTIONS } from "../theme/fontPresets";
import {
  getCountryInvoiceConfig,
  getCountryLabel,
  getCountryTemplates
} from "../data/invoiceCountryConfig";

const FALLBACK_COMPANY = "Company Name";

const BASE_INVOICE = {
  invoiceNo: "",
  invoiceDate: "",
  dueDate: "",
  placeOfSupply: "",
  seller: {
    name: "",
    address: "",
    phone: "",
    email: "",
    state: ""
  },
  customer: {
    name: "",
    phone: "",
    address: "",
    state: ""
  },
  items: []
};

function buildEmptyInvoice(country, companyName, companyProfile) {
  const config = getCountryInvoiceConfig(country);
  const taxProfile = companyProfile?.tax || {};
  const title = config.invoiceTitle;
  const base = {
    ...BASE_INVOICE,
    title,
    country: config.label,
    companyName,
    currencySymbol: config.currencySymbol,
    taxRate: config.defaultTaxRate,
    tax: {
      type: config.taxType,
      rate: config.defaultTaxRate
    }
  };

  if (config.taxType === "GST") {
    return {
      ...base,
      seller: {
        ...base.seller,
        gstin: taxProfile.gstin || ""
      },
      customer: {
        ...base.customer,
        gstin: ""
      }
    };
  }

  if (config.label === "UAE") {
    return {
      ...base,
      tax: {
        ...base.tax,
        idLabel: "TRN",
        idValue: taxProfile.vatNumber || ""
      }
    };
  }

  if (config.taxType === "VAT") {
    return {
      ...base,
      tax: {
        ...base.tax,
        idLabel: "VAT Registration No.",
        idValue: taxProfile.vatNumber || ""
      }
    };
  }

  if (config.taxType === "SALES_TAX") {
    return {
      ...base,
      tax: {
        ...base.tax,
        idLabel: "EIN",
        idValue: taxProfile.taxId || ""
      }
    };
  }

  return base;
}

function computePreviewTotals(preview) {
  const items = (preview.items || []).map((item) => {
    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    const taxableValue = qty * rate;
    return { ...item, qty, rate, taxableValue, amount: taxableValue };
  });
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const rate = Number(preview.taxRate || preview.tax?.rate || 0);
  const taxType = preview.tax?.type || (preview.country === "India" ? "GST" : "NONE");
  const computedTax =
    taxType === "GST"
      ? computeIndiaGST({
          taxRate: rate,
          companyState: preview.seller?.state || "",
          customerState: preview.customer?.state || preview.placeOfSupply || "",
          taxableAmount: subTotal
        })
      : taxType === "VAT"
        ? computeVAT({ vatRate: rate, taxableAmount: subTotal })
        : computeVAT({ vatRate: 0, taxableAmount: subTotal });
  const tax = { ...(preview.tax || {}), ...computedTax };
  const total = subTotal + tax.totalTax;
  return {
    ...preview,
    items,
    tax,
    totals: {
      subTotal,
      tax: tax.totalTax,
      total,
      balance: total
    }
  };
}

export default function InvoiceTemplateSetup() {
  const nav = useNavigate();
  const { profile: organizationProfile = {}, country = "India" } = useOrganization();
  const company = organizationProfile;
  const companyName = company?.companyName || FALLBACK_COMPANY;
  const countryConfig = getCountryInvoiceConfig(country);
  const countryTemplates = getCountryTemplates(country);
  const [config, setConfig] = useState(() => {
    const stored = getInvoiceTemplateConfig();
    const templateAllowed = countryTemplates.some((tpl) => tpl.id === stored.templateId);
    const fallbackTemplate = countryTemplates[0]?.id || DEFAULT_TEMPLATE_CONFIG.templateId;
    return {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...stored,
      templateId: templateAllowed ? stored.templateId : fallbackTemplate,
      logoUrl: stored.logoUrl || company?.logoBase64 || ""
    };
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState(() => ({
    ...buildEmptyInvoice(country, companyName, company)
  }));

  useEffect(() => {
    let active = true;

    async function load() {
      const remoteProfile = await companyLoadMyOrganization();
      if (!active) return;
      const profile = remoteProfile || organizationProfile || {};
      const mapped = profile?.settings?.invoiceTemplate || null;
      if (mapped && typeof mapped === "object") {
        setConfig((prev) => {
          const next = { ...DEFAULT_TEMPLATE_CONFIG, ...prev, ...mapped };
          setInvoiceTemplateConfig(next);
          return next;
        });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPreview((prev) => {
      const next = { ...prev };
      if (!next.companyName || next.companyName === FALLBACK_COMPANY) {
        next.companyName = companyName;
      }
      if (!next.seller || !next.seller.name || next.seller.name === FALLBACK_COMPANY) {
        next.seller = { ...(next.seller || {}), name: companyName };
      }
      if (next.country !== country) {
        return { ...buildEmptyInvoice(country, companyName, company) };
      }
      return next;
    });
  }, [companyName, country]);

  useEffect(() => {
    const allowed = countryTemplates.some((tpl) => tpl.id === config.templateId);
    if (!allowed && countryTemplates.length) {
      setConfig((prev) => ({ ...prev, templateId: countryTemplates[0].id }));
    }
  }, [countryTemplates, config.templateId]);

  const demoInvoice = useMemo(() => computePreviewTotals(preview), [preview]);

  function updateConfig(patch) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  function updatePreview(patch) {
    setPreview((prev) => ({ ...prev, ...patch }));
  }

  function updatePreviewItem(id, patch) {
    setPreview((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }));
  }

  async function handleLogoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateConfig({ logoUrl: reader.result });
    reader.readAsDataURL(file);
  }

  async function saveTemplate() {
    setSaving(true);
    setSaveError("");
    const safeTemplate = setInvoiceTemplateConfig(config);

    try {
      setInvoiceTemplateCompleted(true);

      const profile = organizationProfile || {};
      const nextProfile = {
        ...profile,
        settings: {
          ...(profile.settings || {}),
          invoiceTemplate: safeTemplate,
          invoice_template_selected: true
        },
        updated_at: new Date().toISOString()
      };
      companyUpdateProfile(nextProfile);
      await companySaveProfileRemote(nextProfile);

      nav("/dashboard", { replace: true });
    } catch (error) {
      setSaveError(error?.message || "Template saved locally but cloud sync failed.");
      setInvoiceTemplateCompleted(true);
      nav("/dashboard", { replace: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-5 sm:py-6">
      <PageHeader
        title="Invoice Template Setup"
        subtitle="Choose a template and brand colors before accessing the dashboard."
      />
      {saveError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {saveError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)] xl:gap-5">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Set up your invoices</p>
              <p className="text-xs text-slate-500 mt-1">Invoice Template</p>
            </div>
            <span
              className="rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
              style={{ color: UI.COLORS.deepRed }}
            >
              STEP 1/3
            </span>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Invoice Template</p>
                <p className="text-xs text-slate-500 mt-1">Templates based on: {getCountryLabel(country)}</p>
              </div>
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {countryConfig.taxType}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {countryTemplates.map((option) => {
                const selected = config.templateId === option.id;
                const hint =
                  option.id === "india_triplicate"
                    ? "Triplicate print layout"
                    : option.id === "india_blue_gst"
                      ? "Blue GST layout"
                      : option.id === "india_gst_sample"
                    ? "CGST + SGST format"
                    : option.id === "india_igst_sample"
                      ? "IGST format"
                      : "Invoice Preview";
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateConfig({ templateId: option.id })}
                    className={clsx(
                      "rounded-2xl border bg-white p-3 text-left transition shadow-soft",
                      selected ? "border-slate-400" : "border-slate-100 hover:border-slate-200"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-semibold text-slate-700">{option.label}</p>
                      {selected ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : null}
                    </div>
                    <div className="mt-2 h-14 rounded-xl border border-slate-100 bg-slate-50 p-2 text-[9px] leading-tight text-slate-500">
                      <p className="font-semibold text-slate-600">{hint}</p>
                      <p>Bill To: —</p>
                      <p>Item: —</p>
                      <p>Total: {countryConfig.currencySymbol}—</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
              <p className="text-xs font-semibold text-slate-600">Mandatory fields</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {countryConfig.requiredFields.map((field) => (
                  <span
                    key={field}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-900">Organization Logo</p>
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={config.logoUrl}
                onChange={(e) => updateConfig({ logoUrl: e.target.value })}
                placeholder="Paste logo URL"
                className="w-full rounded-2xl border border-slate-100 px-3 py-2 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              />
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-100 bg-slate-50">
                  <ImagePlus className="h-4 w-4 text-slate-400" />
                </span>
                <span>Upload logo (optional)</span>
                <input type="file" accept="image/*" onChange={handleLogoFile} className="text-xs" />
              </label>
            </div>
          </div>

          <div className="mt-5">
            <FormField label="Logo Position">
              <div className="grid grid-cols-3 gap-2">
                {["left", "center", "right"].map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => updateConfig({ logoPosition: pos })}
                    className={clsx(
                      "rounded-2xl border px-3 py-2 text-xs font-semibold capitalize",
                      config.logoPosition === pos
                        ? "border-slate-400 bg-slate-50 text-slate-800"
                        : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </FormField>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-900">Invoice Colors</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-slate-500">Background</span>
                <input
                  type="color"
                  value={config.bgColor}
                  onChange={(e) => updateConfig({ bgColor: e.target.value })}
                  className="mt-2 h-10 w-full rounded-2xl border border-slate-100 bg-white p-1"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Accent</span>
                <input
                  type="color"
                  value={config.primaryColor}
                  onChange={(e) => updateConfig({ primaryColor: e.target.value })}
                  className="mt-2 h-10 w-full rounded-2xl border border-slate-100 bg-white p-1"
                />
              </label>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-900">Font</p>
            <select
              value={config.fontFamily}
              onChange={(e) => {
                const nextFont = e.target.value;
                updateConfig({ fontFamily: nextFont });
              }}
              className="mt-3 w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
              style={{ "--tw-ring-color": UI.COLORS.ring }}
            >
              {APP_FONT_OPTIONS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6">
            <GradientButton
              className="w-full justify-center"
              onClick={saveTemplate}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save & Proceed"}
            </GradientButton>
            <p className="mt-3 text-xs text-slate-500">
              This template will be used for invoices and print/PDF.
            </p>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Live Preview</p>
              <p className="text-xs text-slate-500">
                Preview updates instantly · {getCountryLabel(country)} · {countryConfig.currencySymbol}
                {countryConfig.currency}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <PencilLine className="h-4 w-4" />
              {previewOpen ? "Close Edit" : "Edit Preview"}
            </button>
          </div>
          {previewOpen ? (
            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Company Name">
                  <input
                    value={preview.companyName}
                    onChange={(e) => updatePreview({ companyName: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Invoice Title">
                  <input
                    value={preview.title}
                    onChange={(e) => updatePreview({ title: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Invoice No">
                  <input
                    value={preview.invoiceNo}
                    onChange={(e) => updatePreview({ invoiceNo: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Invoice Date">
                  <DateInput
                    value={preview.invoiceDate}
                    onChange={(nextValue) => updatePreview({ invoiceDate: nextValue })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Due Date">
                  <DateInput
                    value={preview.dueDate}
                    onChange={(nextValue) => updatePreview({ dueDate: nextValue })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField
                  label={
                    countryConfig.taxType === "GST"
                      ? "GST %"
                      : countryConfig.taxType === "VAT"
                        ? "VAT %"
                        : "Sales Tax % (optional)"
                  }
                >
                  <input
                    value={preview.taxRate}
                    onChange={(e) => updatePreview({ taxRate: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Customer Name">
                  <input
                    value={preview.customer.name}
                    onChange={(e) =>
                      updatePreview({ customer: { ...preview.customer, name: e.target.value } })
                    }
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Customer Phone">
                  <input
                    value={preview.customer.phone}
                    onChange={(e) =>
                      updatePreview({ customer: { ...preview.customer, phone: e.target.value } })
                    }
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Customer Address">
                  <input
                    value={preview.customer.address}
                    onChange={(e) =>
                      updatePreview({ customer: { ...preview.customer, address: e.target.value } })
                    }
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Items</p>
                <div className="mt-3 space-y-3">
                  {preview.items.map((item) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        value={item.name}
                        onChange={(e) => updatePreviewItem(item.id, { name: e.target.value })}
                        className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                        placeholder="Item name"
                      />
                      <input
                        value={item.qty}
                        onChange={(e) => updatePreviewItem(item.id, { qty: e.target.value })}
                        className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                        placeholder="Qty"
                      />
                      <input
                        value={item.rate}
                        onChange={(e) => updatePreviewItem(item.id, { rate: e.target.value })}
                        className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                        placeholder="Rate"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-4">
            <div className="mx-auto w-full max-w-[780px] xl:max-w-[740px]">
              <InvoicePreview
                templateId={config.templateId}
                styleConfig={{
                  primaryColor: config.primaryColor,
                  bgColor: config.bgColor,
                  fontFamily: config.fontFamily,
                  logoUrl: config.logoUrl,
                  logoPosition: config.logoPosition
                }}
                invoiceData={demoInvoice}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
