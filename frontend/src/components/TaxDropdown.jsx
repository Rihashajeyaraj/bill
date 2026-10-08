import React, { useMemo } from "react";

const INDIA_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
const VAT_RATES = {
  "Sri Lanka": 18,
  "United Kingdom": 20,
  UK: 20,
  Ireland: 23
};

function buildIndiaOptions() {
  const options = [{ label: "None", value: "None" }];
  INDIA_RATES.forEach((rate) => {
    options.push({ label: `IGST@${rate}%`, value: `IGST@${rate}%` });
    options.push({ label: `GST@${rate}%`, value: `GST@${rate}%` });
  });
  options.push({ label: "Exempt", value: "Exempt" });
  return options;
}

function buildVatOptions(country) {
  const rate = VAT_RATES[country] || 0;
  const options = [{ label: "None", value: "None" }];
  if (rate) options.push({ label: `VAT@${rate}%`, value: `VAT@${rate}%` });
  options.push({ label: "Exempt", value: "Exempt" });
  return options;
}

export default function TaxDropdown({ country, value, onChange, className }) {
  const isIndia = (country || "").toLowerCase() === "india";
  const options = useMemo(() => (isIndia ? buildIndiaOptions() : buildVatOptions(country)), [isIndia, country]);

  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={className}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
