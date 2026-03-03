import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId, authGetRole, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { canCreateEntries, canEditEntries } from "./roles";
import { triggerCreditLimitNotifications } from "../modules/parties/store";
import { createItemBarcodesForPurchase } from "./itemBarcodes.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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
    message.includes("post_purchase_bill_fifo")
  );
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

export function purchasesList() {
  return getAll();
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
  return {
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
    lines: []
  };
}

export async function purchasesSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return purchasesList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return purchasesList();

  const { data, error } = await supabase
    .from("purchase_bills")
    .select("id,supplier_id,bill_no,bill_date,due_date,subtotal,tax_total,grand_total,status,metadata,created_at")
    .eq("organization_id", organizationId)
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
      parseNumber(entry?.grand_total) - (debitMap.get(entry.id) || 0) - (paymentMap.get(entry.id) || 0)
    );
    return {
      ...bill,
      partyAddress: bill.partyAddress || supplierAddressMap.get(entry?.supplier_id) || "",
      lines: lineMap.get(entry.id) || []
    };
  });
  setAll(mapped);
  await triggerCreditLimitNotifications();
  return mapped;
}

export async function purchasesCreate(bill) {
  assertPurchaseWritePermission();
  const now = new Date().toISOString();
  const actor = authGetUser();
  const actorUserId = actor?.id || null;
  const actorName = String(actor?.name || actor?.email || "").trim();
  let id = uid("pur_");
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const totals = bill?.totals || {};

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const supplierId = looksLikeUuid(bill?.partyId) ? bill.partyId : null;
      const postingPayload = {
        organization_id: organizationId,
        bill_no: bill?.billNumber || `BILL-${Date.now()}`,
        bill_date: bill?.billDate || now.slice(0, 10),
        due_date: bill?.dueDate || bill?.billDate || now.slice(0, 10),
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
        if (postError && !isMissingRpcError(postError)) {
          throw new Error(normalizeSupabaseError(postError, "Failed to post purchase bill"));
        }

        const { data: billRow, error: billError } = await supabase
          .from("purchase_bills")
          .insert({
            organization_id: organizationId,
            bill_no: bill?.billNumber || `BILL-${Date.now()}`,
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
              totalQty: parseNumber(totals?.totalQty)
            },
            created_by: actorUserId
          })
          .select("*")
          .single();

        if (billError) {
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
  }

  const next = {
    ...bill,
    id,
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
  };

  setAll([next, ...getAll()]);
  try {
    await createItemBarcodesForPurchase({
      purchaseId: id,
      billDate: bill?.billDate || now.slice(0, 10),
      lines: next.lines,
      enabled: bill?.barcodeOptions?.enabled !== false,
      mode: bill?.barcodeOptions?.mode || "batch"
    });
  } catch (error) {
    console.warn("Barcode generation failed for purchase", error);
  }
  await triggerCreditLimitNotifications();
  return id;
}
