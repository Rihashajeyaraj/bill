import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function getAll() {
  return lsGet(LS_KEYS.invoices, []);
}
function setAll(list) {
  lsSet(LS_KEYS.invoices, list);
}

export function invoicesList() {
  return getAll();
}

export function invoicesCreate(invoice) {
  const id = uid("inv_");
  const next = { ...invoice, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);
  return id;
}
