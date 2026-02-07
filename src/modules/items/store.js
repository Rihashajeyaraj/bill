import { LS_KEYS, lsGet, lsSet, uid } from "../../services/storage";
import { buildTaxLabel, normalizeItemType, normalizeText, parseNumber } from "./utils";

const CREDIT_NOTES_PREMIUM_KEY = "creditNotesPremiumV1";
const DEBIT_NOTES_PREMIUM_KEY = "debitNotesPremiumV1";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseTaxRate(label) {
  const match = String(label || "").match(/@([0-9.]+)%/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

function normalizeItem(raw) {
  const type = normalizeItemType(raw?.type);
  const metadata = raw?.metadata || {};
  const taxRate =
    parseNumber(raw?.taxRate) || parseTaxRate(raw?.taxLabel) || parseNumber(metadata?.taxRate);
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
    type,
    name: raw?.name || raw?.itemName || "",
    description: raw?.description || metadata?.description || "",
    hsn: raw?.hsn || metadata?.hsn || "",
    sac: raw?.sac || metadata?.sac || "",
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

function listRawItems() {
  return ensureArray(lsGet(LS_KEYS.items, []));
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
  const taxLabel = buildTaxLabel(country, parseNumber(draft.taxRate));

  const payload = {
    id,
    name: draft.name,
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
      sku: draft.sku || "",
      barcode: draft.barcode || "",
      purchasePrice: parseNumber(draft.purchaseRate),
      taxInclusive: !!draft.taxInclusive,
      salePriceTaxMode: draft.taxInclusive ? "WITH_TAX" : "WITHOUT_TAX",
      purchasePriceTaxMode: draft.taxInclusive ? "WITH_TAX" : "WITHOUT_TAX",
      trackStock: !!draft.trackInventory,
      openingStock: parseNumber(draft.openingStock),
      openingStockValue: parseNumber(draft.openingStockValue),
      lowStockQty: parseNumber(draft.lowStockAlert),
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
  lsSet(LS_KEYS.items, list);
  return id;
}

export function removeItem(id) {
  lsSet(
    LS_KEYS.items,
    listRawItems().filter((item) => item.id !== id)
  );
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

export function computeItemUsage(item) {
  let count = 0;
  let lastUsed = "";

  const invoices = ensureArray(lsGet(LS_KEYS.invoices, []));
  const purchases = ensureArray(lsGet(LS_KEYS.purchases, []));
  const creditLegacy = ensureArray(lsGet(LS_KEYS.creditNotes, []));
  const creditPremium = ensureArray(lsGet(CREDIT_NOTES_PREMIUM_KEY, []));
  const debitPremium = ensureArray(lsGet(DEBIT_NOTES_PREMIUM_KEY, []));

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
  const invoices = ensureArray(lsGet(LS_KEYS.invoices, []));
  const purchases = ensureArray(lsGet(LS_KEYS.purchases, []));
  const creditLegacy = ensureArray(lsGet(LS_KEYS.creditNotes, []));
  const creditPremium = ensureArray(lsGet(CREDIT_NOTES_PREMIUM_KEY, []));
  const debitPremium = ensureArray(lsGet(DEBIT_NOTES_PREMIUM_KEY, []));

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
