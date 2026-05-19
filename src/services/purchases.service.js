import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId, authGetRole, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { canCreateEntries, canEditEntries } from "./roles";
import { triggerCreditLimitNotifications } from "../modules/parties/store";
import { triggerLowStockNotifications } from "../modules/items/store";
import { createItemBarcodesForPurchase } from "./itemBarcodes.service";
import { companyPeekDocumentNumber, companySyncDocumentCounter } from "./company.service";
import {
  annotateWithFinancialYear,
  financialYearsEnsureForDate,
  financialYearsResolveForDate,
  matchesFinancialYearFilter,
  resolveFinancialYearFilterRange
} from "./financialYears.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
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

function parseBillNumberParts(value) {
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

function hasPurchaseNumberConflict(billNumber, excludeId = "") {
  const normalized = String(billNumber || "").trim().toLowerCase();
  const ignoredId = String(excludeId || "").trim();
  if (!normalized) return false;
  return getAll().some((entry) => {
    if (ignoredId && String(entry?.id || "").trim() === ignoredId) return false;
    return String(entry?.billNumber || "").trim().toLowerCase() === normalized;
  });
}

async function fetchLatestRemotePurchaseNumber(organizationId, basePrefix) {
  if (!isSupabaseConfigured || !supabase || !organizationId || !basePrefix) return "";
  const { data, error } = await supabase
    .from("purchase_bills")
    .select("bill_no")
    .eq("organization_id", organizationId)
    .like("bill_no", `${basePrefix}%`)
    .order("bill_no", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingColumnError(error)) return "";
    throw new Error(normalizeSupabaseError(error, "Failed to load latest purchase number"));
  }

  return String((Array.isArray(data) ? data[0] : null)?.bill_no || "").trim();
}

async function purchaseNumberExistsRemotely(organizationId, billNumber, excludeId = "") {
  if (!isSupabaseConfigured || !supabase || !organizationId || !billNumber) return false;
  let query = supabase
    .from("purchase_bills")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("bill_no", billNumber);

  const ignoredId = String(excludeId || "").trim();
  if (ignoredId) {
    query = query.neq("id", ignoredId);
  }

  const { data, error } = await query.limit(1);

  if (error) {
    if (isMissingColumnError(error)) return false;
    throw new Error(normalizeSupabaseError(error, "Failed to validate purchase number"));
  }

  return Array.isArray(data) && data.length > 0;
}

async function resolveUniquePurchaseNumber(requestedBillNumber, billDate, organizationId) {
  const normalizedRequested = String(requestedBillNumber || "").trim();
  const previewBillNumber = String(
    companyPeekDocumentNumber("purchase", { dateValue: billDate }) || ""
  ).trim();
  const preferredBillNumber = normalizedRequested || previewBillNumber || `BILL-${Date.now()}`;
  const requestedParts = parseBillNumberParts(preferredBillNumber);
  const fallbackParts = parseBillNumberParts(previewBillNumber || preferredBillNumber);
  const baseParts = requestedParts?.sequence > 0 ? requestedParts : fallbackParts;

  if (
    normalizedRequested &&
    !hasPurchaseNumberConflict(normalizedRequested) &&
    !(await purchaseNumberExistsRemotely(organizationId, normalizedRequested))
  ) {
    return normalizedRequested;
  }

  if (!baseParts) return preferredBillNumber;

  const localMax = getAll().reduce((maxValue, entry) => {
    const parts = parseBillNumberParts(entry?.billNumber || "");
    if (!parts || parts.base !== baseParts.base) return maxValue;
    return Math.max(maxValue, parts.sequence);
  }, 0);
  const remoteParts = parseBillNumberParts(
    await fetchLatestRemotePurchaseNumber(organizationId, baseParts.base)
  );
  const remoteMax = remoteParts?.base === baseParts.base ? remoteParts.sequence : 0;
  const seedSequence = baseParts.sequence > 0 ? baseParts.sequence - 1 : 0;

  for (let offset = 1; offset <= 5; offset += 1) {
    const candidate = `${baseParts.base}${String(
      Math.max(localMax, remoteMax, seedSequence) + offset
    ).padStart(Math.max(baseParts.width, 4), "0")}`;
    if (hasPurchaseNumberConflict(candidate)) continue;
    if (await purchaseNumberExistsRemotely(organizationId, candidate)) continue;
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
    message.includes("post_purchase_bill_fifo")
  );
}

function isMissingColumnError(error) {
  return String(error?.code || "").toUpperCase() === "42703";
}

