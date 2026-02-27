export type CountryCode = "SL" | "IN" | "AE" | "SG" | "UK" | "IE" | "US";

export type DebitStatus = "Draft" | "Issued" | "Applied";

export type DebitType =
  | "Full Debit"
  | "Partial Debit"
  | "Price Increase"
  | "Quantity Shortage"
  | "Additional Charges"
  | "Tax Adjustment";

export type TaxModel = "VAT" | "GST" | "SALES_TAX";

export interface CountryConfig {
  code: CountryCode;
  name: string;
  flag: string;
  numberPrefix: string;
  label: string;
  currency: string;
  taxModel: TaxModel;
  taxLabel: string;
  defaultTaxRate: number;
  registrationLabel: string;
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
    numberPrefix: "DN-SL-",
    label: "Tax Debit Note",
    currency: "LKR",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 18,
    registrationLabel: "VAT Registration Number",
    registrationRequired: true,
    registrationRegex: /^\d{9}[A-Z]$/,
    hsnSacRequired: false,
    legalWording: "Issued as a tax debit note under Sri Lanka VAT regulations.",
    addressFormat: "Street, City, Postal Code, Sri Lanka",
    legalFooter: "This document reduces payable against the referenced purchase invoice."
  },
  IN: {
    code: "IN",
    name: "India",
    flag: "\u{1F1EE}\u{1F1F3}",
    numberPrefix: "DN-IN-",
    label: "GST Debit Note",
    currency: "INR",
    taxModel: "GST",
    taxLabel: "GST",
    defaultTaxRate: 18,
    registrationLabel: "GSTIN",
    registrationRequired: true,
    registrationRegex: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/,
    hsnSacRequired: true,
    legalWording: "Issued under Section 34 of the CGST Act as a valid GST debit note.",
    addressFormat: "Address Line, City, State, PIN, India",
    legalFooter: "HSN/SAC and GST treatment are applied as per current GST rules."
  },
  AE: {
    code: "AE",
    name: "UAE",
    flag: "\u{1F1E6}\u{1F1EA}",
    numberPrefix: "DN-UAE-",
    label: "Tax Debit Note",
    currency: "AED",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 5,
    registrationLabel: "TRN",
    registrationRequired: true,
    registrationRegex: /^\d{15}$/,
    hsnSacRequired: false,
    legalWording: "Issued in accordance with UAE VAT requirements for debit notes.",
    addressFormat: "Building, Street, Emirate, UAE",
    legalFooter: "Debit note value is reflected in VAT and accounts payable adjustments."
  },
  SG: {
    code: "SG",
    name: "Singapore",
    flag: "\u{1F1F8}\u{1F1EC}",
    numberPrefix: "DN-SG-",
    label: "GST Debit Note",
    currency: "SGD",
    taxModel: "GST",
    taxLabel: "GST",
    defaultTaxRate: 9,
    registrationLabel: "GST Registration No.",
    registrationRequired: true,
    registrationRegex: /^[A-Z0-9-]{8,15}$/,
    hsnSacRequired: false,
    legalWording: "Issued as a GST-compliant debit note under IRAS guidance.",
    addressFormat: "Block, Street, Unit, Singapore",
    legalFooter: "Keep this debit note with the linked purchase invoice for audit."
  },
  UK: {
    code: "UK",
    name: "UK",
    flag: "\u{1F1EC}\u{1F1E7}",
    numberPrefix: "DN-UK-",
    label: "VAT Debit Note",
    currency: "GBP",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 20,
    registrationLabel: "VAT Registration Number",
    registrationRequired: true,
    registrationRegex: /^(GB)?\d{9}$/,
    hsnSacRequired: false,
    legalWording: "HMRC-compliant VAT debit note.",
    addressFormat: "Address, Postcode, United Kingdom",
    legalFooter: "Reference this debit note against the original purchase VAT invoice."
  },
  IE: {
    code: "IE",
    name: "Ireland",
    flag: "\u{1F1EE}\u{1F1EA}",
    numberPrefix: "DN-IE-",
    label: "VAT Debit Note",
    currency: "EUR",
    taxModel: "VAT",
    taxLabel: "VAT",
    defaultTaxRate: 23,
    registrationLabel: "VAT Registration Number",
    registrationRequired: true,
    registrationRegex: /^(IE)?[0-9A-Z]{7,9}$/,
    hsnSacRequired: false,
    legalWording: "Irish Revenue-compliant VAT debit note.",
    addressFormat: "Address, Eircode, Ireland",
    legalFooter: "Reference this debit note against the original Irish VAT purchase invoice."
  },
  US: {
    code: "US",
    name: "USA",
    flag: "\u{1F1FA}\u{1F1F8}",
    numberPrefix: "DN-US-",
    label: "Debit Memo",
    currency: "USD",
    taxModel: "SALES_TAX",
    taxLabel: "Sales Tax",
    defaultTaxRate: 7,
    registrationLabel: "State Tax Permit",
    registrationRequired: false,
    registrationRegex: /^[A-Z0-9-]{6,20}$/,
    hsnSacRequired: false,
    legalWording: "Debit memo for state-level sales tax and charge adjustments.",
    addressFormat: "Street, City, State, ZIP, USA",
    legalFooter: "Sales tax handling may vary based on supplier jurisdiction."
  }
};

export const COUNTRY_OPTIONS = Object.values(COUNTRY_CONFIG);

export const COUNTRY_NAME_TO_CODE: Record<string, CountryCode> = {
  "Sri Lanka": "SL",
  India: "IN",
  UAE: "AE",
  Singapore: "SG",
  UK: "UK",
  IE: "IE",
  USA: "US",
  "United Kingdom": "UK",
  Ireland: "IE",
  "United States": "US"
};

export const STATUS_FLOW: Record<DebitStatus, DebitStatus[]> = {
  Draft: ["Draft", "Issued"],
  Issued: ["Issued", "Applied"],
  Applied: ["Applied"]
};
