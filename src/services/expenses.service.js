import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.expenses, []);
}
function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.expenses, list);
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

export function expensesList() {
  return getAll();
}

export async function expensesSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return expensesList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return expensesList();

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("organization_id", organizationId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to load expenses"));
  }

  const mapped = (Array.isArray(data) ? data : []).map((row) => ({
    id: row?.id || uid("exp_"),
    expenseNo: row?.expense_no || "",
    date: row?.expense_date || "",
    category: row?.category || "",
    partyId: row?.party_id || "",
    amount: parseNumber(row?.amount),
    taxRate: parseNumber(row?.tax_rate),
    taxAmount: parseNumber(row?.tax_amount),
    totalAmount: parseNumber(row?.total_amount),
    paymentMode: row?.payment_mode || "",
    note: row?.notes || "",
    status: row?.status || "posted",
    created_at: row?.created_at || new Date().toISOString()
  }));

  setAll(mapped);
  return mapped;
}

export async function expensesCreate(expense) {
  const id = uid("exp_");
  const next = { ...expense, id, created_at: new Date().toISOString() };

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const actorUserId = authGetUser()?.id || null;
      const amount = parseNumber(expense?.amount);
      const taxRate = parseNumber(expense?.taxRate);
      const taxAmount =
        parseNumber(expense?.taxAmount) || Math.max(0, (amount * Math.max(0, taxRate)) / 100);
      const totalAmount = parseNumber(expense?.totalAmount) || amount + taxAmount;

      const { error } = await supabase.from("expenses").insert({
        organization_id: organizationId,
        expense_no: expense?.expenseNo || `EXP-${Date.now()}`,
        expense_date: expense?.date || new Date().toISOString().slice(0, 10),
        category: expense?.category || null,
        party_id: expense?.partyId || null,
        amount,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        payment_mode: expense?.paymentMode || null,
        notes: expense?.note || expense?.notes || null,
        status: "posted",
        created_by: actorUserId
      });

      if (error) {
        throw new Error(normalizeSupabaseError(error, "Failed to save expense"));
      }
    }
  }

  setAll([next, ...getAll()]);
  return id;
}
