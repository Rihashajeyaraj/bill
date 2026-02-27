import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.creditNotes, []);
}

function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.creditNotes, list);
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

function isMissingColumnError(error) {
  return String(error?.code || "").toUpperCase() === "42703";
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "applied") return "applied";
  if (raw === "issued") return "issued";
  return "draft";
}

async function fetchExistingRemoteNoteId(organizationId, creditNoteNo) {
  const { data, error } = await supabase
    .from("credit_notes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("credit_note_no", creditNoteNo)
    .maybeSingle();
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to check existing credit note"));
  }
  return data?.id || null;
}

async function fetchInvoiceLinesForCreditValidation(relatedInvoiceId) {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("id,item_id,qty,cogs_unit_cost,unit_price,tax_rate")
    .eq("invoice_id", relatedInvoiceId);
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load invoice lines for credit note validation"));
  }
  return Array.isArray(data) ? data : [];
}

async function fetchAppliedCreditNoteItemRows(organizationId, relatedInvoiceId, existingNoteId) {
  const { data: noteRows, error: noteError } = await supabase
    .from("credit_notes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("related_invoice_id", relatedInvoiceId)
    .eq("status", "applied");
  if (noteError) {
    throw new Error(normalizeSupabaseError(noteError, "Failed to load applied credit notes"));
  }
  const appliedNoteIds = (Array.isArray(noteRows) ? noteRows : [])
    .map((row) => row?.id)
    .filter(Boolean)
    .filter((id) => String(id) !== String(existingNoteId || ""));
  if (!appliedNoteIds.length) return [];

  let itemRowsResult = await supabase
    .from("credit_note_items")
    .select("credit_note_id,item_id,qty,source_invoice_item_id")
    .in("credit_note_id", appliedNoteIds);
  if (itemRowsResult.error && isMissingColumnError(itemRowsResult.error)) {
    itemRowsResult = await supabase
      .from("credit_note_items")
      .select("credit_note_id,item_id,qty")
      .in("credit_note_id", appliedNoteIds);
  }
  if (itemRowsResult.error) {
    throw new Error(normalizeSupabaseError(itemRowsResult.error, "Failed to load applied credit note quantities"));
  }
  return Array.isArray(itemRowsResult.data) ? itemRowsResult.data : [];
}

async function validateCreditNoteRemoteLimits({
  organizationId,
  relatedInvoiceId,
  existingNoteId,
  lines,
  grandTotal,
  status
}) {
  if (!relatedInvoiceId) {
    throw new Error("Linked invoice is required to save this credit note.");
  }

  const invoiceLines = await fetchInvoiceLinesForCreditValidation(relatedInvoiceId);
  const sourceLineById = new Map();
  const qtyByItem = new Map();
  invoiceLines.forEach((row) => {
    const sourceId = String(row?.id || "").trim();
    if (sourceId) sourceLineById.set(sourceId, row);
    const itemId = String(row?.item_id || "").trim();
    if (!itemId) return;
    const qty = Math.max(0, parseNumber(row?.qty));
    qtyByItem.set(itemId, (qtyByItem.get(itemId) || 0) + qty);
  });

  const appliedRows = await fetchAppliedCreditNoteItemRows(organizationId, relatedInvoiceId, existingNoteId);
  const appliedQtyBySource = new Map();
  const appliedQtyByItem = new Map();
  appliedRows.forEach((row) => {
    const qty = Math.max(0, parseNumber(row?.qty));
    if (!qty) return;
    const sourceId = String(row?.source_invoice_item_id || "").trim();
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
    const sourceId = String(line?.sourceInvoiceItemId || line?.source_invoice_item_id || "").trim();
    const itemId = String(line?.itemId || line?.item_id || "").trim();
    if (sourceId) {
      requestedBySource.set(sourceId, (requestedBySource.get(sourceId) || 0) + qty);
      return;
    }
    if (itemId) {
      requestedByItem.set(itemId, (requestedByItem.get(itemId) || 0) + qty);
      return;
    }
    throw new Error("Each credit note line must be linked to a source invoice line.");
  });

  for (const [sourceId, requestedQty] of requestedBySource.entries()) {
    const sourceLine = sourceLineById.get(sourceId);
    if (!sourceLine) {
      throw new Error(`Credit note includes an invalid source invoice line (${sourceId}).`);
    }
    const sourceQty = Math.max(0, parseNumber(sourceLine?.qty));
    const alreadyCredited = Math.max(0, parseNumber(appliedQtyBySource.get(sourceId) || 0));
    const availableQty = Math.max(0, sourceQty - alreadyCredited);
    if (requestedQty > availableQty + 1e-6) {
      throw new Error(`Credit quantity ${requestedQty} exceeds available ${availableQty} for a linked invoice line.`);
    }
  }

  for (const [itemId, requestedQty] of requestedByItem.entries()) {
    if (!qtyByItem.has(itemId)) {
      throw new Error(`Credit note item ${itemId} is not present on the linked invoice.`);
    }
    const sourceQty = Math.max(0, parseNumber(qtyByItem.get(itemId) || 0));
    const alreadyCredited = Math.max(0, parseNumber(appliedQtyByItem.get(itemId) || 0));
    const availableQty = Math.max(0, sourceQty - alreadyCredited);
    if (requestedQty > availableQty + 1e-6) {
      throw new Error(`Credit quantity ${requestedQty} exceeds available ${availableQty} for this invoice item.`);
    }
  }

  if (status !== "applied") return;

  const { data: invoiceHeader, error: invoiceError } = await supabase
    .from("invoices")
    .select("id,grand_total")
    .eq("organization_id", organizationId)
    .eq("id", relatedInvoiceId)
    .maybeSingle();
  if (invoiceError) {
    throw new Error(normalizeSupabaseError(invoiceError, "Failed to validate invoice balance"));
  }
  if (!invoiceHeader?.id) {
    throw new Error("Linked invoice was not found.");
  }

  const { data: paymentRows, error: paymentError } = await supabase
    .from("payments")
    .select("amount,status")
    .eq("organization_id", organizationId)
    .eq("direction", "in")
    .eq("invoice_id", relatedInvoiceId);
  if (paymentError) {
    throw new Error(normalizeSupabaseError(paymentError, "Failed to validate invoice payments"));
  }
  const paidAmount = (Array.isArray(paymentRows) ? paymentRows : []).reduce((sum, row) => {
    const paymentStatus = String(row?.status || "").toLowerCase();
    if (paymentStatus === "draft" || paymentStatus === "cancelled") return sum;
    return sum + Math.max(0, parseNumber(row?.amount));
  }, 0);

  const { data: appliedCredits, error: creditError } = await supabase
    .from("credit_notes")
    .select("id,grand_total,status")
    .eq("organization_id", organizationId)
    .eq("related_invoice_id", relatedInvoiceId)
    .eq("status", "applied");
  if (creditError) {
    throw new Error(normalizeSupabaseError(creditError, "Failed to validate applied credits"));
  }
  const alreadyCreditedAmount = (Array.isArray(appliedCredits) ? appliedCredits : []).reduce((sum, row) => {
    if (String(row?.id || "") === String(existingNoteId || "")) return sum;
    return sum + Math.max(0, parseNumber(row?.grand_total));
  }, 0);

  const availableAmount = Math.max(
    0,
    Math.max(0, parseNumber(invoiceHeader?.grand_total)) - paidAmount - alreadyCreditedAmount
  );
  if (Math.max(0, parseNumber(grandTotal)) > availableAmount + 0.01) {
    throw new Error(
      `Credit amount ${parseNumber(grandTotal).toFixed(2)} exceeds invoice balance ${availableAmount.toFixed(2)}.`
    );
  }
}

async function applyCreditNoteReturnToStock({
  organizationId,
  header,
  noteLines
}) {
  const sourceId = header?.id;
  if (!sourceId || !Array.isArray(noteLines) || !noteLines.length) return;

  const { data: existingMoves, error: existingMovesError } = await supabase
    .from("stock_movements")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source_table", "credit_notes")
    .eq("source_id", sourceId)
    .limit(1);
  if (existingMovesError) {
    throw new Error(normalizeSupabaseError(existingMovesError, "Failed to verify existing stock returns"));
  }
  if (Array.isArray(existingMoves) && existingMoves.length) {
    return;
  }

  const itemIds = Array.from(
    new Set(
      noteLines
        .map((line) => String(line?.item_id || "").trim())
        .filter(Boolean)
    )
  );
  if (!itemIds.length) return;

  const { data: itemRows, error: itemError } = await supabase
    .from("items")
    .select("id,purchase_price")
    .eq("organization_id", organizationId)
    .in("id", itemIds);
  if (itemError) {
    throw new Error(normalizeSupabaseError(itemError, "Failed to load item costs for stock return"));
  }
  const purchaseCostByItem = new Map(
    (Array.isArray(itemRows) ? itemRows : []).map((row) => [String(row?.id || ""), parseNumber(row?.purchase_price)])
  );

  const invoiceItemCostById = new Map();
  if (header?.related_invoice_id) {
    const { data: invoiceItems, error: invoiceItemError } = await supabase
      .from("invoice_items")
      .select("id,item_id,cogs_unit_cost")
      .eq("invoice_id", header.related_invoice_id);
    if (invoiceItemError) {
      throw new Error(normalizeSupabaseError(invoiceItemError, "Failed to load invoice cost details for stock return"));
    }
    (Array.isArray(invoiceItems) ? invoiceItems : []).forEach((row) => {
      invoiceItemCostById.set(String(row?.id || ""), parseNumber(row?.cogs_unit_cost));
    });
  }

  for (const line of noteLines) {
    const itemId = String(line?.item_id || "").trim();
    const qty = Math.max(0, parseNumber(line?.qty));
    if (!itemId || qty <= 0) continue;
    const sourceInvoiceItemId = String(line?.source_invoice_item_id || "").trim();
    const sourceCost = sourceInvoiceItemId ? parseNumber(invoiceItemCostById.get(sourceInvoiceItemId)) : 0;
    const unitCostExcl = sourceCost > 0 ? sourceCost : parseNumber(purchaseCostByItem.get(itemId));
    const unitCostIncl = unitCostExcl;

    const { data: batchRow, error: batchError } = await supabase
      .from("stock_batches")
      .insert({
        organization_id: organizationId,
        item_id: itemId,
        purchase_bill_id: null,
        purchase_bill_item_id: null,
        batch_date: header?.credit_note_date || new Date().toISOString().slice(0, 10),
        source_document_no: header?.credit_note_no || "CREDIT_RETURN",
        qty_purchased: qty,
        qty_remaining: qty,
        unit_cost_excl_tax: unitCostExcl,
        unit_cost_incl_tax: unitCostIncl,
        tax_rate: 0,
        tax_amount: 0,
        tax_inclusive: false,
        metadata: {
          source: "credit_note_return",
          creditNoteId: header?.id || null,
          creditNoteItemId: line?.id || null
        },
        created_by: authGetUser()?.id || null
      })
      .select("id")
      .single();
    if (batchError) {
      throw new Error(normalizeSupabaseError(batchError, "Failed to create stock return batch"));
    }

    const { error: movementError } = await supabase.from("stock_movements").insert({
      organization_id: organizationId,
      item_id: itemId,
      stock_batch_id: batchRow?.id || null,
      movement_type: "IN",
      movement_date: header?.credit_note_date || new Date().toISOString().slice(0, 10),
      quantity_delta: qty,
      unit_cost_excl_tax: unitCostExcl,
      unit_cost_incl_tax: unitCostIncl,
      source_table: "credit_notes",
      source_id: header?.id || null,
      source_item_id: line?.id || null,
      source_document_no: header?.credit_note_no || "",
      notes: "Credit note return in",
      metadata: {
        source: "credit_note_return"
      },
      created_by: authGetUser()?.id || null
    });
    if (movementError) {
      throw new Error(normalizeSupabaseError(movementError, "Failed to create stock return movement"));
    }
  }
}

function updateStock(lines) {
  const items = lsGetOrganizationScoped(LS_KEYS.items, []);
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
  lsSetOrganizationScoped(LS_KEYS.items, next);
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
  const status = normalizeStatus(note?.status || note?.desiredStatus || "Draft");
  const creditNoteNo = note?.creditNoteNo || `CN-${Date.now()}`;
  const existingNoteId = await fetchExistingRemoteNoteId(organizationId, creditNoteNo);

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

  await validateCreditNoteRemoteLimits({
    organizationId,
    relatedInvoiceId,
    existingNoteId,
    lines: Array.isArray(note?.lines) ? note.lines : [],
    grandTotal,
    status
  });

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
  let insertedLineRows = [];
  if (lines.length) {
    const remoteLines = lines.map((line, index) => ({
      credit_note_id: header.id,
      item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
      source_invoice_item_id: looksLikeUuid(line?.sourceInvoiceItemId) ? line.sourceInvoiceItemId : null,
      description: line?.itemName || line?.description || `Line ${index + 1}`,
      qty: parseNumber(line?.qty ?? line?.quantity),
      unit_price: parseNumber(line?.rate ?? line?.unitPrice),
      tax_rate: parseNumber(line?.taxRate ?? line?.tax),
      line_total: parseNumber(line?.creditAmount ?? line?.amountAfterTax ?? line?.amount)
    }));
    let insertResult = await supabase
      .from("credit_note_items")
      .insert(remoteLines)
      .select("id,item_id,qty,source_invoice_item_id");
    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      const fallbackLines = remoteLines.map(({ source_invoice_item_id, ...row }) => row);
      insertResult = await supabase
        .from("credit_note_items")
        .insert(fallbackLines)
        .select("id,item_id,qty");
    }
    if (insertResult.error) {
      throw new Error(normalizeSupabaseError(insertResult.error, "Failed to save credit note items"));
    }
    insertedLineRows = Array.isArray(insertResult.data) ? insertResult.data : [];
  }

  if (status === "applied" && note?.returnToStock) {
    await applyCreditNoteReturnToStock({
      organizationId,
      header,
      noteLines: insertedLineRows
    });
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
