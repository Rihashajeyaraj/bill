import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import {
  authEnsureOrganizationAccess,
  authGetOrganizationId,
  authGetRole,
  authGetUser
} from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { canCreateEntries, canEditEntries } from "./roles";
import { invoicesSyncFromRemote } from "./invoices.service";
import { listPaymentIn, savePaymentIn } from "../modules/paymentIn/store";
import { syncPaymentInRemote } from "./payments.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFORMA_STATUSES = new Set(["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"]);

function parseNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function round2(value) {
  return Math.round((parseNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeSupabaseError(error, fallback) {
  const message = String(error?.message || "").trim();
  if (message.toLowerCase().includes("sales proforma already converted")) {
    return message;
  }
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  if (error?.code === "42P01") {
    return `${fallback}. Missing proforma tables. Run the proforma migration SQL first.`;
  }
  if (error?.code === "PGRST202") {
    return `${fallback}. Missing proforma RPC. Run the proforma migration SQL first.`;
  }
  return message || fallback;
}

function isUniqueConstraintConflict(error) {
  const code = String(error?.code || "").trim();
  const status = Number(error?.status || 0);
  return code === "23505" || status === 409;
}

function isOrganizationAccessError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "P0001" && message.includes("access denied for organization");
}

function normalizeStatus(value, fallback = "DRAFT") {
  const status = String(value || "").trim().toUpperCase();
  if (PROFORMA_STATUSES.has(status)) return status;
  return fallback;
}

function assertWritePermission(documentLabel) {
  const role = authGetRole();
  if (!canCreateEntries(role) && !canEditEntries(role)) {
    throw new Error(`You do not have permission to save ${documentLabel}.`);
  }
}

function salesGetAll() {
  return lsGetOrganizationScoped(LS_KEYS.sales_proformas, []);
}

function salesSetAll(list) {
  lsSetOrganizationScoped(LS_KEYS.sales_proformas, list);
}

function purchaseGetAll() {
  return lsGetOrganizationScoped(LS_KEYS.purchase_proformas, []);
}

function purchaseSetAll(list) {
  lsSetOrganizationScoped(LS_KEYS.purchase_proformas, list);
}

function calculateSalesTotals(lines, roundOff = 0) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const subtotal = round2(
    safeLines.reduce((sum, line) => {
      const qty = parseNumber(line?.qty);
      const rate = parseNumber(line?.rate ?? line?.unitPrice);
      const discount = parseNumber(line?.discountAmount);
      const taxableAmount = parseNumber(line?.taxableAmount);
      const taxable = taxableAmount > 0 ? taxableAmount : Math.max(0, qty * rate - discount);
      return sum + taxable;
    }, 0)
  );
  const taxTotal = round2(
    safeLines.reduce((sum, line) => {
      const explicitTax =
        parseNumber(line?.cgstAmount) +
        parseNumber(line?.sgstAmount) +
        parseNumber(line?.igstAmount) +
        parseNumber(line?.vatAmount) +
        parseNumber(line?.cessAmount);
      if (explicitTax > 0) return sum + explicitTax;
      const qty = parseNumber(line?.qty);
      const rate = parseNumber(line?.rate ?? line?.unitPrice);
      const discount = parseNumber(line?.discountAmount);
      const taxableAmount = parseNumber(line?.taxableAmount);
      const taxable = taxableAmount > 0 ? taxableAmount : Math.max(0, qty * rate - discount);
      return sum + round2((taxable * parseNumber(line?.taxRate)) / 100);
    }, 0)
  );
  const grandTotal = round2(subtotal + taxTotal + parseNumber(roundOff));
  return {
    subTotal: subtotal,
    taxableTotal: subtotal,
    discountTotal: round2(
      safeLines.reduce((sum, line) => sum + parseNumber(line?.discountAmount), 0)
    ),
    cgst: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.cgstAmount), 0)),
    sgst: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.sgstAmount), 0)),
    igst: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.igstAmount), 0)),
    vat: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.vatAmount), 0)),
    cess: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.cessAmount), 0)),
    taxTotal,
    roundOff: round2(roundOff),
    grandTotal
  };
}

