import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function getAll() {
  return lsGet(LS_KEYS.creditNotes, []);
}

function setAll(list) {
  lsSet(LS_KEYS.creditNotes, list);
}

function updateInvoiceBalance(referenceInvoiceId, creditTotal, creditNoteId) {
  const invoices = lsGet(LS_KEYS.invoices, []);
  const idx = invoices.findIndex((inv) => inv.id === referenceInvoiceId);
  if (idx < 0) return;
  const current = invoices[idx];
  const baseBalance = Number(
    current?.totals?.balance ?? current?.totals?.grandTotal ?? current?.totals?.total ?? 0
  );
  const nextBalance = Math.max(0, baseBalance - Number(creditTotal || 0));
  invoices[idx] = {
    ...current,
    totals: { ...(current.totals || {}), balance: nextBalance },
    lastCreditNoteId: creditNoteId
  };
  lsSet(LS_KEYS.invoices, invoices);
}

function updateCustomerBalance(partyId, creditTotal) {
  if (!partyId) return;
  const parties = lsGet(LS_KEYS.parties, []);
  const idx = parties.findIndex((p) => p.id === partyId);
  if (idx < 0) return;
  const balance = Number(parties[idx].balance || 0);
  parties[idx] = { ...parties[idx], balance: balance - Number(creditTotal || 0) };
  lsSet(LS_KEYS.parties, parties);
}

function updateStock(lines) {
  const items = lsGet(LS_KEYS.items, []);
  if (!items.length || !Array.isArray(lines)) return;
  const byId = lines.reduce((acc, line) => {
    if (!line.itemId) return acc;
    const qty = Number(line.qty || 0);
    if (!qty) return acc;
    acc[line.itemId] = (acc[line.itemId] || 0) + qty;
    return acc;
  }, {});
  const next = items.map((item) => {
    const addQty = byId[item.id];
    if (!addQty) return item;
    return { ...item, stockQty: Number(item.stockQty || 0) + addQty };
  });
  lsSet(LS_KEYS.items, next);
}

export function creditNotesList() {
  return getAll();
}

export function creditNotesCreate(note) {
  const id = uid("crn_");
  const next = { ...note, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);

  updateInvoiceBalance(note.referenceInvoiceId, note?.totals?.grandTotal || 0, id);
  updateCustomerBalance(note.partyId, note?.totals?.grandTotal || 0);
  if (note.returnToStock) updateStock(note.lines || []);

  return id;
}
