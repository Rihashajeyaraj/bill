import {
  LS_KEYS,
  lsGetOrganizationScoped,
  lsSetOrganizationScoped,
  uid
} from "../../services/storage";
import { authGetOrganizationId, authGetRole, authGetUser } from "../../services/auth.service";
import { isSupabaseConfigured, supabase } from "../../services/supabaseClient";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../../services/roles";
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

function assertItemWritePermission({ isEdit = false } = {}) {
  const role = authGetRole();
  if (isEdit) {
    if (!canEditEntries(role)) {
      throw new Error("You do not have permission to edit items.");
    }
    return;
  }
  if (!canCreateEntries(role)) {
    throw new Error("You do not have permission to create items.");
  }
}

function assertItemDeletePermission() {
  const role = authGetRole();
  if (!canDeleteEntries(role)) {
    throw new Error("You do not have permission to delete items.");
  }
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

function normalizeCategoryId(value) {
  const id = String(value || "").trim();
  if (!id) return "";
  if (looksLikeUuid(id)) return id;
  if (/^\d+$/.test(id)) return id;
  return "";
}

function normalizeCategoryName(value) {
  return String(value || "").trim();
}

function extractCategoryFromJoinedRow(row, categoryById = null) {
  const joined = row?.category || row?.categories || row?.item_category || row?.item_categories || null;
  const joinedRow = Array.isArray(joined) ? joined[0] || null : joined;
  const categoryId = normalizeCategoryId(
    row?.category_id ||
      joinedRow?.id ||
      row?.metadata?.categoryId ||
      row?.metadata?.category_id
  );
  const joinedName = normalizeCategoryName(
    joinedRow?.name || joinedRow?.category_name || joinedRow?.title
  );
  const mappedName = categoryId && categoryById instanceof Map ? normalizeCategoryName(categoryById.get(categoryId)) : "";
  const categoryName = normalizeCategoryName(
    joinedName ||
      mappedName ||
      row?.category_name ||
      row?.category ||
      row?.metadata?.category
  );

  return {
    categoryId,
    categoryName
  };
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
  const openingStock = parseNumber(metadata?.openingStock ?? metadata?.openingQty ?? raw?.stockQty);
  const currentStock = parseNumber(metadata?.currentStock ?? raw?.currentStock ?? openingStock);
  const categoryId = normalizeCategoryId(
    raw?.categoryId || raw?.category_id || metadata?.categoryId || metadata?.category_id
  );
  const category = normalizeCategoryName(
    raw?.categoryName ||
      raw?.category_name ||
      raw?.category?.name ||
      raw?.categories?.name ||
      metadata?.category ||
      raw?.category
  );

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
    openingStock,
    currentStock,
    openingStockValue: parseNumber(metadata?.openingStockValue),
    lowStockAlert: parseNumber(metadata?.lowStockQty ?? metadata?.lowStockAlert),
    categoryId,
    category,
    sku: metadata?.sku || metadata?.itemCode || raw?.itemCode || "",
    barcode: metadata?.barcode || "",
    priceLevels: ensureArray(metadata?.priceLevels),
    taxMappings: ensureArray(metadata?.taxMappings),
    metadata
  };
}

