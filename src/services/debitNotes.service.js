import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isMissingColumnError(error) {
  return String(error?.code || "").toUpperCase() === "42703";
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "applied") return "applied";
  if (raw === "issued") return "issued";
  return "draft";
}

async function fetchExistingRemoteNoteId(organizationId, debitNoteNo) {
  const { data, error } = await supabase
    .from("debit_notes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("debit_note_no", debitNoteNo)
    .maybeSingle();
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to check existing debit note"));
  }
  return data?.id || null;
}

async function fetchAppliedDebitItemRows(organizationId, relatedBillId, existingNoteId) {
  const { data: noteRows, error: noteError } = await supabase
    .from("debit_notes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("related_bill_id", relatedBillId)
    .eq("status", "applied");
  if (noteError) {
    throw new Error(normalizeSupabaseError(noteError, "Failed to load applied debit notes"));
  }

  const appliedIds = (Array.isArray(noteRows) ? noteRows : [])
    .map((row) => row?.id)
    .filter(Boolean)
    .filter((id) => String(id) !== String(existingNoteId || ""));
  if (!appliedIds.length) return [];

  let rowsResult = await supabase
    .from("debit_note_items")
    .select("debit_note_id,item_id,qty,source_purchase_bill_item_id")
    .in("debit_note_id", appliedIds);
  if (rowsResult.error && isMissingColumnError(rowsResult.error)) {
    rowsResult = await supabase
      .from("debit_note_items")
      .select("debit_note_id,item_id,qty")
      .in("debit_note_id", appliedIds);
  }
  if (rowsResult.error) {
    throw new Error(normalizeSupabaseError(rowsResult.error, "Failed to load applied debit quantities"));
  }
  return Array.isArray(rowsResult.data) ? rowsResult.data : [];
}

async function validateDebitNoteRemoteLimits({
  organizationId,
  relatedBillId,
  existingNoteId,
  lines
}) {
  if (!relatedBillId) {
    throw new Error("Linked purchase bill is required to save this debit note.");
  }

  const { data: purchaseRows, error: purchaseError } = await supabase
    .from("purchase_bill_items")
    .select("id,item_id,qty")
    .eq("bill_id", relatedBillId);
  if (purchaseError) {
    throw new Error(normalizeSupabaseError(purchaseError, "Failed to load bill lines for debit note validation"));
  }
  const sourceLineById = new Map();
  const qtyByItem = new Map();
  (Array.isArray(purchaseRows) ? purchaseRows : []).forEach((row) => {
    const sourceId = String(row?.id || "").trim();
    if (sourceId) sourceLineById.set(sourceId, row);
    const itemId = String(row?.item_id || "").trim();
    if (!itemId) return;
    const qty = Math.max(0, parseNumber(row?.qty));
    qtyByItem.set(itemId, (qtyByItem.get(itemId) || 0) + qty);
  });

  const appliedRows = await fetchAppliedDebitItemRows(organizationId, relatedBillId, existingNoteId);
  const appliedQtyBySource = new Map();
  const appliedQtyByItem = new Map();
  appliedRows.forEach((row) => {
    const qty = Math.max(0, parseNumber(row?.qty));
    if (!qty) return;
    const sourceId = String(row?.source_purchase_bill_item_id || "").trim();
    if (sourceId) {
      appliedQtyBySource.set(sourceId, (appliedQtyBySource.get(sourceId) || 0) + qty);
    }
    const itemId = String(row?.item_id || "").trim();
    if (itemId) {
      appliedQtyByItem.set(itemId, (appliedQtyByItem.get(itemId) || 0) + qty);
    }
  });

  const requestedBySource = new Map();
  const requestedByItem = new Map();
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const qty = Math.max(0, parseNumber(line?.qty ?? line?.quantity));
    if (!qty) return;
    const sourceId = String(line?.sourcePurchaseItemId || line?.source_purchase_bill_item_id || "").trim();
    const itemId = String(line?.itemId || line?.item_id || "").trim();
    if (sourceId) {
      requestedBySource.set(sourceId, (requestedBySource.get(sourceId) || 0) + qty);
      return;
    }
    if (itemId) {
      requestedByItem.set(itemId, (requestedByItem.get(itemId) || 0) + qty);
      return;
    }
    throw new Error("Each debit note line must be linked to a source bill line.");
  });

  for (const [sourceId, requestedQty] of requestedBySource.entries()) {
    const sourceLine = sourceLineById.get(sourceId);
    if (!sourceLine) {
      throw new Error(`Debit note includes an invalid source bill line (${sourceId}).`);
    }
    const sourceQty = Math.max(0, parseNumber(sourceLine?.qty));
    const alreadyDebited = Math.max(0, parseNumber(appliedQtyBySource.get(sourceId) || 0));
    const availableQty = Math.max(0, sourceQty - alreadyDebited);
    if (requestedQty > availableQty + 1e-6) {
      throw new Error(`Debit quantity ${requestedQty} exceeds available ${availableQty} for a linked bill line.`);
    }
  }

  for (const [itemId, requestedQty] of requestedByItem.entries()) {
    if (!qtyByItem.has(itemId)) {
      throw new Error(`Debit note item ${itemId} is not present on the linked bill.`);
    }
    const sourceQty = Math.max(0, parseNumber(qtyByItem.get(itemId) || 0));
    const alreadyDebited = Math.max(0, parseNumber(appliedQtyByItem.get(itemId) || 0));
    const availableQty = Math.max(0, sourceQty - alreadyDebited);
    if (requestedQty > availableQty + 1e-6) {
      throw new Error(`Debit quantity ${requestedQty} exceeds available ${availableQty} for this bill item.`);
    }
  }
}

