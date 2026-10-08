import assert from "node:assert/strict";
import {
  allocateFifoBatches,
  splitPurchaseLineTax,
  summarizeTaxLedger
} from "../src/services/fifoTaxProfit.js";

function verify(label, run) {
  try {
    run();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("Acceptance #1: two purchase batches exist", () => {
  const first = splitPurchaseLineTax({
    qty: 10,
    unitPrice: 5000,
    taxRate: 18,
    taxInclusive: false
  });
  const second = splitPurchaseLineTax({
    qty: 10,
    unitPrice: 5500,
    taxRate: 18,
    taxInclusive: false
  });

  const batches = [
    { id: "B1", qtyRemaining: first.qty, unitCostExclTax: first.unitCostExclTax },
    { id: "B2", qtyRemaining: second.qty, unitCostExclTax: second.unitCostExclTax }
  ];

  assert.equal(batches.length, 2);
  assert.equal(batches[0].qtyRemaining, 10);
  assert.equal(batches[1].qtyRemaining, 10);
});

verify("Acceptance #2: sell 12 uses FIFO 10 + 2 and leaves 0 + 8", () => {
  const result = allocateFifoBatches({
    batches: [
      { id: "B1", qtyRemaining: 10, unitCostExclTax: 5000 },
      { id: "B2", qtyRemaining: 10, unitCostExclTax: 5500 }
    ],
    sellQty: 12
  });

  assert.equal(result.allocations.length, 2);
  assert.equal(result.allocations[0].batchId, "B1");
  assert.equal(result.allocations[0].qty, 10);
  assert.equal(result.allocations[1].batchId, "B2");
  assert.equal(result.allocations[1].qty, 2);
  assert.equal(result.updatedBatches[0].qtyRemaining, 0);
  assert.equal(result.updatedBatches[1].qtyRemaining, 8);
  assert.equal(result.shortageQty, 0);
  assert.equal(result.cogs, 61000);
});

verify("Acceptance #3: tax-inclusive purchase correctly splits base and tax", () => {
  const result = splitPurchaseLineTax({
    qty: 1,
    unitPrice: 1180,
    taxRate: 18,
    taxInclusive: true
  });
  assert.equal(result.taxableAmount, 1000);
  assert.equal(result.taxAmount, 180);
  assert.equal(result.lineTotal, 1180);
});

verify("Acceptance #4: output ledger and net payable calculation", () => {
  const summary = summarizeTaxLedger([
    { entryType: "INPUT", taxAmount: 180 },
    { entryType: "INPUT", taxAmount: 120 },
    { entryType: "OUTPUT", taxAmount: 450 }
  ]);
  assert.equal(summary.inputTax, 300);
  assert.equal(summary.outputTax, 450);
  assert.equal(summary.netPayable, 150);
});

console.log("All FIFO/Tax/Profit acceptance tests passed.");

