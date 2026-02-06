export type CountryCode = "SL" | "IN" | "AE" | "SG" | "UK" | "US";

export type CreditStatus = "Draft" | "Issued" | "Applied";

export type CreditType =
  | "Full Credit"
  | "Partial Credit"
  | "Item Return"
  | "Price Adjustment"
  | "Discount Credit";

export type TaxModel = "VAT" | "GST" | "SALES_TAX";

export interface CountryConfig {
  code: CountryCode;
  name: string;
  flag: string;
  numberPrefix: string;
  label: string;
  currency: string;
  currencySymbol: string;
  taxModel: TaxModel;
  taxLabel: string;
  defaultTaxRate: number;
  registrationLabel?: string;
  registrationRequired: boolean;
  registrationRegex?: RegExp;
  hsnSacRequired: boolean;
  legalWording: string;
  addressFormat: string;
  legalFooter: string;
}

export const COUNTRY_CONFIG: Record<CountryCode, CountryConfig> = {
  SL: {
    code: "SL",
    name: "Sri Lanka",
    flag: "\u{1F1F1}\u{1F1F0}",
    numberPrefix: "CN-SL-",
    label: "Tax Credit Note",
    currency: "LKR",
    currencySymbol: "Rs",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 18,
    registrationLabel: "VAT Registration Number",
    registrationRequired: true,
    registrationRegex: /^\d{9}[A-Z]$/,
    hsnSacRequired: false,
    legalWording: "Issued under Sri Lanka VAT regulations.",
    addressFormat: "Street, City, Postal Code, Sri Lanka",
    legalFooter: "This tax credit note adjusts VAT on the referenced invoice."
  },
  IN: {
    code: "IN",
    name: "India",
    flag: "\u{1F1EE}\u{1F1F3}",
    numberPrefix: "CN-IN-",
    label: "GST Credit Note",
    currency: "INR",
    currencySymbol: "INR",
    taxModel: "GST",
    taxLabel: "GST",
    defaultTaxRate: 18,
    registrationLabel: "GSTIN",
    registrationRequired: true,
    registrationRegex: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/,
    hsnSacRequired: true,
    legalWording: "Issued under Section 34 of the CGST Act.",
    addressFormat: "Address Line, City, State, PIN, India",
    legalFooter: "Input tax credit reversal handled as per GST rules."
  },
  AE: {
    code: "AE",
    name: "UAE",
    flag: "\u{1F1E6}\u{1F1EA}",
    numberPrefix: "CN-UAE-",
    label: "Tax Credit Note",
    currency: "AED",
    currencySymbol: "AED",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 5,
    registrationLabel: "TRN",
    registrationRequired: true,
    registrationRegex: /^\d{15}$/,
    hsnSacRequired: false,
    legalWording: "Issued in accordance with UAE Federal Decree-Law on VAT.",
    addressFormat: "Building, Street, Emirate, UAE",
    legalFooter: "Tax adjustment aligns with FTA credit note requirements."
  },
  SG: {
    code: "SG",
    name: "Singapore",
    flag: "\u{1F1F8}\u{1F1EC}",
    numberPrefix: "CN-SG-",
    label: "GST Credit Note",
    currency: "SGD",
    currencySymbol: "SGD",
    taxModel: "GST",
    taxLabel: "GST",
    defaultTaxRate: 9,
    registrationLabel: "GST Registration No.",
    registrationRequired: true,
    registrationRegex: /^[A-Z0-9-]{8,15}$/,
    hsnSacRequired: false,
    legalWording: "Issued as a valid GST credit note under IRAS guidance.",
    addressFormat: "Block, Street, Unit, Singapore",
    legalFooter: "Please retain this document for GST records and audit."
  },
  UK: {
    code: "UK",
    name: "UK",
    flag: "\u{1F1EC}\u{1F1E7}",
    numberPrefix: "CN-UK-",
    label: "VAT Credit Note",
    currency: "GBP",
    currencySymbol: "GBP",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 20,
    registrationLabel: "VAT Registration Number",
    registrationRequired: true,
    registrationRegex: /^(GB)?\d{9}$/,
    hsnSacRequired: false,
    legalWording: "HMRC compliant VAT credit note.",
    addressFormat: "Address, Postcode, United Kingdom",
    legalFooter: "This document must be referenced against the original VAT invoice."
  },
  US: {
    code: "US",
    name: "USA",
    flag: "\u{1F1FA}\u{1F1F8}",
    numberPrefix: "CN-US-",
    label: "Credit Memo",
    currency: "USD",
    currencySymbol: "USD",
    taxModel: "SALES_TAX",
    taxLabel: "Sales Tax",
    defaultTaxRate: 7,
    registrationLabel: "State Tax Permit",
    registrationRequired: false,
    registrationRegex: /^[A-Z0-9-]{6,20}$/,
    hsnSacRequired: false,
    legalWording: "Credit memo for sales tax jurisdiction adjustments.",
    addressFormat: "Street, City, State, ZIP, USA",
    legalFooter: "State sales tax treatment may vary by nexus rules."
  }
};

export const COUNTRY_OPTIONS = Object.values(COUNTRY_CONFIG);

export const COUNTRY_NAME_TO_CODE: Record<string, CountryCode> = {
  "Sri Lanka": "SL",
  India: "IN",
  UAE: "AE",
  Singapore: "SG",
  UK: "UK",
  USA: "US",
  "United Kingdom": "UK",
  "United States": "US"
};

export const STATUS_FLOW: Record<CreditStatus, CreditStatus[]> = {
  Draft: ["Draft", "Issued"],
  Issued: ["Issued", "Applied"],
  Applied: ["Applied"]
};

export const CREDIT_REASONS = ["Return", "Discount", "Error"];
