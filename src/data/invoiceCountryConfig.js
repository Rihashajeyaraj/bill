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
    templates: ["india_gst_sample", "india_igst_sample", "standard", "compact", "modern", "bold"],
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
  }
};

export const TEMPLATE_LIBRARY = {
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

export function getCountryInvoiceConfig(country) {
  return COUNTRY_INVOICE_CONFIG[country] || COUNTRY_INVOICE_CONFIG.India;
}

export function getCountryTemplates(country) {
  const config = getCountryInvoiceConfig(country);
  return config.templates.map((id) => TEMPLATE_LIBRARY[id]).filter(Boolean);
}

export function getCountryLabel(country) {
  const config = getCountryInvoiceConfig(country);
  return `${config.label} ${config.emoji}`;
}