function mapRemoteItem(row, categoryById = null) {
  const type = String(row?.item_type || "").toLowerCase() === "service" ? "Service" : "Product";
  const openingStock = parseNumber(row?.opening_stock);
  const currentStock = parseNumber(row?.current_stock);
  const purchasePrice = parseNumber(row?.purchase_price);
  const { categoryId, categoryName } = extractCategoryFromJoinedRow(row, categoryById);

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
    categoryId,
    category: categoryName,
    sku: row?.sku || "",
    price: parseNumber(row?.sale_price),
    stockQty: currentStock,
    currentStock,
    metadata: {
      purchasePrice,
      categoryId,
      category: categoryName,
      taxInclusive: !!row?.tax_inclusive,
      salePriceTaxMode: row?.tax_inclusive ? "WITH_TAX" : "WITHOUT_TAX",
      purchasePriceTaxMode: row?.tax_inclusive ? "WITH_TAX" : "WITHOUT_TAX",
      trackStock: type === "Product",
      openingStock,
      openingQty: openingStock,
      currentStock,
      stockSource: "db_current_stock",
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
  const categoryId = normalizeCategoryId(incoming.categoryId);

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
    category_id: categoryId || null,
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
  const isEdit = !!draft?.id && list.some((item) => String(item?.id) === String(draft.id));
  assertItemWritePermission({ isEdit });
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
    categoryId: normalizeCategoryId(draft.categoryId),
    category: draft.category || "",
    metadata: {
      description: draft.description || "",
      categoryId: normalizeCategoryId(draft.categoryId),
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
  assertItemDeletePermission();
  lsSetOrganizationScoped(
    LS_KEYS.items,
    listRawItems().filter((item) => item.id !== id)
  );
}

async function fetchCategoryMapByIds(organizationId, categoryIds = []) {
  const uniqueIds = Array.from(new Set(ensureArray(categoryIds).map((id) => normalizeCategoryId(id)).filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const tableCandidates = ["categories", "item_categories"];
  for (const table of tableCandidates) {
    const { data, error } = await supabase
      .from(table)
      .select("id,name")
      .eq("organization_id", organizationId)
      .in("id", uniqueIds);

    if (error) {
      if (isMissingRelationError(error)) continue;
      throw new Error(normalizeSupabaseError(error, "Failed to load item categories"));
    }

    return ensureArray(data).reduce((map, row) => {
      const id = normalizeCategoryId(row?.id);
      if (!id) return map;
      const name = normalizeCategoryName(row?.name);
      if (!name) return map;
      map.set(id, name);
      return map;
    }, new Map());
  }

  return new Map();
}

async function fetchRemoteItemsWithOptionalCategoryJoin(organizationId) {
  const queryCandidates = [
    "*, category:categories(id,name)",
    "*, categories(id,name)",
    "*"
  ];

  for (const query of queryCandidates) {
    const { data, error } = await supabase
      .from("items")
      .select(query)
      .eq("organization_id", organizationId)
      .order("item_name", { ascending: true });

    if (!error) return ensureArray(data);
    if (query !== "*" && isMissingRelationError(error)) continue;
    throw new Error(normalizeSupabaseError(error, "Failed to load items"));
  }

  return [];
}

export async function listItemCategoryOptionsRemote() {
  if (!isSupabaseConfigured || !supabase) return [];
  const organizationId = authGetOrganizationId();
  if (!organizationId) return [];

  const tableCandidates = ["categories", "item_categories"];
  for (const table of tableCandidates) {
    const { data, error } = await supabase
      .from(table)
      .select("id,name")
      .eq("organization_id", organizationId);

    if (error) {
      if (isMissingRelationError(error)) continue;
      throw new Error(normalizeSupabaseError(error, "Failed to load item categories"));
    }

    const options = ensureArray(data)
      .map((row) => ({
        id: normalizeCategoryId(row?.id),
        name: normalizeCategoryName(row?.name)
      }))
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    return options;
  }

  return [];
}

export async function syncItemsFromRemote() {
  if (!isSupabaseConfigured || !supabase) return listItems();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return listItems();

  const rows = await fetchRemoteItemsWithOptionalCategoryJoin(organizationId);
  const categoryIds = rows.map((row) => normalizeCategoryId(row?.category_id)).filter(Boolean);
  const categoryById = await fetchCategoryMapByIds(organizationId, categoryIds).catch(() => new Map());
  const mapped = ensureArray(rows).map((row) => mapRemoteItem(row, categoryById));
  lsSetOrganizationScoped(LS_KEYS.items, mapped);
  return mapped.sort((a, b) => a.name.localeCompare(b.name));
}

function stripUnsupportedItemColumns(payload, error) {
  const next = { ...(payload || {}) };
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("item_code")) delete next.item_code;
  if (message.includes("category_id")) delete next.category_id;
  return next;
}

export async function upsertItemRemote(draft, country) {
  const existing = listRawItems().some((item) => String(item?.id) === String(draft?.id || ""));
  const isEdit = !!draft?.id && (looksLikeUuid(draft.id) || existing);
  assertItemWritePermission({ isEdit });

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
  let payload = toRemotePayload(incoming);
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
      const legacyPayload = stripUnsupportedItemColumns(payload, attempt.error);
      attempt = await supabase
        .from("items")
        .update(legacyPayload)
        .eq("organization_id", organizationId)
        .eq("id", incoming.id)
        .select("*")
        .maybeSingle();
      payload = legacyPayload;
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
      const legacyPayload = stripUnsupportedItemColumns(payload, attempt.error);
      attempt = await supabase
        .from("items")
        .insert({
          organization_id: organizationId,
          created_by: actorUserId,
          ...legacyPayload
        })
        .select("*")
        .single();
      payload = legacyPayload;
    }

    if (attempt.error) {
      throw new Error(normalizeSupabaseError(attempt.error, "Failed to create item"));
    }
    remoteRow = attempt.data;
  }

  const saved = mapRemoteItem(remoteRow);
  const persistedCategoryId = normalizeCategoryId(remoteRow?.category_id || payload?.category_id);
  if (persistedCategoryId) {
    if (!saved.categoryId) saved.categoryId = persistedCategoryId;
    if (!saved.category && incoming.category) {
      saved.category = incoming.category;
    }
  } else if (!saved.categoryId) {
    saved.category = "";
  }
  const nextList = listRawItems().filter((item) => item.id !== incoming.id && item.id !== saved.id);
  lsSetOrganizationScoped(LS_KEYS.items, [saved, ...nextList]);
  return saved.id;
}

export async function removeItemRemote(id) {
  if (!id) return;
  assertItemDeletePermission();

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

function includeInventoryRecord(record) {
  const status = String(record?.status || record?.paymentStatus || "").trim().toLowerCase();
  if (!status) return true;
  return status !== "draft" && status !== "cancelled" && status !== "canceled";
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

  const [salesHistory, purchaseHistory] = await Promise.all([
    getItemSalesHistoryRemote(itemId),
    getItemPurchaseHistoryRemote(itemId)
  ]);

  return {
    itemId,
    totalSales: salesHistory.reduce((sum, row) => sum + parseNumber(row?.salesAmount), 0),
    totalPurchase: purchaseHistory.reduce((sum, row) => sum + parseNumber(row?.purchaseAmount), 0),
    salesQty: salesHistory.reduce((sum, row) => sum + parseNumber(row?.quantity), 0),
    purchaseQty: purchaseHistory.reduce((sum, row) => sum + parseNumber(row?.quantity), 0)
  };
}

const HISTORY_TABLE_CACHE = {
  purchaseLines: "",
  salesLines: "",
  purchaseHeaders: "",
  salesHeaders: ""
};

function isMissingRelationError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST200" ||
    code === "PGRST201" ||
    code === "PGRST205" ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("could not find table")
  );
}

