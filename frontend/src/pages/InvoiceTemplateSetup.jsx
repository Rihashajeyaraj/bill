import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout, Sparkles, CheckCircle2, ArrowRight, Upload, ImagePlus } from "lucide-react";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import Card from "../components/Card";
import InvoiceTemplateSelector from "../components/InvoiceTemplateSelector";
import InvoicePreview from "../components/InvoicePreview";
import {
  getInvoiceTemplateConfig,
  setInvoiceTemplateConfig,
  setInvoiceTemplateCompleted,
  DEFAULT_TEMPLATE_CONFIG
} from "../lib/templateStore";
import {
  fetchTenantTemplates,
  setTemplateAsDefault,
  getDefaultTemplateKey
} from "../services/templateService";
import {
  companyLoadMyOrganization,
  companySaveProfileRemote,
  companyUpdateProfile
} from "../services/company.service";
import { useOrganization } from "../context/OrganizationContext";

export default function InvoiceTemplateSetup() {
  const nav = useNavigate();
  const { profile: organizationProfile = {}, country = "India" } = useOrganization();
  const company = organizationProfile;
  const companyName = company?.companyName || "Your Company Pvt Ltd";

  const [selectedTemplateKey, setSelectedTemplateKey] = useState(() => getDefaultTemplateKey());
  const [logoUrl, setLogoUrl] = useState(() => company?.logoBase64 || company?.logoUrl || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      const remoteProfile = await companyLoadMyOrganization();
      if (!active) return;
      const profile = remoteProfile || organizationProfile || {};
      const storedTemplateKey = profile?.settings?.invoiceTemplate?.templateId || getDefaultTemplateKey();
      setSelectedTemplateKey(storedTemplateKey);
      setLogoUrl(profile?.logoBase64 || profile?.logoUrl || profile?.settings?.logoUrl || "");
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const handleLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSaveAndProceed = async () => {
    setSaving(true);
    setSaveError("");

    try {
      // 1. Update template service default
      await setTemplateAsDefault(selectedTemplateKey);

      // 2. Update local template config store
      const nextConfig = {
        ...DEFAULT_TEMPLATE_CONFIG,
        templateId: selectedTemplateKey,
        logoUrl
      };
      setInvoiceTemplateConfig(nextConfig);
      setInvoiceTemplateCompleted(true);

      // 3. Sync organization profile remote
      const profile = organizationProfile || {};
      const nextProfile = {
        ...profile,
        logoBase64: logoUrl || profile.logoBase64,
        settings: {
          ...(profile.settings || {}),
          invoiceTemplate: nextConfig,
          invoice_template_selected: true,
          default_template_key: selectedTemplateKey,
          logoUrl
        },
        updated_at: new Date().toISOString()
      };
      companyUpdateProfile(nextProfile);
      await companySaveProfileRemote(nextProfile);

      // 4. Proceed to dashboard
      nav("/dashboard", { replace: true });
    } catch (error) {
      setSaveError(error?.message || "Template saved locally. Navigating to dashboard...");
      setInvoiceTemplateCompleted(true);
      nav("/dashboard", { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const demoInvoiceData = {
    title: "PREVIEW TAX INVOICE",
    isProforma: false,
    companyName: companyName || "",
    companyAddress: company?.address || "",
    companyGstin: company?.tax?.gstin || "",
    companyPan: company?.tax?.pan || "",
    companyLogoUrl: logoUrl,
    customerName: "",
    customerAddress: "",
    customerGstin: "",
    customerState: "",
    customerCountry: country || "",
    invoiceNo: "-",
    invoiceDate: new Date().toISOString().slice(0, 10),
    currencyCode: "INR",
    items: [],
    totals: { subTotal: 0, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, total: 0 },
    grand_total_in_words: "",
    bankDetails: {
      bankName: "",
      accountName: companyName || "",
      accountNo: "",
      ifsc: "",
      swift: ""
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 space-y-5">
      {/* PAGE HEADER */}
      <PageHeader
        title="Invoice Template Setup"
        subtitle="Select your company's default invoice template and visual format for live billing & PDF generation."
      />

      {saveError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {saveError}
        </div>
      )}

      {/* TOP BRANDING & LOGO ROW */}
      <Card className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-2xl shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <div className="relative group">
                <img src={logoUrl} alt="Company Logo" className="h-14 w-28 object-contain bg-white p-2 rounded-xl shadow-xs" />
                <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-bold rounded-xl cursor-pointer transition-opacity">
                  Change
                  <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
                </label>
              </div>
            ) : (
              <label className="h-14 w-32 border-2 border-dashed border-slate-500 hover:border-emerald-400 bg-slate-800/80 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors text-xs text-slate-300 font-semibold">
                <ImagePlus className="w-4 h-4 text-emerald-400" />
                <span>Upload Logo</span>
                <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
              </label>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-wide uppercase text-white">{companyName}</h2>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Multi-Tenant Ready
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Country: <strong>{country}</strong> · Tax Mode: <strong>GST / VAT Engine Enabled</strong>
              </p>
            </div>
          </div>

          <GradientButton
            onClick={handleSaveAndProceed}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-md"
          >
            {saving ? "Saving Template..." : "Save & Proceed to Dashboard"}
            <ArrowRight className="w-4 h-4" />
          </GradientButton>
        </div>
      </Card>

      {/* UNIFIED TEMPLATE SELECTOR SYSTEM */}
      <div className="space-y-4">
        <InvoiceTemplateSelector
          selectedTemplateKey={selectedTemplateKey}
          onSelectTemplate={(key) => setSelectedTemplateKey(key)}
          invoiceData={demoInvoiceData}
        />
      </div>

      {/* MASTER LIVE PREVIEW CONTAINER */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Layout className="w-4 h-4 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Live Master Preview</h3>
          </div>
          <span className="text-xs text-slate-500">
            Selected Template: <strong className="text-emerald-700 uppercase">{selectedTemplateKey}</strong>
          </span>
        </div>

        <div className="bg-slate-100/70 p-4 sm:p-6 rounded-2xl border border-slate-200">
          <InvoicePreview
            templateId={selectedTemplateKey}
            invoiceData={{
              ...demoInvoiceData,
              companyLogoUrl: logoUrl
            }}
          />
        </div>

        <div className="mt-5 flex justify-end">
          <GradientButton
            onClick={handleSaveAndProceed}
            disabled={saving}
            className="px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-md"
          >
            {saving ? "Saving Setup..." : "Save & Proceed to Dashboard"}
            <ArrowRight className="w-4 h-4" />
          </GradientButton>
        </div>
      </Card>
    </div>
  );
}
