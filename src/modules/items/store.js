import {
  LS_KEYS,
  lsGetOrganizationScoped,
  lsSetOrganizationScoped,
  uid
} from "../../services/storage";
import { authGetOrganizationId, authGetUser } from "../../services/auth.service";
import { isSupabaseConfigured, supabase } from "../../services/supabaseClient";
import { buildTaxLabel, normalizeItemType, normalizeText, parseNumber } from "./utils";

const CREDIT_NOTES_PREMIUM_KEY = "creditNotesPremiumV1";
const DEBIT_NOTES_PREMIUM_KEY = "debitNotesPremiumV1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_CODE_MIN_DIGITS = 4;
const ITEM_CODE_CONFIG_BY_TYPE = {
  Product: { prefix: "PRD-", pattern: /^PRD-(\d+)$/i },
  Service: { prefix: "SER-", pattern: /^SER-(\d+)$/i }
};

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
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

function normalizeItemName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findDuplicateItemByName(list, incomingName, incomingId) {
  const normalizedIncomingName = normalizeItemName(incomingName);
  if (!normalizedIncomingName) return null;
  const normalizedIncomingId = String(incomingId || "");

  for (const item of ensureArray(list)) {
    if (normalizedIncomingId && String(item?.id || "") === normalizedIncomingId) continue;
    const existingName = normalizeItemName(item?.name || item?.itemName || item?.item_name || "");
    if (!existingName) continue;
    if (existingName === normalizedIncomingName) return item;
  }
  return null;
}

async function findRemoteDuplicateItemByName(organizationId, incomingName, incomingId) {
  if (!supabase) return null;
  const normalizedIncomingName = normalizeItemName(incomingName);
  if (!normalizedIncomingName) return null;
  const normalizedIncomingId = String(incomingId || "");

  const { data, error } = await supabase
    .from("items")
    .select("id,item_name")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (error) return null;
  for (const row of ensureArray(data)) {
    if (normalizedIncomingId && String(row?.id || "") === normalizedIncomingId) continue;
    const existingName = normalizeItemName(row?.item_name || "");
    if (!existingName) continue;
    if (existingName === normalizedIncomingName) return row;
  }
  return null;
}

