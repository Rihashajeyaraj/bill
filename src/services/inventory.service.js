import { authGetOrganizationId } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

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

