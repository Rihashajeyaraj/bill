/**
 * Quick smoke-test for the frontend tax engine.
 * Run with: node test_tax_engine.mjs
 */
import { calculateTaxes, getCountryTaxConfig, getUSStateSalesTaxRates } from './frontend/src/services/tax.js';

function assert(label, condition, details = '') {
  if (condition) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ FAIL: ${label}${details ? ' — ' + details : ''}`);
    process.exitCode = 1;
  }
}

// ─── Scenario 1: India TN → Karnataka (IGST 18%) ───────────────────────────
const s1 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 18,
  org: { country: 'India', state: 'Tamil Nadu' },
  party: { country: 'India', state: 'Karnataka' }
});
assert('TN→KA: taxMode=GST',         s1.taxMode === 'GST');
assert('TN→KA: IGST=1800',           s1.igst === 1800, `igst=${s1.igst}`);
assert('TN→KA: CGST=0',              s1.cgst === 0,   `cgst=${s1.cgst}`);
assert('TN→KA: SGST=0',              s1.sgst === 0,   `sgst=${s1.sgst}`);
assert('TN→KA: supplyType=INTER',    s1.supplyType === 'INTER');
assert('TN→KA: grandTotal=11800',    s1.grandTotal === 11800);

// ─── Scenario 2: India TN → Tamil Nadu (CGST+SGST 9%+9%) ──────────────────
const s2 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 18,
  org: { country: 'India', state: 'Tamil Nadu' },
  party: { country: 'India', state: 'Tamil Nadu' }
});
assert('TN→TN: taxMode=GST',         s2.taxMode === 'GST');
assert('TN→TN: CGST=900',            s2.cgst === 900,  `cgst=${s2.cgst}`);
assert('TN→TN: SGST=900',            s2.sgst === 900,  `sgst=${s2.sgst}`);
assert('TN→TN: IGST=0',              s2.igst === 0,    `igst=${s2.igst}`);
assert('TN→TN: supplyType=INTRA',    s2.supplyType === 'INTRA');

// ─── Scenario 3: India → UAE (Export, VAT 5%) ──────────────────────────────
const s3 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 0,  // no rate specified, should use UAE 5% default
  org: { country: 'India', state: 'Tamil Nadu' },
  party: { country: 'UAE', state: 'Dubai' }
});
assert('IN→UAE: taxMode=VAT',        s3.taxMode === 'VAT', `taxMode=${s3.taxMode}`);
assert('IN→UAE: vat=500',            s3.vat === 500,  `vat=${s3.vat}`);
assert('IN→UAE: cgst=0',             s3.cgst === 0,   `cgst=${s3.cgst}`);
assert('IN→UAE: igst=0',             s3.igst === 0,   `igst=${s3.igst}`);
assert('IN→UAE: grandTotal=10500',   s3.grandTotal === 10500);

// ─── Scenario 4: India → UK (Export, VAT 20%) ─────────────────────────────
const s4 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 0,
  org: { country: 'India', state: 'Tamil Nadu' },
  party: { country: 'United Kingdom' }
});
assert('IN→UK: taxMode=VAT',         s4.taxMode === 'VAT');
assert('IN→UK: vat=2000',            s4.vat === 2000, `vat=${s4.vat}`);

// ─── Scenario 5: USA California, state rate only ──────────────────────────
const s5 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 0,
  org: { country: 'USA', state: 'California' },
  party: { country: 'USA', state: 'California' }
});
assert('CA: taxMode=SALES_TAX',      s5.taxMode === 'SALES_TAX');
assert('CA: stateTaxRate=7.25',      s5.stateTaxRate === 7.25, `stateTaxRate=${s5.stateTaxRate}`);
assert('CA: localTaxRate=0',         s5.localTaxRate === 0, `localTaxRate=${s5.localTaxRate} (should be 0, never invented)`);
assert('CA: stateTax=725',           s5.stateTax === 725);
assert('CA: warning set',            s5.warning.length > 0);

// ─── Scenario 6: USA California with explicit local rate ──────────────────
const s6 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 0,
  localTaxRate: 1.25,
  org: { country: 'USA', state: 'California' },
  party: { country: 'USA', state: 'California' }
});
assert('CA+local: localTaxRate=1.25', s6.localTaxRate === 1.25);
assert('CA+local: localTax=125',      s6.localTax === 125);
assert('CA+local: totalTax=850',      s6.totalTax === 850);
assert('CA+local: no warning',        s6.warning === '');

// ─── Scenario 7: Domestic inter-state must NOT trigger VAT ────────────────
const s7 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 18,
  org: { country: 'India', state: 'Tamil Nadu' },
  party: { country: 'India', state: 'Maharashtra' }
});
assert('TN→MH: taxMode=GST NOT VAT', s7.taxMode === 'GST', `taxMode=${s7.taxMode}`);
assert('TN→MH: IGST=1800',           s7.igst === 1800);
assert('TN→MH: supplyType=INTER',    s7.supplyType === 'INTER');

// ─── Scenario 8: No customer context → returns zeros ──────────────────────
const s8 = calculateTaxes({
  taxableAmount: 10000,
  taxRate: 18,
  org: { country: 'India', state: 'Tamil Nadu' },
  party: { country: '', state: '' }  // empty = no customer yet
});
// Empty country resolves to "india" → domestic GST → INTER (missing state)
assert('empty customer: taxMode=GST', s8.taxMode === 'GST', `taxMode=${s8.taxMode}`);

// ─── Scenario 9: getCountryTaxConfig returns correct mode ─────────────────
const cfg_india = getCountryTaxConfig('India');
assert('config India: GST',          cfg_india.taxMode === 'GST');
assert('config India: showGstFields',cfg_india.showGstFields === true);

const cfg_usa = getCountryTaxConfig('USA');
assert('config USA: SALES_TAX',      cfg_usa.taxMode === 'SALES_TAX');
assert('config USA: no defaultRate', cfg_usa.defaultTaxRate === 0);

const cfg_uae = getCountryTaxConfig('UAE');
assert('config UAE: VAT',            cfg_uae.taxMode === 'VAT');
assert('config UAE: rate=5',         cfg_uae.defaultTaxRate === 5);

// ─── Scenario 10: US state rate lookup ────────────────────────────────────
const tx = getUSStateSalesTaxRates('Texas');
assert('TX stateRate=6.25',          tx.stateRate === 6.25);
assert('TX localRate=0',             tx.localRate === 0);
assert('TX localRateSource',         tx.localRateSource === 'not_provided');
assert('TX resolved=true',           tx.resolved === true);

const ak = getUSStateSalesTaxRates('Alaska');
assert('AK: no sales tax warning',   ak.stateRate === 0);
assert('AK: localRateSource=not_applicable', ak.localRateSource === 'not_applicable');

const unknown = getUSStateSalesTaxRates('XYZ Unknown State');
assert('Unknown state: resolved=false', unknown.resolved === false);
assert('Unknown state: stateRate=0',    unknown.stateRate === 0);

console.log('\nDone.');