function calculatePurchaseTotals(lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const subtotal = round2(
    safeLines.reduce((sum, line) => {
      const qty = parseNumber(line?.qty);
      const rate = parseNumber(line?.rate ?? line?.unitPrice);
      const taxableAmount = parseNumber(line?.taxableAmount);
      const taxable = taxableAmount > 0 ? taxableAmount : Math.max(0, qty * rate);
      return sum + taxable;
    }, 0)
  );
  const taxTotal = round2(
    safeLines.reduce((sum, line) => {
      const explicitTax =
        parseNumber(line?.cgstAmount) +
        parseNumber(line?.sgstAmount) +
        parseNumber(line?.igstAmount) +
        parseNumber(line?.vatAmount);
      if (explicitTax > 0) return sum + explicitTax;
      const qty = parseNumber(line?.qty);
      const rate = parseNumber(line?.rate ?? line?.unitPrice);
      const taxableAmount = parseNumber(line?.taxableAmount);
      const taxable = taxableAmount > 0 ? taxableAmount : Math.max(0, qty * rate);
      return sum + round2((taxable * parseNumber(line?.taxRate)) / 100);
    }, 0)
  );
  return {
    subTotal: subtotal,
    taxableTotal: subtotal,
    cgst: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.cgstAmount), 0)),
    sgst: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.sgstAmount), 0)),
    igst: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.igstAmount), 0)),
    vat: round2(safeLines.reduce((sum, line) => sum + parseNumber(line?.vatAmount), 0)),
    taxTotal,
    grandTotal: round2(subtotal + taxTotal)
  };
}

function mapSalesLine(row, index = 0) {
  const qty = parseNumber(row?.qty);
  const rate = parseNumber(row?.unit_price);
  const discountAmount = parseNumber(row?.discount_amount);
  const taxable = parseNumber(row?.taxable_amount) || Math.max(0, qty * rate - discountAmount);
  const computedLineTax =
    parseNumber(row?.cgst_amount) +
    parseNumber(row?.sgst_amount) +
    parseNumber(row?.igst_amount) +
    parseNumber(row?.vat_amount) +
    parseNumber(row?.cess_amount);
  return {
    id: row?.id || uid("spf_li_"),
    lineNo: parseNumber(row?.line_no) || index + 1,
    itemId: row?.item_id || "",
    description: row?.description || "",
    hsnSac: row?.hsn_sac || "",
    qty,
    unit: row?.unit || "pcs",
    rate,
    discountPercent: parseNumber(row?.discount_percent),
    discountAmount,
    taxableAmount: taxable,
    taxRate: parseNumber(row?.tax_rate),
    cgstAmount: parseNumber(row?.cgst_amount),
    sgstAmount: parseNumber(row?.sgst_amount),
    igstAmount: parseNumber(row?.igst_amount),
    vatAmount: parseNumber(row?.vat_amount),
    cessAmount: parseNumber(row?.cess_amount),
    lineTax: computedLineTax,
    lineTotal: parseNumber(row?.line_total) || round2(taxable + computedLineTax)
  };
}

function mapSalesHeader(row, lineRows = []) {
  const lines = (Array.isArray(lineRows) ? lineRows : []).map(mapSalesLine);
  const computedTotals = calculateSalesTotals(lines, parseNumber(row?.round_off));
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: row?.id || uid("spf_"),
    proformaNo: row?.proforma_no || "",
    proformaDate: row?.proforma_date || "",
    validTill: row?.valid_till || "",
    dueDate: row?.due_date || row?.valid_till || row?.proforma_date || "",
    partyId: row?.party_id || "",
    partyName: metadata?.partyName || "",
    placeOfSupply: row?.place_of_supply_state || "",
    country: metadata?.country || "",
    taxMode: metadata?.taxMode || "",
    supplyType: metadata?.supplyType || "",
    status: normalizeStatus(row?.status),
    notes: row?.notes || "",
    terms: row?.terms || "",
    convertedDocumentId: row?.converted_document_id || "",
    convertedAt: row?.converted_at || "",
    lines,
    totals: {
      subTotal: round2(parseNumber(row?.subtotal) || computedTotals.subTotal),
      discountTotal: round2(parseNumber(row?.discount_total) || computedTotals.discountTotal),
      taxableTotal: round2(parseNumber(row?.taxable_total) || computedTotals.taxableTotal),
      cgst: round2(parseNumber(row?.cgst_total) || computedTotals.cgst),
      sgst: round2(parseNumber(row?.sgst_total) || computedTotals.sgst),
      igst: round2(parseNumber(row?.igst_total) || computedTotals.igst),
      vat: round2(parseNumber(row?.vat_total) || computedTotals.vat),
      cess: round2(parseNumber(row?.cess_total) || computedTotals.cess),
      taxTotal: round2(parseNumber(row?.tax_total) || computedTotals.taxTotal),
      roundOff: round2(parseNumber(row?.round_off)),
      grandTotal: round2(parseNumber(row?.grand_total) || computedTotals.grandTotal)
    },
    createdAt: row?.created_at || "",
    updatedAt: row?.updated_at || ""
  };
}

