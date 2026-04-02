import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import {
  authEnsureOrganizationAccess,
  authGetOrganizationId,
  authGetRole,
  authGetUser
} from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { canCreateEntries, canEditEntries } from "./roles";
import { triggerCreditLimitNotifications } from "../modules/parties/store";
import { triggerLowStockNotifications } from "../modules/items/store";
import { companyPeekDocumentNumber, companySyncDocumentCounter } from "./company.service";
import {
  annotateWithFinancialYear,
  financialYearsEnsureForDate,
  financialYearsResolveForDate,
  matchesFinancialYearFilter,
  resolveFinancialYearFilterRange
} from "./financialYears.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.invoices, []);
}

function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.invoices, list);
}

function applyInvoiceStockAdjustment(lines, direction = 1) {
  const itemLines = Array.isArray(lines) ? lines : [];
  if (!itemLines.length) return;
  const quantityByItemId = new Map();
  const multiplier = Number(direction) === -1 ? -1 : 1;

  itemLines.forEach((line) => {
    const itemId = String(line?.itemId || line?.item_id || "").trim();
    if (!itemId) return;
    const qty = Math.max(0, parseNumber(line?.qty ?? line?.quantity)) * multiplier;
    if (!qty) return;
    quantityByItemId.set(itemId, (quantityByItemId.get(itemId) || 0) + qty);
  });
  if (!quantityByItemId.size) return;

  const items = lsGetOrganizationScoped(LS_KEYS.items, []);
  if (!Array.isArray(items) || !items.length) return;

  const nextItems = items.map((item) => {
    const itemId = String(item?.id || "").trim();
    const delta = quantityByItemId.get(itemId);
    if (!delta || item?.trackInventory !== true) return item;

    const currentStock = Math.max(
      0,
      parseNumber(item?.currentStock ?? item?.stockQty ?? item?.metadata?.currentStock ?? item?.openingStock)
    );
    const nextCurrentStock = Math.max(0, currentStock - delta);
    const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    return {
      ...item,
      currentStock: nextCurrentStock,
      stockQty: nextCurrentStock,
      metadata: {
        ...metadata,
        currentStock: nextCurrentStock
      }
    };
  });

  lsSetOrganizationScoped(LS_KEYS.items, nextItems);
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

function isUniqueConstraintError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "23505" ||
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("already exists")
  );
}

function parseInvoiceNumberParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return {
    raw: text,
    base: match[1],
    sequence: parseNumber(match[2]),
    width: match[2].length
  };
}

function hasInvoiceNumberConflict(invoiceNo, excludeId = "") {
  const normalized = String(invoiceNo || "").trim().toLowerCase();
  const ignoredId = String(excludeId || "").trim();
  if (!normalized) return false;
  return getAll().some((entry) => {
    if (ignoredId && String(entry?.id || "").trim() === ignoredId) return false;
    return String(entry?.invoiceNo || "").trim().toLowerCase() === normalized;
  });
}

async function fetchLatestRemoteInvoiceNumber(organizationId, basePrefix) {
  if (!isSupabaseConfigured || !supabase || !organizationId || !basePrefix) return "";
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_no")
    .eq("organization_id", organizationId)
    .like("invoice_no", `${basePrefix}%`)
    .order("invoice_no", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingColumnError(error)) return "";
    throw new Error(normalizeSupabaseError(error, "Failed to load latest invoice number"));
  }

  return String((Array.isArray(data) ? data[0] : null)?.invoice_no || "").trim();
}

