import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARCODE_MODE_BATCH = "batch";
const BARCODE_MODE_UNIT = "unit";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function parseNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function getAll() {
  return ensureArray(lsGetOrganizationScoped(LS_KEYS.item_barcodes, []));
}

function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.item_barcodes, ensureArray(list));
}

function normalizeCodeSegment(value, fallback = "ITEM") {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  if (cleaned) return cleaned.slice(0, 20);
  const fallbackClean = String(fallback || "ITEM")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return fallbackClean || "ITEM";
}

function toDateSegment(value) {
  const raw = String(value || "").trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function normalizeSequence(value) {
  const n = Math.trunc(parseNumber(value));
  return n > 0 ? n : 1;
}

function extractSequenceFromBarcode(prefix, dateSegment, barcodeValue) {
  const normalizedValue = String(barcodeValue || "").trim().toUpperCase();
  if (!normalizedValue) return 0;
  const regex = new RegExp(`^${prefix}-${dateSegment}-(\\d+)$`);
  const match = normalizedValue.match(regex);
  if (!match) return 0;
  return normalizeSequence(match[1]);
}

function nextSequence(prefix, dateSegment, existingRows) {
  return ensureArray(existingRows).reduce((max, entry) => {
    const barcodeValue = entry?.barcode_value || entry?.barcodeValue || "";
    const sequence = extractSequenceFromBarcode(prefix, dateSegment, barcodeValue);
    return sequence > max ? sequence : max;
  }, 0) + 1;
}

function normalizeBarcodePrefix(itemCode, itemId) {
  const fallback = String(itemId || "ITEM").slice(-8);
  return normalizeCodeSegment(itemCode, fallback);
}

function composeBarcodeValue(prefix, dateSegment, sequence) {
  return `${prefix}-${dateSegment}-${String(normalizeSequence(sequence)).padStart(3, "0")}`;
}

function rowKey(entry) {
  const purchaseId = String(entry?.purchase_id || entry?.purchaseId || "").trim();
  const barcodeValue = normalizeBarcodeLookupValue(entry?.barcode_value || entry?.barcodeValue || "");
  return `${purchaseId}::${barcodeValue}`;
}

function normalizeBarcodeRow(raw) {
  return {
    id: String(raw?.id || uid("bar_")).trim(),
    organization_id: String(raw?.organization_id || raw?.organizationId || "").trim(),
    item_id: String(raw?.item_id || raw?.itemId || "").trim(),
    purchase_id: String(raw?.purchase_id || raw?.purchaseId || "").trim(),
    barcode_value: String(raw?.barcode_value || raw?.barcodeValue || "").trim(),
    qr_value: String(raw?.qr_value || raw?.qrValue || raw?.barcode_value || raw?.barcodeValue || "").trim(),
    created_at: String(raw?.created_at || raw?.createdAt || nowIso()).trim(),
    createdBy: String(raw?.createdBy || "").trim(),
    lineIndex: Math.max(0, Math.trunc(parseNumber(raw?.lineIndex))),
    unitIndex: Math.max(1, Math.trunc(parseNumber(raw?.unitIndex || 1)))
  };
}

function dedupeRows(rows) {
  const map = new Map();
  ensureArray(rows).forEach((entry) => {
    const normalized = normalizeBarcodeRow(entry);
    if (!normalized.purchase_id || !normalized.barcode_value) return;
    map.set(rowKey(normalized), normalized);
  });
  return Array.from(map.values()).sort((left, right) =>
    String(right.created_at || "").localeCompare(String(left.created_at || ""))
  );
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

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

function isMissingColumnError(error) {
  const code = String(error?.code || "").toUpperCase();
  return code === "42703" || String(error?.message || "").toLowerCase().includes("column");
}

export function normalizeBarcodeLookupValue(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function getBarcodeImageUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return `https://bwipjs-api.metafloor.com/?bcid=code128&scale=3&height=12&includetext=true&text=${encodeURIComponent(
    normalized
  )}`;
}

export function getQrImageUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(normalized)}`;
}

export function listItemBarcodes() {
  return dedupeRows(getAll());
}

function buildBarcodeRowsForPurchase({ purchaseId, billDate, lines, mode, existingRows, organizationId }) {
  const normalizedMode = String(mode || BARCODE_MODE_BATCH).toLowerCase() === BARCODE_MODE_UNIT
    ? BARCODE_MODE_UNIT
    : BARCODE_MODE_BATCH;
  const dateSegment = toDateSegment(billDate);
  const sourceRows = dedupeRows(existingRows);
  const takenValues = new Set(
    sourceRows.map((entry) => normalizeBarcodeLookupValue(entry.barcode_value))
  );
  const createdRows = [];
  const safeLines = ensureArray(lines);

  safeLines.forEach((line, lineIndex) => {
    const itemId = String(line?.itemId || line?.item_id || "").trim();
    if (!itemId) return;
    const qty = Math.max(0, Math.trunc(parseNumber(line?.qty ?? line?.quantity ?? 0)));
    if (qty <= 0) return;

    const prefix = normalizeBarcodePrefix(line?.itemCode || line?.item_code, itemId);
    let sequence = nextSequence(prefix, dateSegment, [...sourceRows, ...createdRows]);
    const unitCount = normalizedMode === BARCODE_MODE_UNIT ? qty : 1;

    for (let unitIndex = 1; unitIndex <= unitCount; unitIndex += 1) {
      let barcodeValue = composeBarcodeValue(prefix, dateSegment, sequence);
      while (takenValues.has(normalizeBarcodeLookupValue(barcodeValue))) {
        sequence += 1;
        barcodeValue = composeBarcodeValue(prefix, dateSegment, sequence);
      }
      takenValues.add(normalizeBarcodeLookupValue(barcodeValue));

      createdRows.push(
        normalizeBarcodeRow({
          id: uid("bar_"),
          organization_id: organizationId || "",
          item_id: itemId,
          purchase_id: purchaseId,
          barcode_value: barcodeValue,
          qr_value: barcodeValue,
          created_at: nowIso(),
          lineIndex,
          unitIndex
        })
      );

      sequence += 1;
    }
  });

  return createdRows;
}

async function pushRowsToRemote(rows) {
  if (!isSupabaseConfigured || !supabase) return;
  const organizationId = authGetOrganizationId();
  if (!organizationId) return;

  const remoteRows = ensureArray(rows)
    .map((entry) => normalizeBarcodeRow(entry))
    .filter((entry) => looksLikeUuid(entry.purchase_id) && looksLikeUuid(entry.item_id));

  if (!remoteRows.length) return;

  const withOrganizationRows = remoteRows.map((entry) => ({
    organization_id: organizationId,
    item_id: entry.item_id,
    purchase_id: entry.purchase_id,
    barcode_value: entry.barcode_value,
    qr_value: entry.qr_value
  }));

  let attempt = await supabase
    .from("item_barcodes")
    .insert(withOrganizationRows)
    .select("*");

  if (attempt.error && isMissingColumnError(attempt.error)) {
    const fallbackRows = remoteRows.map((entry) => ({
      item_id: entry.item_id,
      purchase_id: entry.purchase_id,
      barcode_value: entry.barcode_value,
      qr_value: entry.qr_value
    }));
    attempt = await supabase.from("item_barcodes").insert(fallbackRows).select("*");
  }

  if (attempt.error) {
    if (isMissingRelationError(attempt.error)) return;
    throw new Error(normalizeSupabaseError(attempt.error, "Failed to save item barcodes"));
  }

  const remoteData = ensureArray(attempt.data).map(normalizeBarcodeRow);
  if (!remoteData.length) return;
  const current = dedupeRows(getAll());
  setAll(dedupeRows([...remoteData, ...current]));
}

export async function createItemBarcodesForPurchase({
  purchaseId,
  billDate,
  lines,
  mode = BARCODE_MODE_BATCH,
  enabled = true
}) {
  if (enabled === false || !purchaseId) return [];
  const organizationId = authGetOrganizationId();
  const existing = dedupeRows(getAll());
  const alreadyForPurchase = existing.filter(
    (entry) => String(entry.purchase_id || "") === String(purchaseId)
  );
  if (alreadyForPurchase.length) return alreadyForPurchase;

  const created = buildBarcodeRowsForPurchase({
    purchaseId,
    billDate,
    lines,
    mode,
    existingRows: existing,
    organizationId
  });
  if (!created.length) return [];

  setAll(dedupeRows([...created, ...existing]));
  try {
    await pushRowsToRemote(created);
  } catch (error) {
    console.warn("Failed to sync item barcodes to remote", error);
  }
  return created;
}

export async function listItemBarcodesByPurchaseIds(purchaseIds = []) {
  const targetIds = Array.from(
    new Set(
      ensureArray(purchaseIds)
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  if (!targetIds.length) return [];

  const localRows = dedupeRows(getAll()).filter((entry) =>
    targetIds.includes(String(entry.purchase_id || ""))
  );

  if (!isSupabaseConfigured || !supabase) return localRows;

  const organizationId = authGetOrganizationId();
  const uuidPurchaseIds = targetIds.filter(looksLikeUuid);
  if (!uuidPurchaseIds.length) return localRows;

  let query = supabase
    .from("item_barcodes")
    .select("*")
    .in("purchase_id", uuidPurchaseIds);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingColumnError(error)) {
      const fallback = await supabase
        .from("item_barcodes")
        .select("*")
        .in("purchase_id", uuidPurchaseIds);
      if (fallback.error) {
        if (isMissingRelationError(fallback.error)) return localRows;
        throw new Error(normalizeSupabaseError(fallback.error, "Failed to load item barcodes"));
      }
      const merged = dedupeRows([...localRows, ...ensureArray(fallback.data).map(normalizeBarcodeRow)]);
      return merged.filter((entry) => targetIds.includes(String(entry.purchase_id || "")));
    }
    if (isMissingRelationError(error)) return localRows;
    throw new Error(normalizeSupabaseError(error, "Failed to load item barcodes"));
  }

  const remoteRows = ensureArray(data).map(normalizeBarcodeRow);
  const mergedRows = dedupeRows([...remoteRows, ...dedupeRows(getAll())]);
  setAll(mergedRows);

  return mergedRows.filter((entry) => targetIds.includes(String(entry.purchase_id || "")));
}

export async function syncItemBarcodesFromRemote() {
  if (!isSupabaseConfigured || !supabase) return listItemBarcodes();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return listItemBarcodes();

  let query = supabase
    .from("item_barcodes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(5000);

  let { data, error } = await query;

  if (error && isMissingColumnError(error)) {
    const fallback = await supabase
      .from("item_barcodes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    if (isMissingRelationError(error)) return listItemBarcodes();
    throw new Error(normalizeSupabaseError(error, "Failed to load item barcodes"));
  }

  const remoteRows = ensureArray(data).map(normalizeBarcodeRow);
  const localRows = dedupeRows(getAll());
  const localNonRemoteRows = localRows.filter(
    (entry) => !looksLikeUuid(entry.purchase_id) || !looksLikeUuid(entry.item_id)
  );
  const mergedRows = dedupeRows([...remoteRows, ...localNonRemoteRows]);
  setAll(mergedRows);
  return mergedRows;
}

export function findItemIdByBarcode(scanValue, rows = []) {
  const target = normalizeBarcodeLookupValue(scanValue);
  if (!target) return "";
  const match = ensureArray(rows).find((entry) => {
    const barcodeValue = normalizeBarcodeLookupValue(entry?.barcode_value || entry?.barcodeValue);
    return barcodeValue === target;
  });
  return String(match?.item_id || match?.itemId || "").trim();
}

