import assert from "node:assert/strict";
import {
  parsePurchaseBillSpreadsheetRows,
  parsePurchaseBillText
} from "../src/services/purchaseBillPdfImport.js";

function verify(label, run) {
  try {
    run();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("extracts header details and item rows from purchase bill text", () => {
  const parsed = parsePurchaseBillText(`
    Supplier: ABC Traders
    Mobile: 077 123 4567
    Invoice No: PB-1007
    Invoice Date: 25/03/2026

    Description Qty Rate Amount
    1 Cement Bag 10 pcs 1200.00 12000.00
    2 River Sand 5 loads 800.00 4000.00
    Grand Total 16000.00
  `);

  assert.equal(parsed.supplierName, "ABC Traders");
  assert.equal(parsed.billNumber, "PB-1007");
  assert.equal(parsed.billDate, "2026-03-25");
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0], {
    description: "Cement Bag",
    qty: 10,
    unit: "pcs",
    rate: 1200,
    amount: 12000,
    tax: null
  });
  assert.equal(parsed.items[1].description, "River Sand");
  assert.equal(parsed.items[1].qty, 5);
  assert.equal(parsed.items[1].unit, "loads");
  assert.equal(parsed.items[1].rate, 800);
  assert.equal(parsed.items[1].amount, 4000);
});

verify("returns warnings when important fields are missing", () => {
  const parsed = parsePurchaseBillText(`
    Random heading
    Notes only
  `);

  assert.equal(parsed.items.length, 0);
  assert.ok(parsed.warnings.includes("No item rows were confidently extracted from the PDF."));
  assert.ok(parsed.warnings.includes("Bill number could not be identified automatically."));
  assert.ok(parsed.warnings.includes("Bill date could not be identified automatically."));
});

verify("extracts purchase bill details from spreadsheet rows", () => {
  const parsed = parsePurchaseBillSpreadsheetRows([
    {
      Supplier: "ABC Traders",
      Mobile: "0771234567",
      "Bill No": "PB-1008",
      "Bill Date": "2026-03-26"
    },
    {
      Item: "Blue Pen",
      Qty: 12,
      Unit: "pcs",
      Rate: 45,
      Amount: 540
    },
    {
      Item: "A4 Paper",
      Quantity: 5,
      UOM: "pack",
      Price: 320,
      Total: 1600
    }
  ]);

  assert.equal(parsed.supplierName, "ABC Traders");
  assert.equal(parsed.supplierPhone, "0771234567");
  assert.equal(parsed.billNumber, "PB-1008");
  assert.equal(parsed.billDate, "2026-03-26");
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].description, "Blue Pen");
  assert.equal(parsed.items[1].description, "A4 Paper");
});

verify("extracts spreadsheet data from metadata rows and later item table", () => {
  const parsed = parsePurchaseBillSpreadsheetRows([
    {
      A: "Supplier",
      B: "Metro Stores"
    },
    {
      A: "Bill No",
      B: "PB-2001"
    },
    {
      A: "Bill Date",
      B: "27/03/2026"
    },
    {
      A: "Item",
      B: "Qty",
      C: "Unit",
      D: "Rate",
      E: "Amount"
    },
    {
      A: "Notebook",
      B: 3,
      C: "pcs",
      D: 250,
      E: 750
    },
    {
      A: "Marker",
      B: 2,
      C: "pcs",
      D: 120,
      E: 240
    }
  ]);

  assert.equal(parsed.supplierName, "Metro Stores");
  assert.equal(parsed.billNumber, "PB-2001");
  assert.equal(parsed.billDate, "2026-03-27");
});

console.log("Purchase bill PDF import tests passed.");
