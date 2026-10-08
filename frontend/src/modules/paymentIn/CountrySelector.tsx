import React from "react";
import { Globe2 } from "lucide-react";
import { COUNTRY_OPTIONS } from "./countryConfig";
import type { CountryCode } from "./countryConfig";

interface CountrySelectorProps {
  value: CountryCode | "";
  onChange: (next: CountryCode) => void;
  disabled?: boolean;
}

export default function CountrySelector({ value, onChange, disabled }: CountrySelectorProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center">
            <Globe2 className="h-5 w-5 text-slate-700" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Payment Country Context</p>
            <p className="text-xs text-slate-500">
              Country is mandatory and drives currency, receipt numbering, legal wording, and payment modes.
            </p>
          </div>
        </div>

        <label className="flex w-full max-w-sm flex-col gap-1 md:w-80">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operating Country</span>
          <select
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value as CountryCode)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Select country</option>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.code} value={country.code}>
                {country.flag} {country.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

