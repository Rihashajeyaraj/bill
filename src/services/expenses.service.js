import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function getAll() {
  return lsGet(LS_KEYS.expenses, []);
}
function setAll(list) {
  lsSet(LS_KEYS.expenses, list);
}

export function expensesList() {
  return getAll();
}

export function expensesCreate(expense) {
  const id = uid("exp_");
  const next = { ...expense, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);
  return id;
}
