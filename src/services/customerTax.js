const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z0-9]$/;

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeContactTypeValue(value) {
  const normalized = normalizeText(value);
  if (normalized === "business") return "Business";
  if (normalized === "individual") return "Individual";
  return "";
}

function resolveOrganizationCountry(org = {}) {
  const direct = normalizeText(org?.country);
  if (direct) return direct;

  const profileCountry = normalizeText(org?.profile?.country);
  if (profileCountry) return profileCountry;

  const countryCode = String(org?.countryCode || org?.country_code || org?.profile?.countryCode || "")
    .trim()
    .toUpperCase();
  if (countryCode === "IN") return "india";
  return "";
}

export function normalizeContactType(contactType, taxId = "") {
  const explicit = normalizeContactTypeValue(contactType);
  if (explicit) return explicit;
  return String(taxId || "").trim() ? "Business" : "Individual";
}

export function validateContactTax(contact = {}, org = {}) {
  const isGSTMode = resolveOrganizationCountry(org) === "india";
  const enteredTaxId = String(contact?.taxId ?? contact?.gstin ?? "")
    .trim()
    .toUpperCase();
  const contactType = normalizeContactType(
    contact?.contactType ?? contact?.customerType,
    enteredTaxId
  );
  const isBusiness = contactType === "Business";
  const requireTaxId = isGSTMode && isBusiness;
  const showGSTINField = isBusiness;

  let error = "";
  let warning = "";
  if (isBusiness && isGSTMode) {
    if (!enteredTaxId) {
      warning = "GSTIN is recommended for Business contacts in India.";
    } else if (!GSTIN_REGEX.test(enteredTaxId)) {
      error = "Invalid GSTIN format for India.";
    }
  }

  return {
    isBusiness,
    contactType,
    isGSTMode,
    requireTaxId,
    showGSTINField,
    normalizedTaxId: isBusiness ? enteredTaxId : "",
    error,
    warning
  };
}

export function normalizeCustomerType(customerType, taxId = "") {
  return normalizeContactType(customerType, taxId);
}

export function validateCustomerTax(customer = {}, org = {}) {
  return validateContactTax(customer, org);
}
