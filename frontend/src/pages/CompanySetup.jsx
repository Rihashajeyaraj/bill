import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import FormField from "../components/FormField";
import FileUpload from "../components/FileUpload";
import CurrencyMultiInput from "../components/CurrencyMultiInput";
import DateInput from "../components/DateInput";
import { authGetOrganizationId, authGetRole, authGetUser } from "../services/auth.service";
import { canAccessSettings } from "../services/roles";
import {
  companyGetProfile,
  companySaveProfileRemote
} from "../services/company.service";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { UI } from "../theme/tokens";
import { useOrganization } from "../context/OrganizationContext";
import {
  getCanonicalCountryName,
  listAllCountries,
  listStatesByCountry,
  resolveCountryIsoCode
} from "../lib/geoData";
import {
  phoneDigitRangeLabel,
  validateInternationalPhone
} from "../lib/phoneValidation";
import {
  buildFinancialYearEndDate,
  normalizeIsoDate
} from "../services/financialYears.service";

const MAX_CURRENCIES = 3;

const COUNTRY_META = {
  India: { currency: "INR" },
  "Sri Lanka": { currency: "LKR", vatRate: 18 },
  UAE: { currency: "AED", vatRate: 5 },
  USA: { currency: "USD" },
  "United Kingdom": { currency: "GBP", vatRate: 20 },
  UK: { currency: "GBP", vatRate: 20 },
  Ireland: { currency: "EUR", vatRate: 23 }
};

const VAT_COUNTRIES = ["Sri Lanka", "United Kingdom", "Ireland", "UK", "UAE"];

function getCurrency(country) {
  return COUNTRY_META[country]?.currency || "";
}

function getVatRate(country) {
  return COUNTRY_META[country]?.vatRate || 0;
}