function normalizeAddressParts(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function getLocalSupplierAddress(supplierId) {
  if (!supplierId) return "";
  const parties = lsGetOrganizationScoped(LS_KEYS.parties, []);
  const matched = (Array.isArray(parties) ? parties : []).find((party) => party?.id === supplierId);
  if (!matched) return "";
  return normalizeAddressParts([
    matched?.address,
    matched?.city,
    matched?.state,
    matched?.postalCode
  ]);
}

export async function fetchSupplierAddress(supplierId) {
  if (!supplierId) return "";
  const fallbackAddress = getLocalSupplierAddress(supplierId);
  if (!isSupabaseConfigured || !supabase || !looksLikeUuid(supplierId)) {
    return fallbackAddress;
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) return fallbackAddress;

  const { data, error } = await supabase
    .from("parties")
    .select("billing_address_line1,billing_address_line2,city,state_name,postal_code")
    .eq("organization_id", organizationId)
    .eq("id", supplierId)
    .maybeSingle();

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to fetch supplier address"));
  }

  return normalizeAddressParts([
    data?.billing_address_line1,
    data?.billing_address_line2,
    data?.city,
    data?.state_name,
    data?.postal_code
  ]) || fallbackAddress;
}

function deriveBillStatus(grandTotal, balanceAmount) {
  const grand = Math.max(0, parseNumber(grandTotal));
  const balance = Math.max(0, parseNumber(balanceAmount));
  if (grand <= 0) return "draft";
  if (balance <= 0) return "paid";
  if (balance < grand) return "partial";
  return "issued";
}

function assertPurchaseWritePermission() {
  const role = authGetRole();
  if (!canCreateEntries(role) && !canEditEntries(role)) {
    throw new Error("You do not have permission to save purchase bills.");
  }
}

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.purchases, []);
}
function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.purchases, list);
}

function paymentOutAllocationTdsShare(record, line) {
  const totalTdsAmount = Math.max(0, parseNumber(record?.totals?.tdsAmount));
  if (totalTdsAmount <= 0) return 0;

  const allocations = ensureArray(record?.allocations);
  const positiveAllocations = allocations.filter((entry) => Math.max(0, parseNumber(entry?.applyAmount)) > 0);
  if (!positiveAllocations.length) return 0;

  const totalApplied = positiveAllocations.reduce(
    (sum, entry) => sum + Math.max(0, parseNumber(entry?.applyAmount)),
    0
  );
  const lineBillId = String(line?.billId || "").trim();
  const positiveIndex = positiveAllocations.findIndex(
    (entry) => String(entry?.billId || "").trim() === lineBillId
  );
  if (positiveIndex < 0) return 0;

  const appliedAmount = Math.max(0, parseNumber(line?.applyAmount));
  if (appliedAmount <= 0 || totalApplied <= 0) return 0;

  if (positiveAllocations.length === 1) {
    return totalTdsAmount;
  }

  const rawShare = (appliedAmount / totalApplied) * totalTdsAmount;
  if (positiveIndex === positiveAllocations.length - 1) {
    const allocatedBefore = positiveAllocations
      .slice(0, positiveIndex)
      .reduce((sum, entry) => sum + paymentOutAllocationTdsShare(record, entry), 0);
    return Math.max(0, totalTdsAmount - allocatedBefore);
  }

  return Math.max(0, Number(rawShare.toFixed(2)));
}

function appliedPaymentOutForBillLocal(billId) {
  const normalizedBillId = String(billId || "").trim();
  if (!normalizedBillId) return 0;

  const legacy = ensureArray(lsGetOrganizationScoped(LS_KEYS.payments, []))
    .filter((entry) => String(entry?.direction || "").toUpperCase() === "OUT")
    .filter((entry) => !String(entry?.referenceNo || entry?.reference_no || "").startsWith("PO:"))
    .filter((entry) => String(entry?.billId || entry?.bill_id || "").trim() === normalizedBillId)
    .reduce(
      (sum, entry) =>
        sum +
        Math.max(0, parseNumber(entry?.amount)) +
        Math.max(0, parseNumber(entry?.tdsAmount || entry?.tds_amount)),
      0
    );

  const premium = ensureArray(lsGetOrganizationScoped("paymentOutPremiumV1", []))
    .filter((entry) => String(entry?.status || "") === "Applied")
    .reduce(
      (sum, entry) =>
        sum +
        ensureArray(entry?.allocations)
          .filter((line) => String(line?.billId || "").trim() === normalizedBillId)
          .reduce(
            (lineSum, line) =>
              lineSum +
              Math.max(0, parseNumber(line?.applyAmount)) +
              paymentOutAllocationTdsShare(entry, line),
            0
          ),
      0
    );

  return legacy + premium;
}

function appliedDebitForBillLocal(billId) {
  const normalizedBillId = String(billId || "").trim();
  if (!normalizedBillId) return 0;

  return ensureArray(lsGetOrganizationScoped("debitNotesPremiumV1", []))
    .filter((entry) => String(entry?.status || "") === "Applied")
    .reduce((sum, entry) => {
      const applications = ensureArray(entry?.debitApplications);
      const hasTransferredApplications = applications.length > 0;
      const directApplied =
        !hasTransferredApplications &&
        String(entry?.linkedPurchaseInvoiceId || "").trim() === normalizedBillId
          ? Math.max(0, parseNumber(entry?.totals?.total))
          : 0;
      const transferredApplied = applications
        .filter((line) => String(line?.billId || "").trim() === normalizedBillId)
        .reduce((lineSum, line) => lineSum + Math.max(0, parseNumber(line?.applyAmount)), 0);
      return sum + directApplied + transferredApplied;
    }, 0);
}