function mapPurchaseLine(row, index = 0) {
  const qty = parseNumber(row?.qty);
  const rate = parseNumber(row?.unit_price);
  const taxable = parseNumber(row?.taxable_amount) || Math.max(0, qty * rate);
  const lineTax =
    parseNumber(row?.cgst_amount) +
    parseNumber(row?.sgst_amount) +
    parseNumber(row?.igst_amount) +
    parseNumber(row?.vat_amount);
  return {
    id: row?.id || uid("ppf_li_"),
    lineNo: parseNumber(row?.line_no) || index + 1,
    itemId: row?.item_id || "",
    itemCode: row?.item_code || "",
    description: row?.description || "",
    qty,
    rate,
    taxRate: parseNumber(row?.tax_rate),
    taxInclusive: !!row?.tax_inclusive,
    taxableAmount: taxable,
    taxAmount: parseNumber(row?.tax_amount) || lineTax,
    cgstAmount: parseNumber(row?.cgst_amount),
    sgstAmount: parseNumber(row?.sgst_amount),
    igstAmount: parseNumber(row?.igst_amount),
    vatAmount: parseNumber(row?.vat_amount),
    lineTotal: parseNumber(row?.line_total) || round2(taxable + lineTax)
  };
}

function mapPurchaseHeader(row, lineRows = []) {
  const lines = (Array.isArray(lineRows) ? lineRows : []).map(mapPurchaseLine);
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const computedTotals = calculatePurchaseTotals(lines);
  return {
    id: row?.id || uid("ppf_"),
    proformaNo: row?.proforma_no || "",
    proformaDate: row?.proforma_date || "",
    validTill: row?.valid_till || "",
    dueDate: row?.due_date || row?.valid_till || row?.proforma_date || "",
    supplierId: row?.supplier_id || "",
    partyName: metadata?.partyName || "",
    partyAddress: metadata?.partyAddress || "",
    phone: metadata?.phone || "",
    country: metadata?.country || "",
    taxMode: metadata?.taxMode || "",
    supplyType: metadata?.supplyType || "",
    status: normalizeStatus(row?.status),
    convertedDocumentId: row?.converted_document_id || "",
    convertedAt: row?.converted_at || "",
    lines,
    totals: {
      subTotal: round2(parseNumber(row?.subtotal) || computedTotals.subTotal),
      taxableTotal: round2(parseNumber(row?.taxable_total) || computedTotals.taxableTotal),
      cgst: round2(parseNumber(row?.cgst_total) || computedTotals.cgst),
      sgst: round2(parseNumber(row?.sgst_total) || computedTotals.sgst),
      igst: round2(parseNumber(row?.igst_total) || computedTotals.igst),
      vat: round2(parseNumber(row?.vat_total) || computedTotals.vat),
      taxTotal: round2(parseNumber(row?.tax_total) || computedTotals.taxTotal),
      grandTotal: round2(parseNumber(row?.grand_total) || computedTotals.grandTotal)
    },
    createdAt: row?.created_at || "",
    updatedAt: row?.updated_at || ""
  };
}

async function refreshExpiry(organizationId) {
  if (!isSupabaseConfigured || !supabase || !organizationId) return;
  let { error } = await supabase.rpc("refresh_proforma_expiry_status", {
    p_organization_id: organizationId
  });
  if (error && isOrganizationAccessError(error)) {
    const repairedOrgId = await authEnsureOrganizationAccess(organizationId);
    if (repairedOrgId && repairedOrgId !== organizationId) {
      const retry = await supabase.rpc("refresh_proforma_expiry_status", {
        p_organization_id: repairedOrgId
      });
      error = retry.error;
    }
  }
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to refresh proforma expiry status"));
  }
}

export function salesProformasList() {
  return salesGetAll();
}

export function purchaseProformasList() {
  return purchaseGetAll();
}

export async function salesProformaPeekNumber(proformaDate = "") {
  if (!isSupabaseConfigured || !supabase) return `PI-${new Date().getFullYear()}-0001`;
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return `PI-${new Date().getFullYear()}-0001`;
  const { data, error } = await supabase.rpc("peek_sales_proforma_no", {
    p_organization_id: organizationId,
    p_proforma_date: proformaDate || new Date().toISOString().slice(0, 10)
  });
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load sales proforma number"));
  }
  return String(data || "").trim();
}

export async function purchaseProformaPeekNumber(proformaDate = "") {
  if (!isSupabaseConfigured || !supabase) return `PPI-${new Date().getFullYear()}-0001`;
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return `PPI-${new Date().getFullYear()}-0001`;
  const { data, error } = await supabase.rpc("peek_purchase_proforma_no", {
    p_organization_id: organizationId,
    p_proforma_date: proformaDate || new Date().toISOString().slice(0, 10)
  });
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load purchase proforma number"));
  }
  return String(data || "").trim();
}

