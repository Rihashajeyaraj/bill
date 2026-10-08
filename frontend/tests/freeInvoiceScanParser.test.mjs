import assert from "node:assert/strict";
import { parseInvoiceScan, validateInvoiceScan } from "../src/lib/invoiceScanParser.js";

const sampleInvoice = `
HUES GRANITES PRIVATE LIMITED
TAX INVOICE
INVOICE # 5381
DATE : 23-03-2026
SUB TOTAL 1193222.65
IGST 1193.22
TOTAL 1194416.00
`;

const parsed = parseInvoiceScan(sampleInvoice);

assert.equal(parsed.supplier, "HUES GRANITES PRIVATE LIMITED");
assert.equal(parsed.invoiceNumber, "5381");
assert.equal(parsed.date, "23-03-2026");
assert.equal(parsed.total, "1194416.00");
assert.equal(validateInvoiceScan(parsed).issues.length, 0);

const tableHeavyInvoice = `
ACME SUPPLIES PRIVATE LIMITED
Invoice No: INV-2026-119
Date: 11-02-2026
Description Qty Rate Amount
Tile A 5 100.00 500.00
Tile B 10 150.00 1500.00
Sub Total 2000.00
CGST 180.00
SGST 180.00
Grand Total 2360.00
`;

const tableParsed = parseInvoiceScan(tableHeavyInvoice);

assert.equal(tableParsed.invoiceNumber, "INV-2026-119");
assert.equal(tableParsed.date, "11-02-2026");
assert.equal(tableParsed.total, "2360.00");
assert.equal(tableParsed.supplier, "ACME SUPPLIES PRIVATE LIMITED");

const mergedHeaderInvoice = `
HUES GRANITES PRIVATE LIMITED PO/WS/423/2025-26 23-03-2026
TAX INVOICE
Invoice No: DATE
INVOICE # 5381
Sub Total 1193222.65
IGST 1193.22
Total 1194416.00
`;

const mergedParsed = parseInvoiceScan(mergedHeaderInvoice);

assert.equal(mergedParsed.invoiceNumber, "5381");
assert.equal(mergedParsed.supplier, "HUES GRANITES PRIVATE LIMITED");
assert.equal(mergedParsed.total, "1194416.00");

const actualPdfShapeInvoice = `
INVOICE
INVOICE # DATE
5381 23-03-2026
HUES GRANITES PRIVATE LIMITED PO/WS/423/2025-26 23-03-2026
WESTONE,
No:63,Ground Floor,3rd Cross,Jnanakshi Layout Opp-Sharada Layout, BHEL
Layout,RR Nagar,
Bengaluru, Karnataka , 560098
Ph No: 9448355991
INDIA
S.NO DESCRIPTION OF GOODS QTY IN QTY IN PRICE/SQ.MT AMOUNT IN Rs
HTS Code GEO Name RANDOM SLABS NO SQ.MT IN Rs
1 68029300 GRANITE COFFEE BROWN Leather 20 MM 68 425.498 2,669.03 1,135,666.93
2 68029300 GRANITE COFFEE BROWN Leather 30 MM 3 16.598 3,467.63 57,555.72
SUB TOTAL 1,193,222.65
I GST 0.1% 1,193.22
ROUND OFF 0.13
TOTAL 442.096 11,94,416.00
2.I We Declare that this Invoice show the actual price of the goods described and that all particulars are true and correct;
`;

const actualPdfParsed = parseInvoiceScan(actualPdfShapeInvoice);

assert.equal(actualPdfParsed.invoiceNumber, "5381");
assert.equal(actualPdfParsed.date, "23-03-2026");
assert.equal(actualPdfParsed.supplier, "HUES GRANITES PRIVATE LIMITED");
assert.equal(actualPdfParsed.supplierPhone, "9448355991");
assert.equal(actualPdfParsed.city, "Bengaluru");
assert.equal(actualPdfParsed.state, "Karnataka");
assert.equal(
  actualPdfParsed.address,
  "No:63,Ground Floor,3rd Cross,Jnanakshi Layout Opp-Sharada Layout, BHEL, Layout,RR Nagar,, Bengaluru, Karnataka , 560098"
);
assert.equal(actualPdfParsed.country, "India");
assert.equal(actualPdfParsed.total, "1194416.00");
assert.equal(actualPdfParsed.items.length, 2);
assert.equal(actualPdfParsed.items[0].description, "GRANITE COFFEE BROWN Leather 20 MM");
assert.equal(actualPdfParsed.items[0].qty, 425.498);
assert.equal(actualPdfParsed.items[0].unit, "sqm");
assert.equal(actualPdfParsed.items[0].rate, 2669.03);
assert.equal(actualPdfParsed.items[0].tax, 0.1);
assert.equal(actualPdfParsed.items[1].description, "GRANITE COFFEE BROWN Leather 30 MM");
assert.equal(actualPdfParsed.items[1].qty, 16.598);
assert.equal(actualPdfParsed.items[1].rate, 3467.63);

console.log("freeInvoiceScanParser.test passed");