function recalculatePurchaseBalance(entry) {
  const grandTotal = Math.max(
    0,
    parseNumber(
      entry?.totals?.grandTotal ??
        entry?.totals?.finalTotal ??
        entry?.totals?.total ??
        entry?.grandTotal
    )
  );
  const paymentApplied = appliedPaymentOutForBillLocal(entry?.id);
  const debitApplied = appliedDebitForBillLocal(entry?.id);
  const storedBalance = Math.max(
    0,
    parseNumber(entry?.remainingBalance ?? entry?.totals?.balance ?? grandTotal)
  );
  const hasLinkedActivity = paymentApplied > 0 || debitApplied > 0;
  const effectiveBalance = Math.max(
    0,
    hasLinkedActivity ? grandTotal - paymentApplied - debitApplied : storedBalance
  );

  return {
    ...entry,
    remainingBalance: effectiveBalance,
    totals: {
      ...(entry?.totals || {}),
      balance: effectiveBalance
    },
    status:
      String(entry?.status || "").toLowerCase() === "cancelled"
        ? "cancelled"
        : deriveBillStatus(grandTotal, effectiveBalance)
  };
}

function applyPurchaseStockDelta(lines, direction = 1) {
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
    const nextCurrentStock = Math.max(0, currentStock + delta);
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

export function purchasesGetById(purchaseId) {
  const normalizedId = String(purchaseId || "").trim();
  if (!normalizedId) return null;
  const matched = getAll().find((entry) => String(entry?.id || "").trim() === normalizedId) || null;
  return matched ? recalculatePurchaseBalance(matched) : null;
}

function calculatePurchaseSummary(lines, totalsInput = {}) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const totals = totalsInput && typeof totalsInput === "object" ? totalsInput : {};
  const totalQtyFromLines = safeLines.reduce(
    (sum, line) => sum + Math.max(0, parseNumber(line?.qty ?? line?.quantity)),
    0
  );
  const subTotalFromLines = safeLines.reduce(
    (sum, line) => sum + Math.max(0, parseNumber(line?.lineSubTotal ?? parseNumber(line?.qty) * parseNumber(line?.rate))),
    0
  );
  const taxTotalFromLines = safeLines.reduce(
    (sum, line) =>
      sum +
      parseNumber(
        line?.lineTax ??
          parseNumber(line?.cgstAmount) +
            parseNumber(line?.sgstAmount) +
            parseNumber(line?.igstAmount) +
            parseNumber(line?.vatAmount)
      ),
    0
  );

  const totalQty = totalQtyFromLines || parseNumber(totals?.totalQty);
  const subTotal = subTotalFromLines || parseNumber(totals?.subTotal);
  const taxTotal = taxTotalFromLines || parseNumber(totals?.taxTotal);
  const roundOff = parseNumber(totals?.roundOff);
  const providedGrandTotal = parseNumber(totals?.grandTotal);

  return {
    totalQty,
    subTotal,
    taxTotal,
    roundOff,
    grandTotal: providedGrandTotal || subTotal + taxTotal + roundOff
  };
}

function buildRemotePurchaseLines(billId, lines) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => ({
    bill_id: billId,
    item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
    item_code: line?.itemCode || null,
    description: line?.itemName || line?.name || `Line ${index + 1}`,
    qty: parseNumber(line?.qty),
    unit_price: parseNumber(line?.rate),
    tax_rate: parseNumber(line?.tax),
    taxable_amount: parseNumber(line?.lineSubTotal),
    tax_amount: parseNumber(line?.lineTax),
    tax_inclusive:
      line?.taxInclusive === true ||
      String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX",
    cgst_amount: parseNumber(line?.cgstAmount),
    sgst_amount: parseNumber(line?.sgstAmount),
    igst_amount: parseNumber(line?.igstAmount),
    vat_amount: parseNumber(line?.vatAmount ?? line?.lineTax),
    line_total: parseNumber(line?.amount)
  }));
}

function purchaseDateForFilter(entry) {
  return entry?.billDate || entry?.invoiceDate || entry?.date || entry?.created_at;
}

export function purchasesList(range) {
  const rows = getAll().map((entry) => recalculatePurchaseBalance(entry));
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);
  if (!fromDate && !toDate) return rows;
  return rows.filter((entry) => matchesFinancialYearFilter(purchaseDateForFilter(entry), { fromDate, toDate }));
}

