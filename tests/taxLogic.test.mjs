import assert from "node:assert/strict";
import { calculateTaxes } from "../src/services/tax.js";

function verify(label, run) {
  try {
    run();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("India intra-state splits equally", () => {
  const result = calculateTaxes({
    taxableAmount: 1000,
    taxRate: 18,
    org: { country: "India", state: "Tamil Nadu" },
    party: { state: "Tamil Nadu" }
  });

  assert.equal(result.taxMode, "GST");
  assert.equal(result.supplyType, "INTRA");
  assert.equal(result.cgst, 90);
  assert.equal(result.sgst, 90);
  assert.equal(result.igst, 0);
  assert.equal(result.totalTax, 180);
  assert.equal(result.grandTotal, 1180);
});

verify("India inter-state applies IGST", () => {
  const result = calculateTaxes({
    taxableAmount: 1000,
    taxRate: 18,
    org: { country: "India", state: "Tamil Nadu" },
    party: { state: "Kerala" }
  });

  assert.equal(result.taxMode, "GST");
  assert.equal(result.supplyType, "INTER");
  assert.equal(result.igst, 180);
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
  assert.equal(result.totalTax, 180);
  assert.equal(result.grandTotal, 1180);
});

verify("Non-India uses normal tax mode only", () => {
  const result = calculateTaxes({
    taxableAmount: 1000,
    taxRate: 15,
    org: { country: "Sri Lanka", state: "Western" },
    party: { state: "Western" }
  });

  assert.equal(result.taxMode, "NORMAL");
  assert.equal(result.taxAmount, 150);
  assert.equal(result.totalTax, 150);
  assert.equal(result.grandTotal, 1150);
  assert.equal(result.igst, 0);
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
  assert.equal(result.taxBreakup.taxLabel, "TAX");
});

verify("India missing party state falls back and warns", () => {
  const result = calculateTaxes({
    taxableAmount: 1000,
    taxRate: 18,
    org: { country: "India", state: "Tamil Nadu" },
    party: { state: "" }
  });

  assert.equal(result.taxMode, "GST");
  assert.equal(result.supplyType, "INTRA");
  assert.equal(result.warning, "State missing, please select state");
  assert.equal(result.totalTax, 180);
  assert.equal(result.grandTotal, 1180);
});

console.log("All tax logic tests passed.");
