import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped, uid } from "./storage";
import { authGetOrganizationId, authGetUser } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import {
  annotateWithFinancialYear,
  financialYearsEnsureForDate,
  financialYearsResolveForDate
} from "./financialYears.service";

const DEFAULT_EXPENSE_CATEGORIES = ["Office", "Travel", "Utilities", "Marketing", "Maintenance"];
export const EXPENSES_CHANGED_EVENT = "expenses:updated";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAll() {
  return lsGetOrganizationScoped(LS_KEYS.expenses, []);
}
function setAll(list) {
  lsSetOrganizationScoped(LS_KEYS.expenses, list);
}
function getAllCategories() {
  return lsGetOrganizationScoped(LS_KEYS.expense_categories, DEFAULT_EXPENSE_CATEGORIES);
}
function setAllCategories(list) {
  lsSetOrganizationScoped(LS_KEYS.expense_categories, list);
}

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function looksLikeUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function notifyExpensesChanged(source = "unknown") {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(
    new CustomEvent(EXPENSES_CHANGED_EVENT, {
      detail: { source, at: Date.now() }
    })
  );
}

function normalizeCategory(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCategoryKey(value) {
  return normalizeCategory(value).toLowerCase();
}

function collectCategoriesFromExpenses(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source
    .map((entry) => normalizeCategory(entry?.category))
    .filter(Boolean);
}

function uniqueCategories(categories, expenses = []) {
  const bucket = new Map();
  [...DEFAULT_EXPENSE_CATEGORIES, ...(Array.isArray(categories) ? categories : []), ...collectCategoriesFromExpenses(expenses)]
    .map((entry) => normalizeCategory(entry))
    .filter(Boolean)
    .forEach((entry) => {
      const key = normalizeCategoryKey(entry);
      if (!bucket.has(key)) bucket.set(key, entry);
    });
  return Array.from(bucket.values()).sort((a, b) => a.localeCompare(b));
}

function rememberCategoryLocal(value) {
  const clean = normalizeCategory(value);
  if (!clean) return "";

  const merged = uniqueCategories([...getAllCategories(), clean], getAll());
  setAllCategories(merged);
  const existing = merged.find((entry) => normalizeCategoryKey(entry) === normalizeCategoryKey(clean));
  return existing || clean;
}

function isMissingTableError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || message.includes("does not exist");
}

function isMissingFunctionError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "42883" || code === "PGRST202" || message.includes("function") && message.includes("not found");
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function isMissingColumnError(error) {
  return String(error?.code || "").toUpperCase() === "42703";
}

function mapExpenseRow(row) {
  return annotateWithFinancialYear({
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
    financialYearId: row?.financial_year_id || "",
    created_at: row?.created_at || new Date().toISOString()
  }, row?.expense_date || row?.created_at);
}

function normalizeExpenseCategory(value) {
  const clean = normalizeCategory(value);
  return clean || "Uncategorized";
}

function summarizeExpenseCategories(entries) {
  const bucket = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const category = normalizeExpenseCategory(entry?.category);
    const value = Math.max(0, parseNumber(entry?.amount ?? entry?.totalAmount ?? entry?.total));
    bucket.set(category, (bucket.get(category) || 0) + value);
  });
  return Array.from(bucket.entries())
    .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
}

function normalizeDashboardSummaryRows(rows) {
  return summarizeExpenseCategories(
    (Array.isArray(rows) ? rows : []).map((row) => ({
      category: row?.category,
      total: row?.total
    }))
  );
}

async function ensureRemoteCategory(category) {
  const clean = rememberCategoryLocal(category);
  if (!clean || !isSupabaseConfigured || !supabase) return clean;

  const organizationId = authGetOrganizationId();
  if (!organizationId) return clean;

  const actorUserId = authGetUser()?.id || null;
  const { data, error } = await supabase
    .from("expense_categories")
    .upsert(
      {
        organization_id: organizationId,
        name: clean,
        normalized_name: normalizeCategoryKey(clean),
        created_by: actorUserId
      },
      { onConflict: "organization_id,normalized_name" }
    )
    .select("name")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return clean;
    return clean;
  }

  return rememberCategoryLocal(data?.name || clean);
}

export function expensesList() {
  return getAll();
}

export async function getDashboardExpenseSummary() {
  if (!isSupabaseConfigured || !supabase) return summarizeExpenseCategories(getAll());

  const organizationId = authGetOrganizationId();
  if (!organizationId) return summarizeExpenseCategories(getAll());

  const { data, error } = await supabase.rpc("dashboard_expense_summary", {
    p_organization_id: organizationId
  });

  if (!error) {
    return normalizeDashboardSummaryRows(data);
  }

  if (!isMissingFunctionError(error) && !isMissingTableError(error)) {
    throw new Error(normalizeSupabaseError(error, "Failed to load expense summary"));
  }

  const { data: rows, error: rowsError } = await supabase
    .from("expenses")
    .select("category, amount")
    .eq("organization_id", organizationId);

  if (rowsError) {
    throw new Error(normalizeSupabaseError(rowsError, "Failed to load expense summary"));
  }

  return summarizeExpenseCategories(
    (Array.isArray(rows) ? rows : []).map((row) => ({
      category: row?.category,
      amount: row?.amount
    }))
  );
}

