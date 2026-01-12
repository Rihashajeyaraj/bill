export function normalizeTaxRate(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function computeIndiaGST({ taxRate, companyState, customerState, taxableAmount }) {
  const rate = normalizeTaxRate(taxRate);
  const base = Number(taxableAmount || 0);

  const sameState =
    (companyState || "").trim().toLowerCase() === (customerState || "").trim().toLowerCase();

  if (!rate || base <= 0) {
    return { type: "GST", sameState, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
  }

  if (sameState) {
    const half = rate / 2;
    const cgst = (base * half) / 100;
    const sgst = (base * half) / 100;
    return { type: "GST", sameState, cgst, sgst, igst: 0, totalTax: cgst + sgst };
  }

  const igst = (base * rate) / 100;
  return { type: "GST", sameState, cgst: 0, sgst: 0, igst, totalTax: igst };
}

export function computeVAT({ vatRate, taxableAmount }) {
  const rate = normalizeTaxRate(vatRate);
  const base = Number(taxableAmount || 0);
  const vat = rate && base > 0 ? (base * rate) / 100 : 0;
  return { type: "VAT", vat, totalTax: vat };
}
