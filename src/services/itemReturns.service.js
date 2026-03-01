import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped } from "./storage";

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.itemReturnActions, []);
}

function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.itemReturnActions, list);
}

function nowIso() {
  return new Date().toISOString();
}

export function listItemReturnActions() {
  return getAll();
}

export function getItemReturnAction(returnRef) {
  if (!returnRef) return null;
  return getAll().find((entry) => String(entry?.returnRef || "") === String(returnRef)) || null;
}

export function saveItemReturnAction(action) {
  const returnRef = String(action?.returnRef || "").trim();
  if (!returnRef) {
    throw new Error("Return reference is required.");
  }

  const list = getAll();
  const idx = list.findIndex((entry) => String(entry?.returnRef || "") === returnRef);
  const next = {
    returnRef,
    action: String(action?.action || "PENDING"),
    supplierId: String(action?.supplierId || "").trim(),
    resellCustomerName: String(action?.resellCustomerName || "").trim(),
    resellPrice: Number(action?.resellPrice || 0) || 0,
    notes: String(action?.notes || "").trim(),
    updatedAt: nowIso()
  };

  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      ...next
    };
    setAll(list);
    return list[idx];
  }

  const created = {
    ...next,
    createdAt: nowIso()
  };
  setAll([created, ...list]);
  return created;
}