function mapRemotePurchaseBill(row, balanceAmount) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const tax = metadata?.tax && typeof metadata.tax === "object" ? metadata.tax : {};
  const grandTotal = parseNumber(row?.grand_total);
  const effectiveBalance = Math.max(0, parseNumber(balanceAmount));
  const status =
    String(row?.status || "").toLowerCase() === "cancelled"
      ? "cancelled"
      : deriveBillStatus(grandTotal, effectiveBalance);
  const mapped = {
    id: row?.id || uid("pur_"),
    country: metadata?.country || "",
    partyId: row?.supplier_id || "",
    partyName: metadata?.partyName || "",
    partyAddress: metadata?.partyAddress || "",
    phone: metadata?.phone || "",
    billNumber: row?.bill_no || "",
    billDate: row?.bill_date || "",
    dueDate: row?.due_date || row?.bill_date || "",
    paymentType: metadata?.paymentType || "",
    created_at: row?.created_at || new Date().toISOString(),
    totals: {
      totalQty: parseNumber(metadata?.totalQty),
      subTotal: parseNumber(row?.subtotal),
      taxTotal: parseNumber(row?.tax_total),
      tax,
      taxBreakup: metadata?.taxBreakup || null,
      taxRate: parseNumber(metadata?.taxRate),
      roundOff: parseNumber(metadata?.roundOff),
      grandTotal,
      balance: effectiveBalance
    },
    taxMode: metadata?.taxMode || "",
    supplyType: metadata?.supplyType || null,
    remainingBalance: effectiveBalance,
    createdByUserId: row?.created_by || null,
    createdByName: String(metadata?.createdByName || "").trim(),
    createdBy: String(metadata?.createdByName || row?.created_by || "").trim(),
    status,
    financialYearId: row?.financial_year_id || metadata?.financialYearId || "",
    financialYearLabel: metadata?.financialYearLabel || "",
    financialYearCode: metadata?.financialYearCode || "",
    lines: []
  };
  return annotateWithFinancialYear(mapped, mapped.billDate);
}

export async function purchasesSyncFromRemote(range) {
  if (!isSupabaseConfigured || !supabase) return purchasesList(range);

  const organizationId = authGetOrganizationId();
  if (!organizationId) return purchasesList(range);
  const { fromDate, toDate } = resolveFinancialYearFilterRange(range);

  let query = supabase
    .from("purchase_bills")
    .select("id,supplier_id,financial_year_id,bill_no,bill_date,due_date,subtotal,tax_total,grand_total,status,metadata,created_at")
    .eq("organization_id", organizationId);
  if (fromDate) query = query.gte("bill_date", fromDate);
  if (toDate) query = query.lte("bill_date", toDate);

  const { data, error } = await query
    .order("bill_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load purchase bills"));
  }

  const bills = Array.isArray(data) ? data : [];
  const supplierIds = Array.from(new Set(bills.map((entry) => entry?.supplier_id).filter(Boolean)));
  let supplierAddressMap = new Map();
  if (supplierIds.length) {
    const { data: supplierRows, error: supplierError } = await supabase
      .from("parties")
      .select("id,billing_address_line1,billing_address_line2,city,state_name,postal_code")
      .eq("organization_id", organizationId)
      .in("id", supplierIds);
    if (supplierError) {
      throw new Error(normalizeSupabaseError(supplierError, "Failed to load supplier addresses"));
    }
    supplierAddressMap = new Map(
      (Array.isArray(supplierRows) ? supplierRows : []).map((row) => [
        row?.id,
        normalizeAddressParts([
          row?.billing_address_line1,
          row?.billing_address_line2,
          row?.city,
          row?.state_name,
          row?.postal_code
        ])
      ])
    );
  }
  const billIds = bills.map((entry) => entry.id).filter(Boolean);
  let lineRows = [];
  let paymentRows = [];
  let debitRows = [];
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

    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .select("bill_id,amount,status,direction")
      .eq("organization_id", organizationId)
      .eq("direction", "out")
      .in("bill_id", billIds);
    if (paymentError) {
      throw new Error(normalizeSupabaseError(paymentError, "Failed to load purchase bill payments"));
    }
    paymentRows = Array.isArray(paymentData) ? paymentData : [];

    const { data: debitData, error: debitError } = await supabase
      .from("debit_notes")
      .select("related_bill_id,grand_total,status")
      .eq("organization_id", organizationId)
      .eq("status", "applied")
      .in("related_bill_id", billIds);
    if (debitError) {
      throw new Error(normalizeSupabaseError(debitError, "Failed to load applied debit notes"));
    }
    debitRows = Array.isArray(debitData) ? debitData : [];
  }

  const lineMap = new Map();
  lineRows.forEach((line) => {
    const list = lineMap.get(line.bill_id) || [];
    list.push({
      id: line?.id || uid("pur_l_"),
      itemId: line?.item_id || "",
      itemCode: line?.item_code || "",
      itemName: line?.description || "",
      qty: parseNumber(line?.qty),
      rate: parseNumber(line?.unit_price),
      saleRate: parseNumber(line?.metadata?.suggestedSaleRate),
      tax: parseNumber(line?.tax_rate),
      taxableAmount: parseNumber(line?.taxable_amount),
      taxAmount: parseNumber(line?.tax_amount),
      taxInclusive: !!line?.tax_inclusive,
      priceTaxMode: line?.tax_inclusive ? "WITH_TAX" : "WITHOUT_TAX",
      cgstAmount: parseNumber(line?.cgst_amount),
      sgstAmount: parseNumber(line?.sgst_amount),
      igstAmount: parseNumber(line?.igst_amount),
      vatAmount: parseNumber(line?.vat_amount),
      lineTax:
        parseNumber(line?.cgst_amount) +
        parseNumber(line?.sgst_amount) +
        parseNumber(line?.igst_amount) +
        parseNumber(line?.vat_amount),
      amount: parseNumber(line?.line_total)
    });
    lineMap.set(line.bill_id, list);
  });

  const paymentMap = new Map();
  paymentRows.forEach((row) => {
    const billId = row?.bill_id;
    if (!billId) return;
    const status = String(row?.status || "").toLowerCase();
    if (status === "draft" || status === "cancelled") return;
    const current = paymentMap.get(billId) || 0;
    paymentMap.set(billId, current + Math.max(0, parseNumber(row?.amount)));
  });

  const debitMap = new Map();
  debitRows.forEach((row) => {
    const billId = row?.related_bill_id;
    if (!billId) return;
    const current = debitMap.get(billId) || 0;
    debitMap.set(billId, current + Math.max(0, parseNumber(row?.grand_total)));
  });

  const mapped = bills.map((entry) => {
    const bill = mapRemotePurchaseBill(
      entry,
      parseNumber(entry?.grand_total) + (debitMap.get(entry.id) || 0) - (paymentMap.get(entry.id) || 0)
    );
    return {
      ...bill,
      partyAddress: bill.partyAddress || supplierAddressMap.get(entry?.supplier_id) || "",
      lines: lineMap.get(entry.id) || []
    };
  });
  if (!fromDate && !toDate) {
    setAll(mapped);
  }
  await triggerCreditLimitNotifications();
  await triggerLowStockNotifications();
  return mapped;
}

