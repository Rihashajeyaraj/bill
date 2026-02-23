import { LS_KEYS, lsGet, lsSet, uid } from "./storage";
import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAll() {
  return lsGet(LS_KEYS.creditNotes, []);
}

function setAll(list) {
  lsSet(LS_KEYS.creditNotes, list);
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
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

export async function creditNotesSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return creditNotesList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return creditNotesList();

  const { data: notes, error } = await supabase
    .from("credit_notes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("credit_note_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load credit notes"));
  }

  const mapped = (Array.isArray(notes) ? notes : []).map((row) => {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      id: row?.id || uid("crn_"),
      creditNoteNo: row?.credit_note_no || "",
      creditDate: row?.credit_note_date || "",
      partyId: row?.party_id || "",
      referenceInvoiceId: row?.related_invoice_id || "",
      referenceInvoiceNo: metadata?.referenceInvoiceNo || "",
      reason: row?.reason || "",
      status: row?.status || "draft",
      country: metadata?.country || "",
      totals: {
        tax: parseNumber(row?.tax_total),
        grandTotal: parseNumber(row?.grand_total)
      },
      lines: Array.isArray(metadata?.lines) ? metadata.lines : [],
      created_at: row?.created_at || new Date().toISOString()
    };
  });

  setAll(mapped);
  return mapped;
}

function findInvoiceRowId(note) {
  if (!supabase) return null;
  if (looksLikeUuid(note?.linkedInvoiceId || note?.referenceInvoiceId)) {
    return note.linkedInvoiceId || note.referenceInvoiceId;
  }
  return null;
}

export async function creditNotesSaveRemote(note) {
  if (!isSupabaseConfigured || !supabase) return null;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return null;

  const actorUserId = authGetUser()?.id || null;
  const totals = note?.totals || {};
  const grandTotal = parseNumber(totals?.total ?? totals?.grandTotal);
  const taxTotal = parseNumber(totals?.taxTotal ?? totals?.tax);
  const desiredStatus = String(note?.status || note?.desiredStatus || "Draft").toLowerCase();
  const status = desiredStatus === "applied" ? "applied" : desiredStatus === "issued" ? "issued" : "draft";
  const creditNoteNo = note?.creditNoteNo || `CN-${Date.now()}`;

  let relatedInvoiceId = findInvoiceRowId(note);
  if (!relatedInvoiceId && note?.linkedInvoiceNo) {
    const { data: linked } = await supabase
      .from("invoices")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("invoice_no", note.linkedInvoiceNo)
      .maybeSingle();
    relatedInvoiceId = linked?.id || null;
  }

  const payload = {
    organization_id: organizationId,
    credit_note_no: creditNoteNo,
    credit_note_date: note?.creditNoteDate || note?.creditDate || new Date().toISOString().slice(0, 10),
    party_id: looksLikeUuid(note?.customerId || note?.partyId) ? note.customerId || note.partyId : null,
    related_invoice_id: relatedInvoiceId,
    reason: note?.reason || "",
    taxable_total: parseNumber(totals?.subtotal),
    cgst_total: parseNumber(totals?.cgst),
    sgst_total: parseNumber(totals?.sgst),
    igst_total: parseNumber(totals?.igst),
    vat_total: parseNumber(totals?.vat),
    tax_total: taxTotal,
    grand_total: grandTotal,
    status,
    metadata: {
      country: note?.country || "",
      customerName: note?.customerName || note?.partyName || "",
      referenceInvoiceNo: note?.linkedInvoiceNo || note?.referenceInvoiceNo || "",
      lines: Array.isArray(note?.lines) ? note.lines : []
    },
    created_by: actorUserId
  };

  const { data: header, error: headerError } = await supabase
    .from("credit_notes")
    .upsert(payload, { onConflict: "organization_id,credit_note_no" })
    .select("*")
    .single();

  if (headerError) {
    throw new Error(normalizeSupabaseError(headerError, "Failed to save credit note"));
  }

  const { error: deleteItemsError } = await supabase
    .from("credit_note_items")
    .delete()
    .eq("credit_note_id", header.id);
  if (deleteItemsError) {
    throw new Error(normalizeSupabaseError(deleteItemsError, "Failed to refresh credit note items"));
  }

  const lines = Array.isArray(note?.lines) ? note.lines : [];
  if (lines.length) {
    const remoteLines = lines.map((line, index) => ({
      credit_note_id: header.id,
      item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
      description: line?.itemName || line?.description || `Line ${index + 1}`,
      qty: parseNumber(line?.qty ?? line?.quantity),
      unit_price: parseNumber(line?.rate ?? line?.unitPrice),
      tax_rate: parseNumber(line?.taxRate ?? line?.tax),
      line_total: parseNumber(line?.creditAmount ?? line?.amountAfterTax ?? line?.amount)
    }));
    const { error: insertItemsError } = await supabase.from("credit_note_items").insert(remoteLines);
    if (insertItemsError) {
      throw new Error(normalizeSupabaseError(insertItemsError, "Failed to save credit note items"));
    }
  }

  return header;
}

export function creditNotesCreate(note) {
  const id = uid("crn_");
  const next = { ...note, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);

  if (note.returnToStock) updateStock(note.lines || []);

  void creditNotesSaveRemote(next);

  return id;
}