function parseTaxRate(label) {
  const match = String(label || "").match(/@([0-9.]+)%/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

function extractRawItemCode(item) {
  return item?.itemCode || item?.item_code || item?.metadata?.itemCode || "";
}

function normalizeItemCodeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function itemCodeConfig(type) {
  const normalizedType = normalizeItemType(type);
  return ITEM_CODE_CONFIG_BY_TYPE[normalizedType] || ITEM_CODE_CONFIG_BY_TYPE.Product;
}

function parseItemCodeSequence(value, type) {
  const normalized = normalizeItemCodeValue(value);
  const match = normalized.match(itemCodeConfig(type).pattern);
  if (!match) return 0;
  const sequence = Number(match[1]);
  if (!Number.isFinite(sequence) || sequence <= 0) return 0;
  return Math.floor(sequence);
}

function formatItemCodeSequence(sequence, type) {
  const safeSequence = Math.max(1, Number(sequence) || 1);
  const width = Math.max(ITEM_CODE_MIN_DIGITS, String(safeSequence).length);
  return `${itemCodeConfig(type).prefix}${String(safeSequence).padStart(width, "0")}`;
}

function resolveItemTypeForSequence(item) {
  return normalizeItemType(item?.type || item?.item_type || item?.metadata?.type || "Product");
}

function listTakenItemCodes(list, itemIdToIgnore) {
  const taken = new Set();
  ensureArray(list).forEach((item) => {
    if (itemIdToIgnore && item?.id === itemIdToIgnore) return;
    const code = normalizeItemCodeValue(extractRawItemCode(item));
    if (code) taken.add(code);
  });
  return taken;
}

function getMaxItemCodeSequence(list, itemIdToIgnore, type) {
  const targetType = normalizeItemType(type);
  return ensureArray(list).reduce((max, item) => {
    if (itemIdToIgnore && item?.id === itemIdToIgnore) return max;
    if (resolveItemTypeForSequence(item) !== targetType) return max;
    const sequence = parseItemCodeSequence(extractRawItemCode(item), targetType);
    return sequence > max ? sequence : max;
  }, 0);
}

function generateUniqueItemCode(list, itemIdToIgnore, type) {
  const taken = listTakenItemCodes(list, itemIdToIgnore);
  const targetType = normalizeItemType(type);
  let nextSequence = getMaxItemCodeSequence(list, itemIdToIgnore, targetType) + 1;
  let candidate = formatItemCodeSequence(nextSequence, targetType);
  while (taken.has(candidate)) {
    nextSequence += 1;
    candidate = formatItemCodeSequence(nextSequence, targetType);
  }
  return candidate;
}

function resolveItemCodeForUpsert({ draftItemCode, id, list, type }) {
  const existing = ensureArray(list).find((entry) => entry?.id === id);
  const requestedCode = normalizeItemCodeValue(draftItemCode);
  const existingCode = normalizeItemCodeValue(extractRawItemCode(existing));
  const preferredCode = requestedCode || existingCode;
  if (preferredCode) {
    const taken = listTakenItemCodes(list, id);
    if (!taken.has(preferredCode)) return preferredCode;
  }
  return generateUniqueItemCode(list, id, type);
}

function normalizeItem(raw) {
  const type = normalizeItemType(raw?.type);
  const metadata = raw?.metadata || {};
  const rawHsnOrSac = raw?.hsnOrSac || metadata?.hsnOrSac || "";
  const taxRate =
    parseNumber(raw?.taxRate) ||
    parseNumber(raw?.gstPercent) ||
    parseNumber(raw?.taxPercent) ||
    parseTaxRate(raw?.taxLabel) ||
    parseNumber(metadata?.taxRate) ||
    parseNumber(metadata?.gstPercent) ||
    parseNumber(metadata?.taxPercent);
  const taxInclusive =
    !!metadata?.taxInclusive ||
    metadata?.salePriceTaxMode === "WITH_TAX" ||
    metadata?.purchasePriceTaxMode === "WITH_TAX";
  const status = String(raw?.status || "").toLowerCase() === "inactive" ? "Inactive" : "Active";
  const trackInventory =
    type === "Product"
      ? metadata?.trackStock ?? metadata?.trackInventory ?? true
      : false;

  return {
    id: raw?.id || uid("itm_"),
    itemCode: normalizeItemCodeValue(raw?.itemCode || raw?.item_code || metadata?.itemCode || ""),
    type,
    name: raw?.name || raw?.itemName || "",
    description: raw?.description || metadata?.description || "",
    hsn: raw?.hsn || metadata?.hsn || (type === "Product" ? rawHsnOrSac : ""),
    sac: raw?.sac || metadata?.sac || (type === "Service" ? rawHsnOrSac : ""),
    unit: raw?.unit || metadata?.unit || "pcs",
    salesRate: parseNumber(raw?.price ?? raw?.salesRate ?? raw?.salePrice),
    purchaseRate: parseNumber(metadata?.purchasePrice ?? raw?.purchaseRate),
    taxRate,
    taxInclusive,
    status,
    trackInventory,
    openingStock: parseNumber(metadata?.openingStock ?? metadata?.openingQty ?? raw?.stockQty),
    openingStockValue: parseNumber(metadata?.openingStockValue),
    lowStockAlert: parseNumber(metadata?.lowStockQty ?? metadata?.lowStockAlert),
    category: metadata?.category || raw?.category || "",
    sku: metadata?.sku || metadata?.itemCode || raw?.itemCode || "",
    barcode: metadata?.barcode || "",
    priceLevels: ensureArray(metadata?.priceLevels),
    taxMappings: ensureArray(metadata?.taxMappings),
    metadata
  };
}

function mapRemoteItem(row) {
  const type = String(row?.item_type || "").toLowerCase() === "service" ? "Service" : "Product";
  const openingStock = parseNumber(row?.opening_stock);
  const purchasePrice = parseNumber(row?.purchase_price);

  return normalizeItem({
    id: row?.id,
    itemCode: row?.item_code || "",
    type,
    name: row?.item_name || "",
    hsn: type === "Product" ? row?.hsn_sac || "" : "",
    sac: type === "Service" ? row?.hsn_sac || "" : "",
    unit: row?.unit || "pcs",
    salesRate: parseNumber(row?.sale_price),
    purchaseRate: purchasePrice,
    taxRate: parseNumber(row?.tax_rate),
    status: row?.is_active === false ? "Inactive" : "Active",
    trackInventory: type === "Product",
    openingStock,
    lowStockAlert: parseNumber(row?.reorder_level),
    sku: row?.sku || "",
    price: parseNumber(row?.sale_price),
    stockQty: openingStock,
    metadata: {
      purchasePrice,
      taxInclusive: !!row?.tax_inclusive,
      salePriceTaxMode: row?.tax_inclusive ? "WITH_TAX" : "WITHOUT_TAX",
      purchasePriceTaxMode: row?.tax_inclusive ? "WITH_TAX" : "WITHOUT_TAX",
      trackStock: type === "Product",
      openingStock,
      openingQty: openingStock,
      lowStockQty: parseNumber(row?.reorder_level)
    },
    created_at: row?.created_at,
    updated_at: row?.updated_at
  });
}

function toRemotePayload(draft) {
  const incoming = normalizeItem(draft);
  const hsnSac = incoming.type === "Service" ? incoming.sac || incoming.hsn : incoming.hsn || incoming.sac;
  const openingStock = incoming.trackInventory ? parseNumber(incoming.openingStock) : 0;
  const reorderLevel = incoming.trackInventory ? parseNumber(incoming.lowStockAlert) : null;

  return {
    item_type: incoming.type === "Service" ? "service" : "product",
    item_name: incoming.name || "",
    item_code: incoming.itemCode || null,
    sku: incoming.sku || null,
    hsn_sac: hsnSac || null,
    unit: incoming.unit || "pcs",
    sale_price: parseNumber(incoming.salesRate),
    purchase_price: parseNumber(incoming.purchaseRate),
    tax_rate: parseNumber(incoming.taxRate),
    tax_inclusive: !!incoming.taxInclusive,
    opening_stock: openingStock,
    current_stock: openingStock,
    reorder_level: reorderLevel,
    is_active: incoming.status !== "Inactive"
  };
}

function listRawItems() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.items, []));
}

