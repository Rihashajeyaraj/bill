import { LS_KEYS, lsGet, lsSet, uid } from "./storage";
import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAll() {
  return lsGet(LS_KEYS.payments, []);
}
function setAll(list) {
  lsSet(LS_KEYS.payments, list);
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

async function adjustInvoiceBalance(invoiceId, amount, direction) {
  if (!supabase || !invoiceId || !amount) return;
  const { data: row } = await supabase
    .from("invoices")
    .select("id,grand_total,paid_amount,balance_amount")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!row) return;
  const paidBefore = parseNumber(row.paid_amount);
  const delta = Math.max(0, parseNumber(amount)) * direction;
  const nextPaid = Math.max(0, paidBefore + delta);
  const grand = Math.max(0, parseNumber(row.grand_total));
  const nextBalance = Math.max(0, grand - nextPaid);
  const status = nextBalance <= 0 ? "paid" : nextPaid > 0 ? "partial" : "issued";
  await supabase
    .from("invoices")
    .update({ paid_amount: nextPaid, balance_amount: nextBalance, status })
    .eq("id", invoiceId);
}

async function adjustBillBalance(billId, amount, direction) {
  if (!supabase || !billId || !amount) return;
  const { data: row } = await supabase
    .from("purchase_bills")
    .select("id,grand_total,paid_amount,balance_amount")
    .eq("id", billId)
    .maybeSingle();
  if (!row) return;
  const paidBefore = parseNumber(row.paid_amount);
  const delta = Math.max(0, parseNumber(amount)) * direction;
  const nextPaid = Math.max(0, paidBefore + delta);
  const grand = Math.max(0, parseNumber(row.grand_total));
  const nextBalance = Math.max(0, grand - nextPaid);
  const status = nextBalance <= 0 ? "paid" : nextPaid > 0 ? "partial" : "issued";
  await supabase
    .from("purchase_bills")
    .update({ paid_amount: nextPaid, balance_amount: nextBalance, status })
    .eq("id", billId);
}

async function findInvoiceIdByNumber(organizationId, invoiceNo) {
  if (!supabase || !organizationId || !invoiceNo) return null;
  const { data } = await supabase
    .from("invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("invoice_no", invoiceNo)
    .maybeSingle();
  return data?.id || null;
}

async function findBillIdByNumber(organizationId, billNo) {
  if (!supabase || !organizationId || !billNo) return null;
  const { data } = await supabase
    .from("purchase_bills")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("bill_no", billNo)
    .maybeSingle();
  return data?.id || null;
}

export function paymentsList() {
  return getAll();
}

export async function paymentsSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return paymentsList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return paymentsList();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("organization_id", organizationId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load payments"));
  }

  const mapped = (Array.isArray(data) ? data : []).map((row) => ({
    id: row?.id || uid("pay_"),
    date: row?.payment_date || "",
    paymentNo: row?.payment_no || "",
    direction: String(row?.direction || "").toUpperCase(),
    partyId: row?.party_id || "",
    invoiceId: row?.invoice_id || "",
    billId: row?.bill_id || "",
    amount: parseNumber(row?.amount),
    mode: row?.payment_mode || "",
    referenceNo: row?.reference_no || "",
    note: row?.notes || "",
    status: row?.status || "posted",
    created_at: row?.created_at || new Date().toISOString()
  }));

  setAll(mapped);
  return mapped;
}

export function paymentsCreate(payment) {
  const id = uid("pay_");
  const next = { ...payment, id, created_at: new Date().toISOString() };
  setAll([next, ...getAll()]);

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const actorUserId = authGetUser()?.id || null;
      const remotePayload = {
        organization_id: organizationId,
        payment_no: payment?.paymentNo || `PAY-${Date.now()}`,
        payment_date: payment?.date || new Date().toISOString().slice(0, 10),
        direction: String(payment?.direction || "IN").toUpperCase() === "OUT" ? "out" : "in",
        party_id: looksLikeUuid(payment?.partyId) ? payment.partyId : null,
        invoice_id: looksLikeUuid(payment?.invoiceId) ? payment.invoiceId : null,
        bill_id: looksLikeUuid(payment?.billId) ? payment.billId : null,
        amount: parseNumber(payment?.amount),
        payment_mode: payment?.mode || payment?.paymentMode || null,
        reference_no: payment?.referenceNo || payment?.paymentReference || null,
        notes: payment?.note || payment?.notes || null,
        status: "posted",
        created_by: actorUserId
      };
      void supabase.from("payments").insert(remotePayload);
    }
  }

  return id;
}