export async function salesProformasSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return salesProformasList();
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return salesProformasList();

  await refreshExpiry(organizationId);

  const { data: headerRows, error: headerError } = await supabase
    .from("proforma_invoices")
    .select("*")
    .eq("organization_id", organizationId)
    .order("proforma_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (headerError) {
    throw new Error(normalizeSupabaseError(headerError, "Failed to load sales proformas"));
  }

  const ids = (Array.isArray(headerRows) ? headerRows : []).map((row) => row.id).filter(Boolean);
  let lineRows = [];
  if (ids.length) {
    const { data, error } = await supabase
      .from("proforma_invoice_items")
      .select("*")
      .in("proforma_id", ids)
      .order("line_no", { ascending: true });
    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to load sales proforma line items"));
    }
    lineRows = Array.isArray(data) ? data : [];
  }

  const linesByHeader = new Map();
  lineRows.forEach((line) => {
    const key = String(line?.proforma_id || "");
    if (!key) return;
    const list = linesByHeader.get(key) || [];
    list.push(line);
    linesByHeader.set(key, list);
  });

  const mapped = (Array.isArray(headerRows) ? headerRows : []).map((row) =>
    mapSalesHeader(row, linesByHeader.get(String(row.id)) || [])
  );
  salesSetAll(mapped);
  return mapped;
}

export async function purchaseProformasSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return purchaseProformasList();
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return purchaseProformasList();

  await refreshExpiry(organizationId);

  const { data: headerRows, error: headerError } = await supabase
    .from("purchase_proformas")
    .select("*")
    .eq("organization_id", organizationId)
    .order("proforma_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (headerError) {
    throw new Error(normalizeSupabaseError(headerError, "Failed to load purchase proformas"));
  }

  const ids = (Array.isArray(headerRows) ? headerRows : []).map((row) => row.id).filter(Boolean);
  let lineRows = [];
  if (ids.length) {
    const { data, error } = await supabase
      .from("purchase_proforma_items")
      .select("*")
      .in("proforma_id", ids)
      .order("line_no", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to load purchase proforma line items"));
    }
    lineRows = Array.isArray(data) ? data : [];
  }

  const linesByHeader = new Map();
  lineRows.forEach((line) => {
    const key = String(line?.proforma_id || "");
    if (!key) return;
    const list = linesByHeader.get(key) || [];
    list.push(line);
    linesByHeader.set(key, list);
  });

  const mapped = (Array.isArray(headerRows) ? headerRows : []).map((row) =>
    mapPurchaseHeader(row, linesByHeader.get(String(row.id)) || [])
  );
  purchaseSetAll(mapped);
  return mapped;
}

export async function salesProformaGetByIdRemote(id) {
  const proformaId = String(id || "").trim();
  if (!looksLikeUuid(proformaId)) return null;
  if (!isSupabaseConfigured || !supabase) {
    return salesGetAll().find((entry) => String(entry?.id || "") === proformaId) || null;
  }
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return null;

  await refreshExpiry(organizationId);

  const { data: row, error } = await supabase
    .from("proforma_invoices")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", proformaId)
    .maybeSingle();
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load sales proforma"));
  }
  if (!row) return null;
  const { data: lineRows, error: lineError } = await supabase
    .from("proforma_invoice_items")
    .select("*")
    .eq("proforma_id", proformaId)
    .order("line_no", { ascending: true });
  if (lineError) {
    throw new Error(normalizeSupabaseError(lineError, "Failed to load sales proforma line items"));
  }
  return mapSalesHeader(row, Array.isArray(lineRows) ? lineRows : []);
}

export async function purchaseProformaGetByIdRemote(id) {
  const proformaId = String(id || "").trim();
  if (!looksLikeUuid(proformaId)) return null;
  if (!isSupabaseConfigured || !supabase) {
    return purchaseGetAll().find((entry) => String(entry?.id || "") === proformaId) || null;
  }
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return null;

  await refreshExpiry(organizationId);

  const { data: row, error } = await supabase
    .from("purchase_proformas")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", proformaId)
    .maybeSingle();
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load purchase proforma"));
  }
  if (!row) return null;
  const { data: lineRows, error: lineError } = await supabase
    .from("purchase_proforma_items")
    .select("*")
    .eq("proforma_id", proformaId)
    .order("line_no", { ascending: true })
    .order("id", { ascending: true });
  if (lineError) {
    throw new Error(normalizeSupabaseError(lineError, "Failed to load purchase proforma line items"));
  }
  return mapPurchaseHeader(row, Array.isArray(lineRows) ? lineRows : []);
}

