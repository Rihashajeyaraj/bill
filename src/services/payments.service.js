import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function getAll() {
  return lsGet(LS_KEYS.payments, []);
}
function setAll(list) {
  lsSet(LS_KEYS.payments, list);
}

export function paymentsList() {
  return getAll();
}

export function paymentsCreate(payment) {
  const id = uid("pay_");
  const next = { ...payment, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);
  return id;
}
