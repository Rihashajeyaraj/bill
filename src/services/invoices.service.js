import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId, authGetRole, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { canCreateEntries, canEditEntries } from "./roles";
import { triggerCreditLimitNotifications } from "../modules/parties/store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.invoices, []);
}

function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.invoices, list);
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

function isMissingRpcError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "PGRST202" ||
    message.includes("could not find the function") ||
    message.includes("post_invoice_fifo")
  );
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

  return {
    id: row?.id || uid("inv_"),
    invoiceNo: row?.invoice_no || "",
    invoiceDate: row?.invoice_date || "",
    dueDate: row?.due_date || row?.invoice_date || "",
    partyId: row?.party_id || "",
    partyName: metadata?.partyName || metadata?.buyer?.name || "",
    placeOfSupply: row?.place_of_supply_state || metadata?.placeOfSupply || "",
    country: metadata?.country || "",
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
    created_at: row?.created_at || new Date().toISOString(),
    updated_at: row?.updated_at || row?.created_at || new Date().toISOString()
  };
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

export function invoicesList() {
  return getAll();
}

export async function invoicesSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return invoicesList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return invoicesList();

  const { data: invoiceRows, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("organization_id", organizationId)
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
      .select("invoice_id,amount,status,direction")
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
    paymentMap.set(invoiceId, current + Math.max(0, parseNumber(row?.amount)));
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

  setAll(mapped);
  await triggerCreditLimitNotifications();
  return mapped;
}

export async function invoicesCreate(invoice) {
  assertInvoiceWritePermission();
  const now = new Date().toISOString();
  const actor = authGetUser();
  const actorUserId = actor?.id || null;
  const actorName = String(actor?.name || actor?.email || "").trim();
  const invoiceNo = invoice?.invoiceNo || `INV-${Date.now()}`;
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

  let id = uid("inv_");

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const remotePayload = {
        organization_id: organizationId,
        invoice_no: invoiceNo,
        invoice_date: invoice?.invoiceDate || now.slice(0, 10),
        due_date: invoice?.dueDate || invoice?.invoiceDate || now.slice(0, 10),
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
          templateId: invoice?.templateId || ""
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
        if (postError && !isMissingRpcError(postError)) {
          throw new Error(normalizeSupabaseError(postError, "Failed to post invoice"));
        }

        const { data: header, error: headerError } = await supabase
          .from("invoices")
          .upsert(remotePayload, { onConflict: "organization_id,invoice_no" })
          .select("*")
          .single();

        if (headerError) {
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
  }

  const next = {
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
    supplyType: invoice?.supplyType || tax?.supplyType || taxBreakup?.supplyType || null,
    remainingBalance: grandTotal,
    createdByUserId: actorUserId,
    createdByName: actorName,
    createdBy: actorName || String(actorUserId || "").trim(),
    created_at: now,
    updated_at: now
  };

  setAll([next, ...getAll().filter((entry) => entry.id !== id && entry.invoiceNo !== invoiceNo)]);
  console.log("[CreditMonitoring] Triggering notification check from invoicesCreate", {
    invoiceId: id,
    invoiceNo,
    partyId: next?.partyId || null
  });
  await triggerCreditLimitNotifications();
  return id;
}