export async function salesProformaUpsert(input) {
  assertWritePermission("sales proformas");
  const nowIso = new Date().toISOString();
  const proformaDate = String(input?.proformaDate || "").trim();
  const validTill = String(input?.validTill || "").trim();
  const dueDate = String(input?.dueDate || "").trim();
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  const totals = calculateSalesTotals(lines, parseNumber(input?.totals?.roundOff));
  const actor = authGetUser();
  const actorUserId = actor?.id || null;
  const actorName = String(actor?.name || actor?.email || "").trim();
  const status = normalizeStatus(input?.status, "DRAFT");

  let id = String(input?.id || "").trim();
  let proformaNo = String(input?.proformaNo || "").trim();

  if (isSupabaseConfigured && supabase) {
    const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
    if (!organizationId) {
      throw new Error("Organization is required to save sales proforma.");
    }

    const headerPayload = {
      organization_id: organizationId,
      proforma_no: proformaNo || `PI-${Date.now()}`,
      proforma_date: proformaDate,
      valid_till: validTill || null,
      due_date: dueDate || validTill || proformaDate,
      party_id: looksLikeUuid(input?.partyId) ? input.partyId : null,
      place_of_supply_state: input?.placeOfSupply || null,
      currency_code: String(input?.currencyCode || "INR").toUpperCase(),
      exchange_rate: parseNumber(input?.exchangeRate || 1) || 1,
      subtotal: totals.subTotal,
      discount_total: totals.discountTotal,
      taxable_total: totals.taxableTotal,
      cgst_total: totals.cgst,
      sgst_total: totals.sgst,
      igst_total: totals.igst,
      cess_total: totals.cess,
      vat_total: totals.vat,
      tax_total: totals.taxTotal,
      round_off: totals.roundOff,
      grand_total: totals.grandTotal,
      status,
      notes: input?.notes || null,
      terms: input?.terms || null,
      metadata: {
        country: input?.country || "",
        partyName: input?.partyName || "",
        taxMode: input?.taxMode || "",
        supplyType: input?.supplyType || "",
        createdByName: actorName
      },
      created_by: actorUserId
    };

    let headerRow = null;
    if (looksLikeUuid(id)) {
      const { data, error } = await supabase
        .from("proforma_invoices")
        .update(headerPayload)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("*")
        .single();
      if (error) {
        throw new Error(normalizeSupabaseError(error, "Failed to update sales proforma"));
      }
      headerRow = data;
    } else {
      let created = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!proformaNo || attempt > 0) {
          const { data: nextNo, error: noError } = await supabase.rpc("allocate_sales_proforma_no", {
            p_organization_id: organizationId,
            p_proforma_date: proformaDate
          });
          if (noError) {
            throw new Error(normalizeSupabaseError(noError, "Failed to allocate sales proforma number"));
          }
          proformaNo = String(nextNo || "").trim();
          headerPayload.proforma_no = proformaNo || `PI-${Date.now()}`;
        }

        const { data, error } = await supabase
          .from("proforma_invoices")
          .insert(headerPayload)
          .select("*")
          .single();
        if (!error) {
          created = data;
          break;
        }
        if (!isUniqueConstraintConflict(error)) {
          throw new Error(normalizeSupabaseError(error, "Failed to create sales proforma"));
        }
        if (attempt === 2) {
          throw new Error("Failed to create sales proforma due to number conflict. Please retry.");
        }
      }
      headerRow = created;
    }

    id = String(headerRow?.id || id || "");
    proformaNo = String(headerRow?.proforma_no || proformaNo || "");

    if (!id) {
      throw new Error("Sales proforma save failed. Missing proforma id.");
    }

    const { error: deleteError } = await supabase
      .from("proforma_invoice_items")
      .delete()
      .eq("proforma_id", id);
    if (deleteError) {
      throw new Error(normalizeSupabaseError(deleteError, "Failed to refresh sales proforma line items"));
    }

    const remoteLines = lines.map((line, index) => {
      const qty = parseNumber(line?.qty);
      const rate = parseNumber(line?.rate ?? line?.unitPrice);
      const discountAmount = parseNumber(line?.discountAmount);
      const taxableAmount = parseNumber(line?.taxableAmount) || Math.max(0, qty * rate - discountAmount);
      const taxRate = parseNumber(line?.taxRate);
      const explicitTax =
        parseNumber(line?.cgstAmount) +
        parseNumber(line?.sgstAmount) +
        parseNumber(line?.igstAmount) +
        parseNumber(line?.vatAmount) +
        parseNumber(line?.cessAmount);
      const impliedTax = round2((taxableAmount * taxRate) / 100);
      return {
        proforma_id: id,
        item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
        line_no: parseNumber(line?.lineNo) || index + 1,
        description: line?.description || line?.itemName || `Line ${index + 1}`,
        hsn_sac: line?.hsnSac || null,
        qty,
        unit: line?.unit || null,
        unit_price: rate,
        discount_percent: parseNumber(line?.discountPercent),
        discount_amount: discountAmount,
        taxable_amount: taxableAmount,
        tax_rate: taxRate,
        cgst_amount: parseNumber(line?.cgstAmount),
        sgst_amount: parseNumber(line?.sgstAmount),
        igst_amount: parseNumber(line?.igstAmount),
        cess_amount: parseNumber(line?.cessAmount),
        vat_amount: parseNumber(line?.vatAmount),
        line_total: parseNumber(line?.lineTotal) || round2(taxableAmount + (explicitTax || impliedTax))
      };
    });

    if (remoteLines.length) {
      const { error: lineError } = await supabase.from("proforma_invoice_items").insert(remoteLines);
      if (lineError) {
        throw new Error(normalizeSupabaseError(lineError, "Failed to save sales proforma line items"));
      }
    }
  }

  const localEntry = {
    id: id || uid("spf_"),
    proformaNo: proformaNo || `PI-${Date.now()}`,
    proformaDate,
    validTill,
    dueDate: dueDate || validTill || proformaDate,
    partyId: input?.partyId || "",
    partyName: input?.partyName || "",
    placeOfSupply: input?.placeOfSupply || "",
    country: input?.country || "",
    taxMode: input?.taxMode || "",
    supplyType: input?.supplyType || "",
    status,
    notes: input?.notes || "",
    terms: input?.terms || "",
    convertedDocumentId: input?.convertedDocumentId || "",
    convertedAt: input?.convertedAt || "",
    lines: lines.map((line, index) => ({
      id: line?.id || uid("spf_li_"),
      lineNo: parseNumber(line?.lineNo) || index + 1,
      itemId: line?.itemId || "",
      description: line?.description || line?.itemName || "",
      hsnSac: line?.hsnSac || "",
      qty: parseNumber(line?.qty),
      unit: line?.unit || "pcs",
      rate: parseNumber(line?.rate ?? line?.unitPrice),
      discountPercent: parseNumber(line?.discountPercent),
      discountAmount: parseNumber(line?.discountAmount),
      taxableAmount: parseNumber(line?.taxableAmount),
      taxRate: parseNumber(line?.taxRate),
      cgstAmount: parseNumber(line?.cgstAmount),
      sgstAmount: parseNumber(line?.sgstAmount),
      igstAmount: parseNumber(line?.igstAmount),
      vatAmount: parseNumber(line?.vatAmount),
      cessAmount: parseNumber(line?.cessAmount),
      lineTotal: parseNumber(line?.lineTotal)
    })),
    totals,
    updatedAt: nowIso
  };

  const existing = salesGetAll().filter((entry) => String(entry?.id || "") !== String(localEntry.id));
  salesSetAll([localEntry, ...existing]);
  return { id: localEntry.id, proformaNo: localEntry.proformaNo };
}

