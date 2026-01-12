import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, ImagePlus } from "lucide-react";
import clsx from "clsx";

import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import InvoicePreview from "../components/InvoicePreview";
import { api } from "../lib/api";
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
  { id: "minimal", label: "Minimal" }
];

const FONT_OPTIONS = ["Inter", "Roboto", "Poppins"];

const DEFAULT_DEMO = {
  invoiceNo: "INV-1208",
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: "2026-02-05",
  customer: {
    name: "Kavin Stores",
    phone: "+94 71 111 2222",
    address: "No. 12, Business Street, Western"
  },
  items: [
    { id: "it1", name: "Granite Slab", qty: 2, rate: 8500, amount: 17000 },
    { id: "it2", name: "Installation", qty: 1, rate: 15000, amount: 15000 }
  ],
  totals: {
    subTotal: 32000,
    tax: 5760,
    total: 37760,
    balance: 37760
  }
};

function mapTemplatePayload(payload) {
  if (!payload) return null;
  const source = payload.invoice_template || payload.invoiceTemplate || payload;
  const next = {
    templateId: source.invoice_template_id || source.template_id || source.templateId,
    primaryColor: source.invoice_primary_color || source.primaryColor,
    bgColor: source.invoice_bg_color || source.bgColor,
    fontFamily: source.invoice_font_family || source.fontFamily,
    logoUrl: source.invoice_logo_url || source.logoUrl
  };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  });
  return next;
}

export default function InvoiceTemplateSetup() {
  const nav = useNavigate();
  const company = companyGetProfile();
  const [config, setConfig] = useState(() => {
    const stored = getInvoiceTemplateConfig();
    return {
      ...DEFAULT_TEMPLATE_CONFIG,
      ...stored,
      logoUrl: stored.logoUrl || company?.logoBase64 || ""
    };
  });
  const [saving, setSaving] = useState(false);

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

  const demoInvoice = useMemo(() => {
    return {
      ...DEFAULT_DEMO,
      companyName: company?.companyName || "BillJoy Technologies"
    };
  }, [company]);

  function updateConfig(patch) {
    setConfig((prev) => ({ ...prev, ...patch }));
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
      invoice_logo_url: config.logoUrl
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
                    <div className="mt-2 h-14 rounded-xl border border-slate-100 bg-slate-50 p-2">
                      <div className="h-1.5 w-12 rounded-full bg-slate-200" />
                      <div className="mt-2 space-y-1">
                        <div className="h-1.5 w-full rounded-full bg-slate-200" />
                        <div className="h-1.5 w-10/12 rounded-full bg-slate-200" />
                      </div>
                      <div className="mt-2 h-1.5 w-8 rounded-full bg-slate-200" />
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
          </div>
          <div className="mt-4">
            <InvoicePreview
              templateId={config.templateId}
              styleConfig={{
                primaryColor: config.primaryColor,
                bgColor: config.bgColor,
                fontFamily: config.fontFamily,
                logoUrl: config.logoUrl
              }}
              invoiceData={demoInvoice}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
