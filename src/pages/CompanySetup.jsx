import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import FormField from "../components/FormField";
import FileUpload from "../components/FileUpload";
import CurrencyMultiInput from "../components/CurrencyMultiInput";
import { authGetRole, authGetUser } from "../services/auth.service";
import {
  COUNTRIES,
  companyGetProfile,
  companySaveProfileRemote
} from "../services/company.service";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { UI } from "../theme/tokens";

const MAX_CURRENCIES = 3;

const INDIA_STATES = [
  "Andhra Pradesh",
  "Delhi",
  "Gujarat",
  "Karnataka",
  "Kerala",
  "Maharashtra",
  "Tamil Nadu",
  "Telangana",
  "West Bengal"
];

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
  const baseCountry = existing?.country === "UK" ? "United Kingdom" : existing?.country || "India";
  const legacyAddress = existing?.address || {};
  const normalizedAddress = {
    line1: legacyAddress.line1 || legacyAddress.street || "",
    line2: legacyAddress.line2 || "",
    city: legacyAddress.city || "",
    state: legacyAddress.state || "",
    postalCode: legacyAddress.postalCode || ""
  };
  const currencies = normalizeCurrencyList(existing, baseCountry);

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
    }
  };
}

export default function CompanySetup() {
  const nav = useNavigate();
  const user = authGetUser();
  const role = authGetRole();

  const current = companyGetProfile();
  const [profile, setProfile] = useState(() => normalizeProfile(user, role, current));
  const [pendingCountry, setPendingCountry] = useState("");
  const [countryWarning, setCountryWarning] = useState(false);

  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [vatInput, setVatInput] = useState("");
  const [hasInvoices, setHasInvoices] = useState(() => invoicesList().length > 0);

  const isIndia = useMemo(() => profile.country === "India", [profile.country]);
  const isVatCountry = useMemo(() => VAT_COUNTRIES.includes(profile.country), [profile.country]);
  const isSalesTaxCountry = useMemo(() => profile.country === "USA", [profile.country]);

  useEffect(() => {
    if (profile.country === "India") {
      setVatInput("");
      return;
    }
    const rate = Number(profile.tax?.vatRate || 0);
    setVatInput(`${rate}%`);
  }, [profile.country]);

  useEffect(() => {
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
  }, []);

  function validate() {
    const next = {};
    if (!profile.companyName.trim()) next.companyName = "Company name is required.";
    if (!profile.country) next.country = "Country is required.";
    if (!profile.currencies.length) next.currency = "Currency is required.";
    if (!profile.address.line1.trim()) next.addressLine1 = "Address line 1 is required.";
    if (!profile.address.city.trim()) next.city = "City is required.";
    if (isIndia && !profile.address.state.trim()) next.state = "State is required for India.";
    return next;
  }

  async function save() {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaveError("");
    setSaving(true);

    try {
      await companySaveProfileRemote({
        ...profile,
        currency: profile.currencies[0] || "",
        created_at: new Date().toISOString()
      });
      nav("/dashboard", { replace: true });
    } catch (error) {
      setSaveError(error?.message || "Failed to save organization details");
    } finally {
      setSaving(false);
    }
  }

  function applyCountryChange(country) {
    const defaults = normalizeCurrencyList({}, country);
    setProfile((p) => ({
      ...p,
      country,
      currency: defaults[0] || "",
      currencies: defaults,
      address: { ...p.address, state: "" },
      tax: { ...p.tax, gstin: "", vatNumber: "", vatRate: getVatRate(country) }
    }));
  }

  return (
    <div className="px-5 py-6 max-w-6xl mx-auto">
      <PageHeader
        title="Company Setup"
        subtitle="Create your organization and tax profile to unlock dashboards."
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
              <FormField label="Company Name">
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

              <FormField label="Country">
                <select
                  value={profile.country}
                  onChange={(e) => {
                    const c = e.target.value;
                    if (hasInvoices && current?.country && c !== current.country) {
                      setPendingCountry(c);
                      setCountryWarning(true);
                      return;
                    }
                    applyCountryChange(c);
                  }}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 bg-white ${
                    errors.country ? "border-rose-300" : "border-slate-100"
                  }`}
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
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
                            applyCountryChange(pendingCountry);
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

              <FormField label="Currency" hint={`Add up to ${MAX_CURRENCIES}`}>
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

              <FormField label="Company Phone">
                <input
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                  placeholder="+91 98765 43210"
                />
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
              <FormField label="Address Line 1">
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

              <FormField label="City">
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

            <FormField label={isIndia ? "State (required for India)" : "State / Province"}>
              {isIndia ? (
                  <>
                    <input
                      list="india-states"
                      value={profile.address.state}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, address: { ...p.address, state: e.target.value } }))
                      }
                      className={`w-full rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-4 ${
                        errors.state ? "border-rose-300" : "border-slate-100"
                      }`}
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                      placeholder="Select or type state"
                    />
                    <datalist id="india-states">
                      {INDIA_STATES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </>
              ) : (
                <input
                  value={profile.address.state}
                    onChange={(e) => setProfile((p) => ({ ...p, address: { ...p.address, state: e.target.value } }))}
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                  />
                )}
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
          </div>
        </Card>
      </div>
    </div>
  );
}
