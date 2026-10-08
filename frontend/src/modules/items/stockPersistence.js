function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNonNegative(value) {
  return Math.max(0, toNumber(value));
}

export function resolveLowStockAlertValue(raw = {}, metadata = {}) {
  return toNonNegative(
    raw?.lowStockAlert ?? raw?.lowStockQty ?? metadata?.lowStockQty ?? metadata?.lowStockAlert
  );
}

export function resolveUpsertStockValues({
  trackInventory,
  preserveStockOnEdit = false,
  draftQuantity,
  draftCurrentStock,
  draftOpeningStock,
  existingCurrentStock,
  existingOpeningStock
}) {
  if (!trackInventory) {
    return {
      quantity: 0,
      openingStock: 0,
      currentStock: 0
    };
  }

  const draftQuantityValue = toNonNegative(draftQuantity ?? draftCurrentStock ?? draftOpeningStock);
  if (!preserveStockOnEdit) {
    return {
      quantity: draftQuantityValue,
      openingStock: draftQuantityValue,
      currentStock: draftQuantityValue
    };
  }

  const currentStock = toNonNegative(existingCurrentStock ?? draftQuantityValue);
  const openingStock = toNonNegative(existingOpeningStock ?? draftQuantityValue);
  return {
    quantity: currentStock,
    openingStock,
    currentStock
  };
}
