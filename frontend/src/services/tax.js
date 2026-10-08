/**
 * tax.js — Jurisdiction-Aware Tax Engine (Frontend)
 *
 * Design principles:
 *   - India: GST (CGST+SGST for intra-state, IGST for inter-state).
 *   - USA: Sales Tax. The STATE statutory rate is known and reliable.
 *          The LOCAL rate CANNOT be determined without city/ZIP.
 *          We NEVER invent or estimate a local rate.
 *          If no local rate is provided, local_rate = 0 and a warning is returned.
 *   - UAE: VAT 5% (statutory).
 *   - Other countries: country-specific statutory VAT rates (see COUNTRY_VAT_RATES).
 *   - Unknown country: rate = 0 + warning; user must enter manually.
 *
 * US state rates source: Sales Tax Institute (2024)
 * https://www.salestaxinstitute.com/resources/rates
 */

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Country normalisation
// ─────────────────────────────────────────────────────────────────────────────

export function resolveCountry(entity = {}) {
  const rawCountry = normalizeText(
    entity?.country || entity?.countryName || entity?.country_name || ""
  );

  if (!rawCountry) {
    // Fall back to country code
    const code = String(entity?.countryCode || entity?.country_code || "")
      .trim()
      .toUpperCase();
    if (code === "IN") return "india";
    if (code === "US") return "usa";
    if (code === "AE") return "uae";
    if (code === "GB") return "uk";
    if (code === "AU") return "australia";
    if (code === "CA") return "canada";
    if (code === "SG") return "singapore";
    if (code === "JP") return "japan";
    if (code === "DE") return "germany";
    if (code === "CN") return "china";
    if (code === "IE") return "ireland";
    if (code === "LK") return "sri lanka";
    if (code) return code.toLowerCase();
    return "india"; // safe default for India-first app
  }

  // India variants
  if (["india", "in", "ind", "🇮🇳 india", "bharat"].includes(rawCountry)) return "india";
  // USA variants
  if (["usa", "us", "united states", "united states of america", "u.s.", "u.s.a."].includes(rawCountry)) return "usa";
  // UAE variants
  if (["uae", "ae", "united arab emirates", "dubai", "abu dhabi", "🇦🇪 uae"].includes(rawCountry)) return "uae";
  // UK variants
  if (["uk", "gb", "united kingdom", "great britain", "britain", "england"].includes(rawCountry)) return "uk";
  // Ireland
  if (["ireland", "ie", "republic of ireland"].includes(rawCountry)) return "ireland";
  // Sri Lanka
  if (["sri lanka", "lk", "ceylon"].includes(rawCountry)) return "sri lanka";
  // Australia
  if (["australia", "au"].includes(rawCountry)) return "australia";
  // Canada
  if (["canada", "ca"].includes(rawCountry)) return "canada";
  // Singapore
  if (["singapore", "sg"].includes(rawCountry)) return "singapore";
  // Japan
  if (["japan", "jp"].includes(rawCountry)) return "japan";
  // Germany
  if (["germany", "de", "deutschland"].includes(rawCountry)) return "germany";
  // China
  if (["china", "cn", "people's republic of china"].includes(rawCountry)) return "china";

  return rawCountry;
}

export function normalizeTaxRate(value) {
  return Math.max(0, toNumber(value));
}

