import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function getAll() {
  return lsGet(LS_KEYS.purchases, []);
}
function setAll(list) {
  lsSet(LS_KEYS.purchases, list);
}

export function purchasesList() {
  return getAll();
}

export function purchasesCreate(bill) {
  const id = uid("pur_");
  const next = { ...bill, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);
  return id;
}
