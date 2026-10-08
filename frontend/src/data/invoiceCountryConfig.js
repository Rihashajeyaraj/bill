export const TEMPLATE_LIBRARY = {
  new_globe_export: { id: "new_globe_export", label: "New Globe – Export" },
  anvase_exim_import: { id: "anvase_exim_import", label: "ANVASE EXIM – Import" },
  uprichard_international: { id: "uprichard_international", label: "UPRICHARD – International" },
  pga_shipping_draft: { id: "pga_shipping_draft", label: "PGA Shipping – Draft Tax Invoice" },
  modern_gst: { id: "modern_gst", label: "Modern GST" },
  classic: { id: "classic", label: "Classic" },
  professional: { id: "professional", label: "Professional" },
  compact: { id: "compact", label: "Compact" }
};

export const COUNTRY_INVOICE_CONFIG = {
  India: {
    code: "IN",
    label: "India",
    emoji: "🇮🇳",
    currency: "INR",
    currencySymbol: "₹",
    invoiceTitle: "Tax Invoice",
    taxType: "GST",
    defaultTaxRate: 18,
    templates: [
      "new_globe_export",
      "anvase_exim_import",
      "uprichard_international",
      "pga_shipping_draft",
      "modern_gst",
      "classic",
      "professional",
      "compact"
    ],
    requiredFields: [
      "GSTIN (Seller & Buyer)",
      "HSN/SAC",
      "CGST / SGST / IGST",
      "Place of Supply",
      "Tax breakup"
    ]
  },
  "Sri Lanka": {
    code: "LK",
    label: "Sri Lanka",
    emoji: "🇱🇰",
    currency: "LKR",
    currencySymbol: "₨",
    invoiceTitle: "VAT Invoice",
    taxType: "VAT",
    defaultTaxRate: 18,
    templates: ["uprichard_international", "modern_gst", "classic", "compact"],
    requiredFields: ["VAT Registration Number", "VAT %", "Tax summary (single VAT)"]
  },
  UAE: {
    code: "AE",
    label: "UAE",
    emoji: "🇦🇪",
    currency: "AED",
    currencySymbol: "AED ",
    invoiceTitle: "Tax Invoice",
    taxType: "VAT",
    defaultTaxRate: 5,
    templates: ["uprichard_international", "pga_shipping_draft", "modern_gst", "professional"],
    requiredFields: ["TRN (Tax Registration Number)", "VAT 5%", "Arabic + English layout"]
  },
  USA: {
    code: "US",
    label: "USA",
    emoji: "🇺🇸",
    currency: "USD",
    currencySymbol: "$",
    invoiceTitle: "Invoice",
    taxType: "SALES_TAX",
    defaultTaxRate: 0,
    templates: ["uprichard_international", "modern_gst", "professional", "compact"],
    requiredFields: ["EIN / Business ID", "Sales Tax (optional)"]
  },
  "United Kingdom": {
    code: "GB",
    label: "United Kingdom",
    emoji: "🇬🇧",
    currency: "GBP",
    currencySymbol: "£",
    invoiceTitle: "VAT Invoice",
    taxType: "VAT",
    defaultTaxRate: 20,
    templates: ["uprichard_international", "classic", "professional", "modern_gst"],
    requiredFields: ["VAT Registration Number", "VAT %", "Tax summary (single VAT)"]
  },
  Ireland: {
    code: "IE",
    label: "Ireland",
    emoji: "🇮🇪",
    currency: "EUR",
    currencySymbol: "€",
    invoiceTitle: "VAT Invoice",
    taxType: "VAT",
    defaultTaxRate: 23,
    templates: ["uprichard_international", "classic", "modern_gst", "compact"],
    requiredFields: ["VAT Registration Number", "VAT 23%", "Tax summary (single VAT)"]
  }
};

const COUNTRY_ALIASES = {
  UK: "United Kingdom",
  GB: "United Kingdom",
  "U.K.": "United Kingdom",
  "United States": "USA",
  "United States of America": "USA",
  US: "USA"
};

function normalizeInvoiceCountry(country) {
  const normalized = String(country || "").trim();
  if (!normalized) return "";
  return COUNTRY_ALIASES[normalized] || normalized;
}

export function getCountryInvoiceConfig(country) {
  const normalized = normalizeInvoiceCountry(country);
  return COUNTRY_INVOICE_CONFIG[normalized] || COUNTRY_INVOICE_CONFIG.India;
}

export function getCountryTemplates(country) {
  const config = getCountryInvoiceConfig(country);
  return config.templates.map((id) => TEMPLATE_LIBRARY[id]).filter(Boolean);
}

export function getCountryLabel(country) {
  const config = getCountryInvoiceConfig(country);
  return `${config.label} ${config.emoji}`;
}
