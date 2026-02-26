import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Copy,
  Database,
  Globe,
  Hash,
  LayoutTemplate,
  Palette,
  Percent,
  Plus,
  Users2
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import FormField from "../components/FormField";
import FileUpload from "../components/FileUpload";
import GradientButton from "../components/GradientButton";
import Badge from "../components/Badge";
import CurrencyMultiInput from "../components/CurrencyMultiInput";
import ThemeModal from "../components/theme/ThemeModal";
import {
  THEME_PRESETS,
  findThemePresetById,
  findThemePresetBySettings
} from "../components/theme/themePresets";
import { useTheme } from "../context/ThemeContext";
import { useOrganization } from "../context/OrganizationContext";
import { useToast } from "../context/ToastContext";
import {
  COUNTRIES,
  companyGetProfile,
  organizationListUsers,
  organizationUpdateUser,
  organizationGenerateCode,
  organizationListActiveCodes,
  settingsGetCompany,
  settingsPutCompany
} from "../services/company.service";
import { authGetRole, authGetToken, authGetUser } from "../services/auth.service";
import { isOwnerRole, normalizeRoleLabel } from "../services/roles";
import { uid } from "../services/storage";
import { isSupabaseConfigured, supabase } from "../services/supabaseClient";
import { UI } from "../theme/tokens";
import { APP_FONT_OPTIONS } from "../theme/fontPresets";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  RADIUS_STYLE_OPTIONS,
  SIDEBAR_STYLE_OPTIONS,
  THEME_APPEARANCE_PRESETS,
  UI_DENSITY_OPTIONS
} from "../theme/runtimeTheme";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";
import {
  DEFAULT_TEMPLATE_CONFIG,
  getInvoiceTemplateConfig,
  setInvoiceTemplateCompleted,
  setInvoiceTemplateConfig
} from "../lib/templateStore";
import { getCountryTemplates } from "../data/invoiceCountryConfig";

const SECTION_ITEMS = [
  {
    id: "profile",
    label: "Company Profile",
    description: "Brand identity and contact details.",
    icon: Building2
  },
  {
    id: "localization",
    label: "Localization",
    description: "Country, currency, and formats.",
    icon: Globe
  },
  {
    id: "tax",
    label: "Tax Settings",
    description: "Country-aware tax configuration.",
    icon: Percent
  },
  {
    id: "numbering",
    label: "Numbering & Documents",
    description: "Prefixes and document sequences.",
    icon: Hash
  },
  {
    id: "theme",
    label: "Theme & Appearance",
    description: "Brand colors and invoice styling.",
    icon: Palette
  },
  {
    id: "invoiceTemplate",
    label: "Invoice Template",
    description: "Template, logo and print appearance.",
    icon: LayoutTemplate
  },
  {
    id: "users",
    label: "Users & Roles",
    description: "Access control and approvals.",
    icon: Users2
  },
  {
    id: "preferences",
    label: "Data & Preferences",
    description: "Audit trails and system toggles.",
    icon: Database
  }
];

const BUSINESS_TYPES = [
  "Sole Proprietor",
  "Partnership",
  "Private Limited",
  "LLC",
  "Non Profit",
  "Other"
];

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles"
];

const DATE_FORMATS = ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const NUMBER_FORMATS = ["1,23,456.78", "123,456.78", "123.456,78"];
const MAX_CURRENCIES = 3;
const COUNTRY_META = {
  India: { currency: "INR", code: "IN", gstDefault: 18 },
  "Sri Lanka": { currency: "LKR", code: "LK", vatDefault: 18 },
  UAE: { currency: "AED", code: "AE", vatDefault: 5 },
  "United Kingdom": { currency: "GBP", code: "UK", vatDefault: 20 },
  Ireland: { currency: "EUR", code: "IE", vatDefault: 23 },
  USA: { currency: "USD", code: "US" }
};

const VAT_COUNTRIES = ["Sri Lanka", "UAE", "United Kingdom", "Ireland"];

const DOCUMENT_TYPES = [
  { key: "invoice", label: "Invoice", prefix: "INV" },
  { key: "purchase", label: "Purchase", prefix: "BILL" },
  { key: "creditNote", label: "Credit Note", prefix: "CN" },
  { key: "debitNote", label: "Debit Note", prefix: "DN" },
  { key: "paymentIn", label: "Payment In", prefix: "PR" },
  { key: "paymentOut", label: "Payment Out", prefix: "PO" }
];

const DEFAULT_ROLE_PERMISSIONS = {
  Owner: { create: true, edit: true, delete: true, reports: true, approvals: true },
  Accounter: { create: true, edit: true, delete: false, reports: true, approvals: false },
  Staff: { create: true, edit: false, delete: false, reports: false, approvals: false }
};

const RADIUS_LABELS = {
  rounded: "Rounded",
  "soft-rounded": "Soft Rounded",
  square: "Square"
};

const DENSITY_LABELS = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious"
};

const SIDEBAR_STYLE_LABELS = {
  solid: "Solid",
  glass: "Glass Blur",
  gradient: "Gradient"
};

function normalizeThemeFontSizePx(value) {
  const legacy = {
    compact: 14,
    default: 16,
    large: 18
  };
  const key = String(value || "").trim().toLowerCase();
  const parsed = Object.prototype.hasOwnProperty.call(legacy, key)
    ? legacy[key]
    : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return FONT_SIZE_DEFAULT;
  return Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, parsed)));
}

function getCountryMeta(country) {
  if (COUNTRY_META[country]) return COUNTRY_META[country];
  const clean = (country || "").trim();
  if (!clean) return { currency: "", code: "NA" };
  return { currency: "", code: clean.slice(0, 2).toUpperCase() };
}

function normalizeCurrencyCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function uniqueCurrencyList(values) {
  const seen = new Set();
  const unique = [];
  values.forEach((value) => {
    const code = normalizeCurrencyCode(value);
    if (!code || seen.has(code)) return;
    seen.add(code);
    unique.push(code);
  });
  return unique;
}

function normalizeLocalizationCurrencies({ country, primary, currencies }) {
  const nextCountry = country || "India";
  const autoCurrency = normalizeCurrencyCode(getCountryMeta(nextCountry).currency);
  const primaryCurrency = autoCurrency || normalizeCurrencyCode(primary);
  const merged = uniqueCurrencyList([
    primaryCurrency,
    ...(Array.isArray(currencies) ? currencies : []),
    primary
  ]);
  if (!primaryCurrency) return merged.slice(0, MAX_CURRENCIES);
  const extras = merged
    .filter((currency) => currency !== primaryCurrency)
    .slice(0, Math.max(MAX_CURRENCIES - 1, 0));
  return [primaryCurrency, ...extras];
}

function buildDefaultPrefixes(country) {
  const code = getCountryMeta(country).code || "NA";
  return DOCUMENT_TYPES.reduce((acc, doc) => {
    acc[doc.key] = `${doc.prefix}-${code}-0001`;
    return acc;
  }, {});
}

