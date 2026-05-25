export type CountryCode = "SL" | "IN" | "AE" | "SG" | "UK" | "IE" | "US";

export type PaymentStatus = "Draft" | "Confirmed" | "Applied";

export type PaymentMode =
  | "Cash"
  | "Net Banking"
  | "Cheque"
  | "Card"
  | "UPI"
  | "Online Gateway";

type LegacyPaymentMode = PaymentMode | "Bank Transfer" | "Online";

export interface CountryConfig {
  code: CountryCode;
  name: string;
  flag: string;
  currency: string;
  taxLabel: string;
  receiptLabel: string;
  numberPrefix: string;
  registrationLabel: string;
  registrationRequired: boolean;
  registrationRegex?: RegExp;
  legalWording: string;
  legalFooter: string;
  paymentModes: PaymentMode[];
}

const COMMON_MODES: PaymentMode[] = ["Cash", "Net Banking", "Cheque", "Card", "Online Gateway"];

export const COUNTRY_CONFIG: Record<CountryCode, CountryConfig> = {
  SL: {
    code: "SL",
    name: "Sri Lanka",
    flag: "\u{1F1F1}\u{1F1F0}",
    currency: "LKR",
    taxLabel: "VAT",
    receiptLabel: "Payment Receipt",
    numberPrefix: "PR-SL-",
    registrationLabel: "VAT Registration Number",
    registrationRequired: false,
    registrationRegex: /^\d{9}[A-Z]$/,
    legalWording: "Receipt issued under Sri Lanka VAT rules where applicable.",
    legalFooter: "Please retain this receipt for your accounting and tax records.",
    paymentModes: COMMON_MODES
  },
  IN: {
    code: "IN",
    name: "India",
    flag: "\u{1F1EE}\u{1F1F3}",
    currency: "INR",
    taxLabel: "GST",
    receiptLabel: "Receipt Voucher",
    numberPrefix: "PR-IN-",
    registrationLabel: "GSTIN",
    registrationRequired: false,
    registrationRegex: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/,
    legalWording: "Receipt voucher generated under GST-compliant accounting workflow.",
    legalFooter: "This receipt may be used as proof of realization against tax invoice dues.",
    paymentModes: [...COMMON_MODES, "UPI"]
  },
  AE: {
    code: "AE",
    name: "UAE",
    flag: "\u{1F1E6}\u{1F1EA}",
    currency: "AED",
    taxLabel: "VAT",
    receiptLabel: "Payment Receipt",
    numberPrefix: "PR-UAE-",
    registrationLabel: "TRN",
    registrationRequired: true,
    registrationRegex: /^\d{15}$/,
    legalWording: "Payment receipt issued in line with UAE VAT documentation practices.",
    legalFooter: "TRN and payment references should be retained for audits.",
    paymentModes: COMMON_MODES
  },
  SG: {
    code: "SG",
    name: "Singapore",
    flag: "\u{1F1F8}\u{1F1EC}",
    currency: "SGD",
    taxLabel: "GST",
    receiptLabel: "Payment Receipt",
    numberPrefix: "PR-SG-",
    registrationLabel: "GST Registration No.",
    registrationRequired: false,
    registrationRegex: /^[A-Z0-9-]{8,15}$/,
    legalWording: "Receipt aligned with IRAS documentation guidance for payments.",
    legalFooter: "Keep this payment receipt with the related GST invoices.",
    paymentModes: COMMON_MODES
  },
  UK: {
    code: "UK",
    name: "UK",
    flag: "\u{1F1EC}\u{1F1E7}",
    currency: "GBP",
    taxLabel: "VAT",
    receiptLabel: "Payment Receipt",
    numberPrefix: "PR-UK-",
    registrationLabel: "VAT Registration Number",
    registrationRequired: false,
    registrationRegex: /^(GB)?\d{9}$/,
    legalWording: "HMRC-aligned receipt wording for settlement against VAT invoices.",
    legalFooter: "Reference this receipt with the original invoice in VAT records.",
    paymentModes: COMMON_MODES
  },
  IE: {
    code: "IE",
    name: "Ireland",
    flag: "\u{1F1EE}\u{1F1EA}",
    currency: "EUR",
    taxLabel: "VAT",
    receiptLabel: "Payment Receipt",
    numberPrefix: "PR-IE-",
    registrationLabel: "VAT Registration Number",
    registrationRequired: false,
    registrationRegex: /^(IE)?[0-9A-Z]{7,9}$/,
    legalWording: "Receipt issued in line with Irish VAT documentation practices.",
    legalFooter: "Keep this receipt with the original invoice for VAT records.",
    paymentModes: COMMON_MODES
  },
  US: {
    code: "US",
    name: "USA",
    flag: "\u{1F1FA}\u{1F1F8}",
    currency: "USD",
    taxLabel: "Sales Tax",
    receiptLabel: "Payment Receipt",
    numberPrefix: "PR-US-",
    registrationLabel: "State Tax Permit",
    registrationRequired: false,
    registrationRegex: /^[A-Z0-9-]{6,20}$/,
    legalWording: "Receipt generated for customer settlement with optional sales tax display.",
    legalFooter: "State-level payment and tax treatment may vary by nexus jurisdiction.",
    paymentModes: COMMON_MODES
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

export const STATUS_FLOW: Record<PaymentStatus, PaymentStatus[]> = {
  Draft: ["Draft", "Confirmed"],
  Confirmed: ["Confirmed", "Applied"],
  Applied: ["Applied", "Confirmed"]
};

export function normalizePaymentStatus(value: unknown): PaymentStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "applied") return "Applied";
  if (normalized === "confirmed" || normalized === "received") return "Confirmed";
  return "Draft";
}

export function paymentStatusLabel(status: PaymentStatus | string) {
  return String(status || "") === "Confirmed" ? "Received" : String(status || "Draft");
}

export function normalizePaymentMode(value: unknown): PaymentMode {
  const raw = String(value || "").trim() as LegacyPaymentMode;
  if (raw === "Bank Transfer") return "Net Banking";
  if (raw === "Online") return "UPI";
  if (
    raw === "Cash" ||
    raw === "Net Banking" ||
    raw === "Cheque" ||
    raw === "Card" ||
    raw === "UPI" ||
    raw === "Online Gateway"
  ) {
    return raw;
  }
  return "Cash";
}

export function formatPaymentModeLabel(value: unknown) {
  return normalizePaymentMode(value);
}
