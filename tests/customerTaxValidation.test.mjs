import assert from "node:assert/strict";
import { validateContactTax } from "../src/services/customerTax.js";

function verify(label, fn) {
  try {
    fn();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("India org + Individual customer without GSTIN => success", () => {
  const result = validateContactTax(
    { type: "Customer", contactType: "Individual", taxId: "" },
    { country: "India", settings: {} }
  );
  assert.equal(result.error, "");
  assert.equal(result.warning, "");
  assert.equal(result.contactType, "Individual");
  assert.equal(result.normalizedTaxId, "");
  assert.equal(result.showGSTINField, false);
  assert.equal(result.isGSTMode, true);
});

verify("India org + Business customer with GSTIN => success", () => {
  const result = validateContactTax(
    { type: "Customer", contactType: "Business", taxId: "33abcde1234f1z5" },
    { country: "India", settings: {} }
  );
  assert.equal(result.error, "");
  assert.equal(result.contactType, "Business");
  assert.equal(result.normalizedTaxId, "33ABCDE1234F1Z5");
  assert.equal(result.showGSTINField, true);
});

verify("India org + Business customer without GSTIN => warning only", () => {
  const result = validateContactTax(
    { type: "Customer", contactType: "Business", taxId: "" },
    { country: "India", settings: {} }
  );
  assert.equal(result.error, "");
  assert.equal(result.warning, "GSTIN is recommended for Business contacts in India.");
});

verify("India org + Individual supplier without GSTIN => success", () => {
  const result = validateContactTax(
    { type: "Supplier", contactType: "Individual", taxId: "" },
    { country: "India", settings: {} }
  );
  assert.equal(result.error, "");
  assert.equal(result.warning, "");
  assert.equal(result.showGSTINField, false);
});

verify("India org + Business supplier without GSTIN => warning only", () => {
  const result = validateContactTax(
    { type: "Supplier", contactType: "Business", taxId: "" },
    { country: "India", settings: {} }
  );
  assert.equal(result.error, "");
  assert.equal(result.warning, "GSTIN is recommended for Business contacts in India.");
  assert.equal(result.showGSTINField, true);
});

verify("Non-India org + any contact => GSTIN ignored", () => {
  const result = validateContactTax(
    { type: "Supplier", contactType: "Business", taxId: "NOT-A-GSTIN" },
    { country: "Sri Lanka", settings: {} }
  );
  assert.equal(result.error, "");
  assert.equal(result.warning, "");
  assert.equal(result.normalizedTaxId, "NOT-A-GSTIN");
  assert.equal(result.isGSTMode, false);
});

verify("India org + Business without GSTIN + strict setting => warning only", () => {
  const result = validateContactTax(
    { type: "Customer", contactType: "Business", taxId: "" },
    { country: "India", settings: { requireBusinessTaxId: true } }
  );
  assert.equal(result.error, "");
  assert.equal(result.warning, "GSTIN is recommended for Business contacts in India.");
});

console.log("All contact tax validation tests passed.");
