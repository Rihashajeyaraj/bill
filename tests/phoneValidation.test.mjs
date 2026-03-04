import assert from "node:assert/strict";
import {
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  phoneDigitRangeLabel,
  validateInternationalPhone
} from "../src/lib/phoneValidation.js";

function verify(label, run) {
  try {
    run();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("Digit range label uses 7-15", () => {
  assert.equal(PHONE_MIN_DIGITS, 7);
  assert.equal(PHONE_MAX_DIGITS, 15);
  assert.equal(phoneDigitRangeLabel(), "7-15 digits");
});

verify("Allows international number with country code", () => {
  const result = validateInternationalPhone("+94 71 234 5678", { required: true });
  assert.equal(result.error, "");
});

verify("Allows numbers shorter than 10 digits when at least 7", () => {
  const result = validateInternationalPhone("9234567", { required: true });
  assert.equal(result.error, "");
});

verify("Rejects numbers shorter than 7 digits", () => {
  const result = validateInternationalPhone("123456", { required: true });
  assert.match(result.error, /between 7 and 15 digits/i);
});

verify("Rejects numbers longer than 15 digits", () => {
  const result = validateInternationalPhone("1234567890123456", { required: true });
  assert.match(result.error, /between 7 and 15 digits/i);
});

verify("Rejects invalid characters", () => {
  const result = validateInternationalPhone("+1-202-ABC-0199", { required: true });
  assert.match(result.error, /digits, spaces, parentheses, hyphens/i);
});

console.log("All phone validation tests passed.");