function readFirstDefined(source, keys, fallback = "") {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function sortHistoryRows(rows) {
  return ensureArray(rows).sort((a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime());
}

function toHistoryDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length >= 10 && text[4] === "-" && text[7] === "-") return text.slice(0, 10);
  return text;
}

async function queryItemLinesByTable(itemId, mode) {
  const candidates =
    mode === "sales"
      ? ["sales_items", "invoice_items"]
      : ["purchase_items", "purchase_bill_items"];
  const cacheKey = mode === "sales" ? "salesLines" : "purchaseLines";
  const preferred = HISTORY_TABLE_CACHE[cacheKey];
  const orderedCandidates = preferred
    ? [preferred, ...candidates.filter((candidate) => candidate !== preferred)]
    : candidates;

  for (const table of orderedCandidates) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("item_id", itemId);
    if (!error) {
      HISTORY_TABLE_CACHE[cacheKey] = table;
      return ensureArray(data);
    }
    if (isMissingRelationError(error)) continue;
    const label = mode === "sales" ? "sales" : "purchase";
    throw new Error(normalizeSupabaseError(error, `Failed to load item ${label} history`));
  }
  return [];
}

async function queryHeadersByTable(headerIds, mode) {
  if (!headerIds.length) return { headersById: new Map(), partiesById: new Map() };

  const candidates =
    mode === "sales"
      ? ["sales", "invoices"]
      : ["purchases", "purchase_bills"];
  const cacheKey = mode === "sales" ? "salesHeaders" : "purchaseHeaders";
  const preferred = HISTORY_TABLE_CACHE[cacheKey];
  const orderedCandidates = preferred
    ? [preferred, ...candidates.filter((candidate) => candidate !== preferred)]
    : candidates;

  let headers = [];
  for (const table of orderedCandidates) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .in("id", headerIds);
    if (!error) {
      HISTORY_TABLE_CACHE[cacheKey] = table;
      headers = ensureArray(data);
      break;
    }
    if (isMissingRelationError(error)) continue;
    const label = mode === "sales" ? "sales" : "purchase";
    throw new Error(normalizeSupabaseError(error, `Failed to resolve item ${label} history rows`));
  }

  const headersById = new Map(headers.map((entry) => [entry?.id, entry]));
  const partyIds = Array.from(
    new Set(
      headers
        .map((entry) =>
          readFirstDefined(entry, ["party_id", "customer_id", "supplier_id"], "")
        )
        .filter(Boolean)
    )
  );

  let partiesById = new Map();
  if (partyIds.length) {
    const { data: partyRows, error: partyError } = await supabase
      .from("parties")
      .select("id,display_name,legal_name")
      .in("id", partyIds);
    if (partyError) {
      throw new Error(normalizeSupabaseError(partyError, "Failed to resolve parties for item history"));
    }
    partiesById = new Map(
      ensureArray(partyRows).map((row) => [row?.id, row?.display_name || row?.legal_name || "-"])
    );
  }

  return { headersById, partiesById };
}