async function invoiceNumberExistsRemotely(organizationId, invoiceNo, excludeId = "") {
  if (!isSupabaseConfigured || !supabase || !organizationId || !invoiceNo) return false;
  let query = supabase
    .from("invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("invoice_no", invoiceNo);

  const ignoredId = String(excludeId || "").trim();
  if (ignoredId) {
    query = query.neq("id", ignoredId);
  }

  const { data, error } = await query.limit(1);

  if (error) {
    if (isMissingColumnError(error)) return false;
    throw new Error(normalizeSupabaseError(error, "Failed to validate invoice number"));
  }

  return Array.isArray(data) && data.length > 0;
}

async function resolveUniqueInvoiceNumber(requestedInvoiceNo, invoiceDate, organizationId) {
  const normalizedRequested = String(requestedInvoiceNo || "").trim();
  const previewInvoiceNo = String(
    companyPeekDocumentNumber("invoice", { dateValue: invoiceDate }) || ""
  ).trim();
  const preferredInvoiceNo = normalizedRequested || previewInvoiceNo || `INV-${Date.now()}`;
  const requestedParts = parseInvoiceNumberParts(preferredInvoiceNo);
  const fallbackParts = parseInvoiceNumberParts(previewInvoiceNo || preferredInvoiceNo);
  const baseParts = requestedParts?.sequence > 0 ? requestedParts : fallbackParts;

  if (normalizedRequested) {
    const localConflict = hasInvoiceNumberConflict(normalizedRequested);
    const remoteConflict = await invoiceNumberExistsRemotely(organizationId, normalizedRequested);
    if (!localConflict && !remoteConflict) {
      return normalizedRequested;
    }
    if (normalizedRequested !== previewInvoiceNo) {
      throw new Error("Invoice number already exists");
    }
  }

  if (!baseParts) return preferredInvoiceNo;

  const localMax = getAll().reduce((maxValue, entry) => {
    const parts = parseInvoiceNumberParts(entry?.invoiceNo || "");
    if (!parts || parts.base !== baseParts.base) return maxValue;
    return Math.max(maxValue, parts.sequence);
  }, 0);
  const remoteParts = parseInvoiceNumberParts(
    await fetchLatestRemoteInvoiceNumber(organizationId, baseParts.base)
  );
  const remoteMax = remoteParts?.base === baseParts.base ? remoteParts.sequence : 0;
  const seedSequence = baseParts.sequence > 0 ? baseParts.sequence - 1 : 0;

  for (let offset = 1; offset <= 5; offset += 1) {
    const candidate = `${baseParts.base}${String(
      Math.max(localMax, remoteMax, seedSequence) + offset
    ).padStart(Math.max(baseParts.width, 4), "0")}`;
    if (hasInvoiceNumberConflict(candidate)) continue;
    if (await invoiceNumberExistsRemotely(organizationId, candidate)) continue;
    return candidate;
  }

  return `${baseParts.base}${String(Math.max(localMax, remoteMax, seedSequence) + 6).padStart(
    Math.max(baseParts.width, 4),
    "0"
  )}`;
}

function isMissingRpcError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "PGRST202" ||
    message.includes("could not find the function") ||
    message.includes("post_invoice_fifo")
  );
}

function isMissingColumnError(error) {
  return String(error?.code || "").toUpperCase() === "42703";
}

function deriveInvoiceStatus(grandTotal, balanceAmount) {
  const grand = Math.max(0, parseNumber(grandTotal));
  const balance = Math.max(0, parseNumber(balanceAmount));
  if (grand <= 0) return "draft";
  if (balance <= 0) return "paid";
  if (balance < grand) return "partial";
  return "issued";
}

function assertInvoiceWritePermission() {
  const role = authGetRole();
  if (!canCreateEntries(role) && !canEditEntries(role)) {
    throw new Error("You do not have permission to save invoices.");
  }
}

function mapRemoteInvoiceRow(row, itemRows, balanceAmount) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const taxBreakup = metadata?.taxBreakup && typeof metadata.taxBreakup === "object" ? metadata.taxBreakup : null;
  const tax = {
    type: metadata?.taxType || metadata?.taxMode || "GST/VAT",
    supplyType: metadata?.supplyType || taxBreakup?.supplyType || null,
    totalTax: parseNumber(row?.tax_total),
    cgst: parseNumber(row?.cgst_total),
    sgst: parseNumber(row?.sgst_total),
    igst: parseNumber(row?.igst_total),
    vat: parseNumber(row?.vat_total),
    taxAmount: parseNumber(row?.tax_total)
  };

  const lines = (Array.isArray(itemRows) ? itemRows : []).map((line) => ({
    id: line?.id || uid("invl_"),
    itemId: line?.item_id || "",
    itemName: line?.description || "",
    qty: parseNumber(line?.qty),
    rate: parseNumber(line?.unit_price),
    discount: parseNumber(line?.discount_amount),
    tax: parseNumber(line?.tax_rate),
    taxRate: parseNumber(line?.tax_rate),
    cgstAmount: parseNumber(line?.cgst_amount),
    sgstAmount: parseNumber(line?.sgst_amount),
    igstAmount: parseNumber(line?.igst_amount),
    vatAmount: parseNumber(line?.vat_amount),
    lineTax:
      parseNumber(line?.cgst_amount) +
      parseNumber(line?.sgst_amount) +
      parseNumber(line?.igst_amount) +
      parseNumber(line?.vat_amount) +
      parseNumber(line?.cess_amount),
    net: parseNumber(line?.taxable_amount),
    cogsAmount: parseNumber(line?.cogs_amount),
    cogsUnitCost: parseNumber(line?.cogs_unit_cost),
    grossProfitAmount: parseNumber(line?.gross_profit_amount),
    amount: parseNumber(line?.line_total),
    hsn: line?.hsn_sac || ""
  }));

  const effectiveBalance = Math.max(0, parseNumber(balanceAmount));
  const grandTotal = parseNumber(row?.grand_total);
  const status =
    String(row?.status || "").toLowerCase() === "cancelled"
      ? "cancelled"
      : deriveInvoiceStatus(grandTotal, effectiveBalance);

  const mapped = {
    id: row?.id || uid("inv_"),
    invoiceNo: row?.invoice_no || "",
    invoiceDate: row?.invoice_date || "",
    dueDate: row?.due_date || row?.invoice_date || "",
    partyId: row?.party_id || "",
    partyName: metadata?.partyName || metadata?.buyer?.name || "",
    placeOfSupply: row?.place_of_supply_state || metadata?.placeOfSupply || "",
    country: metadata?.country || "",
    currency: String(row?.currency_code || metadata?.currencyCode || "").trim().toUpperCase(),
    taxMode: metadata?.taxMode || "",
    supplyType: metadata?.supplyType || taxBreakup?.supplyType || null,
    seller: metadata?.seller || {},
    buyer: metadata?.buyer || {},
    lines,
    totals: {
      subTotal: parseNumber(row?.subtotal),
      tax,
      taxBreakup,
      grandTotal,
      balance: effectiveBalance
    },
    remainingBalance: effectiveBalance,
    createdByUserId: row?.created_by || null,
    createdByName: String(metadata?.createdByName || "").trim(),
    createdBy: String(metadata?.createdByName || row?.created_by || "").trim(),
    status,
    financialYearId: row?.financial_year_id || metadata?.financialYearId || "",
    financialYearLabel: metadata?.financialYearLabel || "",
    financialYearCode: metadata?.financialYearCode || "",
    created_at: row?.created_at || new Date().toISOString(),
    updated_at: row?.updated_at || row?.created_at || new Date().toISOString()
  };
  return annotateWithFinancialYear(mapped, mapped.invoiceDate);
}

