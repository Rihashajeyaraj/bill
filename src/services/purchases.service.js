import { LS_KEYS, lsGet, lsSet, uid } from "./storage";
import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function getAll() {
  return lsGet(LS_KEYS.purchases, []);
}
function setAll(list) {
  lsSet(LS_KEYS.purchases, list);
}

export function purchasesList() {
  return getAll();
}

function mapRemotePurchaseBill(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: row?.id || uid("pur_"),
    country: metadata?.country || "",
    partyId: row?.supplier_id || "",
    partyName: metadata?.partyName || "",
    phone: metadata?.phone || "",
    billNumber: row?.bill_no || "",
    billDate: row?.bill_date || "",
    paymentType: metadata?.paymentType || "",
    created_at: row?.created_at || new Date().toISOString(),
    totals: {
      totalQty: parseNumber(metadata?.totalQty),
      subTotal: parseNumber(row?.subtotal),
      taxTotal: parseNumber(row?.tax_total),
      roundOff: parseNumber(metadata?.roundOff),
      grandTotal: parseNumber(row?.grand_total),
      balance: parseNumber(row?.balance_amount)
    },
    remainingBalance: parseNumber(row?.balance_amount),
    status: row?.status || "issued",
    lines: []
  };
}

export async function purchasesSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return purchasesList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return purchasesList();

  const { data, error } = await supabase
    .from("purchase_bills")
    .select("id,supplier_id,bill_no,bill_date,subtotal,tax_total,grand_total,balance_amount,status,metadata,created_at")
    .eq("organization_id", organizationId)
    .order("bill_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load purchase bills"));
  }

  const bills = Array.isArray(data) ? data : [];
  const billIds = bills.map((entry) => entry.id).filter(Boolean);
  let lineRows = [];
  if (billIds.length) {
    const { data: remoteLines, error: linesError } = await supabase
      .from("purchase_bill_items")
      .select("*")
      .in("bill_id", billIds)
      .order("id", { ascending: true });
    if (linesError) {
      throw new Error(normalizeSupabaseError(linesError, "Failed to load purchase bill items"));
    }
    lineRows = Array.isArray(remoteLines) ? remoteLines : [];
  }

  const lineMap = new Map();
  lineRows.forEach((line) => {
    const list = lineMap.get(line.bill_id) || [];
    list.push({
      id: line?.id || uid("pur_l_"),
      itemId: line?.item_id || "",
      itemName: line?.description || "",
      qty: parseNumber(line?.qty),
      rate: parseNumber(line?.unit_price),
      tax: parseNumber(line?.tax_rate),
      lineTax:
        parseNumber(line?.cgst_amount) +
        parseNumber(line?.sgst_amount) +
        parseNumber(line?.igst_amount) +
        parseNumber(line?.vat_amount),
      amount: parseNumber(line?.line_total)
    });
    lineMap.set(line.bill_id, list);
  });

  const mapped = bills.map((entry) => ({
    ...mapRemotePurchaseBill(entry),
    lines: lineMap.get(entry.id) || []
  }));
  setAll(mapped);
  return mapped;
}

export async function purchasesCreate(bill) {
  const now = new Date().toISOString();
  let id = uid("pur_");
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const totals = bill?.totals || {};

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const supplierId = looksLikeUuid(bill?.partyId) ? bill.partyId : null;
      const actorUserId = authGetUser()?.id || null;

      const { data: billRow, error: billError } = await supabase
        .from("purchase_bills")
        .insert({
          organization_id: organizationId,
          bill_no: bill?.billNumber || `BILL-${Date.now()}`,
          bill_date: bill?.billDate || now.slice(0, 10),
          supplier_id: supplierId,
          subtotal: parseNumber(totals?.subTotal),
          tax_total: parseNumber(totals?.taxTotal),
          grand_total: parseNumber(totals?.grandTotal),
          paid_amount: 0,
          balance_amount: parseNumber(totals?.grandTotal),
          status: "issued",
          metadata: {
            country: bill?.country || "",
            partyName: bill?.partyName || "",
            phone: bill?.phone || "",
            paymentType: bill?.paymentType || "",
            roundOff: parseNumber(totals?.roundOff),
            totalQty: parseNumber(totals?.totalQty)
          },
          created_by: actorUserId
        })
        .select("*")
        .single();

      if (billError) {
        throw new Error(normalizeSupabaseError(billError, "Failed to create purchase bill"));
      }

      id = billRow?.id || id;

      if (lines.length) {
        const remoteLines = lines.map((line, index) => ({
          bill_id: id,
          item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
          description: line?.itemName || `Line ${index + 1}`,
          qty: parseNumber(line?.qty),
          unit_price: parseNumber(line?.rate),
          tax_rate: parseNumber(line?.tax),
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          vat_amount: parseNumber(line?.lineTax),
          line_total: parseNumber(line?.amount)
        }));
        const { error: linesError } = await supabase.from("purchase_bill_items").insert(remoteLines);
        if (linesError) {
          throw new Error(normalizeSupabaseError(linesError, "Failed to save purchase bill items"));
        }
      }
    }
  }

  const next = {
    ...bill,
    id,
    country: bill?.country || "",
    created_at: now,
    totals: {
      totalQty: parseNumber(totals?.totalQty),
      subTotal: parseNumber(totals?.subTotal),
      taxTotal: parseNumber(totals?.taxTotal),
      roundOff: parseNumber(totals?.roundOff),
      grandTotal: parseNumber(totals?.grandTotal),
      balance: parseNumber(totals?.grandTotal)
    },
    remainingBalance: parseNumber(totals?.grandTotal),
    status: "issued",
    lines: lines.map((line) => ({
      ...line,
      qty: parseNumber(line?.qty),
      rate: parseNumber(line?.rate),
      tax: parseNumber(line?.tax),
      lineSubTotal: parseNumber(line?.lineSubTotal),
      lineTax: parseNumber(line?.lineTax),
      amount: parseNumber(line?.amount)
    }))
  };

  setAll([next, ...getAll()]);
  return id;
}
