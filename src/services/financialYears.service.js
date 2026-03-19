import { authGetOrganizationId, authGetUser } from "./auth.service";
import {
  LS_KEYS,
  lsGetOrganizationScoped,
  lsSetOrganizationScoped,
  ssGet,
  ssSet
} from "./storage";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

export const FINANCIAL_YEARS_UPDATED_EVENT = "financialYears:updated";

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map((part) => Number(part));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = parseDate(raw);
  if (!parsed) return "";
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function addYears(date, years) {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function buildFinancialYearEndDate(startDate) {
  const start = parseDate(startDate);
  if (!start) return "";
  return normalizeIsoDate(addDays(addYears(start, 1), -1));
}

export function isExactFinancialYearRange(startDate, endDate) {
  const start = normalizeIsoDate(startDate);
  const end = normalizeIsoDate(endDate);
  if (!start || !end) return false;
  return buildFinancialYearEndDate(start) === end;
}

export function buildFinancialYearLabel(startDate, endDate) {
  const startYear = Number(String(normalizeIsoDate(startDate)).slice(0, 4));
  const endYear = Number(String(normalizeIsoDate(endDate)).slice(0, 4));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return "";
  return `${startYear}-${endYear}`;
}

export function buildFinancialYearCode(startDate, endDate) {
  const startYear = String(normalizeIsoDate(startDate)).slice(0, 4);
  const endYear = String(normalizeIsoDate(endDate)).slice(0, 4);
  if (!startYear || !endYear) return "";
  return `${startYear}${endYear}`;
}

function isMissingTableOrColumnError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || message.includes("does not exist");
}

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function getLocalRows() {
  return lsGetOrganizationScoped(LS_KEYS.financial_years, []);
}

function getSelectedIdFallback() {
  const sessionValue = ssGet(LS_KEYS.selected_financial_year_id, "");
  if (sessionValue) return String(sessionValue || "").trim();
  return String(lsGetOrganizationScoped(LS_KEYS.selected_financial_year_id, "") || "").trim();
}

function emitFinancialYearsUpdated(detail = null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(FINANCIAL_YEARS_UPDATED_EVENT, {
      detail:
        detail && typeof detail === "object"
          ? detail
          : {
              years: financialYearsList(),
              selectedId: getSelectedIdFallback()
            }
    })
  );
}

function toFinancialYearRow(row, selectedId = "") {
  const startDate = normalizeIsoDate(row?.start_date || row?.startDate || row?.financial_year_start);
  const endDate = normalizeIsoDate(row?.end_date || row?.endDate || row?.financial_year_end);
  const id = String(row?.id || row?.financial_year_id || "").trim() || `${startDate}_${endDate}`;
  const label =
    String(row?.label || "").trim() || buildFinancialYearLabel(startDate, endDate) || `${startDate} to ${endDate}`;
  const yearCode = String(row?.year_code || row?.yearCode || "").trim() || buildFinancialYearCode(startDate, endDate);
  return {
    id,
    organizationId: String(row?.organization_id || row?.organizationId || authGetOrganizationId() || "").trim(),
    startDate,
    endDate,
    label,
    yearCode,
    isCurrent: !!row?.is_current,
    autoCreated: !!row?.auto_created,
    selected: String(selectedId || "").trim() === id,
    created_at: row?.created_at || new Date().toISOString(),
    updated_at: row?.updated_at || row?.created_at || new Date().toISOString()
  };
}

function sortFinancialYears(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) =>
    String(right?.startDate || "").localeCompare(String(left?.startDate || ""))
  );
}

function persistRows(rows, selectedId = "") {
  const normalized = sortFinancialYears(rows).map((row) => toFinancialYearRow(row, selectedId));
  const effectiveSelectedId =
    String(selectedId || "").trim() ||
    String(normalized.find((row) => row.isCurrent)?.id || normalized[0]?.id || "").trim();

  const finalRows = normalized.map((row) => ({
    ...row,
    selected: row.id === effectiveSelectedId
  }));

  lsSetOrganizationScoped(LS_KEYS.financial_years, finalRows);
  lsSetOrganizationScoped(LS_KEYS.selected_financial_year_id, effectiveSelectedId);
  ssSet(LS_KEYS.selected_financial_year_id, effectiveSelectedId);
  emitFinancialYearsUpdated({ years: finalRows, selectedId: effectiveSelectedId });
  return finalRows;
}

