import React from "react";
import { Bell, BellRing, CheckCheck, Clock3, X } from "lucide-react";
import { useAppShell } from "../../context/AppShellContext";
import {
  formatDateByPreference,
  formatDateTimeByPreference,
  formatNumberByPreference
} from "../../lib/formatPreferences";

function formatAmount(value) {
  return formatNumberByPreference(Number(value || 0), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatValue(entry) {
  if (entry?.alertType === "days") return `${Math.trunc(Number(entry?.currentValue || 0))}`;
  return formatAmount(entry?.currentValue || 0);
}

function formatLimit(entry) {
  if (entry?.alertType === "days") return `${Math.trunc(Number(entry?.limitValue || 0))}`;
  return formatAmount(entry?.limitValue || 0);
}

function alertLabel(entry) {
  return entry?.alertType === "days" ? "Overdue Days" : "Amount Limit";
}

function documentLabel(entry) {
  if (String(entry?.documentType || "").toLowerCase() === "bill") return "Bill";
  return "Invoice";
}

function formatDate(value) {
  return formatDateByPreference(value, String(value || "-"));
}

function alertDescription(entry) {
  if (entry?.alertType === "days") {
    return `${formatValue(entry)} days crossed ${formatLimit(entry)} allowed days.`;
  }
  return `${formatValue(entry)} crossed limit ${formatLimit(entry)} by ${formatAmount(entry?.exceededBy || 0)}.`;
}

export default function NotificationCenter() {
  const {
    notificationOpen,
    setNotificationOpen,
    notifications,
    activities,
    readNotification,
    clearNotificationBadge,
    navigateTo
  } = useAppShell();

  if (!notificationOpen) return null;

  return (
    <div className="fixed inset-0 z-[125]">
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => setNotificationOpen(false)} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-slate-200 bg-white shadow-soft">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">Credit monitoring alerts and activity feed</p>
            </div>
            <button
              type="button"
              onClick={() => setNotificationOpen(false)}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <button
              type="button"
              onClick={() => {
                void clearNotificationBadge();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all as read
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[1fr_1fr]">
            <section className="min-h-0 overflow-auto border-b border-slate-200 px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Latest Alerts</p>
              <div className="space-y-2">
                {notifications.length ? (
                  notifications.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        void readNotification(entry.id);
                        if (entry.partyId) {
                          navigateTo(`/app/parties/${entry.partyId}/statement`, { log: false });
                          return;
                        }
                        navigateTo("/app/notifications", { log: false });
                      }}
                      className={`w-full rounded-2xl border px-3 py-2 text-left ${
                        entry.isRead
                          ? "border-rose-200 bg-rose-50/40"
                          : "border-rose-200 bg-rose-50"
                      } ${entry.isRead ? "opacity-75" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {entry.partyName || "Party"} ({entry.partyType === "supplier" ? "Supplier" : "Customer"})
                        </p>
                        {entry.isRead ? (
                          <Bell className="h-3.5 w-3.5 text-slate-500" />
                        ) : (
                          <BellRing className="h-3.5 w-3.5 text-rose-600" />
                        )}
                      </div>
                      <p className="mt-1 text-xs font-semibold text-rose-700">{alertLabel(entry)}</p>
                      <p className="mt-1 text-xs text-slate-700">{alertDescription(entry)}</p>
                      <div className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                        {entry.documentNo ? (
                          <p>
                            {documentLabel(entry)}: {entry.documentNo}
                          </p>
                        ) : null}
                        {entry.createdBy ? <p>Created by: {entry.createdBy}</p> : null}
                        {Number(entry.pendingAmount || 0) > 0 ? (
                          <p>Pending: {formatAmount(entry.pendingAmount)}</p>
                        ) : null}
                        {entry.alertType === "days" ? (
                          <p>Last due date: {formatDate(entry.lastDueDate || entry.dueDate)}</p>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {formatDateTimeByPreference(entry.createdAt)}
                      </p>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
                    No notifications available.
                  </div>
                )}
              </div>
            </section>

            <section className="min-h-0 overflow-auto px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Activity Log</p>
              <div className="space-y-2">
                {activities.length ? (
                  activities.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <p className="text-sm font-semibold text-slate-800">{entry.action}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {formatDateTimeByPreference(entry.createdAt)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
                    Activity will appear here.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500">
            <div className="flex items-center gap-2">
              <Clock3 className="h-3.5 w-3.5" />
              Session activity is tracked for audit and security.
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
