import React, { useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import FormField from "../components/FormField";
import FileUpload from "../components/FileUpload";
import GradientButton from "../components/GradientButton";
import CurrencyMultiInput from "../components/CurrencyMultiInput";
import { COUNTRIES, companyGetProfile, companyUpdateProfile } from "../services/company.service";
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
  "United Kingdom": { currency: "GBP", vatRate: 20 },
  UK: { currency: "GBP", vatRate: 20 },
  Ireland: { currency: "EUR", vatRate: 23 }
};

const VAT_COUNTRIES = ["Sri Lanka", "United Kingdom", "Ireland", "UK"];

function getCurrency(country) {
  return COUNTRY_META[country]?.currency || "";
}

function getVatRate(country) {
  return COUNTRY_META[country]?.vatRate || 0;
}

function normalizeCurrencyList(current, country) {
  const fromArray = Array.isArray(current?.currencies) ? current.currencies : [];
  const legacy = current?.currency ? [current.currency] : [];
  const combined = [...fromArray, ...legacy]
    .map((currency) => (typeof currency === "string" ? currency.trim().toUpperCase() : ""))
    .filter(Boolean);

  if (combined.length) {
    return Array.from(new Set(combined)).slice(0, MAX_CURRENCIES);
  }

  const fallback = getCurrency(country);
  return fallback ? [fallback] : [];
}

function normalizeCompany(current) {
  const baseCountry = current?.country === "UK" ? "United Kingdom" : current?.country || "India";
  const currencies = normalizeCurrencyList(current, baseCountry);
  const defaults = {
    companyName: "",
    logoBase64: "",
    country: baseCountry,
    currency: currencies[0] || "",
    currencies,
    phone: "",
    email: "",
    address: { line1: "", line2: "", city: "", state: "", postalCode: "" },
    tax: { gstin: "", vatNumber: "", vatRate: getVatRate(baseCountry) }
  };

  const legacyAddress = current?.address || {};
  const normalizedAddress = {
    line1: legacyAddress.line1 || legacyAddress.street || "",
    line2: legacyAddress.line2 || "",
    city: legacyAddress.city || "",
    state: legacyAddress.state || "",
    postalCode: legacyAddress.postalCode || ""
  };

  return {
    ...defaults,
    ...(current || {}),
    currency: currencies[0] || "",
    currencies,
    address: { ...defaults.address, ...normalizedAddress },
    tax: { ...defaults.tax, ...(current?.tax || {}) }
  };
}