export async function purchasesCreate(bill) {
  assertPurchaseWritePermission();
  const now = new Date().toISOString();
  const billDate = bill?.billDate || now.slice(0, 10);
  const requestedBillNumber = String(bill?.billNumber || "").trim();
  const actor = authGetUser();
  const actorUserId = actor?.id || null;
  const actorName = String(actor?.name || actor?.email || "").trim();
  let id = uid("pur_");
  let effectiveBillNumber = "";
  let saveError = null;
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const totals = bill?.totals || {};
  const matchedFinancialYear =
    (await financialYearsEnsureForDate(billDate).catch(() => null)) ||
    financialYearsResolveForDate(billDate);

  const organizationId = isSupabaseConfigured && supabase ? authGetOrganizationId() : "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    effectiveBillNumber = await resolveUniquePurchaseNumber(requestedBillNumber, billDate, organizationId);
    if (!effectiveBillNumber || hasPurchaseNumberConflict(effectiveBillNumber)) {
      continue;
    }

    if (isSupabaseConfigured && supabase && organizationId) {
      const supplierId = looksLikeUuid(bill?.partyId) ? bill.partyId : null;
      const postingPayload = {
        organization_id: organizationId,
        bill_no: effectiveBillNumber,
        bill_date: billDate,
        due_date: bill?.dueDate || billDate,
        supplier_id: supplierId,
        country: bill?.country || "",
        party_name: bill?.partyName || "",
        party_address: bill?.partyAddress || "",
        phone: bill?.phone || "",
        payment_type: bill?.paymentType || "",
        tax_mode: bill?.taxMode || "",
        supply_type: bill?.supplyType || "",
        created_by_name: actorName,
        lines: lines.map((line, index) => ({
          line_no: index + 1,
          item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
          item_code: line?.itemCode || null,
          item_name: line?.itemName || `Line ${index + 1}`,
          description: line?.itemName || `Line ${index + 1}`,
          qty: parseNumber(line?.qty),
          rate: parseNumber(line?.rate),
          suggested_sale_rate: parseNumber(line?.saleRate),
          tax: parseNumber(line?.tax),
          taxInclusive:
            line?.taxInclusive === true ||
            String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX",
          priceTaxMode:
            String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX"
              ? "WITH_TAX"
              : "WITHOUT_TAX"
        }))
      };

      const { data: postedBill, error: postError } = await supabase.rpc("post_purchase_bill_fifo", {
        p_payload: postingPayload
      });

      if (!postError && postedBill?.bill_id) {
        id = postedBill.bill_id;
      } else {
        if (postError && isUniqueConstraintError(postError)) {
          saveError = postError;
          continue;
        }
        if (postError && !isMissingRpcError(postError)) {
          throw new Error(normalizeSupabaseError(postError, "Failed to post purchase bill"));
        }

        let billInsert = await supabase
          .from("purchase_bills")
          .insert({
            organization_id: organizationId,
            financial_year_id: looksLikeUuid(matchedFinancialYear?.id) ? matchedFinancialYear.id : null,
            bill_no: effectiveBillNumber,
            bill_date: billDate,
            due_date: bill?.dueDate || billDate,
            supplier_id: supplierId,
            subtotal: parseNumber(totals?.subTotal),
            tax_total: parseNumber(totals?.taxTotal),
            grand_total: parseNumber(totals?.grandTotal),
            status: "issued",
            metadata: {
              country: bill?.country || "",
              partyName: bill?.partyName || "",
              createdByName: actorName,
              partyAddress: bill?.partyAddress || "",
              phone: bill?.phone || "",
              paymentType: bill?.paymentType || "",
              taxMode: bill?.taxMode || "",
              supplyType: bill?.supplyType || null,
              tax: bill?.totals?.tax || null,
              taxBreakup: bill?.totals?.taxBreakup || null,
              taxRate: parseNumber(bill?.totals?.taxRate),
              roundOff: parseNumber(totals?.roundOff),
              totalQty: parseNumber(totals?.totalQty),
              financialYearId: matchedFinancialYear?.id || "",
              financialYearLabel: matchedFinancialYear?.label || "",
              financialYearCode: matchedFinancialYear?.yearCode || ""
            },
            created_by: actorUserId
          })
          .select("*")
          .single();
        if (billInsert.error && isMissingColumnError(billInsert.error)) {
          billInsert = await supabase
            .from("purchase_bills")
            .insert({
              organization_id: organizationId,
              bill_no: effectiveBillNumber,
              bill_date: bill?.billDate || now.slice(0, 10),
              due_date: bill?.dueDate || bill?.billDate || now.slice(0, 10),
              supplier_id: supplierId,
              subtotal: parseNumber(totals?.subTotal),
              tax_total: parseNumber(totals?.taxTotal),
              grand_total: parseNumber(totals?.grandTotal),
              status: "issued",
              metadata: {
                country: bill?.country || "",
                partyName: bill?.partyName || "",
                createdByName: actorName,
                partyAddress: bill?.partyAddress || "",
                phone: bill?.phone || "",
                paymentType: bill?.paymentType || "",
                taxMode: bill?.taxMode || "",
                supplyType: bill?.supplyType || null,
                tax: bill?.totals?.tax || null,
                taxBreakup: bill?.totals?.taxBreakup || null,
                taxRate: parseNumber(bill?.totals?.taxRate),
                roundOff: parseNumber(totals?.roundOff),
                totalQty: parseNumber(totals?.totalQty),
                financialYearId: matchedFinancialYear?.id || "",
                financialYearLabel: matchedFinancialYear?.label || "",
                financialYearCode: matchedFinancialYear?.yearCode || ""
              },
              created_by: actorUserId
            })
            .select("*")
            .single();
        }
        const { data: billRow, error: billError } = billInsert;

        if (billError) {
          if (isUniqueConstraintError(billError)) {
            saveError = billError;
            continue;
          }
          throw new Error(normalizeSupabaseError(billError, "Failed to create purchase bill"));
        }

        id = billRow?.id || id;

        if (lines.length) {
          const remoteLines = lines.map((line, index) => ({
            bill_id: id,
            item_id: looksLikeUuid(line?.itemId) ? line.itemId : null,
            item_code: line?.itemCode || null,
            description: line?.itemName || `Line ${index + 1}`,
            qty: parseNumber(line?.qty),
            unit_price: parseNumber(line?.rate),
            tax_rate: parseNumber(line?.tax),
            taxable_amount: parseNumber(line?.lineSubTotal),
            tax_amount: parseNumber(line?.lineTax),
            tax_inclusive:
              line?.taxInclusive === true ||
              String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX",
            cgst_amount: parseNumber(line?.cgstAmount),
            sgst_amount: parseNumber(line?.sgstAmount),
            igst_amount: parseNumber(line?.igstAmount),
            vat_amount: parseNumber(line?.vatAmount ?? line?.lineTax),
            line_total: parseNumber(line?.amount)
          }));
          let linesInsert = await supabase.from("purchase_bill_items").insert(remoteLines);
          if (linesInsert.error?.code === "42703") {
            const legacyLines = remoteLines.map(
              ({ item_code, taxable_amount, tax_amount, tax_inclusive, suggested_sale_rate, ...line }) => line
            );
            linesInsert = await supabase.from("purchase_bill_items").insert(legacyLines);
          }
          const linesError = linesInsert.error;
          if (linesError) {
            throw new Error(normalizeSupabaseError(linesError, "Failed to save purchase bill items"));
          }
        }
      }
    }
    saveError = null;
    break;
  }

  if (saveError) {
    throw new Error("Failed to generate a unique purchase bill number. Please retry.");
  }
  if (!effectiveBillNumber || hasPurchaseNumberConflict(effectiveBillNumber)) {
    throw new Error("Failed to allocate a unique purchase bill number.");
  }

  const next = annotateWithFinancialYear({
    ...bill,
    id,
    billNumber: effectiveBillNumber,
    country: bill?.country || "",
    partyAddress: bill?.partyAddress || "",
    created_at: now,
    totals: {
      totalQty: parseNumber(totals?.totalQty),
      subTotal: parseNumber(totals?.subTotal),
      taxTotal: parseNumber(totals?.taxTotal),
      tax: totals?.tax || null,
      taxBreakup: totals?.taxBreakup || null,
      taxRate: parseNumber(totals?.taxRate),
      roundOff: parseNumber(totals?.roundOff),
      grandTotal: parseNumber(totals?.grandTotal),
      balance: parseNumber(totals?.grandTotal)
    },
    taxMode: bill?.taxMode || "",
    supplyType: bill?.supplyType || null,
    remainingBalance: parseNumber(totals?.grandTotal),
    createdByUserId: actorUserId,
    createdByName: actorName,
    createdBy: actorName || String(actorUserId || "").trim(),
    status: "issued",
    lines: lines.map((line) => ({
      ...line,
      qty: parseNumber(line?.qty),
      itemCode: line?.itemCode || "",
      rate: parseNumber(line?.rate),
      saleRate: parseNumber(line?.saleRate),
      tax: parseNumber(line?.tax),
      taxInclusive:
        line?.taxInclusive === true ||
        String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX",
      priceTaxMode:
        String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX"
          ? "WITH_TAX"
          : "WITHOUT_TAX",
      lineSubTotal: parseNumber(line?.lineSubTotal),
      lineTax: parseNumber(line?.lineTax),
      cgstAmount: parseNumber(line?.cgstAmount),
      sgstAmount: parseNumber(line?.sgstAmount),
      igstAmount: parseNumber(line?.igstAmount),
      vatAmount: parseNumber(line?.vatAmount),
      amount: parseNumber(line?.amount)
    }))
  }, bill?.billDate || now.slice(0, 10));

  setAll([next, ...getAll()]);
  companySyncDocumentCounter("purchase", effectiveBillNumber, { dateValue: billDate });
  applyPurchaseStockDelta(next.lines, 1);
  try {
    await createItemBarcodesForPurchase({
      purchaseId: id,
      billDate: bill?.billDate || now.slice(0, 10),
      lines: next.lines,
      enabled: bill?.barcodeOptions?.enabled !== false,
      mode: bill?.barcodeOptions?.mode || "unit"
    });
  } catch (error) {
    console.warn("Barcode generation failed for purchase", error);
  }
  await triggerCreditLimitNotifications();
  await triggerLowStockNotifications();
  return id;
}