export function getNextItemCode(type = "Product") {
  return generateUniqueItemCode(listRawItems(), null, type);
}

export function listItems() {
  return listRawItems()
    .map(normalizeItem)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertItem(draft, country) {
  const list = listRawItems();
  const now = new Date().toISOString();
  const id = draft.id || uid("itm_");
  const itemName = String(draft?.name || draft?.itemName || "").trim();
  if (!itemName) throw new Error("Item name is required.");
  const itemType = normalizeItemType(draft?.type);
  const itemCode = resolveItemCodeForUpsert({
    draftItemCode: draft?.itemCode,
    id,
    list,
    type: itemType
  });
  const duplicateByName = findDuplicateItemByName(list, itemName, id);
  if (duplicateByName) throw new Error("Item name already exists.");
  const taxLabel = buildTaxLabel(country, parseNumber(draft.taxRate));

  const payload = {
    id,
    itemCode,
    name: itemName,
    type: draft.type,
    description: draft.description,
    hsn: draft.type === "Product" ? draft.hsn : "",
    sac: draft.type === "Service" ? draft.sac : "",
    unit: draft.unit,
    price: parseNumber(draft.salesRate),
    taxRate: parseNumber(draft.taxRate),
    taxLabel,
    stockQty: draft.trackInventory ? parseNumber(draft.openingStock) : 0,
    status: draft.status,
    metadata: {
      description: draft.description || "",
      category: draft.category || "",
      itemCode,
      sku: draft.sku || itemCode,
      barcode: draft.barcode || "",
      purchasePrice: parseNumber(draft.purchaseRate),
      taxInclusive: !!draft.taxInclusive,
      salePriceTaxMode: draft.taxInclusive ? "WITH_TAX" : "WITHOUT_TAX",
      purchasePriceTaxMode: draft.taxInclusive ? "WITH_TAX" : "WITHOUT_TAX",
      trackStock: !!draft.trackInventory,
      openingStock: parseNumber(draft.openingStock),
      openingStockValue: parseNumber(draft.openingStockValue),
      lowStockQty: parseNumber(draft.lowStockAlert),
      gstPercent: parseNumber(draft.gstPercent ?? draft.taxRate),
      taxPercent: parseNumber(draft.taxPercent ?? draft.taxRate),
      hsnOrSac:
        (draft.type === "Service" ? draft.sac || draft.hsn || draft.hsnOrSac : draft.hsn || draft.sac || draft.hsnOrSac) ||
        "",
      priceLevels: draft.priceLevels || [],
      taxMappings: draft.taxMappings || [],
      updated_at: now
    },
    updated_at: now
  };

  const idx = list.findIndex((item) => item.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...payload };
  } else {
    list.unshift({ ...payload, created_at: now });
  }
  lsSetOrganizationScoped(LS_KEYS.items, list);
  return id;
}

