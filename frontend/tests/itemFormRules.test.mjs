import assert from "node:assert/strict";
import {
  defaultTrackInventoryForType,
  inferTypeFromCategory,
  isIndiaCountry,
  shouldShowIndiaComplianceFields,
  shouldShowInventoryFields,
  shouldShowInventorySection,
  taxHintForCountry,
  taxRateLabelForCountry
} from "../src/modules/items/formRules.js";

function verify(label, run) {
  try {
    run();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("India detection is case-insensitive", () => {
  assert.equal(isIndiaCountry("india"), true);
  assert.equal(isIndiaCountry("India"), true);
  assert.equal(isIndiaCountry("USA"), false);
});

verify("Tax label switches by country", () => {
  assert.equal(taxRateLabelForCountry("India"), "GST %");
  assert.equal(taxRateLabelForCountry("UAE"), "Tax / VAT %");
});

verify("India compliance visibility toggles correctly", () => {
  assert.equal(shouldShowIndiaComplianceFields("India"), true);
  assert.equal(shouldShowIndiaComplianceFields("Sri Lanka"), false);
});

verify("Tax hints map to GST vs VAT wording", () => {
  assert.match(taxHintForCountry("India"), /GST/i);
  assert.match(taxHintForCountry("USA"), /tax|vat/i);
});

verify("Track inventory defaults by type", () => {
  assert.equal(defaultTrackInventoryForType("PRODUCT"), true);
  assert.equal(defaultTrackInventoryForType("SERVICE"), false);
});

verify("Inventory section visibility follows type or tracking", () => {
  assert.equal(shouldShowInventorySection("PRODUCT", false), true);
  assert.equal(shouldShowInventorySection("SERVICE", false), false);
  assert.equal(shouldShowInventorySection("SERVICE", true), true);
});

verify("Opening stock fields only show for tracked products", () => {
  assert.equal(shouldShowInventoryFields("PRODUCT", true), true);
  assert.equal(shouldShowInventoryFields("PRODUCT", false), false);
  assert.equal(shouldShowInventoryFields("SERVICE", true), false);
});

verify("Category can infer service type", () => {
  assert.equal(inferTypeFromCategory("Consulting Services", "PRODUCT"), "SERVICE");
  assert.equal(inferTypeFromCategory("Hardware", "PRODUCT"), "PRODUCT");
});

console.log("All item form rule tests passed.");
