import { resolveCountryIsoCode } from "../../lib/geoData";
import {
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  phoneDigitRangeLabel
} from "../../lib/phoneValidation";

export interface CountryDialOption {
  isoCode: string;
  country: string;
  dialCode: string;
}

interface MobileLengthRule {
  min: number;
  max: number;
}

export interface ParsedMobileNumber {
  countryCode: string;
  mobileNumber: string;
  fullNumber: string;
}

export const DEFAULT_COUNTRY_DIAL_CODE = "+91";

export const COUNTRY_DIAL_OPTIONS: CountryDialOption[] = [
  { isoCode: "IN", country: "India", dialCode: "+91" },
  { isoCode: "LK", country: "Sri Lanka", dialCode: "+94" },
  { isoCode: "US", country: "United States", dialCode: "+1" },
  { isoCode: "GB", country: "United Kingdom", dialCode: "+44" },
  { isoCode: "AE", country: "UAE", dialCode: "+971" },
  { isoCode: "IE", country: "Ireland", dialCode: "+353" },
  { isoCode: "AU", country: "Australia", dialCode: "+61" },
  { isoCode: "CA", country: "Canada", dialCode: "+1" },
  { isoCode: "SG", country: "Singapore", dialCode: "+65" },
  { isoCode: "ZA", country: "South Africa", dialCode: "+27" }
];

const ISO_TO_DIAL = COUNTRY_DIAL_OPTIONS.reduce<Record<string, string>>((acc, option) => {
  acc[option.isoCode] = option.dialCode;
  return acc;
}, {});

const DIAL_CODES_DESC = Array.from(new Set(COUNTRY_DIAL_OPTIONS.map((option) => option.dialCode))).sort(
  (left, right) => right.length - left.length
);

export function phoneDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeCountryDialCode(value: unknown, fallback = DEFAULT_COUNTRY_DIAL_CODE) {
  const digits = phoneDigits(value);
  if (!digits) return fallback;
  return `+${digits}`;
}

export function resolveDefaultDialCodeFromCountry(countryValue?: string | null) {
  const isoCode = resolveCountryIsoCode(String(countryValue || ""));
  return ISO_TO_DIAL[isoCode] || DEFAULT_COUNTRY_DIAL_CODE;
}

function resolveDialCodeFromPrefixedDigits(digitsWithCountryCode: string, fallbackDialCode: string) {
  for (const dialCode of DIAL_CODES_DESC) {
    const dialDigits = dialCode.slice(1);
    if (digitsWithCountryCode.startsWith(dialDigits)) {
      return {
        countryCode: dialCode,
        mobileNumber: digitsWithCountryCode.slice(dialDigits.length)
      };
    }
  }

  for (let codeLength = 3; codeLength >= 1; codeLength -= 1) {
    const mobileLength = digitsWithCountryCode.length - codeLength;
    if (mobileLength >= PHONE_MIN_DIGITS && mobileLength <= PHONE_MAX_DIGITS) {
      return {
        countryCode: `+${digitsWithCountryCode.slice(0, codeLength)}`,
        mobileNumber: digitsWithCountryCode.slice(codeLength)
      };
    }
  }

  return {
    countryCode: fallbackDialCode,
    mobileNumber: digitsWithCountryCode
  };
}

export function composeFullMobileNumber(countryCode: unknown, mobileNumber: unknown) {
  const normalizedCountryCode = normalizeCountryDialCode(countryCode);
  const normalizedMobile = phoneDigits(mobileNumber);
  if (!normalizedMobile) return "";
  return `${normalizedCountryCode}${normalizedMobile}`;
}

export function splitFullMobileNumber(value: unknown, fallbackDialCode = DEFAULT_COUNTRY_DIAL_CODE): ParsedMobileNumber {
  const rawValue = String(value || "").trim();
  const normalizedFallbackDial = normalizeCountryDialCode(fallbackDialCode);
  if (!rawValue) {
    return {
      countryCode: normalizedFallbackDial,
      mobileNumber: "",
      fullNumber: ""
    };
  }

  const digits = phoneDigits(rawValue);
  if (!digits) {
    return {
      countryCode: normalizedFallbackDial,
      mobileNumber: "",
      fullNumber: ""
    };
  }

  if (rawValue.startsWith("+")) {
    const parsed = resolveDialCodeFromPrefixedDigits(digits, normalizedFallbackDial);
    return {
      countryCode: parsed.countryCode,
      mobileNumber: parsed.mobileNumber,
      fullNumber: composeFullMobileNumber(parsed.countryCode, parsed.mobileNumber)
    };
  }

  return {
    countryCode: normalizedFallbackDial,
    mobileNumber: digits,
    fullNumber: composeFullMobileNumber(normalizedFallbackDial, digits)
  };
}

export function mobileLengthRule(countryCode: unknown): MobileLengthRule {
  normalizeCountryDialCode(countryCode);
  return { min: PHONE_MIN_DIGITS, max: PHONE_MAX_DIGITS };
}

export function mobileLengthHint(countryCode: unknown) {
  mobileLengthRule(countryCode);
  return `${phoneDigitRangeLabel()} (international)`;
}

export function validateMobileNumber(countryCode: unknown, mobileNumber: unknown) {
  const normalizedCountryCode = normalizeCountryDialCode(countryCode);
  const normalizedMobile = phoneDigits(mobileNumber);

  if (!normalizedMobile) {
    return {
      error: "Mobile number is required.",
      countryCode: normalizedCountryCode,
      mobileNumber: normalizedMobile,
      fullNumber: ""
    };
  }

  const rule = mobileLengthRule(normalizedCountryCode);
  if (normalizedMobile.length < rule.min || normalizedMobile.length > rule.max) {
    return {
      error: `Mobile number must be between ${rule.min} and ${rule.max} digits.`,
      countryCode: normalizedCountryCode,
      mobileNumber: normalizedMobile,
      fullNumber: composeFullMobileNumber(normalizedCountryCode, normalizedMobile)
    };
  }

  return {
    error: "",
    countryCode: normalizedCountryCode,
    mobileNumber: normalizedMobile,
    fullNumber: composeFullMobileNumber(normalizedCountryCode, normalizedMobile)
  };
}

export function normalizePhoneForStorage(value: unknown, fallbackCountry?: string | null) {
  const fallbackDialCode = resolveDefaultDialCodeFromCountry(String(fallbackCountry || ""));
  return splitFullMobileNumber(value, fallbackDialCode).fullNumber;
}

export function normalizePhoneForComparison(value: unknown, fallbackCountry?: string | null) {
  return normalizePhoneForStorage(value, fallbackCountry);
}