export function removeItem(id) {
  lsSetOrganizationScoped(
    LS_KEYS.items,
    listRawItems().filter((item) => item.id !== id)
  );
}

export async function syncItemsFromRemote() {
  if (!isSupabaseConfigured || !supabase) return listItems();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return listItems();

  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("organization_id", organizationId)
    .order("item_name", { ascending: true });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load items"));
  }

  const mapped = ensureArray(data).map(mapRemoteItem);
  lsSetOrganizationScoped(LS_KEYS.items, mapped);
  return mapped.sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertItemRemote(draft, country) {
  if (!isSupabaseConfigured || !supabase) {
    return upsertItem(draft, country);
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    return upsertItem(draft, country);
  }

  const list = listRawItems();
  const id = draft?.id || uid("itm_");
  const itemType = normalizeItemType(draft?.type);
  const itemCode = resolveItemCodeForUpsert({
    draftItemCode: draft?.itemCode,
    id,
    list,
    type: itemType
  });
  const incoming = normalizeItem({
    ...draft,
    id,
    itemCode,
    metadata: {
      ...(draft?.metadata || {}),
      itemCode,
      sku: draft?.sku || draft?.metadata?.sku || itemCode
    }
  });
  incoming.name = String(incoming.name || "").trim();
  if (!incoming.name) throw new Error("Item name is required.");
  const duplicateLocalByName = findDuplicateItemByName(list, incoming.name, incoming.id);
  if (duplicateLocalByName) throw new Error("Item name already exists.");
  const duplicateRemoteByName = await findRemoteDuplicateItemByName(organizationId, incoming.name, incoming.id);
  if (duplicateRemoteByName) throw new Error("Item name already exists.");
  const payload = toRemotePayload(incoming);
  const actorUserId = authGetUser()?.id || null;
  let remoteRow = null;

  if (incoming.id && looksLikeUuid(incoming.id)) {
    let attempt = await supabase
      .from("items")
      .update(payload)
      .eq("organization_id", organizationId)
      .eq("id", incoming.id)
      .select("*")
      .maybeSingle();

    if (attempt.error?.code === "42703") {
      const { item_code, ...legacyPayload } = payload;
      attempt = await supabase
        .from("items")
        .update(legacyPayload)
        .eq("organization_id", organizationId)
        .eq("id", incoming.id)
        .select("*")
        .maybeSingle();
    }

    if (attempt.error) {
      throw new Error(normalizeSupabaseError(attempt.error, "Failed to update item"));
    }
    remoteRow = attempt.data || null;
  }

  if (!remoteRow) {
    let attempt = await supabase
      .from("items")
      .insert({
        organization_id: organizationId,
        created_by: actorUserId,
        ...payload
      })
      .select("*")
      .single();

    if (attempt.error?.code === "42703") {
      const { item_code, ...legacyPayload } = payload;
      attempt = await supabase
        .from("items")
        .insert({
          organization_id: organizationId,
          created_by: actorUserId,
          ...legacyPayload
        })
        .select("*")
        .single();
    }

    if (attempt.error) {
      throw new Error(normalizeSupabaseError(attempt.error, "Failed to create item"));
    }
    remoteRow = attempt.data;
  }

  const saved = mapRemoteItem(remoteRow);
  const nextList = listRawItems().filter((item) => item.id !== incoming.id && item.id !== saved.id);
  lsSetOrganizationScoped(LS_KEYS.items, [saved, ...nextList]);
  return saved.id;
}

export async function removeItemRemote(id) {
  if (!id) return;

  if (!isSupabaseConfigured || !supabase) {
    removeItem(id);
    return;
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId || !looksLikeUuid(id)) {
    removeItem(id);
    return;
  }

  const { error } = await supabase
    .from("items")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id);

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to delete item"));
  }

  removeItem(id);
}

function matchesLine(item, line) {
  if (!line) return false;
  if (line.itemId && item.id && String(line.itemId) === String(item.id)) return true;
  const lineName = normalizeText(line.itemName || line.name || line.description);
  return lineName && lineName === normalizeText(item.name);
}