function buildRemoteLines(invoiceId, lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => {
    const qty = parseNumber(line?.qty ?? line?.quantity);
    const rate = parseNumber(line?.rate ?? line?.unitPrice);
    const discountAmount = parseNumber(line?.discountAmount ?? line?.discount);
    const taxable = Math.max(0, parseNumber(line?.taxableAmount ?? line?.net ?? qty * rate - discountAmount));
    const taxRate = parseNumber(line?.taxRate ?? line?.tax);
    const cgstAmount = parseNumber(line?.cgstAmount);
    const sgstAmount = parseNumber(line?.sgstAmount);
    const igstAmount = parseNumber(line?.igstAmount);
    const cessAmount = parseNumber(line?.cessAmount);
    const vatAmount = parseNumber(line?.vatAmount ?? line?.lineTax);
    const lineTotal = parseNumber(
      line?.lineTotal ??
        line?.amount ??
        taxable + cgstAmount + sgstAmount + igstAmount + vatAmount + cessAmount
    );

    return {
      invoice_id: invoiceId,
      item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
      line_no: index + 1,
      description: line?.itemName || line?.name || line?.description || `Line ${index + 1}`,
      hsn_sac: line?.hsn || line?.hsnSac || null,
      qty,
      unit: line?.unit || null,
      unit_price: rate,
      discount_percent: parseNumber(line?.discountPercent),
      discount_amount: discountAmount,
      taxable_amount: taxable,
      tax_rate: taxRate,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      cess_amount: cessAmount,
      vat_amount: vatAmount,
      line_total: lineTotal
    };
  });
}

