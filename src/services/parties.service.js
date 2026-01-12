import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function getAll() {
  return lsGet(LS_KEYS.parties, []);
}
function setAll(list) {
  lsSet(LS_KEYS.parties, list);
}

export function partiesList() {
  return getAll();
}

export function partiesUpsert(party) {
  const list = getAll();
  if (party.id) {
    const idx = list.findIndex((p) => p.id === party.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...party };
    setAll(list);
    return party.id;
  }
  const id = uid("pty_");
  setAll([{ ...party, id, created_at: new Date().toISOString() }, ...list]);
  return id;
}

export function partiesRemove(id) {
  setAll(getAll().filter((p) => p.id !== id));
}

export function partiesByType(type) {
  return getAll().filter((p) => p.type === type);
}

export function partyGet(id) {
  return getAll().find((p) => p.id === id) || null;
}
