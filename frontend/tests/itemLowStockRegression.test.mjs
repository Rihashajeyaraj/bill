import assert from "node:assert/strict";
import {
  resolveLowStockAlertValue,
  resolveUpsertStockValues
} from "../src/modules/items/stockPersistence.js";

function verify(label, run) {
  try {
    run();
    console.log(`PASS: ${label}`);
  } catch (error) {
    console.error(`FAIL: ${label}`);
    throw error;
  }
}

verify("Low-stock create/edit regression stays fixed", () => {
  const createLowStock = resolveLowStockAlertValue(
    { lowStockAlert: 7 },
    {}
  );
  assert.equal(createLowStock, 7);

  const createStock = resolveUpsertStockValues({
    trackInventory: true,
    preserveStockOnEdit: false,
    draftQuantity: 20
  });
  assert.deepEqual(createStock, {
    quantity: 20,
    openingStock: 20,
    currentStock: 20
  });

  const editStock = resolveUpsertStockValues({
    trackInventory: true,
    preserveStockOnEdit: true,
    draftQuantity: 99,
    existingCurrentStock: 6,
    existingOpeningStock: 30
  });
  assert.deepEqual(editStock, {
    quantity: 6,
    openingStock: 30,
    currentStock: 6
  });
});

console.log("Low-stock regression test passed.");