export async function purchasesUpdate(purchaseId, bill) {
  assertPurchaseWritePermission();

  const existingId = String(purchaseId || bill?.id || "").trim();
  if (!existingId) {
    throw new Error("Purchase bill id is required.");
  }

  const existing = purchasesGetById(existingId);
  if (!existing) {
    throw new Error("Purchase bill not found.");
  }

  const now = new Date().toISOString();
  const billDate = bill?.billDate || existing?.billDate || now.slice(0, 10);
  const requestedBillNumber = String(bill?.billNumber || existing?.billNumber || "").trim();
  if (!requestedBillNumber) {
    throw new Error("Bill Number is required.");
  }
  if (hasPurchaseNumberConflict(requestedBillNumber, existingId)) {
    throw new Error("Bill number already exists");
  }

  const actor = authGetUser();
  const actorUserId = actor?.id || existing?.createdByUserId || null;
  const actorName =
    String(actor?.name || actor?.email || existing?.createdByName || existing?.createdBy || "").trim();
  const organizationId = isSupabaseConfigured && supabase ? authGetOrganizationId() : "";
  if (
    organizationId &&
    (await purchaseNumberExistsRemotely(
      organizationId,
      requestedBillNumber,
      looksLikeUuid(existingId) ? existingId : ""
    ))
  ) {
    throw new Error("Bill number already exists");
  }

  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const totals = bill?.totals || {};
  const summary = calculatePurchaseSummary(lines, totals);
  const matchedFinancialYear =
    (await financialYearsEnsureForDate(billDate).catch(() => null)) ||
    financialYearsResolveForDate(billDate);
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
      : deriveBillStatus(summary.grandTotal, nextBalance);

  if (isSupabaseConfigured && supabase && organizationId && looksLikeUuid(existingId)) {
    const remotePayload = {
      financial_year_id: looksLikeUuid(matchedFinancialYear?.id) ? matchedFinancialYear.id : null,
      bill_no: requestedBillNumber,
      bill_date: billDate,
      due_date: bill?.dueDate || existing?.dueDate || billDate,
      supplier_id: looksLikeUuid(bill?.partyId) ? bill.partyId : null,
      subtotal: summary.subTotal,
      tax_total: summary.taxTotal,
      grand_total: summary.grandTotal,
      status: nextStatus,
      metadata: {
        country: bill?.country || existing?.country || "",
        partyName: bill?.partyName || existing?.partyName || "",
        createdByName: String(existing?.createdByName || actorName).trim(),
        updatedByName: actorName,
        partyAddress: bill?.partyAddress || existing?.partyAddress || "",
        phone: bill?.phone || existing?.phone || "",
        paymentType: bill?.paymentType || existing?.paymentType || "",
        taxMode: bill?.taxMode || existing?.taxMode || "",
        supplyType: bill?.supplyType || existing?.supplyType || null,
        tax: bill?.totals?.tax || existing?.totals?.tax || null,
        taxBreakup: bill?.totals?.taxBreakup || existing?.totals?.taxBreakup || null,
        taxRate: parseNumber(bill?.totals?.taxRate ?? existing?.totals?.taxRate),
        roundOff: summary.roundOff,
        totalQty: summary.totalQty,
        financialYearId: matchedFinancialYear?.id || "",
        financialYearLabel: matchedFinancialYear?.label || "",
        financialYearCode: matchedFinancialYear?.yearCode || ""
      }
    };

    let updateResult = await supabase
      .from("purchase_bills")
      .update(remotePayload)
      .eq("id", existingId)
      .eq("organization_id", organizationId)
      .select("id")
      .single();
    if (updateResult.error && isMissingColumnError(updateResult.error)) {
      const { financial_year_id, ...legacyPayload } = remotePayload;
      updateResult = await supabase
        .from("purchase_bills")
        .update(legacyPayload)
        .eq("id", existingId)
        .eq("organization_id", organizationId)
        .select("id")
        .single();
    }
    if (updateResult.error) {
      throw new Error(normalizeSupabaseError(updateResult.error, "Failed to update purchase bill"));
    }

    const { error: deleteLinesError } = await supabase
      .from("purchase_bill_items")
      .delete()
      .eq("bill_id", existingId);
    if (deleteLinesError) {
      throw new Error(normalizeSupabaseError(deleteLinesError, "Failed to refresh purchase bill items"));
    }

    const remoteLines = buildRemotePurchaseLines(existingId, lines);
    if (remoteLines.length) {
      let insertResult = await supabase.from("purchase_bill_items").insert(remoteLines);
      if (insertResult.error?.code === "42703") {
        const legacyLines = remoteLines.map(
          ({ item_code, taxable_amount, tax_amount, tax_inclusive, ...line }) => line
        );
        insertResult = await supabase.from("purchase_bill_items").insert(legacyLines);
      }
      if (insertResult.error) {
        throw new Error(normalizeSupabaseError(insertResult.error, "Failed to save purchase bill items"));
      }
    }
  }

  const next = annotateWithFinancialYear({
    ...existing,
    ...bill,
    id: existingId,
    billNumber: requestedBillNumber,
    billDate,
    dueDate: bill?.dueDate || existing?.dueDate || billDate,
    country: bill?.country || existing?.country || "",
    partyAddress: bill?.partyAddress || existing?.partyAddress || "",
    totals: {
      ...existing?.totals,
      ...totals,
      totalQty: summary.totalQty,
      subTotal: summary.subTotal,
      taxTotal: summary.taxTotal,
      grandTotal: summary.grandTotal,
      balance: nextBalance
    },
    taxMode: bill?.taxMode || existing?.taxMode || "",
    supplyType: bill?.supplyType || existing?.supplyType || null,
    remainingBalance: nextBalance,
    status: nextStatus,
    createdByUserId: existing?.createdByUserId || actorUserId,
    createdByName: existing?.createdByName || actorName,
    createdBy: existing?.createdBy || actorName || String(actorUserId || "").trim(),
    updated_at: now,
    lines: lines.map((line) => ({
      ...line,
      qty: parseNumber(line?.qty),
      itemCode: line?.itemCode || "",
      rate: parseNumber(line?.rate),
      saleRate: parseNumber(line?.saleRate),
      tax: parseNumber(line?.tax),
      taxInclusive:
        line?.taxInclusive === true ||
        String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX",
      priceTaxMode:
        String(line?.priceTaxMode || "").toUpperCase() === "WITH_TAX"
          ? "WITH_TAX"
          : "WITHOUT_TAX",
      lineSubTotal: parseNumber(line?.lineSubTotal),
      lineTax: parseNumber(line?.lineTax),
      cgstAmount: parseNumber(line?.cgstAmount),
      sgstAmount: parseNumber(line?.sgstAmount),
      igstAmount: parseNumber(line?.igstAmount),
      vatAmount: parseNumber(line?.vatAmount),
      amount: parseNumber(line?.amount)
    }))
  }, billDate);

  setAll([next, ...getAll().filter((entry) => String(entry?.id || "").trim() !== existingId)]);
  companySyncDocumentCounter("purchase", requestedBillNumber, { dateValue: billDate });
  applyPurchaseStockDelta(existing?.lines || [], -1);
  applyPurchaseStockDelta(next.lines, 1);
  await triggerCreditLimitNotifications();
  await triggerLowStockNotifications();
  return existingId;
}
