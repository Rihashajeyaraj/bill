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
  const statusRaw = String(note?.status || note?.desiredStatus || "Draft").toLowerCase();
  const status = statusRaw === "applied" ? "applied" : statusRaw === "issued" ? "issued" : "draft";
  const relatedBillId = await resolveRelatedBillId(organizationId, note);

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
      description: line?.itemName || line?.description || `Line ${index + 1}`,
      qty: parseNumber(line?.qty ?? line?.quantity),
      unit_price: parseNumber(line?.rate ?? line?.unitPrice),
      tax_rate: parseNumber(line?.taxRate ?? line?.tax),
      line_total: parseNumber(line?.debitAmount ?? line?.amountAfterTax ?? line?.amount)
    }));
    const { error: insertItemsError } = await supabase.from("debit_note_items").insert(remoteLines);
    if (insertItemsError) {
      throw new Error(normalizeSupabaseError(insertItemsError, "Failed to save debit note items"));
    }
  }

  return header;
}