export function expenseCategoriesList() {
  const merged = uniqueCategories(getAllCategories(), getAll());
  setAllCategories(merged);
  return merged;
}

export async function expenseCategoriesSyncFromRemote() {
  if (!isSupabaseConfigured || !supabase) return expenseCategoriesList();

  const organizationId = authGetOrganizationId();
  if (!organizationId) return expenseCategoriesList();

  const { data, error } = await supabase
    .from("expense_categories")
    .select("name, normalized_name")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return expenseCategoriesList();
    throw new Error(normalizeSupabaseError(error, "Failed to load expense categories"));
  }

  const merged = uniqueCategories(
    (Array.isArray(data) ? data : []).map((row) => row?.name || row?.normalized_name || ""),
    getAll()
  );
  setAllCategories(merged);
  return merged;
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

  const mapped = (Array.isArray(data) ? data : []).map(mapExpenseRow);

  setAll(mapped);
  setAllCategories(uniqueCategories(getAllCategories(), mapped));
  return mapped;
}

export async function expensesCreate(expense) {
  const id = uid("exp_");
  const expenseDate = expense?.date || "";
  const category = await ensureRemoteCategory(expense?.category);
  const normalizedAmount = parseNumber(expense?.amount);
  const normalizedTaxRate = parseNumber(expense?.taxRate);
  const normalizedTaxAmount =
    parseNumber(expense?.taxAmount) || Math.max(0, (normalizedAmount * Math.max(0, normalizedTaxRate)) / 100);
  const normalizedTotalAmount = parseNumber(expense?.totalAmount) || normalizedAmount + normalizedTaxAmount;
  const matchedFinancialYear =
    (await financialYearsEnsureForDate(expenseDate).catch(() => null)) ||
    financialYearsResolveForDate(expenseDate);
  const next = annotateWithFinancialYear({
    ...expense,
    id,
    category,
    amount: normalizedAmount,
    taxRate: normalizedTaxRate,
    taxAmount: normalizedTaxAmount,
    totalAmount: normalizedTotalAmount,
    created_at: new Date().toISOString()
  }, expenseDate);

  if (isSupabaseConfigured && supabase) {
    const organizationId = authGetOrganizationId();
    if (organizationId) {
      const actorUserId = authGetUser()?.id || null;
      let insertResult = await supabase
        .from("expenses")
        .insert({
          organization_id: organizationId,
          financial_year_id: looksLikeUuid(matchedFinancialYear?.id) ? matchedFinancialYear.id : null,
          expense_no: expense?.expenseNo || `EXP-${Date.now()}`,
          expense_date: expenseDate,
          category: category || null,
          party_id: expense?.partyId || null,
          amount: normalizedAmount,
          tax_rate: normalizedTaxRate,
          tax_amount: normalizedTaxAmount,
          total_amount: normalizedTotalAmount,
          payment_mode: expense?.paymentMode || null,
          notes: expense?.note || expense?.notes || null,
          status: "posted",
          created_by: actorUserId
        })
        .select("*")
        .single();
      if (insertResult.error && isMissingColumnError(insertResult.error)) {
        insertResult = await supabase
          .from("expenses")
          .insert({
            organization_id: organizationId,
            expense_no: expense?.expenseNo || `EXP-${Date.now()}`,
            expense_date: expenseDate,
            category: category || null,
            party_id: expense?.partyId || null,
            amount: normalizedAmount,
            tax_rate: normalizedTaxRate,
            tax_amount: normalizedTaxAmount,
            total_amount: normalizedTotalAmount,
            payment_mode: expense?.paymentMode || null,
            notes: expense?.note || expense?.notes || null,
            status: "posted",
            created_by: actorUserId
          })
          .select("*")
          .single();
      }
      const { data, error } = insertResult;

      if (error) {
        throw new Error(normalizeSupabaseError(error, "Failed to save expense"));
      }

      if (data) {
        const mapped = mapExpenseRow(data);
        const list = [mapped, ...getAll().filter((entry) => entry.id !== mapped.id)];
        setAll(list);
        setAllCategories(uniqueCategories(getAllCategories(), list));
      }

      try {
        const synced = await expensesSyncFromRemote();
        notifyExpensesChanged("create_remote");
        return synced;
      } catch {
        notifyExpensesChanged("create_remote_fallback");
        return getAll();
      }
    }
  }

  const list = [next, ...getAll()];
  setAll(list);
  setAllCategories(uniqueCategories(getAllCategories(), list));
  notifyExpensesChanged("create_local");
  return list;
}
