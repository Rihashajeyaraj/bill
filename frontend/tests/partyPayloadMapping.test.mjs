import assert from "node:assert/strict";

// Replicate mapping logic from store.ts for unit test verification
const VALID_PARTY_DB_COLUMNS = new Set([
  "id",
  "organization_id",
  "party_type",
  "display_name",
  "legal_name",
  "contact_person",
  "phone",
  "email",
  "billing_address_line1",
  "billing_address_line2",
  "city",
  "state_name",
  "state_code",
  "country_code",
  "postal_code",
  "gstin",
  "pan",
  "opening_balance",
  "credit_limit",
  "notes",
  "is_active",
  "created_by"
]);

function cleanRemotePayload(payload) {
  const cleaned = {};
  for (const [key, val] of Object.entries(payload)) {
    if (VALID_PARTY_DB_COLUMNS.has(key)) {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

function extractMissingColumn(error) {
  const msg = String(error?.message || error?.details || "");
  const match = msg.match(/Could not find the '([^']+)' column/i) ||
                msg.match(/column "?([^"\s]+)"? does not exist/i);
  return match ? match[1] : null;
}

function toRemotePayloadTest(draft) {
  const gstinValue = (draft.gstin || draft.taxId || "").trim() || null;
  let panValue = (draft.pan || "").trim() || null;
  if (!panValue && gstinValue) {
    const upper = gstinValue.toUpperCase();
    if (upper.length === 15) {
      panValue = upper.slice(2, 12);
    } else if (upper.length === 10) {
      panValue = upper;
    }
  }

  let stateCode = draft.state_code || draft.stateCode || null;
  if (!stateCode && gstinValue && /^\d{2}/.test(gstinValue)) {
    stateCode = gstinValue.slice(0, 2);
  }

  const rawPayload = {
    party_type: draft.type === "Supplier" ? "supplier" : "customer",
    display_name: draft.name,
    legal_name: draft.name,
    phone: draft.phone || null,
    email: draft.email || null,
    billing_address_line1: draft.address || null,
    city: draft.city || null,
    state_name: draft.state || null,
    state_code: stateCode,
    country_code: draft.country_code || "IN",
    postal_code: draft.postal_code || draft.postalCode || null,
    gstin: gstinValue,
    pan: panValue,
    opening_balance: draft.openingBalance || 0,
    credit_limit: draft.creditLimit > 0 ? draft.creditLimit : null,
    notes: draft.notes || null,
    is_active: true
  };

  return cleanRemotePayload(rawPayload);
}

function testMinimalCustomer() {
  const draft = {
    type: "Customer",
    name: "Customer Alpha",
    phone: "+919876543210",
    email: "alpha@example.com"
  };
  const payload = toRemotePayloadTest(draft);
  assert.equal(payload.display_name, "Customer Alpha");
  assert.equal(payload.party_type, "customer");
  assert.equal(payload.phone, "+919876543210");
  assert.equal(payload.email, "alpha@example.com");
  assert.equal(payload.gstin, null);
  assert.equal(payload.pan, null);
  assert.equal("tax_id" in payload, false, "tax_id must NOT be present in payload");
  assert.equal("vat_number" in payload, false, "vat_number must NOT be present in payload");
  console.log("PASS: Minimal customer payload mapping has no tax_id or vat_number");
}

function testCustomerWithTaxAndAddress() {
  const draft = {
    type: "Customer",
    name: "Beta Corp",
    phone: "+919876543211",
    email: "beta@example.com",
    address: "123 Tech Park",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    taxId: "29ABCDE1234F1Z5"
  };
  const payload = toRemotePayloadTest(draft);
  assert.equal(payload.gstin, "29ABCDE1234F1Z5");
  assert.equal(payload.pan, "ABCDE1234F");
  assert.equal(payload.state_code, "29");
  assert.equal(payload.city, "Bengaluru");
  assert.equal(payload.state_name, "Karnataka");
  assert.equal(payload.postal_code, "560001");
  assert.equal("tax_id" in payload, false, "tax_id must NOT be present in payload");
  assert.equal("vat_number" in payload, false, "vat_number must NOT be present in payload");
  console.log("PASS: Customer with tax and address maps taxId to gstin & pan with no tax_id key");
}

function testMissingColumnExtraction() {
  const err1 = { message: "Could not find the 'tax_id' column of 'parties' in the schema cache", code: "PGRST204" };
  assert.equal(extractMissingColumn(err1), "tax_id");

  const err2 = { message: 'column "vat_number" does not exist', code: "42703" };
  assert.equal(extractMissingColumn(err2), "vat_number");
  console.log("PASS: Missing column extraction successfully detects schema cache column errors");
}

testMinimalCustomer();
testCustomerWithTaxAndAddress();
testMissingColumnExtraction();
console.log("All party payload mapping tests passed!");
