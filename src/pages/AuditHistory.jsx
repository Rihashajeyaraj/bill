import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import DateInput from "../components/DateInput";
import { useToast } from "../context/ToastContext";
import { authGetRole, authUsingSupabase } from "../services/auth.service";
import { canAccessSettings } from "../services/roles";
import { listAuditEvents, listAuditFilterOptions } from "../services/audit.service";
import { formatDateTimeByPreference } from "../lib/formatPreferences";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";

const DEFAULT_FILTERS = {
  tableName: "",
  action: "",
  actorUserId: "",
  fromDate: "",
  toDate: ""
};

function normalizeFilters(input = DEFAULT_FILTERS) {
  const next = {
    tableName: String(input.tableName || "").trim(),
    action: String(input.action || "")
      .trim()
      .toUpperCase(),
    actorUserId: String(input.actorUserId || "").trim(),
    fromDate: String(input.fromDate || "").trim(),
    toDate: String(input.toDate || "").trim()
  };

  if (next.fromDate && next.toDate && next.fromDate > next.toDate) {
    return {
      ...next,
      fromDate: next.toDate,
      toDate: next.fromDate
    };
  }

  return next;
}

function toShortUserId(value) {
  const id = String(value || "").trim();
  if (!id) return "System";
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

function actionTone(action) {
  const safe = String(action || "").toUpperCase();
  if (safe === "INSERT") return "bg-emerald-100 text-emerald-700";
  if (safe === "DELETE") return "bg-rose-100 text-rose-700";
  return "bg-sky-100 text-sky-700";
}

function countChangedFields(beforeData, afterData) {
  const before = beforeData && typeof beforeData === "object" ? beforeData : {};
  const after = afterData && typeof afterData === "object" ? afterData : {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let count = 0;
  keys.forEach((key) => {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) count += 1;
  });
  return count;
}

function changeSummary(row) {
  const action = String(row?.action || "").toUpperCase();
  const beforeSize = row?.beforeData && typeof row.beforeData === "object" ? Object.keys(row.beforeData).length : 0;
  const afterSize = row?.afterData && typeof row.afterData === "object" ? Object.keys(row.afterData).length : 0;

  if (action === "INSERT") return `${afterSize} fields created`;
  if (action === "DELETE") return `${beforeSize} fields removed`;
  return `${countChangedFields(row?.beforeData, row?.afterData)} fields changed`;
}

function stringifyJson(value) {
  if (!value || typeof value !== "object") return "-";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "-";
  }
}

export default function AuditHistory() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [tableOptions, setTableOptions] = useState([]);
  const [userOptions, setUserOptions] = useState([]);
  const [hasSystemActor, setHasSystemActor] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState("");
  useGlobalLoadingBridge(loading, "audit-history");

  const isOwner = useMemo(() => canAccessSettings(authGetRole()), []);
  const supabaseEnabled = useMemo(() => authUsingSupabase(), []);

  const loadAuditHistory = useCallback(
    async (nextFilters = DEFAULT_FILTERS) => {
      if (!isOwner) return;
      const normalized = normalizeFilters(nextFilters);
      setLoading(true);
      try {
        const [events, options] = await Promise.all([
          listAuditEvents({ ...normalized, limit: 250 }),
          listAuditFilterOptions({ limit: 2000 })
        ]);
        setRows(Array.isArray(events) ? events : []);
        setTableOptions(Array.isArray(options?.tableNames) ? options.tableNames : []);
        setUserOptions(Array.isArray(options?.userIds) ? options.userIds : []);
        setHasSystemActor(!!options?.hasSystemActor);
        setAppliedFilters(normalized);
        setDraftFilters(normalized);
        setExpandedRowId("");
      } catch (error) {
        toast.error("Failed to load audit history", error?.message || "Unable to fetch audit events.");
      } finally {
        setLoading(false);
      }
    },
    [isOwner, toast]
  );

  useEffect(() => {
    if (!isOwner) return;
    void loadAuditHistory(DEFAULT_FILTERS);
  }, [isOwner, loadAuditHistory]);

  const tableFilterOptions = useMemo(() => {
    const list = [...tableOptions];
    const selected = String(draftFilters.tableName || "").trim();
    if (selected && !list.includes(selected)) list.unshift(selected);
    return list;
  }, [tableOptions, draftFilters.tableName]);

  const userFilterOptions = useMemo(() => {
    const list = [...userOptions];
    const selected = String(draftFilters.actorUserId || "").trim();
    if (selected && selected !== "system" && !list.includes(selected)) list.unshift(selected);
    return list;
  }, [userOptions, draftFilters.actorUserId]);

  if (!isOwner) {
    return (
      <div className="max-w-4xl space-y-4">
        <PageHeader title="Audit History" subtitle="Owner-only organization change history" />
        <Card className="p-6">
          <p className="text-sm font-semibold text-slate-900">Permission denied</p>
          <p className="mt-1 text-sm text-slate-600">Only owner can view organization audit history.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-16">
      <PageHeader
        title="Audit History"
        subtitle="Track create, update, and delete operations across your organization"
        right={
          <>
            <button
              type="button"
              onClick={() => loadAuditHistory(appliedFilters)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                const next = { ...DEFAULT_FILTERS };
                setDraftFilters(next);
                void loadAuditHistory(next);
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </>
        }
      />

      {!supabaseEnabled ? (
        <Card className="p-4">
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-amber-800">
            <ShieldCheck className="h-4 w-4" />
            <p className="text-sm font-medium">Supabase is not configured, so server audit history is unavailable.</p>
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <p className="text-sm font-semibold text-slate-900">Filters</p>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-6">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Table</span>
            <select
              value={draftFilters.tableName}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, tableName: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">All tables</option>
              {tableFilterOptions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">Action</span>
            <select
              value={draftFilters.action}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, action: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">All actions</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">User</span>
            <select
              value={draftFilters.actorUserId}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, actorUserId: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">All users</option>
              {hasSystemActor ? <option value="system">System</option> : null}
              {userFilterOptions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">From date</span>
            <DateInput
              value={draftFilters.fromDate}
              onChange={(nextValue) => setDraftFilters((prev) => ({ ...prev, fromDate: nextValue }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold text-slate-500">To date</span>
            <DateInput
              value={draftFilters.toDate}
              onChange={(nextValue) => setDraftFilters((prev) => ({ ...prev, toDate: nextValue }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => loadAuditHistory(draftFilters)}
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Events</p>
          <p className="text-xs font-semibold text-slate-500">{rows.length} records</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">When</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Table</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Action</th>
                <th className="px-4 py-3 font-semibold text-slate-700">User</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Record</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Changes</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const expanded = expandedRowId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-3 text-slate-700">{formatDateTimeByPreference(row.happenedAt)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.tableName || "-"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${actionTone(row.action)}`}>
                            {row.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700" title={row.actorUserId || "System"}>
                          {toShortUserId(row.actorUserId)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.recordId || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{changeSummary(row)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedRowId(expanded ? "" : row.id)}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {expanded ? "Hide" : "View"}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-t border-slate-100 bg-slate-50/60">
                          <td className="px-4 py-4" colSpan={7}>
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Before</p>
                                <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                                  {stringifyJson(row.beforeData)}
                                </pre>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">After</p>
                                <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
                                  {stringifyJson(row.afterData)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    {loading ? "Loading audit events..." : "No audit events found for selected filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
