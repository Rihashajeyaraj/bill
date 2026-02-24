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
      "india_triplicate",
      "india_blue_gst",
      "india_gst_sample",
      "india_igst_sample",
      "standard",
      "compact",
      "modern",
      "bold"
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
    templates: ["standard", "minimal", "classic"],
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
    templates: ["modern", "elegant"],
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
    templates: ["simple", "professional"],
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
    templates: ["standard", "classic"],
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
    templates: ["standard", "minimal", "classic"],
    requiredFields: ["VAT Registration Number", "VAT 23%", "Tax summary (single VAT)"]
  }
};

export const TEMPLATE_LIBRARY = {
  india_triplicate: { id: "india_triplicate", label: "India Triplicate" },
  india_blue_gst: { id: "india_blue_gst", label: "India GST Blue" },
  india_gst_sample: { id: "india_gst_sample", label: "Sample GST" },
  india_igst_sample: { id: "india_igst_sample", label: "Sample IGST" },
  standard: { id: "standard", label: "Standard" },
  compact: { id: "compact", label: "Compact" },
  modern: { id: "modern", label: "Modern" },
  bold: { id: "bold", label: "Bold" },
  minimal: { id: "minimal", label: "Minimal" },
  classic: { id: "classic", label: "Classic" },
  elegant: { id: "elegant", label: "Elegant" },
  simple: { id: "simple", label: "Simple" },
  professional: { id: "professional", label: "Professional" }
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
