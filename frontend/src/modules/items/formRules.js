function normalizeText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeItemTypeValue(value = "") {
  return normalizeText(value) === "service" ? "SERVICE" : "PRODUCT";
}

export function isIndiaCountry(country = "") {
  return normalizeText(country) === "india";
}

export function taxRateLabelForCountry(country = "") {
  return isIndiaCountry(country) ? "GST %" : "Tax / VAT %";
}

export function taxHintForCountry(country = "") {
  return isIndiaCountry(country)
    ? "Use GST percentage for this item."
    : "Use the standard tax/VAT percentage for this country.";
}

export function shouldShowIndiaComplianceFields(country = "") {
  return isIndiaCountry(country);
}

export function defaultTrackInventoryForType(type = "") {
  return normalizeItemTypeValue(type) === "PRODUCT";
}

export function shouldShowInventorySection(type = "", trackInventory = false) {
  return normalizeItemTypeValue(type) === "PRODUCT" || !!trackInventory;
}

export function shouldShowInventoryFields(type = "", trackInventory = false) {
  return normalizeItemTypeValue(type) === "PRODUCT" && !!trackInventory;
}

export function inferTypeFromCategory(category = "", currentType = "PRODUCT") {
  const normalizedCategory = normalizeText(category);
  if (!normalizedCategory) return normalizeItemTypeValue(currentType);
  if (normalizedCategory.includes("service")) return "SERVICE";
  return normalizeItemTypeValue(currentType);
}
