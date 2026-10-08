export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

const PHONE_FORMAT_PATTERN = /^[+\d][\d\s()-]*$/;

export function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function phoneDigitRangeLabel() {
  return `${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digits`;
}

export function validateInternationalPhone(value, options = {}) {
  const { required = false, label = "Phone number" } = options;
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      error: required ? `${label} is required.` : "",
      digits: "",
      value: raw
    };
  }

  if (!PHONE_FORMAT_PATTERN.test(raw)) {
    return {
      error: `${label} can include digits, spaces, parentheses, hyphens, and optional leading +.`,
      digits: phoneDigits(raw),
      value: raw
    };
  }

  const digits = phoneDigits(raw);
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return {
      error: `${label} must be between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS} digits.`,
      digits,
      value: raw
    };
  }

  return {
    error: "",
    digits,
    value: raw
  };
}
