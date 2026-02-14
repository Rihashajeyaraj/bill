import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Database,
  Globe,
  Hash,
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
import { COUNTRIES, companyGetProfile, companyUpdateProfile } from "../services/company.service";
import { authGetUser } from "../services/auth.service";
import { uid } from "../services/storage";
import { UI } from "../theme/tokens";

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
  { key: "creditNote", label: "Credit Note", prefix: "CN" },
  { key: "debitNote", label: "Debit Note", prefix: "DN" },
  { key: "paymentIn", label: "Payment In", prefix: "PR" },
  { key: "paymentOut", label: "Payment Out", prefix: "PO" }
];

const DEFAULT_ROLE_PERMISSIONS = {
  Admin: { create: true, edit: true, delete: true, reports: true, approvals: true },
  Accountant: { create: true, edit: true, delete: false, reports: true, approvals: false },
  Staff: { create: true, edit: false, delete: false, reports: false, approvals: false },
  Viewer: { create: false, edit: false, delete: false, reports: true, approvals: false }
};

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

function formatSectionTitle(section) {
  const config = SECTION_ITEMS.find((item) => item.id === section);
  return config?.label || "Settings";
}
function buildDefaultSettings(profile, currentUser) {
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
      : [{ id: uid("tax_"), state: "CA", rate: 8.25 }]
  };

  const numberingStored = stored.numbering || {};
  const prefixDefaults = buildDefaultPrefixes(baseCountry);
  const numbering = {
    autoIncrement: numberingStored.autoIncrement ?? true,
    resetYearly: numberingStored.resetYearly ?? false,
    prefixes: { ...prefixDefaults, ...(numberingStored.prefixes || {}) },
    allowCountryOverride: numberingStored.allowCountryOverride ?? false,
    countryOverrides: Array.isArray(numberingStored.countryOverrides)
      ? numberingStored.countryOverrides
      : []
  };

  const themeStored = stored.theme || {};
  const theme = {
    mode: themeStored.mode || "Light",
    primaryColor: themeStored.primaryColor || UI.COLORS.deepRed,
    accentColor: themeStored.accentColor || UI.COLORS.blush,
    invoiceTheme: themeStored.invoiceTheme || "Classic"
  };

  const members = Array.isArray(stored.users?.members) && stored.users.members.length
    ? stored.users.members
    : [
        {
          id: uid("user_"),
          name: currentUser?.name || "Primary Admin",
          email: currentUser?.email || "owner@demo.com",
          role: "Admin",
          status: "Active"
        },
        {
          id: uid("user_"),
          name: "Finance Manager",
          email: "finance@demo.com",
          role: "Accountant",
          status: "Active"
        },
        {
          id: uid("user_"),
          name: "Warehouse",
          email: "warehouse@demo.com",
          role: "Staff",
          status: "Inactive"
        }
      ];

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
  const normalizedSettings = {
    ...settings,
    localization: {
      ...settings.localization,
      currency: primaryCurrency,
      currencies: normalizedCurrencies
    }
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
  if (!profile.phone?.trim()) errors.phone = "Phone number is required.";
  if (!profile.country?.trim()) errors.country = "Country is required.";
  if (!profile.address?.line1?.trim()) errors.line1 = "Address line 1 is required.";
  return errors;
}

