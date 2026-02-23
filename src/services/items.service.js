import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.items, []);
}
function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.items, list);
}

export function itemsList() {
  return getAll();
}

export function itemsUpsert(item) {
  const list = getAll();
  if (item.id) {
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...item };
    setAll(list);
    return item.id;
  }
  const id = uid("itm_");
  setAll([{ ...item, id, created_at: new Date().toISOString() }, ...list]);
  return id;
}

export function itemsRemove(id) {
  setAll(getAll().filter((x) => x.id !== id));
}
