import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, LifeBuoy, RefreshCw, Send } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import FieldLabelText from "../components/FieldLabelText";
import { useToast } from "../context/ToastContext";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";
import { formatDateTimeByPreference } from "../lib/formatPreferences";
import {
  HELP_RESOURCES,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  listSupportRequests,
  listSystemActivity,
  submitSupportRequest
} from "../services/help.service";
import { authUsingSupabase } from "../services/auth.service";

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return formatDateTimeByPreference(parsed);
}

export default function HelpSupport() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState([]);
  const [activities, setActivities] = useState([]);
  const [form, setForm] = useState({
    subject: "",
    category: SUPPORT_CATEGORIES[0],
    priority: SUPPORT_PRIORITIES[1],
    contactEmail: "",
    message: ""
  });
  useGlobalLoadingBridge(loading, "help-support");

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const [supportList, activityList] = await Promise.all([
        listSupportRequests(25),
        listSystemActivity(20)
      ]);
      setRequests(supportList);
      setActivities(activityList);
    } catch (error) {
      toast.error("Help data load failed", error?.message || "Unable to load help and support data.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await submitSupportRequest(form);
      setForm((prev) => ({ ...prev, subject: "", message: "" }));
      toast.success("Support request submitted", "Your request has been added to support logs.");
      await refreshData();
    } catch (error) {
      toast.error("Support request failed", error?.message || "Unable to submit support request.");
    } finally {
      setLoading(false);
    }
  }

  const supportColumns = useMemo(
    () => [
      { key: "createdAt", header: "Created", render: (row) => formatDateTime(row.createdAt) },
      { key: "subject", header: "Subject" },
      { key: "category", header: "Category" },
      { key: "priority", header: "Priority" },
      { key: "status", header: "Status" },
      { key: "contactEmail", header: "Contact" }
    ],
    []
  );

  const activityColumns = useMemo(
    () => [
      { key: "createdAt", header: "Created", render: (row) => formatDateTime(row.createdAt) },
      { key: "action", header: "Action" },
      { key: "entity", header: "Entity" }
    ],
    []
  );

  const modeText = authUsingSupabase() ? "Backend-connected help logs" : "Local help logs";

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader
        title="Help & Support"
        subtitle={`${modeText} with request tracking and activity feed`}
        right={
          <button
            type="button"
            onClick={refreshData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-slate-600" />
            <p className="text-sm font-semibold text-slate-900">Submit Support Request</p>
          </div>
          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-500">
                <FieldLabelText required>Subject</FieldLabelText>
              </label>
              <input
                value={form.subject}
                onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                placeholder="Short issue summary"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Contact Email</label>
              <input
                type="email"
                value={form.contactEmail}
                onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
                placeholder="name@company.com"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Category</label>
              <select
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {SUPPORT_CATEGORIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500">Priority</label>
              <select
                value={form.priority}
                onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {SUPPORT_PRIORITIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500">
                <FieldLabelText required>Message</FieldLabelText>
              </label>
              <textarea
                value={form.message}
                onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
                placeholder="Describe the issue, expected output, and what happened."
                className="mt-1 min-h-[110px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                Submit Request
              </button>
            </div>
          </form>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-slate-600" />
            <p className="text-sm font-semibold text-slate-900">Reference Guides</p>
          </div>
          <div className="mt-3 space-y-2">
            {HELP_RESOURCES.map((resource) => (
              <div key={resource.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-sm font-semibold text-slate-900">{resource.title}</p>
                <p className="mt-1 text-xs text-slate-600">{resource.description}</p>
                <p className="mt-2 text-xs font-mono text-slate-500">{resource.path}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-sm font-semibold text-slate-900">Recent Support Requests</p>
        <div className="mt-3">
          <DataTable
            columns={supportColumns}
            rows={requests}
            emptyText="No support requests yet."
          />
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-slate-900">Recent Activity Logs</p>
        <div className="mt-3">
          <DataTable
            columns={activityColumns}
            rows={activities}
            emptyText="No activity logs found."
          />
        </div>
      </Card>
    </div>
  );
}