function calculateInvoiceSummary(lines, totalsInput) {
  const totals = totalsInput && typeof totalsInput === "object" ? totalsInput : {};
  const taxInput = totals?.tax && typeof totals.tax === "object" ? totals.tax : {};
  const taxBreakup = totals?.taxBreakup && typeof totals.taxBreakup === "object" ? totals.taxBreakup : {};
  const safeLines = Array.isArray(lines) ? lines : [];

  const lineSubTotal = safeLines.reduce((sum, line) => {
    const qty = parseNumber(line?.qty ?? line?.quantity);
    const rate = parseNumber(line?.rate ?? line?.unitPrice);
    const discount = parseNumber(line?.discountAmount ?? line?.discount);
    const taxable = parseNumber(line?.taxableAmount ?? line?.net ?? qty * rate - discount);
    return sum + Math.max(0, taxable);
  }, 0);

  const cgstFromLines = safeLines.reduce((sum, line) => sum + parseNumber(line?.cgstAmount), 0);
  const sgstFromLines = safeLines.reduce((sum, line) => sum + parseNumber(line?.sgstAmount), 0);
  const igstFromLines = safeLines.reduce((sum, line) => sum + parseNumber(line?.igstAmount), 0);
  const vatFromLines = safeLines.reduce((sum, line) => sum + parseNumber(line?.vatAmount), 0);
  const cessFromLines = safeLines.reduce((sum, line) => sum + parseNumber(line?.cessAmount), 0);
  const numericTaxFromTotals =
    typeof totals?.tax === "number" ? parseNumber(totals.tax) : parseNumber(totals?.totalTax);

  const cgst = cgstFromLines || parseNumber(taxInput?.cgst ?? taxBreakup?.cgst);
  const sgst = sgstFromLines || parseNumber(taxInput?.sgst ?? taxBreakup?.sgst);
  const igst = igstFromLines || parseNumber(taxInput?.igst ?? taxBreakup?.igst);
  let vat = vatFromLines || parseNumber(taxInput?.vat ?? taxBreakup?.vat);
  const cess = cessFromLines || parseNumber(taxInput?.cess ?? taxBreakup?.cess);
  const normalTaxAmount =
    parseNumber(taxInput?.taxAmount ?? taxBreakup?.taxAmount ?? taxInput?.totalTax ?? taxBreakup?.totalTax);

  if (!cgst && !sgst && !igst && !vat && normalTaxAmount > 0) {
    vat = normalTaxAmount;
  }
  if (!cgst && !sgst && !igst && !vat && numericTaxFromTotals > 0) {
    vat = numericTaxFromTotals;
  }

  const subTotal = lineSubTotal || parseNumber(totals?.subTotal);
  const roundOff = parseNumber(totals?.roundOff);
  const taxTotal = cgst + sgst + igst + vat + cess;
  const computedGrand = subTotal + taxTotal + roundOff;
  const providedGrand = parseNumber(totals?.grandTotal);

  return {
    subTotal,
    cgst,
    sgst,
    igst,
    vat,
    cess,
    roundOff,
    taxTotal,
    grandTotal: providedGrand > 0 ? providedGrand : computedGrand
  };
}

export function invoiceCalculateSummary(lines, totalsInput = {}) {
  const summary = calculateInvoiceSummary(lines, totalsInput);
  return {
    subTotal: summary.subTotal,
    igst: summary.igst,
    cgst: summary.cgst,
    sgst: summary.sgst,
    grandTotal: summary.grandTotal
  };
}

function invoiceDateForFilter(entry) {
  return entry?.invoiceDate || entry?.invoice_date || entry?.date || entry?.created_at;
}

export function invoicesList(range) {
  const rows = getAll();
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);
  if (!fromDate && !toDate) return rows;
  return rows.filter((entry) => matchesFinancialYearFilter(invoiceDateForFilter(entry), { fromDate, toDate }));
}

export async function invoicesSyncFromRemote(range) {
  if (!isSupabaseConfigured || !supabase) return invoicesList(range);

  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (!organizationId) return invoicesList(range);
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);

  let invoiceQuery = supabase
    .from("invoices")
    .select("*")
    .eq("organization_id", organizationId);
  if (fromDate) invoiceQuery = invoiceQuery.gte("invoice_date", fromDate);
  if (toDate) invoiceQuery = invoiceQuery.lte("invoice_date", toDate);

  const { data: invoiceRows, error: invoiceError } = await invoiceQuery
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (invoiceError) {
    throw new Error(normalizeSupabaseError(invoiceError, "Failed to load invoices"));
  }

  const ids = (Array.isArray(invoiceRows) ? invoiceRows : []).map((row) => row.id).filter(Boolean);
  let lineRows = [];
  let paymentRows = [];
  let creditRows = [];
  if (ids.length) {
    const { data: linesData, error } = await supabase
      .from("invoice_items")
      .select("*")
      .in("invoice_id", ids)
      .order("line_no", { ascending: true });
    if (error) {
      throw new Error(normalizeSupabaseError(error, "Failed to load invoice lines"));
    }
    lineRows = Array.isArray(linesData) ? linesData : [];

    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .select("invoice_id,amount,tds_amount,status,direction")
      .eq("organization_id", organizationId)
      .eq("direction", "in")
      .in("invoice_id", ids);
    if (paymentError) {
      throw new Error(normalizeSupabaseError(paymentError, "Failed to load invoice payment allocations"));
    }
    paymentRows = Array.isArray(paymentData) ? paymentData : [];

    const { data: creditData, error: creditError } = await supabase
      .from("credit_notes")
      .select("related_invoice_id,grand_total,status")
      .eq("organization_id", organizationId)
      .eq("status", "applied")
      .in("related_invoice_id", ids);
    if (creditError) {
      throw new Error(normalizeSupabaseError(creditError, "Failed to load applied credit notes"));
    }
    creditRows = Array.isArray(creditData) ? creditData : [];
  }

  const lineMap = new Map();
  lineRows.forEach((line) => {
    const list = lineMap.get(line.invoice_id) || [];
    list.push(line);
    lineMap.set(line.invoice_id, list);
  });

  const paymentMap = new Map();
  paymentRows.forEach((row) => {
    const invoiceId = row?.invoice_id;
    if (!invoiceId) return;
    const status = String(row?.status || "").toLowerCase();
    if (status === "draft" || status === "cancelled") return;
    const current = paymentMap.get(invoiceId) || 0;
    paymentMap.set(
      invoiceId,
      current + Math.max(0, parseNumber(row?.amount)) + Math.max(0, parseNumber(row?.tds_amount))
    );
  });

  const creditMap = new Map();
  creditRows.forEach((row) => {
    const invoiceId = row?.related_invoice_id;
    if (!invoiceId) return;
    const current = creditMap.get(invoiceId) || 0;
    creditMap.set(invoiceId, current + Math.max(0, parseNumber(row?.grand_total)));
  });

  const mapped = (Array.isArray(invoiceRows) ? invoiceRows : []).map((row) =>
    mapRemoteInvoiceRow(
      row,
      lineMap.get(row.id) || [],
      parseNumber(row?.grand_total) - (paymentMap.get(row.id) || 0) - (creditMap.get(row.id) || 0)
    )
  );

  if (!fromDate && !toDate) {
    setAll(mapped);
  }
  await triggerCreditLimitNotifications();
  await triggerLowStockNotifications();
  return mapped;
}

