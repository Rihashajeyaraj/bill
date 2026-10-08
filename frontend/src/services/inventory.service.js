import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function roundQuantity(value) {
  return Math.round(parseNumber(value) * 1000) / 1000;
}

function roundCost(value) {
  return Math.round(parseNumber(value) * 1000000) / 1000000;
}

function resolveItemSeedDetails(item) {
  const itemType = String(item?.item_type || item?.type || "").trim().toLowerCase();
  const trackInventory = item?.trackInventory === true || itemType === "product";
  const itemId = String(item?.id || "").trim();
  if (!trackInventory || !looksLikeUuid(itemId)) return null;

  const currentStock = Math.max(
    0,
    parseNumber(item?.current_stock ?? item?.currentStock ?? item?.stockQty ?? item?.metadata?.currentStock)
  );
  const openingStock = Math.max(
    0,
    parseNumber(
      item?.opening_stock ??
        item?.openingStock ??
        item?.quantity ??
        item?.metadata?.openingStock ??
        item?.metadata?.openingQty
    )
  );
  const seedQty = roundQuantity(currentStock > 0 ? currentStock : openingStock);
  if (seedQty <= 0) return null;

  const purchasePrice = Math.max(
    0,
    parseNumber(item?.purchase_price ?? item?.purchaseRate ?? item?.metadata?.purchasePrice)
  );
  const salePrice = Math.max(0, parseNumber(item?.sale_price ?? item?.salesRate ?? item?.price));
  const taxRate = Math.max(0, parseNumber(item?.tax_rate ?? item?.taxRate));
  const taxInclusive = Boolean(item?.tax_inclusive ?? item?.taxInclusive ?? false);
  const movementDate = String(item?.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

  return {
    itemId,
    quantity: seedQty,
    purchasePrice,
    salePrice,
    taxRate,
    taxInclusive,
    movementDate
  };
}

async function hasStockLedgerRows(organizationId, itemId) {
  const { data, error } = await supabase
    .from("stock_batches")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("item_id", itemId)
    .limit(1);

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to verify stock ledger"));
  }

  return Array.isArray(data) && data.length > 0;
}

async function seedOpeningStockLedger(organizationId, item) {
  const seed = resolveItemSeedDetails(item);
  if (!seed) return false;
  if (await hasStockLedgerRows(organizationId, seed.itemId)) return false;

  const actorUserId = authGetUser()?.id || null;
  const unitCostExclTax = roundCost(seed.purchasePrice);
  const unitCostInclTax = seed.taxInclusive
    ? unitCostExclTax
    : roundCost(unitCostExclTax * (1 + seed.taxRate / 100));

  const { data: batchRow, error: batchError } = await supabase
    .from("stock_batches")
    .insert({
      organization_id: organizationId,
      item_id: seed.itemId,
      purchase_bill_id: null,
      purchase_bill_item_id: null,
      batch_date: seed.movementDate,
      source_document_no: "OPENING_BALANCE",
      qty_purchased: seed.quantity,
      qty_remaining: seed.quantity,
      unit_cost_excl_tax: unitCostExclTax,
      unit_cost_incl_tax: unitCostInclTax,
      suggested_sale_rate: seed.salePrice,
      tax_rate: seed.taxRate,
      tax_amount: 0,
      tax_inclusive: seed.taxInclusive,
      metadata: {
        source: "item_opening_stock",
        seededByApp: true
      },
      created_by: actorUserId
    })
    .select("id")
    .maybeSingle();

  if (batchError) {
    throw new Error(normalizeSupabaseError(batchError, "Failed to seed opening stock batch"));
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    organization_id: organizationId,
    item_id: seed.itemId,
    stock_batch_id: batchRow?.id || null,
    movement_type: "IN",
    movement_date: seed.movementDate,
    quantity_delta: seed.quantity,
    unit_cost_excl_tax: unitCostExclTax,
    unit_cost_incl_tax: unitCostInclTax,
    source_table: "items",
    source_id: seed.itemId,
    source_item_id: seed.itemId,
    source_document_no: "OPENING_BALANCE",
    notes: "Opening stock seeded from item master",
    metadata: {
      source: "item_opening_stock",
      seededByApp: true
    },
    created_by: actorUserId
  });

  if (movementError) {
    throw new Error(normalizeSupabaseError(movementError, "Failed to record opening stock movement"));
  }

  return true;
}

export async function ensureRemoteOpeningStockLedgerForItems(items) {
  if (!isSupabaseConfigured || !supabase) return 0;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return 0;

  let seededCount = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (await seedOpeningStockLedger(organizationId, item)) {
      seededCount += 1;
    }
  }
  return seededCount;
}