function buildDefaultSettings(profile, currentUser, remoteMembers = null) {
  const stored = profile?.settings || {};
  const baseCountry = stored.localization?.defaultCountry || profile?.country || "India";
  const localizationCurrencies = normalizeLocalizationCurrencies({
    country: baseCountry,
    primary: stored.localization?.currency || profile?.currency || profile?.tax?.currency,
    currencies: [
      ...(Array.isArray(stored.localization?.currencies) ? stored.localization.currencies : []),
      ...(Array.isArray(profile?.currencies) ? profile.currencies : []),
      profile?.currency,
      profile?.tax?.currency
    ]
  });
  const currency = localizationCurrencies[0] || "";
  const meta = getCountryMeta(baseCountry);

  const address = profile?.address || {};
  const profileSection = {
    companyName: profile?.companyName || "",
    logoBase64: profile?.logoBase64 || "",
    businessType: stored.profile?.businessType || profile?.businessType || "",
    email: profile?.email || "",
    phone: profile?.phone || "",
    website: profile?.website || "",
    country: baseCountry,
    address: {
      line1: address.line1 || address.street || "",
      line2: address.line2 || "",
      city: address.city || "",
      state: address.state || "",
      postalCode: address.postalCode || ""
    }
  };

  const localization = {
    defaultCountry: baseCountry,
    currency,
    currencies: localizationCurrencies,
    timezone: stored.localization?.timezone || "Asia/Kolkata",
    dateFormat: stored.localization?.dateFormat || "DD MMM YYYY",
    numberFormat: stored.localization?.numberFormat || "1,23,456.78"
  };

  const taxStored = stored.tax || {};
  const tax = {
    enableGst: taxStored.enableGst ?? baseCountry === "India",
    gstin: taxStored.gstin || profile?.tax?.gstin || "",
    defaultGstRate: taxStored.defaultGstRate ?? meta.gstDefault ?? 18,
    cgstRule: taxStored.cgstRule || "Split equally",
    sgstRule: taxStored.sgstRule || "Split equally",
    igstRule: taxStored.igstRule || "Interstate",
    enableVat: taxStored.enableVat ?? VAT_COUNTRIES.includes(baseCountry),
    vatNumber: taxStored.vatNumber || profile?.tax?.vatNumber || "",
    defaultVatRate: taxStored.defaultVatRate ?? meta.vatDefault ?? 5,
    enableSalesTax: taxStored.enableSalesTax ?? baseCountry === "USA",
    salesTaxStates: Array.isArray(taxStored.salesTaxStates)
      ? taxStored.salesTaxStates
      : []
  };

  const numberingStored = stored.numbering || {};
  const prefixDefaults = buildDefaultPrefixes(baseCountry);
  const numbering = {
    autoIncrement: numberingStored.autoIncrement ?? true,
    resetYearly: numberingStored.resetYearly ?? false,
    prefixes: { ...prefixDefaults, ...(numberingStored.prefixes || {}) },
    counters: {
      invoice: Math.max(1, Number(numberingStored.counters?.invoice || 1)),
      purchase: Math.max(1, Number(numberingStored.counters?.purchase || 1)),
      creditNote: Math.max(1, Number(numberingStored.counters?.creditNote || 1)),
      debitNote: Math.max(1, Number(numberingStored.counters?.debitNote || 1)),
      paymentIn: Math.max(1, Number(numberingStored.counters?.paymentIn || 1)),
      paymentOut: Math.max(1, Number(numberingStored.counters?.paymentOut || 1))
    },
    allowCountryOverride: numberingStored.allowCountryOverride ?? false,
    countryOverrides: Array.isArray(numberingStored.countryOverrides)
      ? numberingStored.countryOverrides
      : []
  };

  const themeStored = stored.theme || {};
  const themeConfigStored =
    stored.theme_config && typeof stored.theme_config === "object" ? stored.theme_config : {};
  const inferredPreset =
    findThemePresetById(themeConfigStored.themePresetId) ||
    findThemePresetBySettings({
      mode: themeStored.mode || "Light",
      invoiceTheme: themeStored.invoiceTheme || "Classic",
      primaryColor: themeStored.primaryColor,
      accentColor: themeStored.accentColor
    }) ||
    THEME_PRESETS[0];
  const modeFromStored = String(themeConfigStored.mode || themeStored.mode || inferredPreset?.mode || "Light")
    .trim()
    .toLowerCase() === "dark"
    ? "Dark"
    : "Light";
  const modeMatchedPreset =
    inferredPreset?.mode === modeFromStored
      ? inferredPreset
      : findThemePresetById(modeFromStored === "Dark" ? "task-ink" : "focus-mint") || inferredPreset;
  const themeFont = APP_FONT_OPTIONS.includes(themeConfigStored.fontFamily)
    ? themeConfigStored.fontFamily
    : APP_FONT_OPTIONS[0];
  const theme = {
    mode: modeFromStored,
    primaryColor: themeConfigStored.primaryColor || themeStored.primaryColor || modeMatchedPreset?.primaryColor || "#0F766E",
    accentColor: themeConfigStored.accentColor || themeStored.accentColor || modeMatchedPreset?.accentColor || "#14B8A6",
    invoiceTheme: themeStored.invoiceTheme || modeMatchedPreset?.invoiceTheme || "Classic",
    themePresetId: modeMatchedPreset?.id || "focus-mint",
    fontFamily: themeFont,
    fontSize: normalizeThemeFontSizePx(themeConfigStored.fontSize),
    radiusStyle: RADIUS_STYLE_OPTIONS.includes(themeConfigStored.radiusStyle) ? themeConfigStored.radiusStyle : "soft-rounded",
    density: UI_DENSITY_OPTIONS.includes(themeConfigStored.density) ? themeConfigStored.density : "comfortable",
    sidebarStyle: SIDEBAR_STYLE_OPTIONS.includes(themeConfigStored.sidebarStyle) ? themeConfigStored.sidebarStyle : "solid"
  };
  const templateStored = stored.invoiceTemplate || {};
  const templateConfig = getInvoiceTemplateConfig();
  const countryTemplates = getCountryTemplates(baseCountry);
  const fallbackTemplateId = countryTemplates[0]?.id || DEFAULT_TEMPLATE_CONFIG.templateId;
  const mergedTemplate = {
    ...DEFAULT_TEMPLATE_CONFIG,
    ...templateConfig,
    ...templateStored
  };
  const isTemplateAllowed = countryTemplates.some((entry) => entry.id === mergedTemplate.templateId);
  const invoiceTemplate = {
    ...mergedTemplate,
    templateId: isTemplateAllowed ? mergedTemplate.templateId : fallbackTemplateId,
    logoUrl: mergedTemplate.logoUrl || profile?.logoBase64 || ""
  };

  const members = Array.isArray(remoteMembers)
    ? remoteMembers
    : Array.isArray(stored.users?.members)
      ? stored.users.members
      : currentUser
        ? [
            {
              id: uid("user_"),
              userId: currentUser.id || "",
              name: currentUser?.name || currentUser?.email?.split("@")[0] || "Owner",
              email: currentUser?.email || "",
              role: "Owner",
              status: "Active"
            }
          ]
        : [];

  const users = {
    roles: stored.users?.roles || DEFAULT_ROLE_PERMISSIONS,
    members
  };

  const preferences = {
    auditTrail: stored.preferences?.auditTrail ?? true,
    approvals: stored.preferences?.approvals ?? true,
    stockTracking: stored.preferences?.stockTracking ?? true,
    multiCurrency: stored.preferences?.multiCurrency ?? false
  };

  return {
    profile: profileSection,
    localization,
    tax,
    numbering,
    theme,
    invoiceTemplate,
    users,
    preferences
  };
}

function mapSettingsToProfile(settings) {
  const normalizedCurrencies = normalizeLocalizationCurrencies({
    country: settings.localization.defaultCountry,
    primary: settings.localization.currency,
    currencies: settings.localization.currencies
  });
  const primaryCurrency = normalizedCurrencies[0] || "";
  const normalizedThemeMode = String(settings.theme?.mode || "Light").trim().toLowerCase() === "dark" ? "dark" : "light";
  const normalizedThemeConfig = {
    themePresetId: settings.theme?.themePresetId || "focus-mint",
    mode: normalizedThemeMode,
    primaryColor: settings.theme?.primaryColor,
    accentColor: settings.theme?.accentColor,
    fontFamily: settings.theme?.fontFamily || APP_FONT_OPTIONS[0],
    fontSize: normalizeThemeFontSizePx(settings.theme?.fontSize),
    radiusStyle: settings.theme?.radiusStyle || "soft-rounded",
    density: settings.theme?.density || "comfortable",
    sidebarStyle: settings.theme?.sidebarStyle || "solid"
  };
  const normalizedSettings = {
    ...settings,
    theme_config: normalizedThemeConfig,
    localization: {
      ...settings.localization,
      currency: primaryCurrency,
      currencies: normalizedCurrencies
    },
    invoice_template_selected: true
  };

  return {
    companyName: settings.profile.companyName,
    logoBase64: settings.profile.logoBase64,
    businessType: settings.profile.businessType,
    email: settings.profile.email,
    phone: settings.profile.phone,
    website: settings.profile.website,
    country: settings.localization.defaultCountry,
    currency: primaryCurrency,
    currencies: normalizedCurrencies,
    address: settings.profile.address,
    tax: {
      gstin: settings.tax.gstin,
      vatNumber: settings.tax.vatNumber,
      vatRate: settings.tax.defaultVatRate,
      enableGst: settings.tax.enableGst,
      enableVat: settings.tax.enableVat,
      enableSalesTax: settings.tax.enableSalesTax,
      defaultGstRate: settings.tax.defaultGstRate,
      defaultVatRate: settings.tax.defaultVatRate,
      salesTaxStates: settings.tax.salesTaxStates,
      currency: primaryCurrency
    },
    settings: normalizedSettings
  };
}
function SectionNavItem({ section, active, dirty, onClick }) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full rounded-2xl border px-3 py-3 text-left transition",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">{section.label}</p>
            <p className="text-xs text-slate-500">{section.description}</p>
          </div>
        </div>
        {dirty ? <span className="mt-1 h-2 w-2 rounded-full bg-amber-400" /> : null}
      </div>
    </button>
  );
}

function SwitchRow({ label, description, checked, onChange, disabled }) {
  return (
    <label
      className={clsx(
        "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3",
        disabled ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white"
      )}
    >
      <div>
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => !disabled && onChange?.(!checked)}
        className={clsx(
          "relative h-6 w-11 rounded-full transition",
          checked ? "bg-emerald-500" : "bg-slate-200",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow",
            checked ? "right-0.5" : "left-0.5"
          )}
        />
      </button>
    </label>
  );
}

function SectionHeader({ title, description, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-lg font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

function ActionRow({ dirty, onSave, onCancel, disabled }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {dirty ? <span className="h-2 w-2 rounded-full bg-amber-400" /> : null}
        {dirty ? "Unsaved changes" : "All changes saved"}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onSave}
          className={clsx(
            "rounded-full px-4 py-2 text-xs font-semibold",
            disabled
              ? "bg-slate-200 text-slate-500"
              : "bg-slate-900 text-white shadow-soft hover:bg-slate-800"
          )}
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-40 rounded-full bg-slate-200" />
        <div className="h-3 w-64 rounded-full bg-slate-200" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="h-12 rounded-2xl bg-slate-200" />
          <div className="h-12 rounded-2xl bg-slate-200" />
          <div className="h-12 rounded-2xl bg-slate-200" />
          <div className="h-12 rounded-2xl bg-slate-200" />
        </div>
      </div>
    </Card>
  );
}
const PERMISSION_LIST = [
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "reports", label: "View reports" },
  { key: "approvals", label: "Approvals" }
];