async function resolveRelatedBillId(organizationId, note) {
  const directId = note?.linkedPurchaseInvoiceId || note?.relatedBillId || note?.billId;
  if (looksLikeUuid(directId)) return directId;

  const billNo = note?.linkedPurchaseInvoiceNo || note?.billNo;
  if (!billNo || !supabase) return null;

  const { data } = await supabase
    .from("purchase_bills")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("bill_no", billNo)
    .maybeSingle();
  return data?.id || null;
}

export async function debitNotesSaveRemote(note) {
  if (!isSupabaseConfigured || !supabase || !note) return null;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return null;

  const actorUserId = authGetUser()?.id || null;
  const totals = note?.totals || {};
  const debitNoteNo = note?.debitNoteNo || `DN-${Date.now()}`;
  const status = normalizeStatus(note?.status || note?.desiredStatus || "Draft");
  const existingNoteId = await fetchExistingRemoteNoteId(organizationId, debitNoteNo);
  const relatedBillId = await resolveRelatedBillId(organizationId, note);
  await validateDebitNoteRemoteLimits({
    organizationId,
    relatedBillId,
    existingNoteId,
    lines: Array.isArray(note?.lines) ? note.lines : []
  });

  const payload = {
    organization_id: organizationId,
    debit_note_no: debitNoteNo,
    debit_note_date: note?.debitNoteDate || new Date().toISOString().slice(0, 10),
    supplier_id: looksLikeUuid(note?.supplierId) ? note.supplierId : null,
    related_bill_id: relatedBillId,
    reason: note?.reason || "",
    taxable_total: parseNumber(totals?.subtotal),
    tax_total: parseNumber(totals?.taxTotal),
    grand_total: parseNumber(totals?.total),
    status,
    metadata: {
      country: note?.country || "",
      supplierName: note?.supplierName || "",
      linkedPurchaseInvoiceNo: note?.linkedPurchaseInvoiceNo || "",
      lines: Array.isArray(note?.lines) ? note.lines : []
    },
    created_by: actorUserId
  };

  const { data: header, error: headerError } = await supabase
    .from("debit_notes")
    .upsert(payload, { onConflict: "organization_id,debit_note_no" })
    .select("*")
    .single();

  if (headerError) {
    throw new Error(normalizeSupabaseError(headerError, "Failed to save debit note"));
  }

  const { error: deleteItemsError } = await supabase
    .from("debit_note_items")
    .delete()
    .eq("debit_note_id", header.id);
  if (deleteItemsError) {
    throw new Error(normalizeSupabaseError(deleteItemsError, "Failed to refresh debit note items"));
  }

  const lines = Array.isArray(note?.lines) ? note.lines : [];
  if (lines.length) {
    const remoteLines = lines.map((line, index) => ({
      debit_note_id: header.id,
      item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
      source_purchase_bill_item_id: looksLikeUuid(line?.sourcePurchaseItemId)
        ? line.sourcePurchaseItemId
        : null,
      description: line?.itemName || line?.description || `Line ${index + 1}`,
      qty: parseNumber(line?.qty ?? line?.quantity),
      unit_price: parseNumber(line?.rate ?? line?.unitPrice),
      tax_rate: parseNumber(line?.taxRate ?? line?.tax),
      line_total: parseNumber(line?.debitAmount ?? line?.amountAfterTax ?? line?.amount)
    }));
    let insertResult = await supabase.from("debit_note_items").insert(remoteLines);
    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      const fallbackLines = remoteLines.map(({ source_purchase_bill_item_id, ...row }) => row);
      insertResult = await supabase.from("debit_note_items").insert(fallbackLines);
    }
    if (insertResult.error) {
      throw new Error(normalizeSupabaseError(insertResult.error, "Failed to save debit note items"));
    }
  }

  return header;
}

export async function debitNotesDeleteRemote(note) {
  if (!isSupabaseConfigured || !supabase || !note) return null;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return null;

  let noteId = looksLikeUuid(note?.id) ? note.id : null;
  if (!noteId && note?.debitNoteNo) {
    noteId = await fetchExistingRemoteNoteId(organizationId, note.debitNoteNo);
  }
  if (!noteId) return null;

  const { error: deleteItemsError } = await supabase
    .from("debit_note_items")
    .delete()
    .eq("debit_note_id", noteId);
  if (deleteItemsError) {
    throw new Error(normalizeSupabaseError(deleteItemsError, "Failed to delete debit note items"));
  }

  const { error: deleteHeaderError } = await supabase
    .from("debit_notes")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", noteId);
  if (deleteHeaderError) {
    throw new Error(normalizeSupabaseError(deleteHeaderError, "Failed to delete debit note"));
  }

  return noteId;
}