export async function purchaseProformaUpsert(input) {
  assertWritePermission("purchase proformas");
  const stockSnapshot = lsGetOrganizationScoped(LS_KEYS.items, []);
  const stockSnapshotJson = JSON.stringify(Array.isArray(stockSnapshot) ? stockSnapshot : []);
  const nowIso = new Date().toISOString();
  const proformaDate = String(input?.proformaDate || "").trim();
  const validTill = String(input?.validTill || "").trim();
  const dueDate = String(input?.dueDate || "").trim();
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  const totals = calculatePurchaseTotals(lines);
  const actor = authGetUser();
  const actorUserId = actor?.id || null;
  const actorName = String(actor?.name || actor?.email || "").trim();
  const status = normalizeStatus(input?.status, "DRAFT");

  let id = String(input?.id || "").trim();
  let proformaNo = String(input?.proformaNo || "").trim();

  if (isSupabaseConfigured && supabase) {
    const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
    if (!organizationId) {
      throw new Error("Organization is required to save purchase proforma.");
    }

    const headerPayload = {
      organization_id: organizationId,
      proforma_no: proformaNo || `PPI-${Date.now()}`,
      proforma_date: proformaDate,
      valid_till: validTill || null,
      due_date: dueDate || validTill || proformaDate,
      supplier_id: looksLikeUuid(input?.supplierId) ? input.supplierId : null,
      subtotal: totals.subTotal,
      taxable_total: totals.taxableTotal,
      cgst_total: totals.cgst,
      sgst_total: totals.sgst,
      igst_total: totals.igst,
      vat_total: totals.vat,
      tax_total: totals.taxTotal,
      grand_total: totals.grandTotal,
      status,
      metadata: {
        country: input?.country || "",
        partyName: input?.partyName || "",
        partyAddress: input?.partyAddress || "",
        phone: input?.phone || "",
        taxMode: input?.taxMode || "",
        supplyType: input?.supplyType || "",
        createdByName: actorName
      },
      created_by: actorUserId
    };

    let headerRow = null;
    if (looksLikeUuid(id)) {
      const { data, error } = await supabase
        .from("purchase_proformas")
        .update(headerPayload)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("*")
        .single();
      if (error) {
        throw new Error(normalizeSupabaseError(error, "Failed to update purchase proforma"));
      }
      headerRow = data;
    } else {
      let created = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!proformaNo || attempt > 0) {
          const { data: nextNo, error: noError } = await supabase.rpc("allocate_purchase_proforma_no", {
            p_organization_id: organizationId,
            p_proforma_date: proformaDate
          });
          if (noError) {
            throw new Error(normalizeSupabaseError(noError, "Failed to allocate purchase proforma number"));
          }
          proformaNo = String(nextNo || "").trim();
          headerPayload.proforma_no = proformaNo || `PPI-${Date.now()}`;
        }

        const { data, error } = await supabase
          .from("purchase_proformas")
          .insert(headerPayload)
          .select("*")
          .single();
        if (!error) {
          created = data;
          break;
        }
        if (!isUniqueConstraintConflict(error)) {
          throw new Error(normalizeSupabaseError(error, "Failed to create purchase proforma"));
        }
        if (attempt === 2) {
          throw new Error("Failed to create purchase proforma due to number conflict. Please retry.");
        }
      }
      headerRow = created;
    }

    id = String(headerRow?.id || id || "");
    proformaNo = String(headerRow?.proforma_no || proformaNo || "");
    if (!id) {
      throw new Error("Purchase proforma save failed. Missing proforma id.");
    }

    const { error: deleteError } = await supabase
      .from("purchase_proforma_items")
      .delete()
      .eq("proforma_id", id);
    if (deleteError) {
      throw new Error(normalizeSupabaseError(deleteError, "Failed to refresh purchase proforma line items"));
    }

    const remoteLines = lines.map((line, index) => {
      const qty = parseNumber(line?.qty);
      const rate = parseNumber(line?.rate ?? line?.unitPrice);
      const taxableAmount = parseNumber(line?.taxableAmount) || Math.max(0, qty * rate);
      const taxRate = parseNumber(line?.taxRate);
      const explicitTax =
        parseNumber(line?.cgstAmount) +
        parseNumber(line?.sgstAmount) +
        parseNumber(line?.igstAmount) +
        parseNumber(line?.vatAmount);
      const impliedTax = round2((taxableAmount * taxRate) / 100);
      return {
        proforma_id: id,
        item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
        line_no: parseNumber(line?.lineNo) || index + 1,
        item_code: line?.itemCode || null,
        description: line?.description || line?.itemName || `Line ${index + 1}`,
        qty,
        unit_price: rate,
        tax_rate: taxRate,
        taxable_amount: taxableAmount,
        tax_amount: parseNumber(line?.taxAmount) || explicitTax || impliedTax,
        tax_inclusive: !!line?.taxInclusive,
        cgst_amount: parseNumber(line?.cgstAmount),
        sgst_amount: parseNumber(line?.sgstAmount),
        igst_amount: parseNumber(line?.igstAmount),
        vat_amount: parseNumber(line?.vatAmount),
        line_total: parseNumber(line?.lineTotal) || round2(taxableAmount + (explicitTax || impliedTax))
      };
    });

    if (remoteLines.length) {
      const { error: lineError } = await supabase.from("purchase_proforma_items").insert(remoteLines);
      if (lineError) {
        throw new Error(normalizeSupabaseError(lineError, "Failed to save purchase proforma line items"));
      }
    }
  }

  const localEntry = {
    id: id || uid("ppf_"),
    proformaNo: proformaNo || `PPI-${Date.now()}`,
    proformaDate,
    validTill,
    dueDate: dueDate || validTill || proformaDate,
    supplierId: input?.supplierId || "",
    partyName: input?.partyName || "",
    partyAddress: input?.partyAddress || "",
    phone: input?.phone || "",
    country: input?.country || "",
    taxMode: input?.taxMode || "",
    supplyType: input?.supplyType || "",
    status,
    convertedDocumentId: input?.convertedDocumentId || "",
    convertedAt: input?.convertedAt || "",
    lines: lines.map((line, index) => ({
      id: line?.id || uid("ppf_li_"),
      lineNo: parseNumber(line?.lineNo) || index + 1,
      itemId: line?.itemId || "",
      itemCode: line?.itemCode || "",
      description: line?.description || line?.itemName || "",
      qty: parseNumber(line?.qty),
      rate: parseNumber(line?.rate ?? line?.unitPrice),
      taxRate: parseNumber(line?.taxRate),
      taxInclusive: !!line?.taxInclusive,
      taxableAmount: parseNumber(line?.taxableAmount),
      taxAmount: parseNumber(line?.taxAmount),
      cgstAmount: parseNumber(line?.cgstAmount),
      sgstAmount: parseNumber(line?.sgstAmount),
      igstAmount: parseNumber(line?.igstAmount),
      vatAmount: parseNumber(line?.vatAmount),
      lineTotal: parseNumber(line?.lineTotal)
    })),
    totals,
    updatedAt: nowIso
  };

  const existing = purchaseGetAll().filter((entry) => String(entry?.id || "") !== String(localEntry.id));
  purchaseSetAll([localEntry, ...existing]);

  // Proforma purchase orders must not mutate inventory; stock updates happen only on posted bills.
  const stockAfter = lsGetOrganizationScoped(LS_KEYS.items, []);
  const stockAfterJson = JSON.stringify(Array.isArray(stockAfter) ? stockAfter : []);
  if (stockAfterJson !== stockSnapshotJson) {
    lsSetOrganizationScoped(LS_KEYS.items, Array.isArray(stockSnapshot) ? stockSnapshot : []);
  }

  return { id: localEntry.id, proformaNo: localEntry.proformaNo };
}