function getItemPurchaseHistoryLocal(item) {
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, []));
  const history = [];
  collectFromLines(purchases, item, (line, bill) => {
    history.push({
      supplier: bill?.partyName || "-",
      quantity: parseNumber(line?.qty ?? line?.quantity),
      date: bill?.billDate || bill?.created_at || "",
      billNo: bill?.billNumber || bill?.bill_no || "",
      purchaseAmount: parseNumber(
        line?.amount ?? line?.lineTotal ?? line?.line_total ?? line?.lineSubTotal
      )
    });
  });
  return sortHistoryRows(history);
}

function getItemSalesHistoryLocal(item) {
  const invoices = ensureArray(lsGetOrganizationScoped(LS_KEYS.invoices, []));
  const history = [];
  collectFromLines(invoices, item, (line, invoice) => {
    history.push({
      customer: invoice?.partyName || invoice?.buyer?.name || "-",
      quantity: parseNumber(line?.qty ?? line?.quantity),
      date: invoice?.invoiceDate || invoice?.created_at || "",
      billNo: invoice?.invoiceNo || invoice?.bill_no || "",
      salesAmount: parseNumber(line?.amount ?? line?.lineTotal ?? line?.line_total ?? line?.net)
    });
  });
  return sortHistoryRows(history);
}

export async function getItemPurchaseHistoryRemote(itemId) {
  const item = listItems().find((entry) => entry.id === itemId);
  if (!item) return [];

  const local = getItemPurchaseHistoryLocal(item);
  if (!isSupabaseConfigured || !supabase || !looksLikeUuid(itemId)) return local;

  const lines = await queryItemLinesByTable(itemId, "purchase");
  if (!lines.length) return [];

  const billIds = Array.from(
    new Set(
      lines
        .map((line) =>
          readFirstDefined(line, ["bill_id", "purchase_id", "purchase_bill_id", "billId"], "")
        )
        .filter(Boolean)
    )
  );
  const { headersById, partiesById } = await queryHeadersByTable(billIds, "purchase");
  const history = lines.map((line) => {
    const billId = readFirstDefined(
      line,
      ["bill_id", "purchase_id", "purchase_bill_id", "billId"],
      ""
    );
    const bill = headersById.get(billId) || {};
    const supplierId = readFirstDefined(bill, ["supplier_id", "party_id", "supplierId"], "");
    const supplierName =
      partiesById.get(supplierId) ||
      readFirstDefined(line, ["supplier_name", "supplierName", "party_name", "partyName"], "") ||
      readFirstDefined(bill?.metadata, ["partyName", "supplierName"], "-");

    const billNo =
      readFirstDefined(line, ["bill_no", "billNo", "purchase_no", "purchaseNo"], "") ||
      readFirstDefined(bill, ["bill_no", "billNo", "purchase_no", "purchaseNo"], "");
    const lineAmount = parseNumber(
      readFirstDefined(line, ["purchase_amount", "line_total", "amount", "lineAmount"], 0)
    );

    return {
      supplier: supplierName,
      quantity: parseNumber(readFirstDefined(line, ["qty", "quantity"], 0)),
      date: toHistoryDate(
        readFirstDefined(
          line,
          ["bill_date", "purchase_date", "date", "created_at"],
          readFirstDefined(bill, ["bill_date", "purchase_date", "date", "created_at"], "")
        )
      ),
      billNo,
      purchaseAmount: lineAmount
    };
  });

  return sortHistoryRows(history);
}

