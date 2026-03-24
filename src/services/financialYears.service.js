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

const DEFAULT_FINANCIAL_YEAR_START = "2000-04-01";
const GENERATED_FINANCIAL_YEAR_OFFSETS = [-5, -4, -3, -2, -1, 0, 1];

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

function buildUtcDate(year, monthIndex, day) {
  const safeYear = Number(year);
  const safeMonth = Number(monthIndex);
  const safeDay = Number(day);
  if (!Number.isFinite(safeYear) || !Number.isFinite(safeMonth) || !Number.isFinite(safeDay)) return null;
  const lastDay = new Date(Date.UTC(safeYear, safeMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(safeYear, safeMonth, Math.min(Math.max(1, safeDay), lastDay)));
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

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function getStoredProfile() {
  return lsGetOrganizationScoped(LS_KEYS.company_profile, null) || {};
}

function resolveFinancialYearDateCandidate(source = {}) {
  return normalizeIsoDate(
    source?.financialYearDate ||
      source?.financial_year_date ||
      source?.financialYearStartDate ||
      source?.financial_year_start
  );
}

function buildDefaultFinancialYearDate(referenceDate = new Date()) {
  const parsed = parseDate(referenceDate) || new Date();
  const year = parsed.getUTCMonth() >= 3 ? parsed.getUTCFullYear() : parsed.getUTCFullYear() - 1;
  return `${year}-04-01`;
}

function getFinancialYearDate(profileFallback = null, rows = []) {
  const explicit = resolveFinancialYearDateCandidate(profileFallback || {});
  if (explicit) return explicit;

  const stored = resolveFinancialYearDateCandidate(getStoredProfile());
  if (stored) return stored;

  const fromRows = (Array.isArray(rows) ? rows : []).find((row) =>
    resolveFinancialYearDateCandidate(row || {})
  );
  const rowDate = resolveFinancialYearDateCandidate(fromRows || {});
  if (rowDate) return rowDate;

  const firstStartDate = normalizeIsoDate((Array.isArray(rows) ? rows : [])[0]?.startDate);
  if (firstStartDate) return firstStartDate;

  return buildDefaultFinancialYearDate();
}

function getFinancialYearOrganizationId(profileFallback = null, rows = []) {
  return String(
    profileFallback?.organizationId ||
      profileFallback?.organization_id ||
      authGetOrganizationId() ||
      (Array.isArray(rows) ? rows[0]?.organizationId : "") ||
      ""
  ).trim();
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

export function resolveFinancialYearRange(dateValue, financialYearDate = "") {
  const safeDate = parseDate(dateValue);
  const safeFinancialYearDate = parseDate(financialYearDate || DEFAULT_FINANCIAL_YEAR_START);
  if (!safeDate || !safeFinancialYearDate) {
    return {
      financialYearDate: "",
      startDate: "",
      endDate: "",
      label: "",
      yearCode: ""
    };
  }

  const anchorMonth = safeFinancialYearDate.getUTCMonth();
  const anchorDay = safeFinancialYearDate.getUTCDate();
  const thisYearStart = buildUtcDate(safeDate.getUTCFullYear(), anchorMonth, anchorDay);
  const effectiveStart = safeDate >= thisYearStart ? thisYearStart : buildUtcDate(safeDate.getUTCFullYear() - 1, anchorMonth, anchorDay);
  const startDate = normalizeIsoDate(effectiveStart);
  const endDate = buildFinancialYearEndDate(startDate);

  return {
    financialYearDate: startDate,
    startDate,
    endDate,
    label: buildFinancialYearLabel(startDate, endDate),
    yearCode: buildFinancialYearCode(startDate, endDate)
  };
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
  const financialYearDate = resolveFinancialYearDateCandidate(row || {});
  const startDate = normalizeIsoDate(row?.start_date || row?.startDate || financialYearDate);
  const endDate = normalizeIsoDate(row?.end_date || row?.endDate) || buildFinancialYearEndDate(startDate);
  const id = String(row?.id || row?.financial_year_id || "").trim() || `${startDate}_${endDate}`;
  const label =
    String(row?.label || "").trim() || buildFinancialYearLabel(startDate, endDate) || `${startDate} to ${endDate}`;
  const yearCode = String(row?.year_code || row?.yearCode || "").trim() || buildFinancialYearCode(startDate, endDate);

  return {
    id,
    organizationId: String(row?.organization_id || row?.organizationId || authGetOrganizationId() || "").trim(),
    financialYearDate: financialYearDate || startDate,
    startDate,
    endDate,
    label,
    yearCode,
    isCurrent: row?.isCurrent ?? !!row?.is_current,
    autoCreated: row?.autoCreated ?? !!row?.auto_created,
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

function mergeFinancialYearRows(rows, selectedId = "") {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((row) => toFinancialYearRow(row, selectedId));
  const merged = new Map();

  normalizedRows.forEach((row) => {
    const key = `${row.organizationId || "local"}::${row.startDate}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, row);
      return;
    }

    merged.set(key, {
      ...current,
      ...row,
      id: looksLikeUuid(row.id) ? row.id : looksLikeUuid(current.id) ? current.id : row.id || current.id,
      financialYearDate: row.financialYearDate || current.financialYearDate,
      label: row.label || current.label,
      yearCode: row.yearCode || current.yearCode,
      isCurrent: !!(current.isCurrent || row.isCurrent),
      autoCreated: !!(current.autoCreated && row.autoCreated),
      created_at: current.created_at || row.created_at,
      updated_at: row.updated_at || current.updated_at
    });
  });

  return sortFinancialYears(Array.from(merged.values()));
}

function buildFinancialYearRowForDate(dateValue, options = {}) {
  const anchorDate = getFinancialYearDate(options?.profileFallback || null, options?.rows || []);
  const range = resolveFinancialYearRange(dateValue, anchorDate);
  if (!range.startDate || !range.endDate) return null;

  const organizationId = getFinancialYearOrganizationId(options?.profileFallback || null, options?.rows || []);
  const existing = (Array.isArray(options?.rows) ? options.rows : []).find(
    (row) => normalizeIsoDate(row?.startDate || row?.start_date) === range.startDate
  );

  return toFinancialYearRow(
    {
      ...(existing || {}),
      id: existing?.id || `${range.startDate}_${range.endDate}`,
      organization_id: existing?.organizationId || existing?.organization_id || organizationId,
      financial_year_date: range.financialYearDate,
      start_date: range.startDate,
      end_date: range.endDate,
      label: existing?.label || range.label,
      year_code: existing?.yearCode || existing?.year_code || range.yearCode,
      is_current: existing?.isCurrent ?? (
        normalizeIsoDate(new Date()) >= range.startDate && normalizeIsoDate(new Date()) <= range.endDate
      ),
      auto_created: existing?.autoCreated ?? true,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    options?.selectedId || ""
  );
}

function buildGeneratedFinancialYears(profileFallback = null, rows = []) {
  const anchorDate = getFinancialYearDate(profileFallback, rows);
  const currentRange = resolveFinancialYearRange(new Date(), anchorDate);
  if (!currentRange.startDate) return [];

  return GENERATED_FINANCIAL_YEAR_OFFSETS.map((offset) => {
    const shiftedStart = normalizeIsoDate(addYears(parseDate(currentRange.startDate), offset));
    return buildFinancialYearRowForDate(shiftedStart, {
      profileFallback: { ...(profileFallback || {}), financialYearDate: anchorDate },
      rows
    });
  }).filter(Boolean);
}

function persistRows(rows, selectedId = "", profileFallback = null) {
  const normalized = mergeFinancialYearRows(
    [...(Array.isArray(rows) ? rows : []), ...buildGeneratedFinancialYears(profileFallback, rows)],
    selectedId
  );
  const effectiveSelectedId =
    String(selectedId || "").trim() ||
    String(normalized.find((row) => row.id === getSelectedIdFallback())?.id || normalized.find((row) => row.isCurrent)?.id || normalized[0]?.id || "").trim();

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

function buildFallbackRows(profile = {}) {
  return buildGeneratedFinancialYears(profile, []);
}

export function financialYearsList() {
  return mergeFinancialYearRows([...getLocalRows(), ...buildGeneratedFinancialYears(getStoredProfile(), getLocalRows())]);
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

  const matched =
    (Array.isArray(rows) ? rows : []).find(
      (row) => row?.startDate && row?.endDate && safeDate >= row.startDate && safeDate <= row.endDate
    ) || null;
  if (matched) return matched;

  return buildFinancialYearRowForDate(safeDate, {
    rows,
    profileFallback: getStoredProfile()
  });
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

export function resolveFinancialYearFilterRange(input = financialYearsGetSelected()) {
  const fromDate = normalizeIsoDate(input?.fromDate || input?.startDate || input?.from || "");
  const toDate = normalizeIsoDate(input?.toDate || input?.endDate || input?.to || "");
  return { fromDate, toDate };
}

export function matchesFinancialYearFilter(dateValue, input = financialYearsGetSelected()) {
  const safeDate = normalizeIsoDate(dateValue);
  const { fromDate, toDate } = resolveFinancialYearFilterRange(input);
  if (fromDate && safeDate && safeDate < fromDate) return false;
  if (toDate && safeDate && safeDate > toDate) return false;
  return true;
}

export function financialYearsSetSelected(selectedId) {
  const safeId = String(selectedId || "").trim();
  const rows = financialYearsList();
  const nextSelectedId =
    safeId && rows.some((row) => row.id === safeId)
      ? safeId
      : String(rows.find((row) => row.isCurrent)?.id || rows[0]?.id || "").trim();
  return persistRows(rows, nextSelectedId, getStoredProfile());
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
    return persistRows(buildFallbackRows(profileFallback || {}), financialYearsGetSelectedId(), profileFallback);
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    return persistRows(buildFallbackRows(profileFallback || {}), financialYearsGetSelectedId(), profileFallback);
  }

  const { data, error } = await supabase
    .from("financial_years")
    .select("*")
    .eq("organization_id", organizationId)
    .order("start_date", { ascending: false });

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      return persistRows(buildFallbackRows(profileFallback || {}), financialYearsGetSelectedId(), profileFallback);
    }
    throw new Error(normalizeSupabaseError(error, "Failed to load financial years"));
  }

  const mapped = mergeFinancialYearRows((Array.isArray(data) ? data : []).map((row) => toFinancialYearRow(row)));
  const rows = mapped.length ? mapped : buildFallbackRows(profileFallback || {});
  return persistRows(rows, financialYearsGetSelectedId(), profileFallback);
}

export async function ensureFinancialYearForProfile(profile = {}, options = {}) {
  const financialYearDate = getFinancialYearDate(profile);
  if (!financialYearDate) {
    throw new Error("Financial year date is required.");
  }

  const dateValue = normalizeIsoDate(options?.dateValue || new Date()) || normalizeIsoDate(new Date());
  const organizationId = String(options?.organizationId || authGetOrganizationId() || "").trim();
  const existingRows = financialYearsList();
  const row = buildFinancialYearRowForDate(dateValue, {
    rows: existingRows,
    profileFallback: {
      ...(profile || {}),
      organizationId,
      financialYearDate
    }
  });

  if (!row) {
    throw new Error("Unable to calculate financial year.");
  }

  if (!organizationId || !isSupabaseConfigured || !supabase) {
    return persistRows([row, ...existingRows], row.id, profile);
  }

  const actorUserId = authGetUser()?.id || null;
  const payload = {
    organization_id: organizationId,
    start_date: row.startDate,
    end_date: row.endDate,
    year_code: row.yearCode,
    label: row.label,
    is_current: !!row.isCurrent,
    auto_created: !!options?.autoCreated,
    created_by: actorUserId
  };

  const { data, error } = await supabase
    .from("financial_years")
    .upsert(payload, { onConflict: "organization_id,year_code" })
    .select("*")
    .single();

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      return persistRows([row, ...existingRows], row.id, profile);
    }
    throw new Error(normalizeSupabaseError(error, "Failed to save financial year"));
  }

  const savedRow = toFinancialYearRow(data || payload, row.id);
  return persistRows([savedRow, ...existingRows], savedRow.id, profile);
}

export async function financialYearsEnsureForDate(dateValue, profileFallback = null, options = {}) {
  const safeDate = normalizeIsoDate(dateValue);
  if (!safeDate) return null;

  const rows = financialYearsList();
  const matched = financialYearsResolveForDate(safeDate, rows);
  if (matched && looksLikeUuid(matched.id)) return matched;

  const savedRows = await ensureFinancialYearForProfile(profileFallback || getStoredProfile(), {
    ...options,
    dateValue: safeDate,
    autoCreated: options?.autoCreated ?? true
  });

  const savedMatched = financialYearsResolveForDate(safeDate, savedRows);
  return savedMatched || matched || null;
}