export async function invoicesCreate(invoice) {
  assertInvoiceWritePermission();
  const now = new Date().toISOString();
  const invoiceDate = invoice?.invoiceDate || now.slice(0, 10);
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (isSupabaseConfigured && supabase && !organizationId) {
    throw new Error("Organization is required to save invoices.");
  }
  const actor = authGetUser();
  const actorUserId = actor?.id || null;
  const actorName = String(actor?.name || actor?.email || "").trim();
  const requestedInvoiceNo = String(invoice?.invoiceNo || "").trim();
  const previewInvoiceNo = String(
    companyPeekDocumentNumber("invoice", { dateValue: invoiceDate }) || ""
  ).trim();
  if (!requestedInvoiceNo && !previewInvoiceNo) {
    throw new Error("Invoice Number is required.");
  }
  const lines = Array.isArray(invoice?.lines) ? invoice.lines : [];
  const totals = invoice?.totals || {};
  const tax = totals?.tax || {};
  const taxBreakup =
    totals?.taxBreakup && typeof totals.taxBreakup === "object"
      ? totals.taxBreakup
      : invoice?.taxBreakup && typeof invoice.taxBreakup === "object"
        ? invoice.taxBreakup
        : null;
  const summary = calculateInvoiceSummary(lines, totals);
  const subTotal = summary.subTotal;
  const grandTotal = summary.grandTotal;
  const matchedFinancialYear =
    (await financialYearsEnsureForDate(invoiceDate, null, { organizationId }).catch(() => null)) ||
    financialYearsResolveForDate(invoiceDate);
  let id = uid("inv_");
  let invoiceNo = "";
  let saveError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    invoiceNo = await resolveUniqueInvoiceNumber(requestedInvoiceNo, invoiceDate, organizationId);
    if (!invoiceNo || hasInvoiceNumberConflict(invoiceNo)) {
      continue;
    }

    if (isSupabaseConfigured && supabase && organizationId) {
      const remotePayload = {
        organization_id: organizationId,
        financial_year_id: looksLikeUuid(matchedFinancialYear?.id) ? matchedFinancialYear.id : null,
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        due_date: invoice?.dueDate || invoiceDate,
        party_id: looksLikeUuid(invoice?.partyId) ? invoice.partyId : null,
        place_of_supply_state: invoice?.placeOfSupply || null,
        currency_code: String(invoice?.companySnapshot?.currency || invoice?.currency || "INR")
          .trim()
          .toUpperCase(),
        subtotal: subTotal,
        discount_total: parseNumber(totals?.discountTotal),
        taxable_total: parseNumber(totals?.taxableTotal ?? subTotal),
        cgst_total: summary.cgst,
        sgst_total: summary.sgst,
        igst_total: summary.igst,
        cess_total: summary.cess,
        vat_total: summary.vat,
        tax_total: summary.taxTotal,
        round_off: summary.roundOff,
        grand_total: grandTotal,
        status: deriveInvoiceStatus(grandTotal, grandTotal),
        metadata: {
          country: invoice?.country || "",
          partyName: invoice?.partyName || "",
          createdByName: actorName,
          buyer: invoice?.buyer || {},
          seller: invoice?.seller || {},
          placeOfSupply: invoice?.placeOfSupply || "",
          taxType: tax?.type || invoice?.taxMode || "",
          taxMode: invoice?.taxMode || tax?.type || "",
          supplyType: invoice?.supplyType || tax?.supplyType || taxBreakup?.supplyType || null,
          taxBreakup,
          templateId: invoice?.templateId || "",
          financialYearId: matchedFinancialYear?.id || "",
          financialYearLabel: matchedFinancialYear?.label || "",
          financialYearCode: matchedFinancialYear?.yearCode || ""
        },
        created_by: actorUserId
      };

      const postingPayload = {
        organization_id: organizationId,
        invoice_no: remotePayload.invoice_no,
        invoice_date: remotePayload.invoice_date,
        due_date: remotePayload.due_date,
        party_id: remotePayload.party_id,
        place_of_supply_state: remotePayload.place_of_supply_state,
        currency_code: remotePayload.currency_code,
        country: invoice?.country || "",
        tax_mode: invoice?.taxMode || tax?.type || "",
        supply_type: invoice?.supplyType || tax?.supplyType || taxBreakup?.supplyType || null,
        party_name: invoice?.partyName || "",
        created_by_name: actorName,
        round_off: summary.roundOff,
        lines: lines.map((line, index) => ({
          line_no: index + 1,
          item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
          manual_batch_id: looksLikeUuid(line?.selectedBatchId) ? line.selectedBatchId : null,
          taxInclusive:
            line?.taxInclusive === true ||
            String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX",
          priceTaxMode:
            String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX"
              ? "WITH_TAX"
              : "WITHOUT_TAX",
          description: line?.itemName || line?.name || line?.description || `Line ${index + 1}`,
          hsn: line?.hsn || line?.hsnSac || null,
          qty: parseNumber(line?.qty ?? line?.quantity),
          unit: line?.unit || null,
          rate: parseNumber(line?.rate ?? line?.unitPrice),
          discount: parseNumber(line?.discountAmount ?? line?.discount),
          discountPercent: parseNumber(line?.discountPercent),
          tax: parseNumber(line?.taxRate ?? line?.tax),
          taxableAmount: parseNumber(
            line?.taxableAmount ?? line?.net ?? parseNumber(line?.qty) * parseNumber(line?.rate)
          ),
          cgstAmount: parseNumber(line?.cgstAmount),
          sgstAmount: parseNumber(line?.sgstAmount),
          igstAmount: parseNumber(line?.igstAmount),
          vatAmount: parseNumber(line?.vatAmount),
          cessAmount: parseNumber(line?.cessAmount)
        }))
      };

      const { data: postedInvoice, error: postError } = await supabase.rpc("post_invoice_fifo", {
        p_payload: postingPayload
      });

      if (!postError && postedInvoice?.invoice_id) {
        id = postedInvoice.invoice_id;
      } else {
        if (postError && isUniqueConstraintError(postError)) {
          saveError = postError;
          continue;
        }
        if (postError && !isMissingRpcError(postError)) {
          throw new Error(normalizeSupabaseError(postError, "Failed to post invoice"));
        }

        let headerResult = await supabase.from("invoices").insert(remotePayload).select("*").single();
        if (headerResult.error && isMissingColumnError(headerResult.error)) {
          const { financial_year_id, ...legacyPayload } = remotePayload;
          headerResult = await supabase.from("invoices").insert(legacyPayload).select("*").single();
        }
        const { data: header, error: headerError } = headerResult;

        if (headerError) {
          if (isUniqueConstraintError(headerError)) {
            saveError = headerError;
            continue;
          }
          throw new Error(normalizeSupabaseError(headerError, "Failed to save invoice"));
        }

        id = header?.id || id;

        const { error: deleteLinesError } = await supabase
          .from("invoice_items")
          .delete()
          .eq("invoice_id", id);
        if (deleteLinesError) {
          throw new Error(
            normalizeSupabaseError(deleteLinesError, "Failed to refresh invoice line items")
          );
        }

        const remoteLines = buildRemoteLines(id, lines);
        if (remoteLines.length) {
          const { error: linesError } = await supabase.from("invoice_items").insert(remoteLines);
          if (linesError) {
            throw new Error(normalizeSupabaseError(linesError, "Failed to save invoice line items"));
          }
        }
      }
    }

    saveError = null;
    break;
  }

  if (saveError) {
    throw new Error("Failed to generate a unique invoice number. Please retry.");
  }
  if (!invoiceNo || hasInvoiceNumberConflict(invoiceNo)) {
    throw new Error("Failed to allocate a unique invoice number.");
  }

  const next = annotateWithFinancialYear({
    ...invoice,
    id,
    invoiceNo,
    invoiceDate: invoice?.invoiceDate || now.slice(0, 10),
    dueDate: invoice?.dueDate || invoice?.invoiceDate || now.slice(0, 10),
    totals: {
      ...totals,
      subTotal,
      tax: {
        ...(typeof tax === "object" ? tax : {}),
        cgst: summary.cgst,
        sgst: summary.sgst,
        igst: summary.igst,
        vat: summary.vat,
        cess: summary.cess,
        totalTax: summary.taxTotal
      },
      taxBreakup,
      grandTotal,
      balance: grandTotal
    },
    taxMode: invoice?.taxMode || tax?.type || "",
    currency: String(invoice?.companySnapshot?.currency || invoice?.currency || "").trim().toUpperCase(),
    supplyType: invoice?.supplyType || tax?.supplyType || taxBreakup?.supplyType || null,
    remainingBalance: grandTotal,
    createdByUserId: actorUserId,
    createdByName: actorName,
    createdBy: actorName || String(actorUserId || "").trim(),
    created_at: now,
    updated_at: now
  }, invoice?.invoiceDate || now.slice(0, 10));

  setAll([next, ...getAll().filter((entry) => entry.id !== id && entry.invoiceNo !== invoiceNo)]);
  companySyncDocumentCounter("invoice", invoiceNo, { dateValue: invoiceDate });
  applyInvoiceStockAdjustment(lines, 1);
  console.log("[CreditMonitoring] Triggering notification check from invoicesCreate", {
    invoiceId: id,
    invoiceNo,
    partyId: next?.partyId || null
  });
  await triggerCreditLimitNotifications();
  await triggerLowStockNotifications();
  return id;
}