export async function getItemSalesHistoryRemote(itemId) {
  const item = listItems().find((entry) => entry.id === itemId);
  if (!item) return [];

  const local = getItemSalesHistoryLocal(item);
  if (!isSupabaseConfigured || !supabase || !looksLikeUuid(itemId)) return local;

  const lines = await queryItemLinesByTable(itemId, "sales");
  if (!lines.length) return [];

  const billIds = Array.from(
    new Set(
      lines
        .map((line) =>
          readFirstDefined(line, ["sale_id", "invoice_id", "sales_id", "bill_id", "invoiceId"], "")
        )
        .filter(Boolean)
    )
  );
  const { headersById, partiesById } = await queryHeadersByTable(billIds, "sales");
  const history = lines.map((line) => {
    const billId = readFirstDefined(
      line,
      ["sale_id", "invoice_id", "sales_id", "bill_id", "invoiceId"],
      ""
    );
    const bill = headersById.get(billId) || {};
    const customerId = readFirstDefined(
      bill,
      ["customer_id", "party_id", "buyer_id", "customerId"],
      ""
    );
    const customerName =
      partiesById.get(customerId) ||
      readFirstDefined(line, ["customer_name", "customerName", "party_name", "partyName"], "") ||
      readFirstDefined(bill?.metadata, ["partyName", "buyerName"], "-");

    const billNo =
      readFirstDefined(line, ["bill_no", "billNo", "invoice_no", "invoiceNo"], "") ||
      readFirstDefined(bill, ["bill_no", "billNo", "invoice_no", "invoiceNo"], "");
    const lineAmount = parseNumber(
      readFirstDefined(line, ["sales_amount", "line_total", "amount", "lineAmount"], 0)
    );

    return {
      customer: customerName,
      quantity: parseNumber(readFirstDefined(line, ["qty", "quantity"], 0)),
      date: toHistoryDate(
        readFirstDefined(
          line,
          ["invoice_date", "sales_date", "bill_date", "date", "created_at"],
          readFirstDefined(bill, ["invoice_date", "sales_date", "bill_date", "date", "created_at"], "")
        )
      ),
      billNo,
      salesAmount: lineAmount
    };
  });

  return sortHistoryRows(history);
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
  if (!item.trackInventory) return { available: 0, availableRaw: 0, lowStock: false };

  const stockSource = String(item?.metadata?.stockSource || "").trim().toLowerCase();
  if (stockSource === "db_current_stock") {
    const availableRaw = parseNumber(item?.currentStock ?? item?.metadata?.currentStock);
    const available = Math.max(0, parseNumber(availableRaw));
    const lowStockAlert = parseNumber(item.lowStockAlert);
    const lowStock = lowStockAlert > 0 && available <= lowStockAlert;
    return { available, availableRaw, lowStock };
  }

  let availableRaw = parseNumber(item.openingStock);
  const invoices = ensureArray(lsGetOrganizationScoped(LS_KEYS.invoices, [])).filter(
    includeInventoryRecord
  );
  const purchases = ensureArray(lsGetOrganizationScoped(LS_KEYS.purchases, [])).filter(
    includeInventoryRecord
  );
  const creditLegacy = ensureArray(lsGetOrganizationScoped(LS_KEYS.creditNotes, []));
  const creditPremium = ensureArray(lsGetOrganizationScoped(CREDIT_NOTES_PREMIUM_KEY, []));
  const debitPremium = ensureArray(lsGetOrganizationScoped(DEBIT_NOTES_PREMIUM_KEY, []));

  collectFromLines(purchases, item, (line) => {
    availableRaw += parseNumber(line.qty ?? line.quantity ?? line.qtyOrdered);
  });

  collectFromLines(invoices, item, (line) => {
    availableRaw -= parseNumber(line.qty ?? line.quantity ?? line.qtyOrdered);
  });

  creditLegacy
    .filter((record) => record?.returnToStock)
    .forEach((record) => {
      collectFromLines([record], item, (line) => {
        availableRaw += parseNumber(line.qty ?? line.quantity ?? line.qtyOrdered);
      });
    });

  creditPremium
    .filter((record) => record?.returnToStock || record?.status === "Applied")
    .forEach((record) => {
      collectFromLines([record], item, (line) => {
        availableRaw += parseNumber(line.quantity ?? line.qty ?? line.qtyOrdered);
      });
    });

  debitPremium
    .filter((record) => record?.status === "Applied")
    .forEach((record) => {
      collectFromLines([record], item, (line) => {
        availableRaw -= parseNumber(line.quantity ?? line.qty ?? line.qtyOrdered);
      });
    });

  const available = Math.max(0, parseNumber(availableRaw));
  const lowStockAlert = parseNumber(item.lowStockAlert);
  const lowStock = lowStockAlert > 0 && available <= lowStockAlert;
  return { available, availableRaw, lowStock };
}