async function relinkSalesProformaPayments(proformaId, invoiceId, invoiceNo) {
  const safeProformaId = String(proformaId || "").trim();
  const safeInvoiceId = String(invoiceId || "").trim();
  if (!safeProformaId || !safeInvoiceId) return [];

  const actor = authGetUser();
  const actorName = String(actor?.name || actor?.email || "System User").trim();
  const linkedPayments = listPaymentIn().filter((record) =>
    (Array.isArray(record?.allocations) ? record.allocations : []).some(
      (line) =>
        String(line?.documentType || "invoice").toLowerCase() === "proforma" &&
        String(line?.invoiceId || "").trim() === safeProformaId
    )
  );

  const updatedPayments = [];
  for (const record of linkedPayments) {
    const nextAllocations = (Array.isArray(record?.allocations) ? record.allocations : []).map((line) => {
      const linkedToProforma =
        String(line?.documentType || "invoice").toLowerCase() === "proforma" &&
        String(line?.invoiceId || "").trim() === safeProformaId;
      if (!linkedToProforma) return line;
      return {
        ...line,
        invoiceId: safeInvoiceId,
        invoiceNo: invoiceNo || line?.invoiceNo || "",
        documentType: "invoice"
      };
    });

    const saved = savePaymentIn({
      id: record.id,
      country: record.country,
      paymentDate: record.paymentDate,
      customerId: record.customerId,
      customerName: record.customerName,
      paymentMode: record.paymentMode,
      referenceNo: record.referenceNo,
      chequeNo: record.chequeNo,
      bankName: record.bankName,
      bankAccount: record.bankAccount,
      transactionId: record.transactionId,
      paymentReference: record.paymentReference,
      registrationNumber: record.registrationNumber,
      internalNotes: record.internalNotes,
      customerNotes: record.customerNotes,
      attachment: record.attachment,
      desiredStatus: record.status,
      amountReceived: parseNumber(record?.totals?.amountReceived ?? record?.amountReceived),
      allocations: nextAllocations,
      customerOutstandingBefore: parseNumber(record?.totals?.customerOutstandingBefore),
      actor: actorName
    });
    await syncPaymentInRemote(saved);
    updatedPayments.push(saved);
  }

  return updatedPayments;
}