export default function CompanySettings() {
  const { setTheme, setThemePreset, themePresetId } = useTheme();
  const currentProfile = companyGetProfile();
  const currentUser = authGetUser();
  const [settings, setSettings] = useState(() => buildDefaultSettings(currentProfile, currentUser));
  const [savedSettings, setSavedSettings] = useState(() => buildDefaultSettings(currentProfile, currentUser));
  const [activeSection, setActiveSection] = useState("profile");
  const [loadingSection, setLoadingSection] = useState(false);
  const [sectionMessage, setSectionMessage] = useState({});
  const [errors, setErrors] = useState({});
  const [invite, setInvite] = useState({ name: "", email: "", role: "Staff" });
  const [themeModalOpen, setThemeModalOpen] = useState(false);

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
      findThemePresetById(themePresetId) ||
      findThemePresetBySettings(settings.theme) ||
      THEME_PRESETS[0],
    [settings.theme, themePresetId]
  );

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

  const country = settings.localization.defaultCountry;
  const isIndia = country === "India";
  const isVat = VAT_COUNTRIES.includes(country);
  const isUsa = country === "USA";
  const sectionTitle = formatSectionTitle(activeSection);

  function updateSection(section, patch) {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...patch }
    }));
  }

  function applyCountryChange(nextCountry) {
    const nextMeta = getCountryMeta(nextCountry);
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

  function handleSave(section) {
    if (section === "profile") {
      const profileErrors = validateProfile(settings.profile);
      if (Object.keys(profileErrors).length) {
        setErrors((prev) => ({ ...prev, profile: profileErrors }));
        return;
      }
      setErrors((prev) => ({ ...prev, profile: {} }));
    }

    setSavedSettings((prev) => ({ ...prev, [section]: settings[section] }));
    companyUpdateProfile(mapSettingsToProfile(settings));
    setSectionMessage((prev) => ({ ...prev, [section]: "Changes saved successfully." }));
    window.setTimeout(() => {
      setSectionMessage((prev) => ({ ...prev, [section]: "" }));
    }, 2400);
  }

  function handleCancel(section) {
    setSettings((prev) => ({ ...prev, [section]: savedSettings[section] }));
    setErrors((prev) => ({ ...prev, [section]: {} }));
  }

  function updatePermission(role, key, value) {
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
    const nextMember = {
      id: uid("user_"),
      name: invite.name || invite.email.split("@")[0],
      email: invite.email,
      role: invite.role,
      status: "Active"
    };
    setSettings((prev) => ({
      ...prev,
      users: { ...prev.users, members: [nextMember, ...prev.users.members] }
    }));
    setInvite({ name: "", email: "", role: "Staff" });
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

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-24">
      <PageHeader
        title="Company Settings"
        subtitle="Admin-grade configuration for billing, tax, and user access."
        right={
          <GradientButton onClick={() => handleSave(activeSection)}>
            Save {sectionTitle}
          </GradientButton>
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
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
              <BadgeCheck className="h-4 w-4" />
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
                        onChange={(value) => updateSection("profile", { logoBase64: value })}
                      />
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
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {settings.profile.companyName || "Company Name"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {settings.localization.currency} · {settings.profile.country}
                        </p>
                      </div>
                    </div>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
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
                    </FormField>

                    <FormField label="Currency (auto from country)">
                      <input
                        value={settings.localization.currency}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                      />
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
                    </FormField>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
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

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField label="Theme Mode">
                      <div className="flex items-center gap-2">
                        {["Light", "Dark"].map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => updateSection("theme", { mode })}
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
                    </div>
                  </div>

                  <ActionRow
                    dirty={sectionDirty}
                    onSave={() => handleSave("theme")}
                    onCancel={() => handleCancel("theme")}
                  />

                  <ThemeModal
                    open={themeModalOpen}
                    themes={THEME_PRESETS}
                    initialThemeId={activeThemePreset?.id || themePresetId}
                    onClose={() => setThemeModalOpen(false)}
                    onApply={(preset) => {
                      setThemePreset(preset.id);
                      setTheme(preset.mode === "Dark" ? "dark" : "light");
                      updateSection("theme", {
                        mode: preset.mode,
                        primaryColor: preset.primaryColor,
                        accentColor: preset.accentColor,
                        invoiceTheme: preset.invoiceTheme || settings.theme.invoiceTheme
                      });
                      setThemeModalOpen(false);
                    }}
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
                            <Badge tone={role === "Admin" ? "success" : "neutral"}>{role}</Badge>
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
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Invite User</p>
                        <div className="mt-3 space-y-2">
                          <input
                            value={invite.name}
                            onChange={(event) => setInvite((prev) => ({ ...prev, name: event.target.value }))}
                            placeholder="Full name"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                          />
                          <input
                            value={invite.email}
                            onChange={(event) => setInvite((prev) => ({ ...prev, email: event.target.value }))}
                            placeholder="Email address"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                          />
                          <select
                            value={invite.role}
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
                            onClick={handleInvite}
                            className="w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
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
                                  onClick={() =>
                                    updateUser(member.id, {
                                      status: member.status === "Active" ? "Inactive" : "Active"
                                    })
                                  }
                                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
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
