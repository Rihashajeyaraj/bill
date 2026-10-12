import React, { useEffect, useState } from "react";
import { Activity, Clock, Building2, User, RefreshCw } from "lucide-react";
import { apiGet } from "../../services/apiClient";

const ACTION_COLORS = {
  CREATE:  { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" },
  UPDATE:  { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
  DELETE:  { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" },
  LOGIN:   { bg: "#f3e8ff", text: "#7e22ce", border: "#d8b4fe" },
  DEFAULT: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" },
};

function getActionStyle(action = "") {
  const key = Object.keys(ACTION_COLORS).find((k) => action.toUpperCase().includes(k));
  return ACTION_COLORS[key || "DEFAULT"];
}

export default function SuperAdminActivity() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    apiGet("/super-admin/activity")
      .then((d) => setLogs(d || []))
      .catch((e) => setError(e?.message || "Failed to load activity logs."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-5 h-5 text-purple-600" />
            <h1 className="text-2xl font-extrabold text-slate-900">Activity Log</h1>
          </div>
          <p className="text-sm text-slate-500 font-medium">Platform-wide operational events. No tenant financial data exposed.</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-slate-700 text-xs font-bold shadow-sm transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm font-medium">Loading activity logs...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-xs font-semibold">{error}</div>
      ) : !logs.length ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
          <Activity className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No activity logs recorded yet</p>
          <p className="text-xs text-slate-400 mt-1">Activity entries will automatically stream here as tenant management events occur.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {logs.map((log, i) => {
            const style = getActionStyle(log.action);
            return (
              <div
                key={log.id || i}
                className="bg-white border border-slate-200 hover:border-purple-200 rounded-xl p-4 flex items-center gap-4 flex-wrap shadow-sm transition-colors"
              >
                {/* Action badge */}
                <span
                  className="rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider shrink-0"
                  style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
                >
                  {log.action || "Event"}
                </span>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-900 mb-1">
                    {log.entity_type ? `${log.entity_type} ` : ""}
                    {log.entity_id ? <span className="text-slate-400 font-mono text-[11px]">#{log.entity_id?.slice(0, 8)}</span> : null}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    {log.user_name && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                        <User className="w-3 h-3 text-slate-400" /> {log.user_name}
                      </span>
                    )}
                    {log.company_name && (
                      <span className="flex items-center gap-1 text-[11px] text-purple-700 font-medium">
                        <Building2 className="w-3 h-3 text-purple-500" /> {log.company_name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Timestamp */}
                <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium shrink-0">
                  <Clock className="w-3 h-3" />
                  {log.created_at ? new Date(log.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
