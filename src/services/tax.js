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

function resolveOrgCountry(org = {}) {
  const rawCountry = normalizeText(org?.country);
  if (rawCountry) return rawCountry;
  const countryCode = String(org?.countryCode || org?.country_code || "")
    .trim()
    .toUpperCase();
  if (countryCode === "IN") return "india";
  return "";
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

function resolveSupplyType({ orgState = "", partyState = "", orgGstin = "", partyGstin = "" }) {
  const normalizedOrgState = normalizeText(orgState);
  const normalizedPartyState = normalizeText(partyState);

  if (normalizedOrgState && normalizedPartyState) {
    return {
      supplyType: normalizedOrgState === normalizedPartyState ? "INTRA" : "INTER",
      warning: ""
    };
  }

  const orgCode = extractStateCodeFromGstin(orgGstin);
  const partyCode = extractStateCodeFromGstin(partyGstin);
  if (orgCode && partyCode) {
    return {
      supplyType: orgCode === partyCode ? "INTRA" : "INTER",
      warning: ""
    };
  }

  return {
    supplyType: "INTRA",
    warning: "State missing, please select state"
  };
}

export function calculateTaxes({
  taxableAmount = 0,
  taxRate = 0,
  org = {},
  party = {},
  taxLabel = "TAX"
} = {}) {
  const base = Math.max(0, round2(taxableAmount));
  const rate = normalizeTaxRate(taxRate);
  const isIndiaOrg = resolveOrgCountry(org) === "india";

  if (!isIndiaOrg) {
    const taxAmount = round2((base * rate) / 100);
    const grandTotal = round2(base + taxAmount);
    return {
      isIndiaOrg,
      taxMode: "NORMAL",
      supplyType: null,
      warning: "",
      taxableAmount: base,
      taxRate: rate,
      gstRate: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      taxAmount,
      totalTax: taxAmount,
      grandTotal,
      taxBreakup: {
        taxableAmount: base,
        taxLabel: taxLabel || "TAX",
        taxRate: rate,
        taxAmount
      }
    };
  }

  const supply = resolveSupplyType({
    orgState: org?.state || org?.address?.state || "",
    partyState: party?.state || "",
    orgGstin: org?.gstin || org?.tax?.gstin || "",
    partyGstin: party?.gstin || party?.taxId || ""
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
    isIndiaOrg,
    taxMode: "GST",
    supplyType,
    warning: supply.warning,
    taxableAmount: base,
    taxRate: rate,
    gstRate: rate,
    igst,
    cgst,
    sgst,
    taxAmount: totalTax,
    totalTax,
    grandTotal,
    sameState: supplyType === "INTRA",
    taxBreakup: {
      taxableAmount: base,
      gstRate: rate,
      igst,
      cgst,
      sgst,
      totalTax,
      grandTotal,
      supplyType
    }
  };
}

export function computeIndiaGST({ taxRate, companyState, customerState, taxableAmount, companyGstin = "", customerGstin = "" }) {
  const result = calculateTaxes({
    taxableAmount,
    taxRate,
    org: { country: "India", state: companyState, gstin: companyGstin },
    party: { state: customerState, gstin: customerGstin }
  });
  return {
    type: "GST",
    sameState: result.supplyType !== "INTER",
    supplyType: result.supplyType,
    warning: result.warning,
    cgst: result.cgst,
    sgst: result.sgst,
    igst: result.igst,
    totalTax: result.totalTax
  };
}

export function computeVAT({ vatRate, taxableAmount }) {
  const result = calculateTaxes({
    taxableAmount,
    taxRate: vatRate,
    org: { country: "Other" },
    party: {},
    taxLabel: "TAX"
  });
  return { type: "VAT", vat: result.taxAmount, totalTax: result.totalTax };
}