function collectFromLines(records, item, onMatch) {
  records.forEach((record) => {
    const lines = ensureArray(record?.lines);
    lines.forEach((line) => {
      if (matchesLine(item, line)) onMatch(line, record);
    });
  });
}

function collectItemTotalsLocal(item) {
  const invoices = ensureArray(lsGetOrganizationScoped(LS_KEYS.invoices, []));
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));

  let totalSales = 0;
  let totalPurchase = 0;
  let salesQty = 0;
  let purchaseQty = 0;

  collectFromLines(invoices, item, (line) => {
    const qty = parseNumber(line?.qty ?? line?.quantity);
    const amount = parseNumber(line?.amount ?? line?.lineTotal ?? line?.line_total ?? line?.net);
    salesQty += qty;
    totalSales += amount;
  });

  collectFromLines(purchases, item, (line) => {
    const qty = parseNumber(line?.qty ?? line?.quantity);
    const amount = parseNumber(line?.amount ?? line?.lineTotal ?? line?.line_total ?? line?.lineSubTotal);
    purchaseQty += qty;
    totalPurchase += amount;
  });

  return {
    itemId: item.id,
    totalSales,
    totalPurchase,
    salesQty,
    purchaseQty
  };
}

export function getItemTradeSummary(itemId) {
  const item = listItems().find((entry) => entry.id === itemId);
  if (!item) {
    return {
      itemId,
      totalSales: 0,
      totalPurchase: 0,
      salesQty: 0,
      purchaseQty: 0
    };
  }
  return collectItemTotalsLocal(item);
}

export async function getItemTradeSummaryRemote(itemId) {
  const local = getItemTradeSummary(itemId);
  if (!isSupabaseConfigured || !supabase || !looksLikeUuid(itemId)) return local;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return local;

  const [{ data: salesRows, error: salesError }, { data: purchaseRows, error: purchaseError }] = await Promise.all([
    supabase
      .from("invoice_items")
      .select("qty,line_total,invoice_id")
      .eq("item_id", itemId),
    supabase
      .from("purchase_bill_items")
      .select("qty,line_total,bill_id")
      .eq("item_id", itemId)
  ]);

  if (salesError) {
    throw new Error(normalizeSupabaseError(salesError, "Failed to load item sales summary"));
  }
  if (purchaseError) {
    throw new Error(normalizeSupabaseError(purchaseError, "Failed to load item purchase summary"));
  }

  const sales = ensureArray(salesRows);
  const purchases = ensureArray(purchaseRows);

  return {
    itemId,
    totalSales: sales.reduce((sum, row) => sum + parseNumber(row?.line_total), 0),
    totalPurchase: purchases.reduce((sum, row) => sum + parseNumber(row?.line_total), 0),
    salesQty: sales.reduce((sum, row) => sum + parseNumber(row?.qty), 0),
    purchaseQty: purchases.reduce((sum, row) => sum + parseNumber(row?.qty), 0)
  };
}

function getItemPurchaseHistoryLocal(item) {
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));
  const history = [];
  collectFromLines(purchases, item, (line, bill) => {
    history.push({
      supplier: bill?.partyName || "-",
      quantity: parseNumber(line?.qty ?? line?.quantity),
      date: bill?.billDate || bill?.created_at || "",
      billNo: bill?.billNumber || bill?.bill_no || ""
    });
  });
  return history.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

