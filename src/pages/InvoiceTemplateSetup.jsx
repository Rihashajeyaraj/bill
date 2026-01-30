import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, ImagePlus, PencilLine } from "lucide-react";
import clsx from "clsx";

import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import FormField from "../components/FormField";
import InvoicePreview from "../components/InvoicePreview";
import { api } from "../lib/api";
import { computeIndiaGST, computeVAT } from "../services/tax";
import {
  DEFAULT_TEMPLATE_CONFIG,
  getInvoiceTemplateConfig,
  setInvoiceTemplateConfig,
  setInvoiceTemplateCompleted
} from "../lib/templateStore";
import { companyGetProfile, companySetCompleted } from "../services/company.service";
import { UI } from "../theme/tokens";

const TEMPLATE_OPTIONS = [
  { id: "compact", label: "Compact" },
  { id: "standard", label: "Standard" },
  { id: "modern", label: "Modern" },
  { id: "minimal", label: "Minimal" },
  { id: "classic", label: "Classic" },
  { id: "bold", label: "Bold" },
  { id: "elegant", label: "Elegant" },
  { id: "mono", label: "Mono" }
];

const FONT_OPTIONS = ["Inter", "Roboto", "Poppins"];

const FALLBACK_COMPANY = "BillJoy Technologies";

const DEFAULT_DEMO = {
  title: "Tax Invoice",
  invoiceNo: "INV-1208",
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: "2026-02-05",
  country: "India",
  placeOfSupply: "Tamil Nadu",
  seller: {
    name: "BillJoy Technologies",
    address: "No. 12, Business Street, Chennai, Tamil Nadu, 600001",
    gstin: "29ABCDE1234F1Z5",
    phone: "+91 98765 43210",
    email: "billing@billjoy.com",
    state: "Tamil Nadu"
  },
  customer: {
    name: "Kavin Stores",
    phone: "+91 90000 12345",
    address: "15/2, Main Road, Chennai, Tamil Nadu, 600002",
    gstin: "29AACCK1234A1ZP",
    state: "Tamil Nadu"
  },
  items: [
    { id: "it1", name: "LED Bulb", hsn: "9405", qty: 10, rate: 100, taxRate: 18 },
    { id: "it2", name: "Installation", hsn: "9987", qty: 1, rate: 1500, taxRate: 18 }
  ],
  taxRate: 18
};

function computePreviewTotals(preview) {
  const items = preview.items.map((item) => {
    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    const taxableValue = qty * rate;
    return { ...item, qty, rate, taxableValue, amount: taxableValue };
  });
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const rate = Number(preview.taxRate || 0);
  const isIndia = preview.country === "India";
  const tax = isIndia
    ? computeIndiaGST({
        taxRate: rate,
        companyState: preview.seller?.state || "",
        customerState: preview.customer?.state || preview.placeOfSupply || "",
        taxableAmount: subTotal
      })
    : computeVAT({ vatRate: rate, taxableAmount: subTotal });
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

function mapTemplatePayload(payload) {
  if (!payload) return null;
  const source = payload.invoice_template || payload.invoiceTemplate || payload;
  const next = {
    templateId: source.invoice_template_id || source.template_id || source.templateId,
    primaryColor: source.invoice_primary_color || source.primaryColor,
    bgColor: source.invoice_bg_color || source.bgColor,
    fontFamily: source.invoice_font_family || source.fontFamily,
    logoUrl: source.invoice_logo_url || source.logoUrl,
    logoPosition: source.invoice_logo_position || source.logoPosition
  };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  });
  return next;
}

export default function InvoiceTemplateSetup() {
  const nav = useNavigate();
  const company = companyGetProfile();
  const companyName = company?.companyName || FALLBACK_COMPANY;
  const [config, setConfig] = useState(() => {
    const stored = getInvoiceTemplateConfig();
    return {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...stored,
      logoUrl: stored.logoUrl || company?.logoBase64 || ""
    };
  });
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState(() => ({
    ...DEFAULT_DEMO,
    companyName
  }));

  useEffect(() => {
    let active = true;

    async function load() {
      let me = null;
      let templatePayload = null;

      try {
        const res = await api.get("/api/me");
        me = res.data;
      } catch {
        me = null;
      }

      try {
        const res = await api.get("/api/company/invoice-template");
        templatePayload = res.data;
      } catch {
        try {
          const res = await api.get("/api/company");
          templatePayload = res.data;
        } catch {
          templatePayload = null;
        }
      }

      if (!active) return;

      if (me) {
        if (typeof me.company_setup_completed === "boolean") {
          companySetCompleted(me.company_setup_completed);
        }
        if (typeof me.invoice_template_completed === "boolean") {
          setInvoiceTemplateCompleted(me.invoice_template_completed);
        }
      }

      const mapped = mapTemplatePayload(templatePayload);
      if (mapped) {
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
      return next;
    });
  }, [companyName]);

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
    const payload = {
      invoice_template_id: config.templateId,
      invoice_primary_color: config.primaryColor,
      invoice_bg_color: config.bgColor,
      invoice_font_family: config.fontFamily,
      invoice_logo_url: config.logoUrl,
      invoice_logo_position: config.logoPosition
    };

    try {
      await api.post("/api/company/invoice-template", payload);
      setInvoiceTemplateConfig(config);
      setInvoiceTemplateCompleted(true);
      nav("/dashboard", { replace: true });
    } catch {
      setInvoiceTemplateConfig(config);
      setInvoiceTemplateCompleted(true);
      nav("/dashboard", { replace: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Invoice Template Setup"
        subtitle="Choose a template and brand colors before accessing the dashboard."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
        <Card className="p-5">
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
            <p className="text-sm font-semibold text-slate-900">Invoice Template</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {TEMPLATE_OPTIONS.map((option) => {
                const selected = config.templateId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateConfig({ templateId: option.id })}
                    className={clsx(
                      "rounded-2xl border p-3 text-left transition shadow-soft bg-white",
                      selected ? "border-slate-400" : "border-slate-100 hover:border-slate-200"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">{option.label}</p>
                      {selected ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : null}
                    </div>
                    <div className="mt-2 h-14 rounded-xl border border-slate-100 bg-slate-50 p-2 text-[9px] text-slate-500 leading-tight">
                      <p className="font-semibold text-slate-600">Invoice #1208</p>
                      <p>Bill To: Kavin Stores</p>
                      <p>Item: Granite Slab</p>
                      <p>Total: 23,500</p>
                    </div>
                  </button>
                );
              })}
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
            <div className="mt-3 grid grid-cols-2 gap-3">
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
              onChange={(e) => updateConfig({ fontFamily: e.target.value })}
              className="mt-3 w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
              style={{ "--tw-ring-color": UI.COLORS.ring }}
            >
              {FONT_OPTIONS.map((font) => (
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

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Live Preview</p>
              <p className="text-xs text-slate-500">Preview updates instantly</p>
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
                  <input
                    type="date"
                    value={preview.invoiceDate}
                    onChange={(e) => updatePreview({ invoiceDate: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Due Date">
                  <input
                    type="date"
                    value={preview.dueDate}
                    onChange={(e) => updatePreview({ dueDate: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Tax %">
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
        </Card>
      </div>
    </div>
  );
}