export async function syncPaymentInRemote(record) {
  if (!isSupabaseConfigured || !supabase || !record) return;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return;

  const actorUserId = authGetUser()?.id || null;
  const sourcePrefix = `PI:${record.id}:`;
  const shouldApply = String(record?.status || "").toLowerCase() === "applied";
  const shouldPost = String(record?.status || "").toLowerCase() !== "draft";

  const { data: existingRows, error: existingError } = await supabase
    .from("payments")
    .select("id,invoice_id,amount")
    .eq("organization_id", organizationId)
    .ilike("reference_no", `${sourcePrefix}%`);
  if (existingError) {
    throw new Error(normalizeSupabaseError(existingError, "Failed to load existing payment-in rows"));
  }

  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    if (row?.invoice_id && parseNumber(row?.amount) > 0) {
      await adjustInvoiceBalance(row.invoice_id, row.amount, -1);
    }
  }

  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("organization_id", organizationId)
    .ilike("reference_no", `${sourcePrefix}%`);
  if (deleteError) {
    throw new Error(normalizeSupabaseError(deleteError, "Failed to refresh payment-in rows"));
  }

  if (!shouldPost) return;

  const rows = [];
  const partyId = looksLikeUuid(record?.customerId) ? record.customerId : null;
  const paymentDate = record?.paymentDate || new Date().toISOString().slice(0, 10);
  const allocations = Array.isArray(record?.allocations) ? record.allocations : [];

  if (shouldApply) {
    for (let index = 0; index < allocations.length; index += 1) {
      const line = allocations[index];
      const amount = Math.max(0, parseNumber(line?.applyAmount));
      if (!amount) continue;
      let invoiceId = looksLikeUuid(line?.invoiceId) ? line.invoiceId : null;
      if (!invoiceId && line?.invoiceNo) {
        invoiceId = await findInvoiceIdByNumber(organizationId, line.invoiceNo);
      }
      rows.push({
        organization_id: organizationId,
        payment_no: record?.receiptNo || `RCPT-${Date.now()}`,
        payment_date: paymentDate,
        direction: "in",
        party_id: partyId,
        invoice_id: invoiceId,
        amount,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}${index + 1}`,
        notes: record?.internalNotes || `Payment in ${record?.status || "received"}`,
        status: "posted",
        created_by: actorUserId
      });
    }

    const unappliedAmount = Math.max(0, parseNumber(record?.totals?.unappliedAmount));
    if (unappliedAmount > 0) {
      rows.push({
        organization_id: organizationId,
        payment_no: record?.receiptNo || `RCPT-${Date.now()}`,
        payment_date: paymentDate,
        direction: "in",
        party_id: partyId,
        invoice_id: null,
        amount: unappliedAmount,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}UNAPPLIED`,
        notes: record?.internalNotes || `Unapplied payment in ${record?.status || "received"}`,
        status: "posted",
        created_by: actorUserId
      });
    }
  } else {
    const amountReceived = Math.max(
      0,
      parseNumber(record?.totals?.amountReceived ?? record?.amountReceived)
    );
    if (amountReceived > 0) {
      rows.push({
        organization_id: organizationId,
        payment_no: record?.receiptNo || `RCPT-${Date.now()}`,
        payment_date: paymentDate,
        direction: "in",
        party_id: partyId,
        invoice_id: null,
        amount: amountReceived,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}RECEIVED`,
        notes: record?.internalNotes || `Payment in ${record?.status || "received"}`,
        status: "posted",
        created_by: actorUserId
      });
    }
  }

  if (rows.length) {
    const { error: insertError } = await supabase.from("payments").insert(rows);
    if (insertError) {
      throw new Error(normalizeSupabaseError(insertError, "Failed to save payment-in rows"));
    }
  }

  if (shouldApply) {
    for (const row of rows) {
      if (row.invoice_id && parseNumber(row.amount) > 0) {
        await adjustInvoiceBalance(row.invoice_id, row.amount, 1);
      }
    }
  }
}

export async function syncPaymentOutRemote(record) {
  if (!isSupabaseConfigured || !supabase || !record) return;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return;

  const actorUserId = authGetUser()?.id || null;
  const sourcePrefix = `PO:${record.id}:`;
  const shouldApply = String(record?.status || "").toLowerCase() === "applied";
  const shouldPost = String(record?.status || "").toLowerCase() !== "draft";

  const { data: existingRows, error: existingError } = await supabase
    .from("payments")
    .select("id,bill_id,amount")
    .eq("organization_id", organizationId)
    .ilike("reference_no", `${sourcePrefix}%`);
  if (existingError) {
    throw new Error(normalizeSupabaseError(existingError, "Failed to load existing payment-out rows"));
  }

  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    if (row?.bill_id && parseNumber(row?.amount) > 0) {
      await adjustBillBalance(row.bill_id, row.amount, -1);
    }
  }

  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("organization_id", organizationId)
    .ilike("reference_no", `${sourcePrefix}%`);
  if (deleteError) {
    throw new Error(normalizeSupabaseError(deleteError, "Failed to refresh payment-out rows"));
  }

  if (!shouldPost) return;

  const rows = [];
  const partyId = looksLikeUuid(record?.supplierId) ? record.supplierId : null;
  const paymentDate = record?.paymentDate || new Date().toISOString().slice(0, 10);
  const allocations = Array.isArray(record?.allocations) ? record.allocations : [];

  if (shouldApply) {
    for (let index = 0; index < allocations.length; index += 1) {
      const line = allocations[index];
      const amount = Math.max(0, parseNumber(line?.applyAmount));
      if (!amount) continue;
      let billId = looksLikeUuid(line?.billId) ? line.billId : null;
      if (!billId && line?.billNo) {
        billId = await findBillIdByNumber(organizationId, line.billNo);
      }
      rows.push({
        organization_id: organizationId,
        payment_no: record?.paymentNo || `PAY-${Date.now()}`,
        payment_date: paymentDate,
        direction: "out",
        party_id: partyId,
        bill_id: billId,
        amount,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}${index + 1}`,
        notes: record?.internalNotes || `Payment out ${record?.status || "paid"}`,
        status: "posted",
        created_by: actorUserId
      });
    }

    const unappliedAmount = Math.max(0, parseNumber(record?.totals?.unappliedAmount));
    if (unappliedAmount > 0) {
      rows.push({
        organization_id: organizationId,
        payment_no: record?.paymentNo || `PAY-${Date.now()}`,
        payment_date: paymentDate,
        direction: "out",
        party_id: partyId,
        bill_id: null,
        amount: unappliedAmount,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}UNAPPLIED`,
        notes: record?.internalNotes || `Unapplied payment out ${record?.status || "paid"}`,
        status: "posted",
        created_by: actorUserId
      });
    }
  } else {
    const amountPaid = Math.max(0, parseNumber(record?.totals?.amountPaid ?? record?.amountPaid));
    if (amountPaid > 0) {
      rows.push({
        organization_id: organizationId,
        payment_no: record?.paymentNo || `PAY-${Date.now()}`,
        payment_date: paymentDate,
        direction: "out",
        party_id: partyId,
        bill_id: null,
        amount: amountPaid,
        payment_mode: record?.paymentMode || null,
        reference_no: `${sourcePrefix}PAID`,
        notes: record?.internalNotes || `Payment out ${record?.status || "paid"}`,
        status: "posted",
        created_by: actorUserId
      });
    }
  }

  if (rows.length) {
    const { error: insertError } = await supabase.from("payments").insert(rows);
    if (insertError) {
      throw new Error(normalizeSupabaseError(insertError, "Failed to save payment-out rows"));
    }
  }

  if (shouldApply) {
    for (const row of rows) {
      if (row.bill_id && parseNumber(row.amount) > 0) {
        await adjustBillBalance(row.bill_id, row.amount, 1);
      }
    }
  }
}