export async function getItemPurchaseHistoryRemote(itemId) {
  const item = listItems().find((entry) => entry.id === itemId);
  if (!item) return [];

  const local = getItemPurchaseHistoryLocal(item);
  if (!isSupabaseConfigured || !supabase || !looksLikeUuid(itemId)) return local;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return local;

  const { data: lineRows, error: linesError } = await supabase
    .from("purchase_bill_items")
    .select("bill_id,qty")
    .eq("item_id", itemId);

  if (linesError) {
    throw new Error(normalizeSupabaseError(linesError, "Failed to load item purchase history"));
  }

  const lines = ensureArray(lineRows);
  if (!lines.length) return [];

  const billIds = Array.from(new Set(lines.map((line) => line?.bill_id).filter(Boolean)));
  const { data: billRows, error: billError } = await supabase
    .from("purchase_bills")
    .select("id,bill_no,bill_date,supplier_id,metadata")
    .eq("organization_id", organizationId)
    .in("id", billIds);
  if (billError) {
    throw new Error(normalizeSupabaseError(billError, "Failed to resolve purchase history bills"));
  }

  const bills = ensureArray(billRows);
  const supplierIds = Array.from(new Set(bills.map((bill) => bill?.supplier_id).filter(Boolean)));
  let suppliersById = new Map();
  if (supplierIds.length) {
    const { data: supplierRows, error: supplierError } = await supabase
      .from("parties")
      .select("id,display_name")
      .eq("organization_id", organizationId)
      .in("id", supplierIds);
    if (supplierError) {
      throw new Error(normalizeSupabaseError(supplierError, "Failed to resolve suppliers"));
    }
    suppliersById = new Map(ensureArray(supplierRows).map((row) => [row.id, row.display_name || "-"]));
  }

  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const history = lines.map((line) => {
    const bill = billById.get(line?.bill_id) || {};
    const supplierName =
      suppliersById.get(bill?.supplier_id) ||
      bill?.metadata?.partyName ||
      "-";
    return {
      supplier: supplierName,
      quantity: parseNumber(line?.qty),
      date: bill?.bill_date || "",
      billNo: bill?.bill_no || ""
    };
  });

  return history.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

export function computeItemUsage(item) {
  let count = 0;
  let lastUsed = "";

  const invoices = ensureArray(lsGetOrganizationScoped(LS_KEYS.invoices, []));
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));
  const creditLegacy = ensureArray(lsGetOrganizationScoped(LS_KEYS.creditNotes, []));
  const creditPremium = ensureArray(lsGetOrganizationScoped(CREDIT_NOTES_PREMIUM_KEY, []));
  const debitPremium = ensureArray(lsGetOrganizationScoped(DEBIT_NOTES_PREMIUM_KEY, []));

  const consider = (record, dateField) => {
    const candidate = record?.[dateField] || record?.date || record?.created_at || "";
    if (candidate && candidate > lastUsed) lastUsed = candidate;
  };

  collectFromLines(invoices, item, (_line, record) => {
    count += 1;
    consider(record, "invoiceDate");
  });
  collectFromLines(purchases, item, (_line, record) => {
    count += 1;
    consider(record, "billDate");
  });
  collectFromLines(creditLegacy, item, (_line, record) => {
    count += 1;
    consider(record, "creditDate");
  });
  collectFromLines(creditPremium, item, (_line, record) => {
    count += 1;
    consider(record, "creditNoteDate");
  });
  collectFromLines(debitPremium, item, (_line, record) => {
    count += 1;
    consider(record, "debitNoteDate");
  });

  return { used: count > 0, count, lastUsed: lastUsed || undefined };
}

export function computeItemStock(item) {
  if (!item.trackInventory) return { available: 0, lowStock: false };

  let available = parseNumber(item.openingStock);
  const invoices = ensureArray(lsGetOrganizationScoped(LS_KEYS.invoices, []));
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));
  const creditLegacy = ensureArray(lsGetOrganizationScoped(LS_KEYS.creditNotes, []));
  const creditPremium = ensureArray(lsGetOrganizationScoped(CREDIT_NOTES_PREMIUM_KEY, []));
  const debitPremium = ensureArray(lsGetOrganizationScoped(DEBIT_NOTES_PREMIUM_KEY, []));

  collectFromLines(purchases, item, (line) => {
    available += parseNumber(line.qty ?? line.quantity ?? line.qtyOrdered);
  });

  collectFromLines(invoices, item, (line) => {
    available -= parseNumber(line.qty ?? line.quantity ?? line.qtyOrdered);
  });

  creditLegacy
    .filter((record) => record?.returnToStock)
    .forEach((record) => {
      collectFromLines([record], item, (line) => {
        available += parseNumber(line.qty ?? line.quantity ?? line.qtyOrdered);
      });
    });

  creditPremium
    .filter((record) => record?.returnToStock || record?.status === "Applied")
    .forEach((record) => {
      collectFromLines([record], item, (line) => {
        available += parseNumber(line.quantity ?? line.qty ?? line.qtyOrdered);
      });
    });

  debitPremium
    .filter((record) => record?.status === "Applied")
    .forEach((record) => {
      collectFromLines([record], item, (line) => {
        available -= parseNumber(line.quantity ?? line.qty ?? line.qtyOrdered);
      });
    });

  const lowStockAlert = parseNumber(item.lowStockAlert);
  const lowStock = lowStockAlert > 0 && available <= lowStockAlert;
  return { available, lowStock };
}