export async function convertSalesProforma(proformaId) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured for conversion.");
  }
  const { data, error } = await supabase.rpc("convert_sales_proforma_to_invoice", {
    p_proforma_id: proformaId
  });
  if (error) {
    if (String(error?.message || "").toLowerCase().includes("sales proforma already converted")) {
      await Promise.allSettled([salesProformasSyncFromRemote(), invoicesSyncFromRemote()]);
    }
    throw new Error(normalizeSupabaseError(error, "Failed to convert sales proforma"));
  }
  const invoiceId = data?.invoice_id || "";
  const invoiceNo = data?.invoice_no || "";
  await invoicesSyncFromRemote();
  await relinkSalesProformaPayments(proformaId, invoiceId, invoiceNo);
  await Promise.all([salesProformasSyncFromRemote(), invoicesSyncFromRemote()]);
  return {
    invoiceId,
    invoiceNo
  };
}

export async function convertPurchaseProforma(proformaId) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured for conversion.");
  }
  const { data, error } = await supabase.rpc("convert_purchase_proforma_to_bill", {
    p_proforma_id: proformaId
  });
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to convert purchase proforma"));
  }
  await purchaseProformasSyncFromRemote();
  return {
    billId: data?.bill_id || "",
    billNo: data?.bill_no || ""
  };
}

export function getPurchaseProformaStatusOptions() {
  return ["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"];
}

export function salesProformaComputeTotals(lines, roundOff = 0) {
  return calculateSalesTotals(lines, roundOff);
}

export function purchaseProformaComputeTotals(lines) {
  return calculatePurchaseTotals(lines);
}