export async function fetchInvoiceAllocationDetails(invoiceId) {
  if (!invoiceId || !isSupabaseConfigured || !supabase) {
    return [];
  }
  const organizationId = authGetOrganizationId();
  if (!organizationId) return [];

  const { data, error } = await supabase.rpc("get_invoice_allocations", {
    p_organization_id: organizationId,
    p_invoice_id: invoiceId
  });
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load allocation details"));
  }
  return Array.isArray(data) ? data : [];
}

export async function fetchPurchaseBillByBatchId(batchId) {
  if (!batchId || !isSupabaseConfigured || !supabase) {
    return null;
  }
  const organizationId = authGetOrganizationId();
  if (!organizationId) return null;

  const { data: batchRow, error: batchError } = await supabase
    .from("stock_batches")
    .select("id,purchase_bill_id,source_document_no")
    .eq("organization_id", organizationId)
    .eq("id", batchId)
    .maybeSingle();

  if (batchError) {
    throw new Error(normalizeSupabaseError(batchError, "Failed to resolve purchase bill from batch"));
  }
  const purchaseBillId = String(batchRow?.purchase_bill_id || "").trim();
  if (!purchaseBillId) {
    return {
      purchaseBillId: "",
      purchaseBillNo: String(batchRow?.source_document_no || "").trim()
    };
  }

  const { data: billRow, error: billError } = await supabase
    .from("purchase_bills")
    .select("id,bill_no")
    .eq("organization_id", organizationId)
    .eq("id", purchaseBillId)
    .maybeSingle();

  if (billError) {
    throw new Error(normalizeSupabaseError(billError, "Failed to load purchase bill details"));
  }

  return {
    purchaseBillId: String(billRow?.id || purchaseBillId),
    purchaseBillNo: String(billRow?.bill_no || batchRow?.source_document_no || "").trim()
  };
}

export async function fetchItemStockHistory(itemId) {
  if (!itemId || !isSupabaseConfigured || !supabase) {
    return { history: [], batches: [] };
  }
  const organizationId = authGetOrganizationId();
  if (!organizationId) return { history: [], batches: [] };

  const [historyResult, batchResult] = await Promise.all([
    supabase.rpc("get_item_stock_history", {
      p_organization_id: organizationId,
      p_item_id: itemId
    }),
    supabase.rpc("get_item_batch_summary", {
      p_organization_id: organizationId,
      p_item_id: itemId
    })
  ]);

  if (historyResult.error) {
    throw new Error(normalizeSupabaseError(historyResult.error, "Failed to load stock history"));
  }
  if (batchResult.error) {
    throw new Error(normalizeSupabaseError(batchResult.error, "Failed to load stock batches"));
  }

  return {
    history: Array.isArray(historyResult.data) ? historyResult.data : [],
    batches: Array.isArray(batchResult.data) ? batchResult.data : []
  };
}

export async function fetchTaxSummary({ dateFrom = "", dateTo = "" } = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return { inputTax: 0, outputTax: 0, netPayable: 0 };
  }
  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    return { inputTax: 0, outputTax: 0, netPayable: 0 };
  }

  const { data, error } = await supabase.rpc("get_tax_summary", {
    p_organization_id: organizationId,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null
  });
  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load tax summary"));
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    inputTax: parseNumber(row?.input_tax),
    outputTax: parseNumber(row?.output_tax),
    netPayable: parseNumber(row?.net_payable)
  };
}

export async function fetchInvoiceProfitDetails(invoiceId) {
  if (!invoiceId || !isSupabaseConfigured || !supabase) {
    return { summary: null, items: [] };
  }
  const organizationId = authGetOrganizationId();
  if (!organizationId) return { summary: null, items: [] };

  const [summaryResult, itemResult] = await Promise.all([
    supabase.rpc("get_invoice_profit_summary", {
      p_organization_id: organizationId,
      p_invoice_id: invoiceId
    }),
    supabase.rpc("get_invoice_item_profit", {
      p_organization_id: organizationId,
      p_invoice_id: invoiceId
    })
  ]);

  if (summaryResult.error) {
    throw new Error(normalizeSupabaseError(summaryResult.error, "Failed to load invoice profit"));
  }
  if (itemResult.error) {
    throw new Error(normalizeSupabaseError(itemResult.error, "Failed to load invoice item profit"));
  }

  return {
    summary: Array.isArray(summaryResult.data) ? summaryResult.data[0] || null : null,
    items: Array.isArray(itemResult.data) ? itemResult.data : []
  };
}