function refreshPrefixes(prevPrefixes, prevCountry, nextCountry) {
  const prevDefaults = buildDefaultPrefixes(prevCountry);
  const nextDefaults = buildDefaultPrefixes(nextCountry);
  const next = { ...prevPrefixes };
  Object.keys(nextDefaults).forEach((key) => {
    if (!prevPrefixes?.[key] || prevPrefixes[key] === prevDefaults[key]) {
      next[key] = nextDefaults[key];
    }
  });
  return next;
}

function validateProfile(profile) {
  const errors = {};
  if (!profile.companyName?.trim()) errors.companyName = "Company name is required.";
  if (!profile.email?.trim()) errors.email = "Email is required.";
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!profile.phone?.trim()) errors.phone = "Phone number is required.";
  if (profile.phone && !/^[+\d][\d\s()-]{5,}$/.test(profile.phone.trim())) {
    errors.phone = "Enter a valid phone number.";
  }
  if (!profile.country?.trim()) errors.country = "Country is required.";
  if (!profile.address?.line1?.trim()) errors.line1 = "Address line 1 is required.";
  if (profile.website && !/^https?:\/\/|^[a-z0-9.-]+\.[a-z]{2,}/i.test(profile.website.trim())) {
    errors.website = "Enter a valid website URL.";
  }
  return errors;
}

function validateLocalization(localization) {
  const errors = {};
  if (!localization?.defaultCountry?.trim()) errors.defaultCountry = "Default country is required.";
  if (!localization?.currency?.trim()) errors.currency = "Currency is required.";
  if (!localization?.dateFormat?.trim()) errors.dateFormat = "Date format is required.";
  if (!localization?.numberFormat?.trim()) errors.numberFormat = "Number format is required.";
  return errors;
}

function validateTax(settings) {
  const errors = {};
  const country = settings?.localization?.defaultCountry;
  const tax = settings?.tax || {};
  if (country === "India" && tax.enableGst) {
    if (!tax.gstin?.trim()) errors.gstin = "GSTIN is required when GST is enabled.";
    if (Number(tax.defaultGstRate) < 0) errors.defaultGstRate = "GST rate cannot be negative.";
  }
  if (VAT_COUNTRIES.includes(country) && tax.enableVat) {
    if (!tax.vatNumber?.trim()) errors.vatNumber = "VAT number is required when VAT is enabled.";
    if (Number(tax.defaultVatRate) < 0) errors.defaultVatRate = "VAT rate cannot be negative.";
  }
  if (country === "USA" && tax.enableSalesTax) {
    const rows = Array.isArray(tax.salesTaxStates) ? tax.salesTaxStates : [];
    const hasInvalid = rows.some((entry) => !String(entry?.state || "").trim() || Number(entry?.rate) < 0);
    if (hasInvalid) errors.salesTaxStates = "Enter valid state code and non-negative rate.";
  }
  return errors;
}

function validateNumbering(numbering) {
  const errors = {};
  const prefixes = numbering?.prefixes || {};
  ["invoice", "purchase", "creditNote", "debitNote"].forEach((key) => {
    if (!String(prefixes[key] || "").trim()) {
      errors[`prefix_${key}`] = "Prefix is required.";
    }
  });
  const counters = numbering?.counters || {};
  ["invoice", "purchase", "creditNote", "debitNote"].forEach((key) => {
    const value = Number(counters[key] || 0);
    if (!Number.isFinite(value) || value < 1) {
      errors[`counter_${key}`] = "Counter must be 1 or greater.";
    }
  });
  return errors;
}

function validateTheme(theme) {
  const errors = {};
  if (!/^#[0-9a-f]{6}$/i.test(String(theme?.primaryColor || ""))) {
    errors.primaryColor = "Primary color must be a valid hex code.";
  }
  if (!/^#[0-9a-f]{6}$/i.test(String(theme?.accentColor || ""))) {
    errors.accentColor = "Accent color must be a valid hex code.";
  }
  if (!APP_FONT_OPTIONS.includes(theme?.fontFamily)) {
    errors.fontFamily = "Select a valid font family.";
  }
  const fontSizeValue = Number(theme?.fontSize);
  if (!Number.isFinite(fontSizeValue) || fontSizeValue < FONT_SIZE_MIN || fontSizeValue > FONT_SIZE_MAX) {
    errors.fontSize = `Font size must be between ${FONT_SIZE_MIN}px and ${FONT_SIZE_MAX}px.`;
  }
  if (!RADIUS_STYLE_OPTIONS.includes(theme?.radiusStyle)) {
    errors.radiusStyle = "Select a valid button style.";
  }
  if (!UI_DENSITY_OPTIONS.includes(theme?.density)) {
    errors.density = "Select a valid density option.";
  }
  if (!SIDEBAR_STYLE_OPTIONS.includes(theme?.sidebarStyle)) {
    errors.sidebarStyle = "Select a valid sidebar style.";
  }
  return errors;
}

function validateInvoiceTemplate(config) {
  const errors = {};
  if (!String(config?.templateId || "").trim()) errors.templateId = "Template is required.";
  if (!String(config?.fontFamily || "").trim()) errors.fontFamily = "Font is required.";
  return errors;
}