function buildFallbackRow(profile = {}) {
  const startDate = normalizeIsoDate(profile?.financialYearStartDate || profile?.financial_year_start);
  const endDate = normalizeIsoDate(profile?.financialYearEndDate || profile?.financial_year_end);
  if (!startDate || !endDate || !isExactFinancialYearRange(startDate, endDate)) return [];
  return [
    {
      id: `${startDate}_${endDate}`,
      organizationId: authGetOrganizationId(),
      startDate,
      endDate,
      label: buildFinancialYearLabel(startDate, endDate),
      yearCode: buildFinancialYearCode(startDate, endDate),
      isCurrent: true,
      autoCreated: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
}

export function financialYearsList() {
  return sortFinancialYears(getLocalRows());
}

export function financialYearsGetSelectedId() {
  return getSelectedIdFallback();
}

export function financialYearsGetSelected() {
  const years = financialYearsList();
  const selectedId = financialYearsGetSelectedId();
  return years.find((row) => row.id === selectedId) || years.find((row) => row.isCurrent) || years[0] || null;
}

export function financialYearsResolveForDate(dateValue, rows = financialYearsList()) {
  const safeDate = normalizeIsoDate(dateValue);
  if (!safeDate) return null;
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) => row?.startDate && row?.endDate && safeDate >= row.startDate && safeDate <= row.endDate
    ) || null
  );
}

export function financialYearsGetCurrent(dateValue = new Date()) {
  return financialYearsResolveForDate(dateValue, financialYearsList());
}

export function financialYearsGetActiveRange() {
  const selected = financialYearsGetSelected();
  if (!selected) return { fromDate: "", toDate: "" };
  return {
    fromDate: selected.startDate,
    toDate: selected.endDate
  };
}

export function financialYearsSetSelected(selectedId) {
  const safeId = String(selectedId || "").trim();
  const rows = financialYearsList();
  const nextSelectedId =
    safeId && rows.some((row) => row.id === safeId)
      ? safeId
      : String(rows.find((row) => row.isCurrent)?.id || rows[0]?.id || "").trim();
  return persistRows(rows, nextSelectedId);
}

export function applyFinancialYearRange(filters = {}, fiscalYear = financialYearsGetSelected()) {
  const next = { ...(filters || {}) };
  if (!fiscalYear) return next;
  if ("fromDate" in next) next.fromDate = fiscalYear.startDate;
  if ("toDate" in next) next.toDate = fiscalYear.endDate;
  if ("asOfDate" in next) next.asOfDate = fiscalYear.endDate;
  return next;
}

export function annotateWithFinancialYear(record, dateValue, rows = financialYearsList()) {
  const matched = financialYearsResolveForDate(dateValue, rows);
  if (!matched) return record;
  return {
    ...(record || {}),
    financialYearId: matched.id,
    financialYearLabel: matched.label,
    financialYearCode: matched.yearCode
  };
}

export async function financialYearsSyncFromRemote(profileFallback = null) {
  if (!isSupabaseConfigured || !supabase) {
    const fallbackRows = buildFallbackRow(profileFallback || {});
    return persistRows(fallbackRows, financialYearsGetSelectedId());
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    const fallbackRows = buildFallbackRow(profileFallback || {});
    return persistRows(fallbackRows, financialYearsGetSelectedId());
  }

  const { data, error } = await supabase
    .from("financial_years")
    .select("*")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false });

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      const fallbackRows = buildFallbackRow(profileFallback || {});
      return persistRows(fallbackRows, financialYearsGetSelectedId());
    }
    throw new Error(normalizeSupabaseError(error, "Failed to load financial years"));
  }

  const mapped = (Array.isArray(data) ? data : []).map((row) => toFinancialYearRow(row, financialYearsGetSelectedId()));
  if (!mapped.length) {
    const fallbackRows = buildFallbackRow(profileFallback || {});
    return persistRows(fallbackRows, financialYearsGetSelectedId());
  }
  return persistRows(mapped, financialYearsGetSelectedId());
}

export async function ensureFinancialYearForProfile(profile = {}, options = {}) {
  const startDate = normalizeIsoDate(profile?.financialYearStartDate || profile?.financial_year_start);
  const endDate = normalizeIsoDate(profile?.financialYearEndDate || profile?.financial_year_end);
  if (!startDate || !endDate) {
    throw new Error("Financial year start and end dates are required.");
  }
  if (!isExactFinancialYearRange(startDate, endDate)) {
    throw new Error("Financial year must be exactly 12 months.");
  }

  const organizationId = String(options?.organizationId || authGetOrganizationId() || "").trim();
  const row = {
    id: `${startDate}_${endDate}`,
    organizationId,
    startDate,
    endDate,
    label: buildFinancialYearLabel(startDate, endDate),
    yearCode: buildFinancialYearCode(startDate, endDate),
    isCurrent: true,
    autoCreated: !!options?.autoCreated,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (!organizationId || !isSupabaseConfigured || !supabase) {
    return persistRows([row], row.id);
  }

  const actorUserId = authGetUser()?.id || null;
  const payload = {
    organization_id: organizationId,
    start_date: startDate,
    end_date: endDate,
    year_code: row.yearCode,
    label: row.label,
    is_current: true,
    auto_created: !!options?.autoCreated,
    created_by: actorUserId
  };

  const { error } = await supabase
    .from("financial_years")
    .upsert(payload, { onConflict: "organization_id,start_date" });

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      return persistRows([row], row.id);
    }
    throw new Error(normalizeSupabaseError(error, "Failed to save financial year"));
  }

  return financialYearsSyncFromRemote(profile);
}
