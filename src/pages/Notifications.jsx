import React, { useEffect, useMemo, useState } from "react";
import { Bell, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppShell } from "../context/AppShellContext";

const FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "customers", label: "Customers" },
  { id: "suppliers", label: "Suppliers" },
  { id: "amount", label: "Amount Alerts" },
  { id: "days", label: "Overdue Alerts" }
];

function formatValue(value, alertType) {
  if (alertType === "days") return `${Math.trunc(Number(value || 0))} day(s)`;
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString();
}

function matchesFilter(entry, filterId) {
  if (filterId === "customers") return entry.partyType === "customer";
  if (filterId === "suppliers") return entry.partyType === "supplier";
  if (filterId === "amount") return entry.alertType === "amount";
  if (filterId === "days") return entry.alertType === "days";
  return true;
}

function alertLabel(entry) {
  return entry.alertType === "days" ? "Overdue Days" : "Amount";
}

function documentLabel(entry) {
  return String(entry?.documentType || "").toLowerCase() === "bill" ? "Bill" : "Invoice";
}

export default function Notifications() {
  const navigate = useNavigate();
  const { notifications, readNotification, refreshFeeds } = useAppShell();
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    void refreshFeeds();
  }, [refreshFeeds]);

  const rows = useMemo(
    () => notifications.filter((entry) => matchesFilter(entry, activeFilter)),
    [notifications, activeFilter]
  );

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-16">
      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold text-slate-900">Notifications</p>
            <p className="text-sm text-slate-500">
              Credit monitoring alerts for customers and suppliers
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <Bell className="h-4 w-4" />
            {notifications.filter((entry) => !entry.isRead).length} unread
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setActiveFilter(option.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                activeFilter === option.id
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">Party Name</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Type</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Alert Type</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Details</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Limit Value</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Current Value</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {entry.partyName || "Unknown Party"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {entry.partyType === "supplier" ? "Supplier" : "Customer"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                        {alertLabel(entry)} Exceeded
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {entry.documentNo ? (
                        <p className="font-semibold text-slate-900">
                          {documentLabel(entry)}: {entry.documentNo}
                        </p>
                      ) : null}
                      {entry.createdBy ? <p>Created by: {entry.createdBy}</p> : null}
                      {Number(entry.pendingAmount || 0) > 0 ? (
                        <p>Pending: {formatAmount(entry.pendingAmount)}</p>
                      ) : null}
                      {entry.alertType === "amount" ? (
                        <p>Over by: {formatAmount(entry.exceededBy || 0)}</p>
                      ) : (
                        <>
                          <p>Over by days: {Math.trunc(Number(entry.overdueByDays || 0))}</p>
                          <p>Last due date: {formatDate(entry.lastDueDate || entry.dueDate)}</p>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatValue(entry.limitValue, entry.alertType)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatValue(entry.currentValue, entry.alertType)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                          entry.isRead
                            ? "bg-slate-100 text-slate-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {entry.isRead ? "Read" : "Unread"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          void readNotification(entry.id);
                          if (entry.partyId) {
                            navigate(`/app/parties/${entry.partyId}/statement`);
                            return;
                          }
                          navigate("/app/parties");
                        }}
                      >
                        Open
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                    No notifications found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