export async function invoicesUpdate(invoiceId, invoice) {
  assertInvoiceWritePermission();

  const existingId = String(invoiceId || invoice?.id || "").trim();
  if (!existingId) {
    throw new Error("Invoice id is required.");
  }

  const existing = getAll().find((entry) => String(entry?.id || "").trim() === existingId);
  if (!existing) {
    throw new Error("Invoice not found.");
  }

  const now = new Date().toISOString();
  const invoiceDate = invoice?.invoiceDate || existing?.invoiceDate || now.slice(0, 10);
  const actor = authGetUser();
  const actorUserId = actor?.id || existing?.createdByUserId || null;
  const actorName =
    String(actor?.name || actor?.email || existing?.createdByName || existing?.createdBy || "").trim();
  const organizationId = await authEnsureOrganizationAccess(authGetOrganizationId());
  if (isSupabaseConfigured && supabase && !organizationId) {
    throw new Error("Organization is required to save invoices.");
  }

  const requestedInvoiceNo = String(invoice?.invoiceNo || existing?.invoiceNo || "").trim();
  if (!requestedInvoiceNo) {
    throw new Error("Invoice Number is required.");
  }
  if (hasInvoiceNumberConflict(requestedInvoiceNo, existingId)) {
    throw new Error("Invoice number already exists");
  }
  if (await invoiceNumberExistsRemotely(organizationId, requestedInvoiceNo, looksLikeUuid(existingId) ? existingId : "")) {
    throw new Error("Invoice number already exists");
  }

  const lines = Array.isArray(invoice?.lines) ? invoice.lines : [];
  const totals = invoice?.totals || {};
  const tax = totals?.tax || {};
  const taxBreakup =
    totals?.taxBreakup && typeof totals.taxBreakup === "object"
      ? totals.taxBreakup
      : invoice?.taxBreakup && typeof invoice.taxBreakup === "object"
        ? invoice.taxBreakup
        : existing?.totals?.taxBreakup && typeof existing.totals.taxBreakup === "object"
          ? existing.totals.taxBreakup
          : null;
  const summary = calculateInvoiceSummary(lines, totals);
  const matchedFinancialYear =
    (await financialYearsEnsureForDate(invoiceDate, null, { organizationId }).catch(() => null)) ||
    financialYearsResolveForDate(invoiceDate);
  const priorGrandTotal = parseNumber(existing?.totals?.grandTotal);
  const priorBalance = Math.max(
    0,
    parseNumber(existing?.remainingBalance ?? existing?.totals?.balance ?? priorGrandTotal)
  );
  const settledAmount = Math.max(0, priorGrandTotal - priorBalance);
  const nextBalance = Math.max(0, summary.grandTotal - settledAmount);
  const nextStatus =
    String(existing?.status || "").toLowerCase() === "cancelled"
      ? "cancelled"
      : deriveInvoiceStatus(summary.grandTotal, nextBalance);

  if (isSupabaseConfigured && supabase && organizationId && looksLikeUuid(existingId)) {
    const remotePayload = {
      financial_year_id: looksLikeUuid(matchedFinancialYear?.id) ? matchedFinancialYear.id : null,
      invoice_no: requestedInvoiceNo,
      invoice_date: invoiceDate,
      due_date: invoice?.dueDate || existing?.dueDate || invoiceDate,
      party_id: looksLikeUuid(invoice?.partyId) ? invoice.partyId : null,
      place_of_supply_state: invoice?.placeOfSupply || null,
      currency_code: String(invoice?.companySnapshot?.currency || invoice?.currency || "INR")
        .trim()
        .toUpperCase(),
      subtotal: summary.subTotal,
      discount_total: parseNumber(totals?.discountTotal),
      taxable_total: parseNumber(totals?.taxableTotal ?? summary.subTotal),
      cgst_total: summary.cgst,
      sgst_total: summary.sgst,
      igst_total: summary.igst,
      cess_total: summary.cess,
      vat_total: summary.vat,
      tax_total: summary.taxTotal,
      round_off: summary.roundOff,
      grand_total: summary.grandTotal,
      status: nextStatus,
      metadata: {
        country: invoice?.country || "",
        partyName: invoice?.partyName || "",
        createdByName: String(existing?.createdByName || actorName).trim(),
        updatedByName: actorName,
        buyer: invoice?.buyer || {},
        seller: invoice?.seller || {},
        placeOfSupply: invoice?.placeOfSupply || "",
        taxType: tax?.type || invoice?.taxMode || "",
        taxMode: invoice?.taxMode || tax?.type || "",
        supplyType: invoice?.supplyType || tax?.supplyType || taxBreakup?.supplyType || null,
        taxBreakup,
        templateId: invoice?.templateId || "",
        financialYearId: matchedFinancialYear?.id || "",
        financialYearLabel: matchedFinancialYear?.label || "",
        financialYearCode: matchedFinancialYear?.yearCode || ""
      }
    };

    let updateResult = await supabase
      .from("invoices")
      .update(remotePayload)
      .eq("id", existingId)
      .eq("organization_id", organizationId)
      .select("id")
      .single();
    if (updateResult.error && isMissingColumnError(updateResult.error)) {
      const { financial_year_id, ...legacyPayload } = remotePayload;
      updateResult = await supabase
        .from("invoices")
        .update(legacyPayload)
        .eq("id", existingId)
        .eq("organization_id", organizationId)
        .select("id")
        .single();
    }
    if (updateResult.error) {
      throw new Error(normalizeSupabaseError(updateResult.error, "Failed to update invoice"));
    }

    const { error: deleteLinesError } = await supabase
      .from("invoice_items")
      .delete()
      .eq("invoice_id", existingId);
    if (deleteLinesError) {
      throw new Error(normalizeSupabaseError(deleteLinesError, "Failed to refresh invoice line items"));
    }

    const remoteLines = buildRemoteLines(existingId, lines);
    if (remoteLines.length) {
      const { error: linesError } = await supabase.from("invoice_items").insert(remoteLines);
      if (linesError) {
        throw new Error(normalizeSupabaseError(linesError, "Failed to save invoice line items"));
      }
    }
  }

  const next = annotateWithFinancialYear({
    ...existing,
    ...invoice,
    id: existingId,
    invoiceNo: requestedInvoiceNo,
    invoiceDate,
    dueDate: invoice?.dueDate || existing?.dueDate || invoiceDate,
    totals: {
      ...existing?.totals,
      ...totals,
      subTotal: summary.subTotal,
      tax: {
        ...(existing?.totals?.tax && typeof existing.totals.tax === "object" ? existing.totals.tax : {}),
        ...(typeof tax === "object" ? tax : {}),
        cgst: summary.cgst,
        sgst: summary.sgst,
        igst: summary.igst,
        vat: summary.vat,
        cess: summary.cess,
        totalTax: summary.taxTotal
      },
      taxBreakup,
      grandTotal: summary.grandTotal,
      balance: nextBalance
    },
    taxMode: invoice?.taxMode || tax?.type || existing?.taxMode || "",
    currency: String(invoice?.companySnapshot?.currency || invoice?.currency || existing?.currency || "").trim().toUpperCase(),
    supplyType: invoice?.supplyType || tax?.supplyType || taxBreakup?.supplyType || existing?.supplyType || null,
    remainingBalance: nextBalance,
    status: nextStatus,
    createdByUserId: existing?.createdByUserId || actorUserId,
    createdByName: existing?.createdByName || actorName,
    createdBy: existing?.createdBy || actorName || String(actorUserId || "").trim(),
    updated_at: now
  }, invoiceDate);

  setAll([next, ...getAll().filter((entry) => String(entry?.id || "") !== existingId)]);
  companySyncDocumentCounter("invoice", requestedInvoiceNo, { dateValue: invoiceDate });
  applyInvoiceStockAdjustment(existing?.lines || [], -1);
  applyInvoiceStockAdjustment(lines, 1);
  await triggerCreditLimitNotifications();
  await triggerLowStockNotifications();
  return existingId;
}
