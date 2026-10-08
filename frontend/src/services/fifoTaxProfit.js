function toNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

export function splitPurchaseLineTax({
  qty = 0,
  unitPrice = 0,
  taxRate = 0,
  taxInclusive = false
} = {}) {
  const safeQty = Math.max(0, toNumber(qty));
  const safeRate = Math.max(0, toNumber(unitPrice));
  const safeTaxRate = Math.max(0, toNumber(taxRate));

  if (safeQty <= 0) {
    return {
      qty: 0,
      taxRate: safeTaxRate,
      taxInclusive: !!taxInclusive,
      taxableAmount: 0,
      taxAmount: 0,
      lineTotal: 0,
      unitCostExclTax: 0,
      unitCostInclTax: 0
    };
  }

  const gross = round2(safeQty * safeRate);
  let taxableAmount = 0;
  let taxAmount = 0;
  let lineTotal = 0;

  if (taxInclusive && safeTaxRate > 0) {
    taxableAmount = round2(gross / (1 + safeTaxRate / 100));
    taxAmount = round2(gross - taxableAmount);
    lineTotal = gross;
  } else {
    taxableAmount = round2(gross);
    taxAmount = round2((taxableAmount * safeTaxRate) / 100);
    lineTotal = round2(taxableAmount + taxAmount);
  }

  return {
    qty: safeQty,
    taxRate: safeTaxRate,
    taxInclusive: !!taxInclusive,
    taxableAmount,
    taxAmount,
    lineTotal,
    unitCostExclTax: round2(taxableAmount / safeQty),
    unitCostInclTax: round2(lineTotal / safeQty)
  };
}

export function allocateFifoBatches({ batches = [], sellQty = 0 } = {}) {
  const queue = (Array.isArray(batches) ? batches : []).map((batch) => ({
    id: String(batch?.id || ""),
    qtyRemaining: Math.max(0, toNumber(batch?.qtyRemaining)),
    unitCostExclTax: Math.max(0, toNumber(batch?.unitCostExclTax))
  }));
  let remainingToSell = Math.max(0, toNumber(sellQty));
  const allocations = [];

  for (const batch of queue) {
    if (remainingToSell <= 0) break;
    if (batch.qtyRemaining <= 0) continue;
    const allocatedQty = Math.min(remainingToSell, batch.qtyRemaining);
    const cogsAmount = round2(allocatedQty * batch.unitCostExclTax);
    allocations.push({
      batchId: batch.id,
      qty: allocatedQty,
      unitCostExclTax: batch.unitCostExclTax,
      cogsAmount
    });
    batch.qtyRemaining = round2(batch.qtyRemaining - allocatedQty);
    remainingToSell = round2(remainingToSell - allocatedQty);
  }

  const cogs = round2(allocations.reduce((sum, row) => sum + toNumber(row.cogsAmount), 0));
  return {
    allocations,
    shortageQty: remainingToSell,
    cogs,
    updatedBatches: queue
  };
}

export function summarizeTaxLedger(entries = []) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const inputTax = round2(
    safeEntries
      .filter((entry) => String(entry?.entryType || "").toUpperCase() === "INPUT")
      .reduce((sum, entry) => sum + toNumber(entry?.taxAmount), 0)
  );
  const outputTax = round2(
    safeEntries
      .filter((entry) => String(entry?.entryType || "").toUpperCase() === "OUTPUT")
      .reduce((sum, entry) => sum + toNumber(entry?.taxAmount), 0)
  );
  return {
    inputTax,
    outputTax,
    netPayable: round2(outputTax - inputTax)
  };
}