export default function CompanySettings() {
  const navigate = useNavigate();
  const toast = useToast();
  const {
    setTheme,
    themePresetId,
    setFont,
    fontFamily,
    setThemeOverrides,
    setThemeConfig
  } = useTheme();
  const { profile: organizationProfile } = useOrganization();
  const currentProfile = organizationProfile || companyGetProfile();
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(() => authGetUser());
  const [authAccessToken, setAuthAccessToken] = useState(() => authGetToken());
  const currentUser = authUser || authGetUser();
  const currentRole = authGetRole();
  const canManageUsers = isOwnerRole(currentRole);
  const canGenerateRegisterCodes = isOwnerRole(currentRole);
  const [settings, setSettings] = useState(() => buildDefaultSettings(currentProfile, currentUser));
  const [savedSettings, setSavedSettings] = useState(() => buildDefaultSettings(currentProfile, currentUser));
  const settingsRef = useRef(settings);
  const savedSettingsRef = useRef(savedSettings);
  const [activeSection, setActiveSection] = useState("profile");
  const [loadingSection, setLoadingSection] = useState(false);
  const [sectionMessage, setSectionMessage] = useState({});
  const [errors, setErrors] = useState({});
  const [invite, setInvite] = useState({ name: "", email: "", role: "Staff" });
  const [registerCodeRole, setRegisterCodeRole] = useState("Accounter");
  const [generatedCode, setGeneratedCode] = useState(null);
  const [activeCodes, setActiveCodes] = useState([]);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMessage, setCodeMessage] = useState("");
  const [codeError, setCodeError] = useState("");
  const [profileLogoFile, setProfileLogoFile] = useState(null);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [savingSection, setSavingSection] = useState("");
  useGlobalLoadingBridge(loadingSection, "company-settings");

  useEffect(() => {
    let active = true;
    let subscription = null;

    async function hydrateAuth() {
      if (!isSupabaseConfigured || !supabase) {
        if (!active) return;
        setAuthUser(authGetUser());
        setAuthAccessToken(authGetToken());
        setAuthLoading(false);
        return;
      }

      try {
        const {
          data: { session }
        } = await supabase.auth.getSession();
        if (!active) return;
        setAuthUser(session?.user || authGetUser() || null);
        setAuthAccessToken(session?.access_token || authGetToken() || "");
      } catch {
        if (!active) return;
        setAuthUser(authGetUser() || null);
        setAuthAccessToken(authGetToken() || "");
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    if (isSupabaseConfigured && supabase) {
      const authListener = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        setAuthUser(session?.user || authGetUser() || null);
        setAuthAccessToken(session?.access_token || authGetToken() || "");
        setAuthLoading(false);
      });
      subscription = authListener?.data?.subscription || null;
    }

    void hydrateAuth();
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!fontFamily) return;
    setSettings((prev) => {
      if (prev?.theme?.fontFamily === fontFamily) return prev;
      return {
        ...prev,
        theme: {
          ...prev.theme,
          fontFamily
        }
      };
    });
    setSavedSettings((prev) => {
      if (prev?.theme?.fontFamily === fontFamily) return prev;
      return {
        ...prev,
        theme: {
          ...prev.theme,
          fontFamily
        }
      };
    });
  }, [fontFamily]);

  useEffect(() => {
    if (authLoading || !currentUser?.id) return undefined;
    let active = true;
    (async () => {
      setLoadingSection(true);
      try {
        const payload = await settingsGetCompany();
        if (!active) return;
        const defaults = buildDefaultSettings(payload?.profile || currentProfile, currentUser, payload?.users);
        setSettings(defaults);
        setSavedSettings(defaults);
        setErrors({});
      } catch (error) {
        if (!active) return;
        toast.error("Failed to load company settings", error?.message || "Using cached settings.");
      } finally {
        if (active) setLoadingSection(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, currentUser?.id, toast]);

  const dirtyMap = useMemo(() => {
    return SECTION_ITEMS.reduce((acc, section) => {
      acc[section.id] =
        JSON.stringify(settings[section.id]) !== JSON.stringify(savedSettings[section.id]);
      return acc;
    }, {});
  }, [settings, savedSettings]);

  const hasUnsaved = useMemo(() => Object.values(dirtyMap).some(Boolean), [dirtyMap]);
  const activeThemePreset = useMemo(
    () =>
      findThemePresetById(settings.theme?.themePresetId) ||
      findThemePresetById(themePresetId) ||
      findThemePresetBySettings(settings.theme) ||
      THEME_PRESETS[0],
    [settings.theme, themePresetId]
  );

  useEffect(() => {
    if (!settings?.theme) return;
    const mode = String(settings.theme.mode || "Light").toLowerCase() === "dark" ? "dark" : "light";
    const fallbackTheme = mode === "dark" ? "task-ink" : "focus-mint";
    const selectedPreset = findThemePresetById(settings.theme.themePresetId);
    const selectedPresetMode = selectedPreset?.mode === "Dark" ? "dark" : "light";
    const resolvedThemeId =
      selectedPreset && selectedPresetMode === mode ? selectedPreset.id : fallbackTheme;
    setTheme(resolvedThemeId);
    setThemeOverrides({
      mode,
      primaryColor: settings.theme.primaryColor,
      accentColor: settings.theme.accentColor
    });
    setThemeConfig({
      themePresetId: resolvedThemeId,
      mode,
      fontFamily: settings.theme.fontFamily,
      fontSize: settings.theme.fontSize,
      radiusStyle: settings.theme.radiusStyle,
      density: settings.theme.density,
      sidebarStyle: settings.theme.sidebarStyle
    });
  }, [
    settings.theme?.mode,
    settings.theme?.themePresetId,
    settings.theme?.primaryColor,
    settings.theme?.accentColor,
    settings.theme?.fontFamily,
    settings.theme?.fontSize,
    settings.theme?.radiusStyle,
    settings.theme?.density,
    settings.theme?.sidebarStyle,
    setTheme,
    setThemeOverrides,
    setThemeConfig
  ]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    savedSettingsRef.current = savedSettings;
  }, [savedSettings]);

  useEffect(() => {
    const latestProfile = organizationProfile || companyGetProfile();
    if (!latestProfile) return;

    const nextDefaults = buildDefaultSettings(
      latestProfile,
      currentUser,
      latestProfile?.settings?.users?.members
    );
    const liveSettings = settingsRef.current;
    const liveSavedSettings = savedSettingsRef.current;
    const hasUnsavedLocalEdits =
      JSON.stringify(liveSettings) !== JSON.stringify(liveSavedSettings);
    const looksEmpty = !String(liveSettings?.profile?.companyName || "").trim();

    if (hasUnsavedLocalEdits && !looksEmpty) return;

    setSettings(nextDefaults);
    setSavedSettings(nextDefaults);
    setErrors({});
  }, [organizationProfile, currentUser?.id]);

  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsaved]);

  useEffect(() => {
    setLoadingSection(true);
    const timer = window.setTimeout(() => setLoadingSection(false), 220);
    return () => window.clearTimeout(timer);
  }, [activeSection]);

  useEffect(() => {
    if (!canGenerateRegisterCodes || activeSection !== "users") return;
    let active = true;
    (async () => {
      try {
        const list = await organizationListActiveCodes(6);
        if (active) setActiveCodes(list);
      } catch {
        if (active) setActiveCodes([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [activeSection, canGenerateRegisterCodes]);

  const country = settings.localization.defaultCountry;
  const isIndia = country === "India";
  const isVat = VAT_COUNTRIES.includes(country);
  const isUsa = country === "USA";
  const templateOptions = useMemo(
    () => getCountryTemplates(settings.localization.defaultCountry),
    [settings.localization.defaultCountry]
  );

  function updateSection(section, patch) {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...patch }
    }));
  }

  function applyCountryChange(nextCountry) {
    const nextMeta = getCountryMeta(nextCountry);
    const templateOptions = getCountryTemplates(nextCountry);
    setSettings((prev) => {
      const nextPrefixes = refreshPrefixes(prev.numbering.prefixes, prev.localization.defaultCountry, nextCountry);
      const nextCurrencies = normalizeLocalizationCurrencies({
        country: nextCountry,
        primary: nextMeta.currency,
        currencies: prev.localization.currencies
      });
      const nextTax = { ...prev.tax };
      if (nextCountry === "India") {
        nextTax.enableGst = true;
        nextTax.defaultGstRate = nextTax.defaultGstRate || nextMeta.gstDefault || 18;
      }
      if (VAT_COUNTRIES.includes(nextCountry)) {
        nextTax.enableVat = true;
        nextTax.defaultVatRate = nextTax.defaultVatRate || nextMeta.vatDefault || 5;
      }
      if (nextCountry === "USA") {
        nextTax.enableSalesTax = true;
      }
      const fallbackTemplateId = templateOptions[0]?.id || DEFAULT_TEMPLATE_CONFIG.templateId;
      const keepCurrentTemplate = templateOptions.some(
        (entry) => entry.id === prev.invoiceTemplate.templateId
      );
      return {
        ...prev,
        profile: {
          ...prev.profile,
          country: nextCountry,
          address: { ...prev.profile.address, state: "" }
        },
        localization: {
          ...prev.localization,
          defaultCountry: nextCountry,
          currency: nextCurrencies[0] || normalizeCurrencyCode(nextMeta.currency),
          currencies: nextCurrencies
        },
        tax: nextTax,
        numbering: {
          ...prev.numbering,
          prefixes: nextPrefixes
        },
        invoiceTemplate: {
          ...prev.invoiceTemplate,
          templateId: keepCurrentTemplate ? prev.invoiceTemplate.templateId : fallbackTemplateId
        }
      };
    });
  }

  function applyAdditionalCurrencies(nextExtraCurrencies) {
    setSettings((prev) => {
      const nextCurrencies = normalizeLocalizationCurrencies({
        country: prev.localization.defaultCountry,
        primary: prev.localization.currency,
        currencies: [
          prev.localization.currency,
          ...(Array.isArray(nextExtraCurrencies) ? nextExtraCurrencies : [])
        ]
      });
      return {
        ...prev,
        localization: {
          ...prev.localization,
          currency: nextCurrencies[0] || "",
          currencies: nextCurrencies
        }
      };
    });
  }

  function validateSection(section, nextSettings) {
    if (section === "profile") return validateProfile(nextSettings.profile);
    if (section === "localization") return validateLocalization(nextSettings.localization);
    if (section === "tax") return validateTax(nextSettings);
    if (section === "numbering") return validateNumbering(nextSettings.numbering);
    if (section === "theme") return validateTheme(nextSettings.theme);
    if (section === "invoiceTemplate") return validateInvoiceTemplate(nextSettings.invoiceTemplate);
    if (section === "users" && !canManageUsers) {
      return { users: "Only Owner can change roles and permissions." };
    }
    return {};
  }

  async function ensureAuthContextForSave() {
    if (authLoading) return null;

    if (!isSupabaseConfigured || !supabase) {
      const fallbackUser = authGetUser();
      const fallbackToken = authAccessToken || authGetToken();
      if (!fallbackUser?.id || !fallbackToken) return null;
      setAuthUser(fallbackUser);
      setAuthAccessToken(fallbackToken);
      return { user: fallbackUser, accessToken: fallbackToken };
    }

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const user = session?.user || authGetUser();
      const accessToken = session?.access_token || authAccessToken || authGetToken();

      if (!user?.id || !accessToken) return null;
      setAuthUser(user);
      setAuthAccessToken(accessToken);
      return { user, accessToken };
    } catch {
      return null;
    }
  }

  async function handleSave(section) {
    if (savingSection || authLoading) return;

    const logoError = String(errors?.profile?.logo || "").trim();
    if (section === "profile" && logoError) return;

    const authContext = await ensureAuthContextForSave();
    if (!authContext?.user?.id || !authContext?.accessToken) {
      toast.error("Session expired", "Login required before organization setup.");
      navigate("/login", { replace: true });
      return;
    }

    let nextSettings = settings;
    if (section === "invoiceTemplate") {
      const persistedTemplate = setInvoiceTemplateConfig(settings.invoiceTemplate);
      setInvoiceTemplateCompleted(true);
      nextSettings = { ...settings, invoiceTemplate: persistedTemplate };
      setSettings(nextSettings);
    }

    const sectionErrors = validateSection(section, nextSettings);
    if (Object.keys(sectionErrors).length) {
      setErrors((prev) => ({ ...prev, [section]: sectionErrors }));
      toast.warning("Fix validation errors", "Please correct highlighted fields before saving.");
      return;
    }
    setErrors((prev) => ({ ...prev, [section]: {} }));

    const nextProfile = mapSettingsToProfile(nextSettings);

    try {
      setSavingSection(section);
      if (section === "users" && canManageUsers) {
        const previousMembers = Array.isArray(savedSettings?.users?.members) ? savedSettings.users.members : [];
        const previousMap = new Map(
          previousMembers
            .map((member) => [member?.userId || member?.id, member])
            .filter(([key]) => !!key)
        );
        const currentMembers = Array.isArray(nextSettings?.users?.members) ? nextSettings.users.members : [];
        for (const member of currentMembers) {
          const userId = member?.userId || member?.id;
          if (!userId) continue;
          const previous = previousMap.get(userId);
          if (!previous) continue;
          if (previous.role === member.role && previous.status === member.status) continue;
          await organizationUpdateUser({
            userId,
            role: member.role,
            status: member.status
          }, { accessToken: authContext.accessToken });
        }
      }

      const result = await settingsPutCompany(
        nextProfile,
        {
          ...(section === "profile" && profileLogoFile ? { logoFile: profileLogoFile } : {}),
          accessToken: authContext.accessToken
        }
      );

      const refreshedUsers =
        section === "users" ? await organizationListUsers().catch(() => result?.users || []) : result?.users;

      const resolvedProfile = result?.profile || nextProfile;
      const defaults = buildDefaultSettings(
        resolvedProfile,
        currentUser,
        refreshedUsers?.length ? refreshedUsers : resolvedProfile?.settings?.users?.members
      );
      setSettings(defaults);
      setSavedSettings(defaults);

      if (section === "profile") {
        setProfileLogoFile(null);
      }

      if (section === "theme") {
        const mode = String(nextSettings.theme.mode || "Light").toLowerCase() === "dark" ? "dark" : "light";
        const fallbackTheme = mode === "dark" ? "task-ink" : "focus-mint";
        const selectedPreset = findThemePresetById(nextSettings.theme.themePresetId);
        const selectedPresetMode = selectedPreset?.mode === "Dark" ? "dark" : "light";
        const resolvedThemeId =
          selectedPreset && selectedPresetMode === mode ? selectedPreset.id : fallbackTheme;
        setTheme(resolvedThemeId);
        setThemeOverrides({
          mode,
          primaryColor: nextSettings.theme.primaryColor,
          accentColor: nextSettings.theme.accentColor
        });
        setThemeConfig({
          themePresetId: resolvedThemeId,
          mode,
          fontFamily: nextSettings.theme.fontFamily,
          fontSize: nextSettings.theme.fontSize,
          radiusStyle: nextSettings.theme.radiusStyle,
          density: nextSettings.theme.density,
          sidebarStyle: nextSettings.theme.sidebarStyle
        });
      }

      const warningText =
        Array.isArray(result?.warnings) && result.warnings.length
          ? ` ${result.warnings.join(" ")}`
          : "";
      const successText = `Changes saved successfully.${warningText}`.trim();
      setSectionMessage((prev) => ({ ...prev, [section]: successText }));
      toast.success("Settings saved", successText);
      window.setTimeout(() => {
        setSectionMessage((prev) => ({ ...prev, [section]: "" }));
      }, 2400);
    } catch (error) {
      const message = error?.message || "Failed to save settings.";
      setSectionMessage((prev) => ({ ...prev, [section]: message }));
      toast.error("Save failed", message);
    } finally {
      setSavingSection("");
    }
  }

  function handleCancel(section) {
    setSettings((prev) => ({ ...prev, [section]: savedSettings[section] }));
    setErrors((prev) => ({ ...prev, [section]: {} }));
    if (section === "profile") {
      setProfileLogoFile(null);
    }
    if (section === "theme") {
      const savedTheme = savedSettings.theme || {};
      const mode = String(savedTheme.mode || "Light").toLowerCase() === "dark" ? "dark" : "light";
      const fallbackTheme = mode === "dark" ? "task-ink" : "focus-mint";
      const selectedPreset = findThemePresetById(savedTheme.themePresetId);
      const selectedPresetMode = selectedPreset?.mode === "Dark" ? "dark" : "light";
      const resolvedThemeId =
        selectedPreset && selectedPresetMode === mode ? selectedPreset.id : fallbackTheme;
      setTheme(resolvedThemeId);
      setThemeOverrides({
        mode,
        primaryColor: savedTheme.primaryColor,
        accentColor: savedTheme.accentColor
      });
      setThemeConfig({
        themePresetId: resolvedThemeId,
        mode,
        fontFamily: savedTheme.fontFamily,
        fontSize: savedTheme.fontSize,
        radiusStyle: savedTheme.radiusStyle,
        density: savedTheme.density,
        sidebarStyle: savedTheme.sidebarStyle
      });
    }
  }

  function updatePermission(role, key, value) {
    if (!canManageUsers) return;
    setSettings((prev) => ({
      ...prev,
      users: {
        ...prev.users,
        roles: {
          ...prev.users.roles,
          [role]: { ...prev.users.roles[role], [key]: value }
        }
      }
    }));
  }

  function updateUser(id, patch) {
    if (!canManageUsers) return;
    setSettings((prev) => ({
      ...prev,
      users: {
        ...prev.users,
        members: prev.users.members.map((member) => (member.id === id ? { ...member, ...patch } : member))
      }
    }));
  }

  function handleInvite() {
    if (!invite.email.trim()) return;
    toast.info(
      "Use register code",
      "Direct invite is not yet wired to auth email flow. Share register code from this section."
    );
    setInvite({ name: "", email: "", role: "Staff" });
  }

  async function handleGenerateRegisterCode() {
    if (!canGenerateRegisterCodes) return;
    setCodeBusy(true);
    setCodeError("");
    setCodeMessage("");
    try {
      const created = await organizationGenerateCode({
        targetRole: registerCodeRole,
        maxUses: 25,
        expiresInDays: 45
      });
      setGeneratedCode(created);
      setCodeMessage("Register code generated successfully.");
      const list = await organizationListActiveCodes(6);
      setActiveCodes(list);
    } catch (error) {
      setCodeError(error?.message || "Failed to generate register code");
    } finally {
      setCodeBusy(false);
    }
  }

  async function copyRegisterCode(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCodeMessage("Code copied to clipboard.");
      setCodeError("");
    } catch {
      setCodeError("Unable to copy code. Copy manually.");
    }
  }

  function handleDanger(action) {
    if (action === "reset-numbering") {
      if (!window.confirm("Reset all numbering prefixes?")) return;
      setSettings((prev) => ({
        ...prev,
        numbering: {
          ...prev.numbering,
          prefixes: buildDefaultPrefixes(prev.localization.defaultCountry),
          countryOverrides: []
        }
      }));
      return;
    }
    if (action === "export-data") {
      window.alert("Company data export queued.");
      return;
    }
    if (action === "deactivate") {
      if (!window.confirm("Deactivate company? Users will lose access.")) return;
      window.alert("Company deactivated (demo).");
    }
  }

  const sectionDirty = dirtyMap[activeSection];
  const activeMessage = sectionMessage[activeSection];
  const sectionErrors = errors[activeSection] || {};
  const activeMessageIsError = /failed|error|denied|unable/i.test(String(activeMessage || ""));
  const saveBlocked = authLoading || !currentUser?.id || !!savingSection;

  if (authLoading) {
    return (
      <div className="mx-auto max-w-[1320px] space-y-4 pb-24">
        <SkeletonCard />
      </div>
    );
  }

  if (!currentUser?.id) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-24">
      <PageHeader
        title="Company Settings"
        subtitle="Admin-grade configuration for billing, tax, and user access."
        right={
          <div className="flex items-center gap-2">
            {canGenerateRegisterCodes ? (
              <button
                type="button"
                onClick={() => navigate("/company-setup?mode=create")}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
                Create New Company
              </button>
            ) : null}
            <GradientButton onClick={() => handleSave(activeSection)} disabled={saveBlocked}>
              {savingSection
                ? "Saving..."
                : activeSection === "profile"
                  ? "Save Company Profile"
                  : "Save changes"}
            </GradientButton>
          </div>
        }
      />

      {hasUnsaved ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          You have unsaved changes. Save the section to apply updates.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col">
            {SECTION_ITEMS.map((section) => (
              <SectionNavItem
                key={section.id}
                section={section}
                active={activeSection === section.id}
                dirty={dirtyMap[section.id]}
                onClick={() => setActiveSection(section.id)}
              />
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          {activeMessage ? (
            <div
              className={clsx(
                "flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs",
                activeMessageIsError
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              )}
            >
              {activeMessageIsError ? <AlertTriangle className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
              {activeMessage}
            </div>
          ) : null}

          {loadingSection ? (
            <SkeletonCard />
          ) : (
            <>
              {activeSection === "profile" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Company Profile"
                    description="Keep branding and contact details consistent across invoices."
                  />

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField label="Company Name *">
                      <input
                        value={settings.profile.companyName}
                        onChange={(event) =>
                          updateSection("profile", { companyName: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      {sectionErrors.companyName ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.companyName}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Logo Upload">
                      <FileUpload
                        value={settings.profile.logoBase64}
                        onChange={(value, file) => {
                          updateSection("profile", { logoBase64: value });
                          setProfileLogoFile(file || null);
                          setErrors((prev) => ({
                            ...prev,
                            profile: {
                              ...(prev.profile || {}),
                              logo: ""
                            }
                          }));
                        }}
                        onError={(message) =>
                          setErrors((prev) => ({
                            ...prev,
                            profile: {
                              ...(prev.profile || {}),
                              logo: message || ""
                            }
                          }))
                        }
                      />
                      {sectionErrors.logo ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.logo}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Business Type">
                      <select
                        value={settings.profile.businessType}
                        onChange={(event) =>
                          updateSection("profile", { businessType: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">Select type</option>
                        {BUSINESS_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <FormField label="Company Email *">
                      <input
                        value={settings.profile.email}
                        onChange={(event) => updateSection("profile", { email: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      {sectionErrors.email ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.email}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Phone *">
                      <input
                        value={settings.profile.phone}
                        onChange={(event) => updateSection("profile", { phone: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      {sectionErrors.phone ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.phone}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Website">
                      <input
                        value={settings.profile.website}
                        onChange={(event) => updateSection("profile", { website: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      {sectionErrors.website ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.website}</p>
                      ) : null}
                    </FormField>
                  </div>
                  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField label="Address Line 1 *">
                      <input
                        value={settings.profile.address.line1}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            profile: {
                              ...prev.profile,
                              address: { ...prev.profile.address, line1: event.target.value }
                            }
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                      {sectionErrors.line1 ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.line1}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Address Line 2">
                      <input
                        value={settings.profile.address.line2}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            profile: {
                              ...prev.profile,
                              address: { ...prev.profile.address, line2: event.target.value }
                            }
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </FormField>

                    <FormField label="City">
                      <input
                        value={settings.profile.address.city}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            profile: {
                              ...prev.profile,
                              address: { ...prev.profile.address, city: event.target.value }
                            }
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </FormField>

                    <FormField label="Country *">
                      <select
                        value={settings.profile.country}
                        onChange={(event) => applyCountryChange(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {COUNTRIES.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.country ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.country}</p>
                      ) : null}
                    </FormField>

                    <FormField label="State / Region">
                      <input
                        value={settings.profile.address.state}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            profile: {
                              ...prev.profile,
                              address: { ...prev.profile.address, state: event.target.value }
                            }
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </FormField>
                  </div>

                  <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                    <p className="text-sm font-semibold text-slate-900">Preview</p>
                    <p className="text-xs text-slate-500">Shown on invoices and statements.</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-10 w-10 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        {settings.profile.logoBase64 ? (
                          <img
                            src={settings.profile.logoBase64}
                            alt="logo"
                            className="h-full w-full object-contain bg-white p-1"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-100 text-xs font-semibold text-slate-600">
                            {(settings.profile.companyName || "C").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {settings.profile.companyName || "Company Name"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {settings.localization.currency} | {settings.profile.country}
                        </p>
                      </div>
                    </div>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("profile")}
                    onCancel={() => handleCancel("profile")}
                  />
                </Card>
              ) : null}
              {activeSection === "localization" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Localization"
                    description="Default country affects tax logic, currency, and numbering."
                  />

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField label="Default Country">
                      <select
                        value={settings.localization.defaultCountry}
                        onChange={(event) => applyCountryChange(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {COUNTRIES.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
                        Changing country updates tax defaults and document numbering.
                      </p>
                      {sectionErrors.defaultCountry ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.defaultCountry}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Currency (auto from country)">
                      <input
                        value={settings.localization.currency}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      />
                      {sectionErrors.currency ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.currency}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Additional Currencies" hint={`Add up to ${MAX_CURRENCIES - 1}`}>
                      <CurrencyMultiInput
                        value={(settings.localization.currencies || []).filter(
                          (currency) => currency !== settings.localization.currency
                        )}
                        onChange={applyAdditionalCurrencies}
                        max={Math.max(MAX_CURRENCIES - 1, 0)}
                        placeholder="USD"
                        ringColor={UI.COLORS.ring}
                      />
                    </FormField>

                    <FormField label="Timezone">
                      <select
                        value={settings.localization.timezone}
                        onChange={(event) =>
                          updateSection("localization", { timezone: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {TIMEZONES.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    <FormField label="Date Format">
                      <select
                        value={settings.localization.dateFormat}
                        onChange={(event) =>
                          updateSection("localization", { dateFormat: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {DATE_FORMATS.map((format) => (
                          <option key={format} value={format}>
                            {format}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.dateFormat ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.dateFormat}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Number Format">
                      <select
                        value={settings.localization.numberFormat}
                        onChange={(event) =>
                          updateSection("localization", { numberFormat: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {NUMBER_FORMATS.map((format) => (
                          <option key={format} value={format}>
                            {format}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.numberFormat ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.numberFormat}</p>
                      ) : null}
                    </FormField>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("localization")}
                    onCancel={() => handleCancel("localization")}
                  />
                </Card>
              ) : null}
              {activeSection === "tax" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Tax Settings"
                    description="Configure GST, VAT, or Sales Tax based on the default country."
                  />

                  <div className="mt-5 space-y-4">
                    {isIndia ? (
                      <>
                        <SwitchRow
                          label="Enable GST"
                          description="Applies GST to invoices and credit notes."
                          checked={settings.tax.enableGst}
                          onChange={(value) => updateSection("tax", { enableGst: value })}
                        />
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField label="GSTIN">
                            <input
                              value={settings.tax.gstin}
                              onChange={(event) => updateSection("tax", { gstin: event.target.value })}
                              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                            />
                            {sectionErrors.gstin ? (
                              <p className="mt-1 text-xs text-rose-600">{sectionErrors.gstin}</p>
                            ) : null}
                          </FormField>
                          <FormField label="Default GST %">
                            <input
                              type="number"
                              value={settings.tax.defaultGstRate}
                              onChange={(event) =>
                                updateSection("tax", { defaultGstRate: Number(event.target.value) })
                              }
                              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                            />
                            {sectionErrors.defaultGstRate ? (
                              <p className="mt-1 text-xs text-rose-600">{sectionErrors.defaultGstRate}</p>
                            ) : null}
                          </FormField>
                        </div>
                      </>
                    ) : null}

                    {isVat ? (
                      <>
                        <SwitchRow
                          label="Enable VAT"
                          description="Applies VAT on sales and purchases."
                          checked={settings.tax.enableVat}
                          onChange={(value) => updateSection("tax", { enableVat: value })}
                        />
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField label="VAT Registration No">
                            <input
                              value={settings.tax.vatNumber}
                              onChange={(event) => updateSection("tax", { vatNumber: event.target.value })}
                              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                            />
                            {sectionErrors.vatNumber ? (
                              <p className="mt-1 text-xs text-rose-600">{sectionErrors.vatNumber}</p>
                            ) : null}
                          </FormField>
                          <FormField label="Default VAT %">
                            <input
                              type="number"
                              value={settings.tax.defaultVatRate}
                              onChange={(event) =>
                                updateSection("tax", { defaultVatRate: Number(event.target.value) })
                              }
                              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                            />
                            {sectionErrors.defaultVatRate ? (
                              <p className="mt-1 text-xs text-rose-600">{sectionErrors.defaultVatRate}</p>
                            ) : null}
                          </FormField>
                        </div>
                      </>
                    ) : null}
                    {isUsa ? (
                      <>
                        <SwitchRow
                          label="Enable Sales Tax"
                          description="Optional sales tax by state."
                          checked={settings.tax.enableSalesTax}
                          onChange={(value) => updateSection("tax", { enableSalesTax: value })}
                        />
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">State-wise Tax</p>
                            <button
                              type="button"
                              onClick={() =>
                                updateSection("tax", {
                                  salesTaxStates: [
                                    ...settings.tax.salesTaxStates,
                                    { id: uid("tax_"), state: "", rate: 0 }
                                  ]
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                            >
                              <Plus className="h-3 w-3" />
                              Add state
                            </button>
                          </div>
                          <div className="mt-3 space-y-2">
                            {settings.tax.salesTaxStates.map((row) => (
                              <div
                                key={row.id}
                                className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_auto]"
                              >
                                <input
                                  value={row.state}
                                  onChange={(event) =>
                                    updateSection("tax", {
                                      salesTaxStates: settings.tax.salesTaxStates.map((item) =>
                                        item.id === row.id ? { ...item, state: event.target.value } : item
                                      )
                                    })
                                  }
                                  placeholder="State code"
                                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                                />
                                <input
                                  type="number"
                                  value={row.rate}
                                  onChange={(event) =>
                                    updateSection("tax", {
                                      salesTaxStates: settings.tax.salesTaxStates.map((item) =>
                                        item.id === row.id
                                          ? { ...item, rate: Number(event.target.value) }
                                          : item
                                      )
                                    })
                                  }
                                  placeholder="Rate %"
                                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSection("tax", {
                                      salesTaxStates: settings.tax.salesTaxStates.filter(
                                        (item) => item.id !== row.id
                                      )
                                    })
                                  }
                                  className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-rose-600"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                          {sectionErrors.salesTaxStates ? (
                            <p className="mt-2 text-xs text-rose-600">{sectionErrors.salesTaxStates}</p>
                          ) : null}
                        </div>
                      </>
                    ) : null}

                    {!isIndia && !isVat && !isUsa ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        Tax configuration will follow your default country settings.
                      </div>
                    ) : null}
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("tax")}
                    onCancel={() => handleCancel("tax")}
                  />
                </Card>
              ) : null}
              {activeSection === "numbering" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Numbering & Documents"
                    description="Control prefixes and numbering behavior across documents."
                  />

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                    {DOCUMENT_TYPES.map((doc) => (
                      <FormField key={doc.key} label={doc.label}>
                        <input
                          value={settings.numbering.prefixes[doc.key]}
                          onChange={(event) =>
                            updateSection("numbering", {
                              prefixes: {
                                ...settings.numbering.prefixes,
                                [doc.key]: event.target.value
                              }
                            })
                          }
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        />
                        {sectionErrors[`prefix_${doc.key}`] ? (
                          <p className="mt-1 text-xs text-rose-600">{sectionErrors[`prefix_${doc.key}`]}</p>
                        ) : null}
                      </FormField>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    {[
                      { key: "invoice", label: "Invoice Counter" },
                      { key: "purchase", label: "Purchase Counter" },
                      { key: "creditNote", label: "Credit Note Counter" },
                      { key: "debitNote", label: "Debit Note Counter" }
                    ].map((entry) => (
                      <FormField key={entry.key} label={entry.label}>
                        <input
                          type="number"
                          min={1}
                          value={settings.numbering.counters?.[entry.key] || 1}
                          onChange={(event) =>
                            updateSection("numbering", {
                              counters: {
                                ...(settings.numbering.counters || {}),
                                [entry.key]: Math.max(1, Number(event.target.value || 1))
                              }
                            })
                          }
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        />
                        {sectionErrors[`counter_${entry.key}`] ? (
                          <p className="mt-1 text-xs text-rose-600">{sectionErrors[`counter_${entry.key}`]}</p>
                        ) : null}
                      </FormField>
                    ))}
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <SwitchRow
                      label="Auto increment"
                      description="Recommended for consistent numbering."
                      checked={settings.numbering.autoIncrement}
                      onChange={(value) => updateSection("numbering", { autoIncrement: value })}
                    />
                    <SwitchRow
                      label="Reset yearly"
                      description="Reset sequence on fiscal year start."
                      checked={settings.numbering.resetYearly}
                      onChange={(value) => updateSection("numbering", { resetYearly: value })}
                    />
                  </div>

                  <div className="mt-6">
                    <SwitchRow
                      label="Editable prefix per country"
                      description="Create overrides by country and document type."
                      checked={settings.numbering.allowCountryOverride}
                      onChange={(value) =>
                        updateSection("numbering", { allowCountryOverride: value })
                      }
                    />

                    {settings.numbering.allowCountryOverride ? (
                      <div className="mt-4 space-y-3">
                        {settings.numbering.countryOverrides.map((override) => (
                          <div
                            key={override.id}
                            className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1.2fr_auto]"
                          >
                            <select
                              value={override.country}
                              onChange={(event) =>
                                updateSection("numbering", {
                                  countryOverrides: settings.numbering.countryOverrides.map((item) =>
                                    item.id === override.id
                                      ? { ...item, country: event.target.value }
                                      : item
                                  )
                                })
                              }
                              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                              {COUNTRIES.map((entry) => (
                                <option key={entry} value={entry}>
                                  {entry}
                                </option>
                              ))}
                            </select>
                            <select
                              value={override.docType}
                              onChange={(event) =>
                                updateSection("numbering", {
                                  countryOverrides: settings.numbering.countryOverrides.map((item) =>
                                    item.id === override.id
                                      ? { ...item, docType: event.target.value }
                                      : item
                                  )
                                })
                              }
                              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                              {DOCUMENT_TYPES.map((doc) => (
                                <option key={doc.key} value={doc.key}>
                                  {doc.label}
                                </option>
                              ))}
                            </select>
                            <input
                              value={override.prefix}
                              onChange={(event) =>
                                updateSection("numbering", {
                                  countryOverrides: settings.numbering.countryOverrides.map((item) =>
                                    item.id === override.id
                                      ? { ...item, prefix: event.target.value }
                                      : item
                                  )
                                })
                              }
                              placeholder="Prefix override"
                              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateSection("numbering", {
                                  countryOverrides: settings.numbering.countryOverrides.filter(
                                    (item) => item.id !== override.id
                                  )
                                })
                              }
                              className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            updateSection("numbering", {
                              countryOverrides: [
                                ...settings.numbering.countryOverrides,
                                {
                                  id: uid("override_"),
                                  country: settings.localization.defaultCountry,
                                  docType: "invoice",
                                  prefix: ""
                                }
                              ]
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add override
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("numbering")}
                    onCancel={() => handleCancel("numbering")}
                  />
                </Card>
              ) : null}
              {activeSection === "theme" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Theme & Appearance"
                    description="Preview brand colors and invoice styling."
                  >
                    <button
                      type="button"
                      onClick={() => setThemeModalOpen(true)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
                    >
                      Choose Theme
                    </button>
                  </SectionHeader>

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Theme Presets</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {THEME_APPEARANCE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            const presetTheme = findThemePresetById(preset.themePresetId) || THEME_PRESETS[0];
                            setTheme(preset.themePresetId);
                            setThemeConfig(preset);
                            setFont(preset.fontFamily);
                            updateSection("theme", {
                              mode: preset.mode === "dark" ? "Dark" : "Light",
                              primaryColor: preset.primaryColor,
                              accentColor: preset.accentColor,
                              invoiceTheme: presetTheme?.invoiceTheme || settings.theme.invoiceTheme,
                              themePresetId: preset.themePresetId,
                              fontFamily: preset.fontFamily,
                              fontSize: preset.fontSize,
                              radiusStyle: preset.radiusStyle,
                              density: preset.density,
                              sidebarStyle: preset.sidebarStyle
                            });
                          }}
                          className={clsx(
                            "rounded-full border px-3 py-2 text-xs font-semibold transition",
                            settings.theme.themePresetId === preset.themePresetId &&
                              settings.theme.primaryColor === preset.primaryColor &&
                              settings.theme.accentColor === preset.accentColor
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField label="Theme Mode">
                      <div className="flex items-center gap-2">
                        {["Light", "Dark"].map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              updateSection("theme", {
                                mode,
                                themePresetId: mode === "Dark" ? "task-ink" : "focus-mint"
                              })
                            }
                            className={clsx(
                              "rounded-full border px-4 py-2 text-xs font-semibold",
                              settings.theme.mode === mode
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-600"
                            )}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </FormField>

                    <FormField label="Invoice PDF Theme">
                      <select
                        value={settings.theme.invoiceTheme}
                        onChange={(event) => updateSection("theme", { invoiceTheme: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="Classic">Classic</option>
                        <option value="Minimal">Minimal</option>
                        <option value="Modern">Modern</option>
                      </select>
                    </FormField>

                    <FormField label="Primary Brand Color">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={settings.theme.primaryColor}
                          onChange={(event) =>
                            updateSection("theme", { primaryColor: event.target.value })
                          }
                          className="h-10 w-12 rounded-xl border border-slate-200"
                        />
                        <input
                          value={settings.theme.primaryColor}
                          onChange={(event) =>
                            updateSection("theme", { primaryColor: event.target.value })
                          }
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      {sectionErrors.primaryColor ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.primaryColor}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Accent Color">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={settings.theme.accentColor}
                          onChange={(event) =>
                            updateSection("theme", { accentColor: event.target.value })
                          }
                          className="h-10 w-12 rounded-xl border border-slate-200"
                        />
                        <input
                          value={settings.theme.accentColor}
                          onChange={(event) =>
                            updateSection("theme", { accentColor: event.target.value })
                          }
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      {sectionErrors.accentColor ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.accentColor}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Font Family">
                      <select
                        value={settings.theme.fontFamily}
                        onChange={(event) => {
                          const nextFont = event.target.value;
                          updateSection("theme", { fontFamily: nextFont });
                          setFont(nextFont);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {APP_FONT_OPTIONS.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.fontFamily ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.fontFamily}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Font Size">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={FONT_SIZE_MIN}
                          max={FONT_SIZE_MAX}
                          step={1}
                          value={settings.theme.fontSize}
                          onChange={(event) =>
                            updateSection("theme", { fontSize: normalizeThemeFontSizePx(event.target.value) })
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                        <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                          px
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Enter any value from {FONT_SIZE_MIN}px to {FONT_SIZE_MAX}px (default {FONT_SIZE_DEFAULT}px).
                      </p>
                      {sectionErrors.fontSize ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.fontSize}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Button Style">
                      <select
                        value={settings.theme.radiusStyle}
                        onChange={(event) => updateSection("theme", { radiusStyle: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {RADIUS_STYLE_OPTIONS.map((radiusStyle) => (
                          <option key={radiusStyle} value={radiusStyle}>
                            {RADIUS_LABELS[radiusStyle]}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.radiusStyle ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.radiusStyle}</p>
                      ) : null}
                    </FormField>

                    <FormField label="UI Density">
                      <select
                        value={settings.theme.density}
                        onChange={(event) => updateSection("theme", { density: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {UI_DENSITY_OPTIONS.map((density) => (
                          <option key={density} value={density}>
                            {DENSITY_LABELS[density]}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.density ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.density}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Sidebar Style">
                      <select
                        value={settings.theme.sidebarStyle}
                        onChange={(event) => updateSection("theme", { sidebarStyle: event.target.value })}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {SIDEBAR_STYLE_OPTIONS.map((sidebarStyle) => (
                          <option key={sidebarStyle} value={sidebarStyle}>
                            {SIDEBAR_STYLE_LABELS[sidebarStyle]}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.sidebarStyle ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.sidebarStyle}</p>
                      ) : null}
                    </FormField>
                  </div>

                  <div className="mt-6 rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Live Preview</p>
                    <div
                      className={clsx(
                        "mt-3 rounded-2xl p-4",
                        settings.theme.mode === "Dark" ? "bg-slate-900 text-white" : "bg-slate-50"
                      )}
                    >
                      <div
                        className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold"
                        style={{ background: settings.theme.primaryColor, color: "white" }}
                      >
                        <span>Invoice Preview</span>
                        <span>{settings.localization.currency}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                          <p className="text-slate-500">Customer</p>
                          <p className="font-semibold">Northwind Traders</p>
                        </div>
                        <div
                          className="rounded-xl p-3 text-white"
                          style={{ background: settings.theme.accentColor }}
                        >
                          <p>Balance Due</p>
                          <p className="text-lg font-semibold">{settings.localization.currency} 48,900</p>
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
                        Font: {settings.theme.fontFamily} | Size: {normalizeThemeFontSizePx(settings.theme.fontSize)}px | Density: {DENSITY_LABELS[settings.theme.density]}
                      </div>
                    </div>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("theme")}
                    onCancel={() => handleCancel("theme")}
                  />

                  <ThemeModal
                    open={themeModalOpen}
                    themes={THEME_PRESETS}
                    initialThemeId={activeThemePreset?.id || themePresetId}
                    onClose={() => setThemeModalOpen(false)}
                    onApply={(preset) => {
                      setTheme(preset.id);
                      const currentMode = String(preset.mode || "Light").toLowerCase() === "dark" ? "Dark" : "Light";
                      updateSection("theme", {
                        mode: currentMode,
                        primaryColor: preset.primaryColor,
                        accentColor: preset.accentColor,
                        invoiceTheme: preset.invoiceTheme || settings.theme.invoiceTheme,
                        themePresetId: preset.id
                      });
                      setThemeModalOpen(false);
                    }}
                  />
                </Card>
              ) : null}
              {activeSection === "invoiceTemplate" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Invoice Template"
                    description="Edit invoice template, logo and print appearance from settings."
                  />

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField label="Template">
                      <select
                        value={settings.invoiceTemplate.templateId}
                        onChange={(event) =>
                          updateSection("invoiceTemplate", { templateId: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {templateOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.templateId ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.templateId}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Font">
                      <select
                        value={settings.invoiceTemplate.fontFamily}
                        onChange={(event) => {
                          const nextFont = event.target.value;
                          updateSection("invoiceTemplate", { fontFamily: nextFont });
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {APP_FONT_OPTIONS.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                      {sectionErrors.fontFamily ? (
                        <p className="mt-1 text-xs text-rose-600">{sectionErrors.fontFamily}</p>
                      ) : null}
                    </FormField>

                    <FormField label="Background Color">
                      <input
                        type="color"
                        value={settings.invoiceTemplate.bgColor}
                        onChange={(event) =>
                          updateSection("invoiceTemplate", { bgColor: event.target.value })
                        }
                        className="h-10 w-full rounded-2xl border border-slate-200 bg-white p-1"
                      />
                    </FormField>

                    <FormField label="Primary Color">
                      <input
                        type="color"
                        value={settings.invoiceTemplate.primaryColor}
                        onChange={(event) =>
                          updateSection("invoiceTemplate", { primaryColor: event.target.value })
                        }
                        className="h-10 w-full rounded-2xl border border-slate-200 bg-white p-1"
                      />
                    </FormField>

                    <FormField label="Logo Position">
                      <select
                        value={settings.invoiceTemplate.logoPosition}
                        onChange={(event) =>
                          updateSection("invoiceTemplate", { logoPosition: event.target.value })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </FormField>

                    <FormField label="Logo">
                      <FileUpload
                        value={settings.invoiceTemplate.logoUrl}
                        onChange={(value) => updateSection("invoiceTemplate", { logoUrl: value })}
                      />
                    </FormField>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("invoiceTemplate")}
                    onCancel={() => handleCancel("invoiceTemplate")}
                  />
                </Card>
              ) : null}
              {activeSection === "users" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Users & Roles"
                    description="Define permissions and manage team access."
                  />

                  <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-4">
                      {Object.keys(settings.users.roles).map((role) => (
                        <div key={role} className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{role}</p>
                              <p className="text-xs text-slate-500">Configure access level.</p>
                            </div>
                            <Badge tone={role === "Owner" ? "success" : "neutral"}>{role}</Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            {PERMISSION_LIST.map((permission) => (
                              <label
                                key={permission.key}
                                className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={settings.users.roles[role]?.[permission.key] || false}
                                  disabled={!canManageUsers}
                                  onChange={(event) =>
                                    updatePermission(role, permission.key, event.target.checked)
                                  }
                                />
                                {permission.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4">
                      {canGenerateRegisterCodes ? (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-sm font-semibold text-slate-900">Generate Register Code</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Use this code for Accounter or Staff signup.
                          </p>
                          <div className="mt-3 space-y-2">
                            <select
                              value={registerCodeRole}
                              onChange={(event) => setRegisterCodeRole(event.target.value)}
                              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                              <option value="Accounter">Accounter</option>
                              <option value="Staff">Staff</option>
                            </select>
                            <button
                              type="button"
                              disabled={codeBusy}
                              onClick={handleGenerateRegisterCode}
                              className={clsx(
                                "w-full rounded-full px-4 py-2 text-xs font-semibold text-white",
                                codeBusy ? "bg-slate-400" : "bg-slate-900"
                              )}
                            >
                              {codeBusy ? "Generating..." : "Generate Code"}
                            </button>
                          </div>

                          {generatedCode?.code ? (
                            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                              <p className="text-xs text-emerald-700">Latest Code</p>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold tracking-[0.08em] text-emerald-900">
                                  {generatedCode.code}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => copyRegisterCode(generatedCode.code)}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  Copy
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {codeMessage ? (
                            <p className="mt-2 text-xs text-emerald-700">{codeMessage}</p>
                          ) : null}
                          {codeError ? <p className="mt-2 text-xs text-rose-600">{codeError}</p> : null}

                          {activeCodes.length ? (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs font-semibold text-slate-500">Active Codes</p>
                              {activeCodes.map((codeEntry) => (
                                <div
                                  key={codeEntry.id}
                                  className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-slate-800">{codeEntry.code}</p>
                                    <Badge tone="neutral">{normalizeRoleLabel(codeEntry.target_role)}</Badge>
                                  </div>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Uses: {codeEntry.used_count}/{codeEntry.max_uses} | Expires:{" "}
                                    {new Date(codeEntry.expires_at).toLocaleDateString()}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Invite User</p>
                        {!canManageUsers ? (
                          <p className="mt-1 text-xs text-slate-500">Only Owner can invite team members.</p>
                        ) : null}
                        <div className="mt-3 space-y-2">
                          <input
                            value={invite.name}
                            disabled={!canManageUsers}
                            onChange={(event) => setInvite((prev) => ({ ...prev, name: event.target.value }))}
                            placeholder="Full name"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                          />
                          <input
                            value={invite.email}
                            disabled={!canManageUsers}
                            onChange={(event) => setInvite((prev) => ({ ...prev, email: event.target.value }))}
                            placeholder="Email address"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                          />
                          <select
                            value={invite.role}
                            disabled={!canManageUsers}
                            onChange={(event) => setInvite((prev) => ({ ...prev, role: event.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          >
                            {Object.keys(settings.users.roles).map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!canManageUsers}
                            onClick={handleInvite}
                            className={clsx(
                              "w-full rounded-full px-4 py-2 text-xs font-semibold text-white",
                              canManageUsers ? "bg-slate-900" : "bg-slate-400"
                            )}
                          >
                            Send Invite
                          </button>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Team Members</p>
                        <div className="mt-3 space-y-3">
                          {settings.users.members.map((member) => (
                            <div key={member.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                                  <p className="text-xs text-slate-500">{member.email}</p>
                                </div>
                                <Badge tone={member.status === "Active" ? "success" : "neutral"}>
                                  {member.status}
                                </Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <select
                                  value={member.role}
                                  disabled={!canManageUsers}
                                  onChange={(event) => updateUser(member.id, { role: event.target.value })}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs"
                                >
                                  {Object.keys(settings.users.roles).map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={!canManageUsers}
                                  onClick={() =>
                                    updateUser(member.id, {
                                      status: member.status === "Active" ? "Inactive" : "Active"
                                    })
                                  }
                                  className={clsx(
                                    "rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold",
                                    canManageUsers ? "text-slate-600" : "cursor-not-allowed text-slate-400"
                                  )}
                                >
                                  {member.status === "Active" ? "Deactivate" : "Activate"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("users")}
                    onCancel={() => handleCancel("users")}
                  />
                </Card>
              ) : null}
              {activeSection === "preferences" ? (
                <Card className="p-6">
                  <SectionHeader
                    title="Data & Preferences"
                    description="Control audit trails, approvals, and system behavior."
                  />

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <SwitchRow
                      label="Enable audit trail"
                      description="Track created and edited entries."
                      checked={settings.preferences.auditTrail}
                      onChange={(value) => updateSection("preferences", { auditTrail: value })}
                    />
                    <SwitchRow
                      label="Enable approvals"
                      description="Require approval for high value transactions."
                      checked={settings.preferences.approvals}
                      onChange={(value) => updateSection("preferences", { approvals: value })}
                    />
                    <SwitchRow
                      label="Enable stock tracking"
                      description="Turns on inventory controls for products."
                      checked={settings.preferences.stockTracking}
                      onChange={(value) => updateSection("preferences", { stockTracking: value })}
                    />
                    <SwitchRow
                      label="Enable multi-currency"
                      description="Future release - requires admin enablement."
                      checked={settings.preferences.multiCurrency}
                      onChange={(value) => updateSection("preferences", { multiCurrency: value })}
                      disabled
                    />
                  </div>

                  <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <div className="flex items-center gap-2 text-rose-700">
                      <AlertTriangle className="h-4 w-4" />
                      <p className="text-sm font-semibold">Danger Zone</p>
                    </div>
                    <p className="mt-1 text-xs text-rose-600">
                      These actions affect reporting and access. Proceed carefully.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleDanger("reset-numbering")}
                        className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600"
                      >
                        Reset numbering
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDanger("export-data")}
                        className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600"
                      >
                        Export company data
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDanger("deactivate")}
                        className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600"
                      >
                        Deactivate company
                      </button>
                    </div>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    disabled={!sectionDirty || saveBlocked}
                    onSave={() => handleSave("preferences")}
                    onCancel={() => handleCancel("preferences")}
                  />
                </Card>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