export default function CompanySettings() {
  const current = companyGetProfile();
  const [company, setCompany] = useState(() => normalizeCompany(current));

  const country = company.country || "India";
  const isIndia = useMemo(() => country === "India", [country]);
  const isVatCountry = useMemo(() => VAT_COUNTRIES.includes(country), [country]);

  function handleCountryChange(nextCountry) {
    const defaults = normalizeCurrencyList({}, nextCountry);
    setCompany((p) => ({
      ...p,
      country: nextCountry,
      currency: defaults[0] || "",
      currencies: defaults,
      address: { ...p.address, state: "" },
      tax: { ...p.tax, gstin: "", vatNumber: "", vatRate: getVatRate(nextCountry) }
    }));
  }

  function save() {
    companyUpdateProfile({ ...company, currency: company.currencies?.[0] || "" });
    alert("Company profile updated (localStorage).");
  }

  const currencyLabel = (company.currencies?.length ? company.currencies : company.currency ? [company.currency] : [])
    .filter(Boolean)
    .join(", ");

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Company Profile"
        subtitle="Manage billing details used across invoices and reports."
        right={<GradientButton onClick={save}>Save Changes</GradientButton>}
      />

      <Card className="p-5">
        <div className="h-1.5 w-28 rounded-full" style={{ background: UI.GRADIENT }} />

        <section className="mt-4">
          <h2 className="text-base font-semibold text-slate-900">Company Details</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Company Name">
              <input
                value={company.companyName || ""}
                onChange={(e) => setCompany((p) => ({ ...p, companyName: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Company Logo">
              <FileUpload
                value={company.logoBase64 || ""}
                onChange={(val) => setCompany((p) => ({ ...p, logoBase64: val }))}
              />
            </FormField>

            <FormField label="Country">
              <select
                value={country}
                onChange={(e) => handleCountryChange(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Currency" hint={`Add up to ${MAX_CURRENCIES}`}>
              <CurrencyMultiInput
                value={company.currencies}
                onChange={(currencies) =>
                  setCompany((p) => ({ ...p, currencies, currency: currencies[0] || "" }))
                }
                placeholder={getCurrency(country) || "INR"}
                max={MAX_CURRENCIES}
              />
            </FormField>

            <FormField label="Company Phone">
              <input
                value={company.phone || ""}
                onChange={(e) => setCompany((p) => ({ ...p, phone: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Company Email">
              <input
                value={company.email || ""}
                onChange={(e) => setCompany((p) => ({ ...p, email: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-semibold text-slate-900">Address Details</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Address Line 1">
              <input
                value={company?.address?.line1 || ""}
                onChange={(e) =>
                  setCompany((p) => ({ ...p, address: { ...(p.address || {}), line1: e.target.value } }))
                }
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Address Line 2">
              <input
                value={company?.address?.line2 || ""}
                onChange={(e) =>
                  setCompany((p) => ({ ...p, address: { ...(p.address || {}), line2: e.target.value } }))
                }
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="City">
              <input
                value={company?.address?.city || ""}
                onChange={(e) =>
                  setCompany((p) => ({ ...p, address: { ...(p.address || {}), city: e.target.value } }))
                }
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label={isIndia ? "State (India)" : "State / Province"}>
              {isIndia ? (
                <>
                  <input
                    list="india-states"
                    value={company?.address?.state || ""}
                    onChange={(e) =>
                      setCompany((p) => ({ ...p, address: { ...(p.address || {}), state: e.target.value } }))
                    }
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
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
                  value={company?.address?.state || ""}
                  onChange={(e) =>
                    setCompany((p) => ({ ...p, address: { ...(p.address || {}), state: e.target.value } }))
                  }
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
                />
              )}
            </FormField>

            <FormField label="Postal Code">
              <input
                value={company?.address?.postalCode || ""}
                onChange={(e) =>
                  setCompany((p) => ({ ...p, address: { ...(p.address || {}), postalCode: e.target.value } }))
                }
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-semibold text-slate-900">Tax Registration Details</h2>
          {isIndia ? (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="GSTIN">
                <input
                  value={company?.tax?.gstin || ""}
                  onChange={(e) =>
                    setCompany((p) => ({
                      ...p,
                      tax: { ...(p.tax || {}), gstin: e.target.value }
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
                />
              </FormField>

              <FormField label="GST State">
                <input
                  value={company?.address?.state || ""}
                  readOnly
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                />
              </FormField>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="VAT Number">
                <input
                  value={company?.tax?.vatNumber || ""}
                  onChange={(e) =>
                    setCompany((p) => ({
                      ...p,
                      tax: { ...(p.tax || {}), vatNumber: e.target.value }
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
                />
              </FormField>

              <FormField label="VAT Rate">
                <input
                  value={company?.tax?.vatRate ? `${company.tax.vatRate}%` : ""}
                  readOnly
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                />
                {isVatCountry ? (
                  <p className="mt-1 text-xs text-slate-500">Single VAT % applied automatically.</p>
                ) : null}
              </FormField>
            </div>
          )}
        </section>

        <div className="mt-6 rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
          <p className="text-sm font-semibold text-slate-900">Invoice preview (company header)</p>
          <p className="text-xs text-slate-500 mt-1">These details reflect on invoice previews.</p>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl border border-slate-100 overflow-hidden bg-white">
              {company.logoBase64 ? (
                <img src={company.logoBase64} alt="logo" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{company.companyName || "Company Name"}</p>
              <p className="text-xs text-slate-500">
                {currencyLabel} | {company.country || ""}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