export function extractStateCodeFromGstin(gstin = "") {
  const value = String(gstin || "")
    .trim()
    .toUpperCase();
  const match = value.match(/^(\d{2})[0-9A-Z]{13}$/);
  return match ? match[1] : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// USA Sales Tax — State Statutory Rates
//
// IMPORTANT: These are STATE-LEVEL statutory minimum rates ONLY.
// They are set by state law and authoritative.
//
// Local (city/county/district) rates add on top and CANNOT be determined
// from state name alone. We NEVER estimate or invent a local rate.
//
// Source: Sales Tax Institute state rate table (2024)
// https://www.salestaxinstitute.com/resources/rates
// ─────────────────────────────────────────────────────────────────────────────

const US_STATE_STATUTORY_RATES = {
  // code → { stateRate (%), name }
  AL: { stateRate: 4.00,   name: "Alabama" },
  AK: { stateRate: 0.00,   name: "Alaska" },          // No state sales tax
  AZ: { stateRate: 5.60,   name: "Arizona" },
  AR: { stateRate: 6.50,   name: "Arkansas" },
  CA: { stateRate: 7.25,   name: "California" },
  CO: { stateRate: 2.90,   name: "Colorado" },
  CT: { stateRate: 6.35,   name: "Connecticut" },
  DE: { stateRate: 0.00,   name: "Delaware" },         // No state sales tax
  FL: { stateRate: 6.00,   name: "Florida" },
  GA: { stateRate: 4.00,   name: "Georgia" },
  HI: { stateRate: 4.00,   name: "Hawaii" },
  ID: { stateRate: 6.00,   name: "Idaho" },
  IL: { stateRate: 6.25,   name: "Illinois" },
  IN: { stateRate: 7.00,   name: "Indiana" },
  IA: { stateRate: 6.00,   name: "Iowa" },
  KS: { stateRate: 6.50,   name: "Kansas" },
  KY: { stateRate: 6.00,   name: "Kentucky" },
  LA: { stateRate: 4.45,   name: "Louisiana" },
  ME: { stateRate: 5.50,   name: "Maine" },
  MD: { stateRate: 6.00,   name: "Maryland" },
  MA: { stateRate: 6.25,   name: "Massachusetts" },
  MI: { stateRate: 6.00,   name: "Michigan" },
  MN: { stateRate: 6.875,  name: "Minnesota" },
  MS: { stateRate: 7.00,   name: "Mississippi" },
  MO: { stateRate: 4.225,  name: "Missouri" },
  MT: { stateRate: 0.00,   name: "Montana" },          // No state sales tax
  NE: { stateRate: 5.50,   name: "Nebraska" },
  NV: { stateRate: 6.85,   name: "Nevada" },
  NH: { stateRate: 0.00,   name: "New Hampshire" },    // No state sales tax
  NJ: { stateRate: 6.625,  name: "New Jersey" },
  NM: { stateRate: 5.00,   name: "New Mexico" },
  NY: { stateRate: 4.00,   name: "New York" },
  NC: { stateRate: 4.75,   name: "North Carolina" },
  ND: { stateRate: 5.00,   name: "North Dakota" },
  OH: { stateRate: 5.75,   name: "Ohio" },
  OK: { stateRate: 4.50,   name: "Oklahoma" },
  OR: { stateRate: 0.00,   name: "Oregon" },           // No state sales tax
  PA: { stateRate: 6.00,   name: "Pennsylvania" },
  RI: { stateRate: 7.00,   name: "Rhode Island" },
  SC: { stateRate: 6.00,   name: "South Carolina" },
  SD: { stateRate: 4.50,   name: "South Dakota" },
  TN: { stateRate: 7.00,   name: "Tennessee" },
  TX: { stateRate: 6.25,   name: "Texas" },
  UT: { stateRate: 4.85,   name: "Utah" },
  VT: { stateRate: 6.00,   name: "Vermont" },
  VA: { stateRate: 5.30,   name: "Virginia" },
  WA: { stateRate: 6.50,   name: "Washington" },
  WV: { stateRate: 6.00,   name: "West Virginia" },
  WI: { stateRate: 5.00,   name: "Wisconsin" },
  WY: { stateRate: 4.00,   name: "Wyoming" },
  DC: { stateRate: 6.00,   name: "District of Columbia" },
};

// Name → code reverse lookup
const US_STATE_NAME_TO_CODE = {};
Object.entries(US_STATE_STATUTORY_RATES).forEach(([code, { name }]) => {
  US_STATE_NAME_TO_CODE[name.toUpperCase()] = code;
});
// Extra aliases
US_STATE_NAME_TO_CODE["DISTRICT OF COLUMBIA"] = "DC";
US_STATE_NAME_TO_CODE["WASHINGTON DC"] = "DC";
US_STATE_NAME_TO_CODE["WASHINGTON D.C."] = "DC";

/**
 * Resolve a US state name/code to its 2-letter code.
 * Returns null if unrecognised.
 */
function resolveUSStateCode(stateInput) {
  if (!stateInput) return null;
  const upper = String(stateInput).trim().toUpperCase();
  if (US_STATE_STATUTORY_RATES[upper]) return upper;
  return US_STATE_NAME_TO_CODE[upper] || null;
}

/**
 * Get US sales tax rates for a state.
 *
 * @param {string} stateInput  - State name or 2-letter code.
 * @param {number|null} localRateOverride - If the user explicitly entered a
 *   local/county rate, pass it here. Otherwise pass null/undefined.
 *
 * @returns {{
 *   stateCode: string|null,
 *   stateName: string,
 *   stateRate: number,
 *   localRate: number,
 *   localRateSource: 'user_provided'|'not_provided'|'not_applicable',
 *   combinedRate: number,
 *   warning: string,
 *   resolved: boolean
 * }}
 */
export function getUSStateSalesTaxRates(stateInput, localRateOverride = null) {
  const stateCode = resolveUSStateCode(stateInput);

  if (!stateCode || !US_STATE_STATUTORY_RATES[stateCode]) {
    // Unknown state — return 0 with a clear warning
    return {
      stateCode: null,
      stateName: stateInput || "Unknown State",
      stateRate: 0,
      localRate: 0,
      localRateSource: "not_provided",
      combinedRate: 0,
      warning: `State '${stateInput || ""}' is not recognised. Please enter the applicable state and local tax rates manually.`,
      resolved: false,
    };
  }

  const { stateRate, name } = US_STATE_STATUTORY_RATES[stateCode];

  // States with no sales tax
  if (stateRate === 0) {
    return {
      stateCode,
      stateName: name,
      stateRate: 0,
      localRate: 0,
      localRateSource: "not_applicable",
      combinedRate: 0,
      warning: `${name} has no state sales tax.`,
      resolved: true,
    };
  }

  let localRate = 0;
  let localRateSource = "not_provided";
  let warning = "";

  if (localRateOverride !== null && localRateOverride !== undefined && localRateOverride >= 0) {
    localRate = round2(localRateOverride);
    localRateSource = "user_provided";
  } else {
    warning =
      `Only the ${name} state rate (${stateRate}%) has been applied. ` +
      `Local/county/city rates vary by jurisdiction and cannot be determined from ` +
      `the state name alone. Enter the local rate for your specific city or county ` +
      `to compute the correct combined rate.`;
  }

  return {
    stateCode,
    stateName: name,
    stateRate,
    localRate,
    localRateSource,
    combinedRate: round2(stateRate + localRate),
    warning,
    resolved: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// International VAT — Country Statutory Standard Rates
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRY_VAT_RATES = {
  uae:          { rate: 5,    label: "UAE VAT",                       currency: "AED" },
  uk:           { rate: 20,   label: "UK VAT",                        currency: "GBP" },
  ireland:      { rate: 23,   label: "Irish VAT",                     currency: "EUR" },
  "sri lanka":  { rate: 18,   label: "Sri Lanka VAT",                 currency: "LKR" },
  australia:    { rate: 10,   label: "Australian GST",                currency: "AUD" },
  "new zealand":{ rate: 15,   label: "New Zealand GST",               currency: "NZD" },
  singapore:    { rate: 9,    label: "Singapore GST",                 currency: "SGD" },
  germany:      { rate: 19,   label: "German VAT (MwSt)",             currency: "EUR" },
  france:       { rate: 20,   label: "French VAT (TVA)",              currency: "EUR" },
  netherlands:  { rate: 21,   label: "Netherlands VAT (BTW)",         currency: "EUR" },
  sweden:       { rate: 25,   label: "Swedish VAT (Moms)",            currency: "SEK" },
  norway:       { rate: 25,   label: "Norwegian VAT (MVA)",           currency: "NOK" },
  denmark:      { rate: 25,   label: "Danish VAT (Moms)",             currency: "DKK" },
  finland:      { rate: 24,   label: "Finnish VAT (ALV)",             currency: "EUR" },
  italy:        { rate: 22,   label: "Italian VAT (IVA)",             currency: "EUR" },
  spain:        { rate: 21,   label: "Spanish VAT (IVA)",             currency: "EUR" },
  portugal:     { rate: 23,   label: "Portuguese VAT (IVA)",          currency: "EUR" },
  belgium:      { rate: 21,   label: "Belgian VAT (BTW/TVA)",         currency: "EUR" },
  austria:      { rate: 20,   label: "Austrian VAT (MwSt)",           currency: "EUR" },
  switzerland:  { rate: 8.1,  label: "Swiss VAT (MWST)",              currency: "CHF" },
  canada:       { rate: 5,    label: "Canada GST (federal; PST/HST varies by province)", currency: "CAD" },
  "south africa":{ rate: 15,  label: "South Africa VAT",              currency: "ZAR" },
  kenya:        { rate: 16,   label: "Kenya VAT",                     currency: "KES" },
  nigeria:      { rate: 7.5,  label: "Nigeria VAT",                   currency: "NGN" },
  malaysia:     { rate: 8,    label: "Malaysia SST",                  currency: "MYR" },
  thailand:     { rate: 7,    label: "Thailand VAT",                  currency: "THB" },
  japan:        { rate: 10,   label: "Japan Consumption Tax",         currency: "JPY" },
  "south korea":{ rate: 10,   label: "Korea VAT",                     currency: "KRW" },
  china:        { rate: 13,   label: "China VAT (standard goods)",    currency: "CNY" },
  indonesia:    { rate: 11,   label: "Indonesia VAT (PPN)",           currency: "IDR" },
  philippines:  { rate: 12,   label: "Philippines VAT (EVAT)",        currency: "PHP" },
  brazil:       { rate: 17,   label: "Brazil ICMS (avg)",             currency: "BRL" },
  mexico:       { rate: 16,   label: "Mexico IVA",                    currency: "MXN" },
  argentina:    { rate: 21,   label: "Argentina IVA",                 currency: "ARS" },
  chile:        { rate: 19,   label: "Chile IVA",                     currency: "CLP" },
  "saudi arabia":{ rate: 15,  label: "Saudi Arabia VAT",              currency: "SAR" },
  bahrain:      { rate: 10,   label: "Bahrain VAT",                   currency: "BHD" },
  qatar:        { rate: 0,    label: "Qatar (no VAT yet)",            currency: "QAR" },
  kuwait:       { rate: 0,    label: "Kuwait (no VAT yet)",           currency: "KWD" },
  oman:         { rate: 5,    label: "Oman VAT",                      currency: "OMR" },
};

/**
 * Get VAT configuration for a country.
 * Returns { rate, label, currency, known, warning }.
 * If the country is unknown, rate = 0 and warning instructs manual entry.
 */
export function getCountryVATConfig(countryInput) {
  const country = resolveCountry({ country: countryInput });
  const entry = COUNTRY_VAT_RATES[country];
  if (entry) {
    return {
      rate: entry.rate,
      label: entry.label,
      currency: entry.currency,
      known: true,
      warning: entry.rate === 0 ? `${entry.label}: No standard VAT applies. Verify applicability.` : "",
    };
  }
  return {
    rate: 0,
    label: `Tax (${countryInput || "Unknown"})`,
    currency: "USD",
    known: false,
    warning: `Tax rate for '${countryInput || "this country"}' is not configured. Please enter the applicable VAT/tax rate manually.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Country Tax Config (for UI display — which fields to show)
// ─────────────────────────────────────────────────────────────────────────────

export function getCountryTaxConfig(countryInput) {
  const country = resolveCountry({ country: countryInput });

  if (country === "usa") {
    return {
      taxMode: "SALES_TAX",
      taxSystemLabel: "US Sales Tax",
      taxIdLabel: "EIN / Business ID",
      defaultTaxRate: 0,               // no default — must be jurisdiction-specific
      showGstFields: false,
      showSalesTaxFields: true,
      showVatFields: false,
      // No availableTaxRates — rates must come from state lookup or user input
      availableTaxRates: [],
      notes: "US sales tax rates vary by state and local jurisdiction. The state statutory rate is applied automatically. Enter the local/county rate manually if applicable.",
    };
  }

  if (country === "india") {
    return {
      taxMode: "GST",
      taxSystemLabel: "India GST",
      taxIdLabel: "GSTIN",
      defaultTaxRate: 18,
      showGstFields: true,
      showSalesTaxFields: false,
      showVatFields: false,
      availableTaxRates: [0, 5, 12, 18, 28],
    };
  }

  // VAT countries
  const vatEntry = COUNTRY_VAT_RATES[country];
  if (vatEntry) {
    return {
      taxMode: "VAT",
      taxSystemLabel: vatEntry.label,
      taxIdLabel: "VAT Registration Number",
      defaultTaxRate: vatEntry.rate,
      showGstFields: false,
      showSalesTaxFields: false,
      showVatFields: true,
      availableTaxRates: vatEntry.rate > 0 ? [0, vatEntry.rate] : [0],
    };
  }

  // Unknown country — user must enter rate manually
  return {
    taxMode: "VAT",
    taxSystemLabel: "Tax",
    taxIdLabel: "Tax ID / Registration Number",
    defaultTaxRate: 0,
    showGstFields: false,
    showSalesTaxFields: false,
    showVatFields: true,
    availableTaxRates: [],
    notes: `Tax configuration for '${countryInput || "this country"}' is not available. Please enter the applicable rate manually.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// India GST — Supply Type Resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveSupplyType({
  orgState = "",
  partyState = "",
  orgGstin = "",
  partyGstin = "",
  orgCountry = "",
  partyCountry = "",
}) {
  const normalizedOrgCountry = resolveCountry({ country: orgCountry });
  const normalizedPartyCountry = resolveCountry({ country: partyCountry });
  const normalizedOrgState = normalizeText(orgState);
  const normalizedPartyState = normalizeText(partyState);
  const orgCode = extractStateCodeFromGstin(orgGstin);
  const partyCode = extractStateCodeFromGstin(partyGstin);

  if (
    normalizedOrgCountry &&
    normalizedPartyCountry &&
    normalizedOrgCountry !== normalizedPartyCountry
  ) {
    return { supplyType: "INTER", warning: "" };
  }

  if (orgCode && partyCode) {
    return { supplyType: orgCode === partyCode ? "INTRA" : "INTER", warning: "" };
  }

  if (normalizedOrgState && normalizedPartyState) {
    return {
      supplyType: normalizedOrgState === normalizedPartyState ? "INTRA" : "INTER",
      warning: "",
    };
  }

  return { supplyType: "INTER", warning: "State missing, assuming IGST" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Tax Calculation Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate taxes for a single line amount.
 *
 * @param {object} params
 * @param {number}      params.taxableAmount
 * @param {number}      params.taxRate          - GST/VAT rate (%). For USA, this
 *                                                is the combined rate if known,
 *                                                or 0 to auto-detect state rate.
 * @param {number|null} params.localTaxRate     - USA only: explicit local/county
 *                                                rate entered by the user.
 * @param {object}      params.org              - Seller/company context.
 * @param {object}      params.party            - Customer/buyer context.
 * @param {string}      params.taxLabel
 */
export function calculateTaxes({
  taxableAmount = 0,
  taxRate = 0,
  localTaxRate = null,
  org = {},
  party = {},
  taxLabel = "TAX",
} = {}) {
  const base = Math.max(0, round2(taxableAmount));
  const rate = normalizeTaxRate(taxRate);
  const orgCountry = resolveCountry(org);
  const partyCountry = resolveCountry(party);

  // ── 1. USA SALES TAX ENGINE ─────────────────────────────────────────────
  if (orgCountry === "usa" || partyCountry === "usa") {
    const stateInput = party?.state || org?.state || "";
    const localOverride =
      localTaxRate !== null && localTaxRate !== undefined && localTaxRate >= 0
        ? localTaxRate
        : null;

    const usResult = getUSStateSalesTaxRates(stateInput, localOverride);
    let stateRate = usResult.stateRate;
    let localRate = usResult.localRate;

    // If the caller passed an explicit combined tax_rate AND no local rate,
    // treat it entirely as the state rate (legacy data compatibility).
    if (rate > 0 && localOverride === null) {
      stateRate = rate;
      localRate = 0;
    }

    const stateTax = round2((base * stateRate) / 100);
    const localTax = round2((base * localRate) / 100);
    const totalTax = round2(stateTax + localTax);
    const grandTotal = round2(base + totalTax);

    return {
      isIndiaOrg: false,
      taxMode: "SALES_TAX",
      supplyType: null,
      warning: usResult.warning,
      taxableAmount: base,
      taxRate: round2(stateRate + localRate),
      stateTaxRate: stateRate,
      localTaxRate: localRate,
      localRateSource: usResult.localRateSource,
      stateName: usResult.stateName,
      stateCode: usResult.stateCode,
      resolved: usResult.resolved,
      stateTax,
      localTax,
      cgst: 0,
      sgst: 0,
      igst: 0,
      vat: 0,
      taxAmount: totalTax,
      totalTax,
      grandTotal,
      sameState: false,
      taxBreakup: {
        taxableAmount: base,
        taxMode: "SALES_TAX",
        stateTaxRate: stateRate,
        localTaxRate: localRate,
        stateTax,
        localTax,
        totalTax,
        grandTotal,
        warning: usResult.warning,
        localRateSource: usResult.localRateSource,
      },
    };
  }

  // ── 2. VAT ENGINE (non-India / export / international) ───────────────────
  // Fires when EITHER party is in a VAT country (non-India, non-USA) AND at
  // least one party is not India.
  // This correctly handles:
  //   - Indian org → UAE/UK/etc customer (export): VAT
  //   - UAE org → any customer: VAT
  //   - India → India (different states): falls through to GST (IGST) ✓
  const NON_INDIA_VAT_COUNTRIES = new Set([
    "uae", "uk", "ireland", "sri lanka", "australia", "new zealand",
    "singapore", "germany", "france", "netherlands", "sweden", "norway",
    "denmark", "finland", "italy", "spain", "portugal", "belgium",
    "austria", "switzerland", "canada", "south africa", "kenya",
    "nigeria", "malaysia", "thailand", "japan", "south korea", "china",
    "indonesia", "philippines", "brazil", "mexico", "argentina", "chile",
    "saudi arabia", "bahrain", "qatar", "kuwait", "oman",
  ]);

  const orgIsVatCountry = NON_INDIA_VAT_COUNTRIES.has(orgCountry);
  const partyIsVatCountry = NON_INDIA_VAT_COUNTRIES.has(partyCountry);
  // At least one party is in a non-India VAT country
  const isInternationalVat = orgIsVatCountry || partyIsVatCountry;
  // But do not fire if BOTH are India (domestic)
  const bothIndia = orgCountry === "india" && partyCountry === "india";

  if (isInternationalVat && !bothIndia) {
    // Prefer the non-India country for rate lookup;
    // if both are non-India (e.g. UAE→UK), prefer the org's country
    const vatCountry = orgIsVatCountry ? orgCountry : partyCountry;
    let vatRate = rate;
    let vatWarning = "";
    if (vatRate <= 0) {
      const vatConfig = getCountryVATConfig(vatCountry);
      vatRate = vatConfig.rate;
      vatWarning = vatConfig.warning;
    }
    const vatAmount = round2((base * vatRate) / 100);
    const grandTotal = round2(base + vatAmount);

    return {
      isIndiaOrg: orgCountry === "india",
      taxMode: "VAT",
      supplyType: null,
      warning: vatWarning,
      taxableAmount: base,
      taxRate: vatRate,
      vatRate,
      vat: vatAmount,
      cgst: 0,
      sgst: 0,
      igst: 0,
      stateTax: 0,
      localTax: 0,
      taxAmount: vatAmount,
      totalTax: vatAmount,
      grandTotal,
      sameState: false,
      taxBreakup: {
        taxableAmount: base,
        taxMode: "VAT",
        vatRate,
        vatAmount,
        totalTax: vatAmount,
        grandTotal,
      },
    };
  }

  // ── 3. INDIA GST ENGINE ──────────────────────────────────────────────────
  const supply = resolveSupplyType({
    orgState: org?.state || org?.address?.state || "",
    partyState: party?.state || "",
    orgGstin: org?.gstin || org?.tax?.gstin || "",
    partyGstin: party?.gstin || party?.taxId || "",
    orgCountry,
    partyCountry,
  });

  const gstAmount = round2((base * rate) / 100);
  const supplyType = supply.supplyType;
  let igst = 0;
  let cgst = 0;
  let sgst = 0;

  if (supplyType === "INTER") {
    igst = gstAmount;
  } else {
    cgst = round2(gstAmount / 2);
    sgst = round2(gstAmount - cgst);
  }

  // Correct rounding drift
  const computedTotal = round2(igst + cgst + sgst);
  const drift = round2(gstAmount - computedTotal);
  if (drift !== 0) {
    if (supplyType === "INTER") {
      igst = round2(igst + drift);
    } else {
      sgst = round2(sgst + drift);
    }
  }

  const totalTax = round2(igst + cgst + sgst);
  const grandTotal = round2(base + totalTax);

  return {
    isIndiaOrg: true,
    taxMode: "GST",
    supplyType,
    warning: supply.warning,
    taxableAmount: base,
    taxRate: rate,
    gstRate: rate,
    igst,
    cgst,
    sgst,
    stateTax: 0,
    localTax: 0,
    vat: 0,
    taxAmount: totalTax,
    totalTax,
    grandTotal,
    sameState: supplyType === "INTRA",
    taxBreakup: {
      taxableAmount: base,
      taxMode: "GST",
      gstRate: rate,
      igst,
      cgst,
      sgst,
      totalTax,
      grandTotal,
      supplyType,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function computeIndiaGST({
  taxRate,
  companyState,
  customerState,
  taxableAmount,
  companyGstin = "",
  customerGstin = "",
}) {
  const result = calculateTaxes({
    taxableAmount,
    taxRate,
    org: { country: "India", state: companyState, gstin: companyGstin },
    party: { country: "India", state: customerState, gstin: customerGstin },
  });
  return {
    type: "GST",
    sameState: result.supplyType !== "INTER",
    supplyType: result.supplyType,
    warning: result.warning,
    cgst: result.cgst,
    sgst: result.sgst,
    igst: result.igst,
    totalTax: result.totalTax,
  };
}

export function computeVAT({ vatRate, taxableAmount, country = "UAE" }) {
  const result = calculateTaxes({
    taxableAmount,
    taxRate: vatRate,
    org: { country },
    party: { country },
    taxLabel: "VAT",
  });
  return { type: "VAT", vat: result.taxAmount, totalTax: result.totalTax };
}

/**
 * Get all 50 US states + DC as an array for dropdown population.
 * Returns [{ code, name, stateRate }]
 */
export function getAllUSStates() {
  return Object.entries(US_STATE_STATUTORY_RATES).map(([code, { name, stateRate }]) => ({
    code,
    name,
    stateRate,
  }));
}