function parseVatInput(value) {
  const match = String(value || "").match(/[\d.]+/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrencyList(existing, country) {
  const fromArray = Array.isArray(existing?.currencies) ? existing.currencies : [];
  const legacy = existing?.currency ? [existing.currency] : [];
  const combined = [...fromArray, ...legacy]
    .map((currency) => (typeof currency === "string" ? currency.trim().toUpperCase() : ""))
    .filter(Boolean);

  if (combined.length) {
    return Array.from(new Set(combined)).slice(0, MAX_CURRENCIES);
  }

  const fallback = getCurrency(country);
  return fallback ? [fallback] : [];
}

function normalizeProfile(user, role, existing) {
  const baseCountry = getCanonicalCountryName(existing?.country || "") || "India";
  const legacyAddress = existing?.address || {};
  const normalizedAddress = {
    line1: legacyAddress.line1 || legacyAddress.street || "",
    line2: legacyAddress.line2 || "",
    city: legacyAddress.city || "",
    state: legacyAddress.state || "",
    postalCode: legacyAddress.postalCode || ""
  };
  const currencies = normalizeCurrencyList(existing, baseCountry);
  const today = new Date();
  const currentYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const defaultFinancialYearStart = `${currentYear}-04-01`;
  const financialYearDate =
    normalizeIsoDate(
      existing?.financialYearDate ||
        existing?.financial_year_date ||
        existing?.financialYearStartDate ||
        existing?.financial_year_start
    ) || defaultFinancialYearStart;
  const financialYearStartDate = financialYearDate;
  const financialYearEndDate = buildFinancialYearEndDate(financialYearDate);

  return {
    ownerName: user?.name || existing?.ownerName || "",
    ownerEmail: user?.email || existing?.ownerEmail || "",
    ownerRole: role || existing?.ownerRole || "Owner",
    companyName: existing?.companyName || "",
    logoBase64: existing?.logoBase64 || "",
    country: baseCountry,
    currency: currencies[0] || "",
    currencies,
    phone: existing?.phone || "",
    email: existing?.email || "",
    address: normalizedAddress,
    tax: {
      gstin: existing?.tax?.gstin || "",
      vatNumber: existing?.tax?.vatNumber || "",
      vatRate: existing?.tax?.vatRate || getVatRate(baseCountry),
      taxId: existing?.tax?.taxId || ""
    },
    financialYearDate,
    financialYearStartDate,
    financialYearEndDate
  };
}

function profileIsMostlyEmpty(value) {
  if (!value) return true;
  return !(
    String(value.companyName || "").trim() ||
    String(value.email || "").trim() ||
    String(value.phone || "").trim() ||
    String(value.address?.line1 || "").trim()
  );
}

export default function CompanySetup() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const user = authGetUser();
  const role = authGetRole();
  const organizationId = authGetOrganizationId();
  const createMode = canAccessSettings(role) && searchParams.get("mode") === "create";
  const freshOwnerSetup = canAccessSettings(role) && !createMode && !organizationId;
  const { profile: organizationProfile } = useOrganization();
  const current = createMode || freshOwnerSetup ? null : organizationProfile || companyGetProfile();

  const initialProfile = createMode || freshOwnerSetup ? {} : organizationProfile || companyGetProfile();
  const [profile, setProfile] = useState(() => normalizeProfile(user, role, initialProfile));
  const [pendingCountry, setPendingCountry] = useState("");
  const [countryWarning, setCountryWarning] = useState(false);

  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [vatInput, setVatInput] = useState("");
  const [hasInvoices, setHasInvoices] = useState(() => invoicesList().length > 0);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);

  const isIndia = useMemo(() => resolveCountryIsoCode(profile.country) === "IN", [profile.country]);
  const isVatCountry = useMemo(() => VAT_COUNTRIES.includes(profile.country), [profile.country]);
  const isSalesTaxCountry = useMemo(() => profile.country === "USA", [profile.country]);
  const allCountries = useMemo(() => listAllCountries(), []);
  const stateOptions = useMemo(() => listStatesByCountry(profile.country), [profile.country]);
  const countryQuery = String(profile.country || "")
    .trim()
    .toLowerCase();
  const stateQuery = String(profile.address.state || "")
    .trim()
    .toLowerCase();
  const countryMatches = useMemo(() => {
    if (!countryQuery) return [];
    return allCountries
      .filter((countryEntry) => countryEntry.name.toLowerCase().includes(countryQuery))
      .slice(0, 8);
  }, [allCountries, countryQuery]);
  const stateMatches = useMemo(() => {
    if (!stateQuery || !stateOptions.length) return [];
    return stateOptions
      .filter((stateEntry) => stateEntry.name.toLowerCase().includes(stateQuery))
      .slice(0, 8);
  }, [stateOptions, stateQuery]);

  useEffect(() => {
    if (profile.country === "India") {
      setVatInput("");
      return;
    }
    const rate = Number(profile.tax?.vatRate || 0);
    setVatInput(`${rate}%`);
  }, [profile.country]);

  useEffect(() => {
    if (createMode || freshOwnerSetup) return;
    const nextProfileSource = organizationProfile || companyGetProfile();
    if (!nextProfileSource) return;

    setProfile((prev) => {
      if (!profileIsMostlyEmpty(prev)) return prev;
      return normalizeProfile(user, role, nextProfileSource);
    });
  }, [createMode, freshOwnerSetup, organizationProfile, user?.id, role]);

  useEffect(() => {
    if (createMode) {
      setHasInvoices(false);
      return;
    }
    let mounted = true;
    async function syncInvoiceState() {
      try {
        const list = await invoicesSyncFromRemote();
        if (!mounted) return;
        setHasInvoices(Array.isArray(list) ? list.length > 0 : invoicesList().length > 0);
      } catch {
        if (!mounted) return;
        setHasInvoices(invoicesList().length > 0);
      }
    }
    syncInvoiceState();
    return () => {
      mounted = false;
    };
  }, [createMode]);

  function validate() {
    const next = {};
    if (!profile.companyName.trim()) next.companyName = "This field is required";
    const phoneValidation = validateInternationalPhone(profile.phone, {
      required: true,
      label: "Phone number"
    });
    if (phoneValidation.error) next.phone = phoneValidation.error;
    if (!profile.country) next.country = "This field is required";
    if (!profile.currencies.length) next.currency = "This field is required";
    if (!profile.address.line1.trim()) next.addressLine1 = "This field is required";
    if (!profile.address.city.trim()) next.city = "This field is required";
    if (isIndia && !profile.address.state.trim()) next.state = "This field is required";
    if (!profile.financialYearDate) next.financialYearDate = "This field is required";
    return next;
  }

  useEffect(() => {
    setErrors((prev) => {
      if (!prev || !Object.keys(prev).length) return prev;
      const next = { ...prev };
      let changed = false;

      if (next.companyName && profile.companyName.trim()) {
        delete next.companyName;
        changed = true;
      }
      if (next.phone) {
        const phoneValidation = validateInternationalPhone(profile.phone, {
          required: true,
          label: "Phone number"
        });
        if (!phoneValidation.error) {
          delete next.phone;
          changed = true;
        }
      }
      if (next.country && profile.country.trim()) {
        delete next.country;
        changed = true;
      }
      if (next.currency && profile.currencies.length) {
        delete next.currency;
        changed = true;
      }
      if (next.addressLine1 && profile.address.line1.trim()) {
        delete next.addressLine1;
        changed = true;
      }
      if (next.city && profile.address.city.trim()) {
        delete next.city;
        changed = true;
      }
      if (next.state && (!isIndia || profile.address.state.trim())) {
        delete next.state;
        changed = true;
      }
      if (next.financialYearDate && profile.financialYearDate) {
        delete next.financialYearDate;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [
    isIndia,
    profile.companyName,
    profile.phone,
    profile.country,
    profile.currencies.length,
    profile.address.line1,
    profile.address.city,
    profile.address.state,
    profile.financialYearDate
  ]);

  async function save() {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveError("Please fill the highlighted required fields before saving.");
      window.requestAnimationFrame(() => {
        const firstInvalidField = document.querySelector("input.border-rose-300, textarea.border-rose-300, select.border-rose-300");
        if (firstInvalidField instanceof HTMLElement) {
          firstInvalidField.scrollIntoView({ behavior: "smooth", block: "center" });
          firstInvalidField.focus();
        }
      });
      return;
    }
    setSaveError("");
    setSaving(true);

    try {
      await companySaveProfileRemote({
        ...profile,
        currency: profile.currencies[0] || "",
        financialYearDate: profile.financialYearDate,
        financialYearStartDate: profile.financialYearDate,
        financialYearEndDate: buildFinancialYearEndDate(profile.financialYearDate),
        created_at: new Date().toISOString()
      }, { forceCreate: createMode });
      nav(canAccessSettings(role) ? "/invoice-template-setup" : "/dashboard", { replace: true });
    } catch (error) {
      setSaveError(error?.message || "Failed to save organization details");
    } finally {
      setSaving(false);
    }
  }

  function applyCountryChange(country) {
    const canonicalCountry = getCanonicalCountryName(country || "");
    if (!canonicalCountry) return;
    const defaults = normalizeCurrencyList({}, canonicalCountry);
    setProfile((p) => ({
      ...p,
      country: canonicalCountry,
      currency: defaults[0] || "",
      currencies: defaults,
      address: { ...p.address, state: "" },
      tax: { ...p.tax, gstin: "", vatNumber: "", vatRate: getVatRate(canonicalCountry) }
    }));
  }

  function applyCountryInput(value, options = { checkWarning: true }) {
    const canonicalCountry = getCanonicalCountryName(value || "");
    if (!canonicalCountry) return;
    const currentCountry = getCanonicalCountryName(current?.country || "");
    const hasCountryChanged = currentCountry && canonicalCountry !== currentCountry;

    if (options.checkWarning && hasInvoices && hasCountryChanged) {
      setPendingCountry(canonicalCountry);
      setCountryWarning(true);
      setProfile((prev) => ({ ...prev, country: currentCountry }));
      setCountryMenuOpen(false);
      return;
    }

    applyCountryChange(canonicalCountry);
    setCountryMenuOpen(false);
    setStateMenuOpen(false);
  }

  return (
    <div className="px-5 py-6 max-w-6xl mx-auto">
      <PageHeader
        title={createMode ? "Create Company" : "Company Setup"}
        subtitle={
          createMode
            ? "Create an additional organization profile."
            : "Create your organization and tax profile to unlock dashboards."
        }
        right={<GradientButton onClick={save}>{saving ? "Saving..." : "Save & Continue"}</GradientButton>}
      />

      {saveError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {saveError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="h-1.5 w-28 rounded-full" style={{ background: UI.GRADIENT }} />

          <section className="mt-4">
            <h2 className="text-base font-semibold text-slate-900">User Profile (read-only)</h2>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Name">
                <input
                  value={profile.ownerName}
                  readOnly
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                />
              </FormField>

              <FormField label="Role">
                <input
                  value={profile.ownerRole}
                  readOnly
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                />
              </FormField>

              <FormField label="Email">
                <input
                  value={profile.ownerEmail}
                  readOnly
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                />
              </FormField>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-base font-semibold text-slate-900">Company Details</h2>
            <p className="mt-1 text-sm text-slate-500">These details appear on invoices and reports.</p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Company Name" required error={errors.companyName}>
                <input
                  value={profile.companyName}
                  onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                    errors.companyName ? "border-rose-300" : "border-slate-100"
                  }`}
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="BillJoy Technologies"
                />
                {errors.companyName ? <p className="mt-1 text-xs text-rose-600">{errors.companyName}</p> : null}
              </FormField>

              <FormField label="Company Logo (optional)">
                <FileUpload
                  value={profile.logoBase64}
                  onChange={(val) => setProfile((p) => ({ ...p, logoBase64: val }))}
                />
              </FormField>

              <FormField label="Country" required error={errors.country}>
                <div className="relative">
                  <input
                    value={profile.country}
                    onChange={(event) => {
                      setProfile((prev) => ({ ...prev, country: event.target.value }));
                      setCountryMenuOpen(true);
                    }}
                    onFocus={() => setCountryMenuOpen(true)}
                    onBlur={(event) => {
                      applyCountryInput(event.target.value);
                      window.setTimeout(() => setCountryMenuOpen(false), 80);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setCountryMenuOpen(false);
                    }}
                    className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 bg-white ${
                      errors.country ? "border-rose-300" : "border-slate-100"
                    }`}
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder="Type country name"
                  />
                  {countryMenuOpen && countryQuery ? (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                      {countryMatches.length ? (
                        countryMatches.map((countryEntry) => (
                          <button
                            key={countryEntry.isoCode}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyCountryInput(countryEntry.name);
                            }}
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {countryEntry.name}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-xs text-slate-500">No matching countries</p>
                      )}
                    </div>
                  ) : null}
                </div>
                {errors.country ? <p className="mt-1 text-xs text-rose-600">{errors.country}</p> : null}
                {countryWarning ? (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <p className="font-semibold">Warning: Country change affects existing invoices.</p>
                    <p className="mt-1">
                      You already have invoices. Changing the country can impact tax compliance and templates.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setProfile((prev) => ({
                            ...prev,
                            country: getCanonicalCountryName(current?.country || prev.country)
                          }));
                          setCountryWarning(false);
                          setPendingCountry("");
                        }}
                        className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-800"
                      >
                        Keep current
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (pendingCountry) {
                            applyCountryInput(pendingCountry, { checkWarning: false });
                          }
                          setCountryWarning(false);
                          setPendingCountry("");
                        }}
                        className="rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white"
                      >
                        Switch country
                      </button>
                    </div>
                  </div>
                ) : null}
              </FormField>

              <FormField label="Currency" required error={errors.currency} hint={`Add up to ${MAX_CURRENCIES}`}>
                <CurrencyMultiInput
                  value={profile.currencies}
                  onChange={(currencies) =>
                    setProfile((p) => ({ ...p, currencies, currency: currencies[0] || "" }))
                  }
                  placeholder={getCurrency(profile.country) || "INR"}
                  max={MAX_CURRENCIES}
                  error={errors.currency}
                  ringColor={UI.COLORS.ring}
                />
                {errors.currency ? <p className="mt-1 text-xs text-rose-600">{errors.currency}</p> : null}
              </FormField>

              <FormField
                label="Company Phone"
                required
                error={errors.phone}
                hint={`Use international format (${phoneDigitRangeLabel()})`}
              >
                <input
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                    errors.phone ? "border-rose-300" : "border-slate-100"
                  }`}
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="+1 202 555 0147"
                />
                {errors.phone ? <p className="mt-1 text-xs text-rose-600">{errors.phone}</p> : null}
              </FormField>

              <FormField label="Company Email">
                <input
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="billing@billjoy.com"
                />
              </FormField>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-base font-semibold text-slate-900">Address Details</h2>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Address Line 1" required error={errors.addressLine1}>
                <input
                  value={profile.address.line1}
                  onChange={(e) => setProfile((p) => ({ ...p, address: { ...p.address, line1: e.target.value } }))}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                    errors.addressLine1 ? "border-rose-300" : "border-slate-100"
                  }`}
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="No. 12, Business Street"
                />
                {errors.addressLine1 ? <p className="mt-1 text-xs text-rose-600">{errors.addressLine1}</p> : null}
              </FormField>

              <FormField label="Address Line 2">
                <input
                  value={profile.address.line2}
                  onChange={(e) => setProfile((p) => ({ ...p, address: { ...p.address, line2: e.target.value } }))}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                />
              </FormField>

              <FormField label="City" required error={errors.city}>
                <input
                  value={profile.address.city}
                  onChange={(e) => setProfile((p) => ({ ...p, address: { ...p.address, city: e.target.value } }))}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                    errors.city ? "border-rose-300" : "border-slate-100"
                  }`}
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="Chennai"
                />
                {errors.city ? <p className="mt-1 text-xs text-rose-600">{errors.city}</p> : null}
              </FormField>

              <FormField
                label="State / Province"
                required={isIndia}
                optional={!isIndia}
                error={errors.state}
                hint={stateOptions.length ? `${stateOptions.length} options available` : "Type manually"}
              >
                <div className="relative">
                  <input
                    value={profile.address.state}
                    onChange={(event) => {
                      setProfile((prev) => ({
                        ...prev,
                        address: { ...prev.address, state: event.target.value }
                      }));
                      if (stateOptions.length) setStateMenuOpen(true);
                    }}
                    onFocus={() => {
                      if (stateOptions.length) setStateMenuOpen(true);
                    }}
                    onBlur={() => window.setTimeout(() => setStateMenuOpen(false), 80)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setStateMenuOpen(false);
                    }}
                    className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                      errors.state ? "border-rose-300" : "border-slate-100"
                    }`}
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder={stateOptions.length ? "Type state / region" : "State, province, or region"}
                  />
                  {stateMenuOpen && stateQuery && stateOptions.length ? (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                      {stateMatches.length ? (
                        stateMatches.map((stateEntry) => (
                          <button
                            key={`${stateEntry.isoCode}_${stateEntry.name}`}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setProfile((prev) => ({
                                ...prev,
                                address: { ...prev.address, state: stateEntry.name }
                              }));
                              setStateMenuOpen(false);
                            }}
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {stateEntry.name}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-xs text-slate-500">No matching states/regions</p>
                      )}
                    </div>
                  ) : null}
                </div>
                {errors.state ? <p className="mt-1 text-xs text-rose-600">{errors.state}</p> : null}
              </FormField>

              <FormField label="Postal Code">
                <input
                  value={profile.address.postalCode}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, address: { ...p.address, postalCode: e.target.value } }))
                  }
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                />
              </FormField>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-base font-semibold text-slate-900">Financial Year</h2>
            <p className="mt-1 text-sm text-slate-500">Choose one financial-year date. The app will calculate the full 12-month range automatically.</p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Financial Year Date" required error={errors.financialYearDate}>
                <DateInput
                  value={profile.financialYearDate || ""}
                  onChange={(nextDate) => {
                    setProfile((p) => ({
                      ...p,
                      financialYearDate: nextDate,
                      financialYearStartDate: nextDate,
                      financialYearEndDate: nextDate ? buildFinancialYearEndDate(nextDate) : ""
                    }));
                  }}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                    errors.financialYearDate ? "border-rose-300" : "border-slate-100"
                  }`}
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                />
                {errors.financialYearDate ? (
                  <p className="mt-1 text-xs text-rose-600">{errors.financialYearDate}</p>
                ) : null}
              </FormField>

              <FormField
                label="Financial Year Period"
                hint="End date is calculated automatically and old years are resolved from this pattern"
              >
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  <p>Start: {profile.financialYearStartDate || "-"}</p>
                  <p className="mt-1">End: {profile.financialYearEndDate || "-"}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    Label preview: {profile.financialYearStartDate?.slice(0, 4) || "YYYY"}-
                    {profile.financialYearEndDate?.slice(0, 4) || "YYYY"}
                  </p>
                </div>
              </FormField>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-base font-semibold text-slate-900">Tax Registration Details</h2>
            {isIndia ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="GST State (from address)">
                  <input
                    value={profile.address.state}
                    readOnly
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                  />
                  {!profile.address.state ? (
                    <p className="mt-1 text-xs text-rose-600">Select a state above to continue.</p>
                  ) : null}
                </FormField>

                <FormField label="GSTIN (optional)">
                  <input
                    value={profile.tax.gstin}
                    onChange={(e) => setProfile((p) => ({ ...p, tax: { ...p.tax, gstin: e.target.value } }))}
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                  />
                </FormField>

                <div className="md:col-span-2 rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
                  <p className="text-sm font-semibold text-slate-900">GST handling notes</p>
                  <ul className="mt-2 text-sm text-slate-600 list-disc list-inside space-y-1">
                    <li>Same-state sales: CGST + SGST</li>
                    <li>Inter-state sales: IGST</li>
                  </ul>
                </div>
              </div>
            ) : isVatCountry ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label={profile.country === "UAE" ? "TRN (optional)" : "VAT Number (optional)"}>
                  <input
                    value={profile.tax.vatNumber}
                    onChange={(e) => setProfile((p) => ({ ...p, tax: { ...p.tax, vatNumber: e.target.value } }))}
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                  />
                </FormField>

                <FormField label="VAT Rate (auto)">
                  <input
                    value={vatInput}
                    onChange={(e) => {
                      const next = e.target.value;
                      setVatInput(next);
                      setProfile((p) => ({
                        ...p,
                        tax: { ...(p.tax || {}), vatRate: parseVatInput(next) }
                      }));
                    }}
                    onBlur={() => {
                      if (!vatInput.trim()) return;
                      const parsed = parseVatInput(vatInput);
                      setVatInput(`${parsed}%`);
                    }}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder={`${getVatRate(profile.country)}%`}
                  />
                  <p className="mt-1 text-xs text-slate-500">Single VAT % applied automatically.</p>
                </FormField>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label={isSalesTaxCountry ? "EIN / Business ID (optional)" : "Tax ID (optional)"}>
                  <input
                    value={profile.tax.taxId || ""}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, tax: { ...p.tax, taxId: e.target.value } }))
                    }
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                  />
                </FormField>
              </div>
            )}
          </section>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900">Setup checklist</h2>
          <p className="mt-2 text-sm text-slate-500">
            Save this form to unlock dashboard access for your team.
          </p>

          <div className="mt-4 rounded-2xl border border-slate-100 p-4" style={{ background: UI.COLORS.cream }}>
            <p className="text-sm font-semibold text-slate-900">Tax mode preview</p>
            <p className="mt-2 text-sm text-slate-700">
              {isIndia
                ? "India: GST applied with CGST/SGST for same-state and IGST for inter-state sales."
                : "VAT countries: Single VAT % applied automatically on invoices."}
            </p>
          </div>

          <div className="mt-4">
            <GradientButton className="w-full justify-center" onClick={save}>
              {saving ? "Saving..." : "Save & Continue"}
            </GradientButton>
            {createMode ? (
              <button
                type="button"
                onClick={() => nav("/app/company-settings")}
                className="mt-2 w-full rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
