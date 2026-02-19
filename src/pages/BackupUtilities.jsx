import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Download, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import { authGetOrganizationId, authUsingSupabase } from "../services/auth.service";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import {
  createBackupSnapshot,
  downloadBackupSnapshot,
  parseBackupFile,
  restoreBackupSnapshot
} from "../services/backup.service";
import { markBackupReminderCompleted } from "../services/activity.service";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";

const COUNT_LABELS = [
  { key: "parties", label: "Parties" },
  { key: "items", label: "Items" },
  { key: "invoices", label: "Invoices" },
  { key: "purchases", label: "Purchases" },
  { key: "payments", label: "Payments" },
  { key: "expenses", label: "Expenses" },
  { key: "creditNotes", label: "Credit Notes (Legacy)" },
  { key: "creditNotesPremium", label: "Credit Notes (Premium)" },
  { key: "debitNotesPremium", label: "Debit Notes (Premium)" },
  { key: "paymentInPremium", label: "Payment In (Premium)" },
  { key: "paymentOutPremium", label: "Payment Out (Premium)" }
];

export default function BackupUtilities() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({});
  const [warnings, setWarnings] = useState([]);
  const [meta, setMeta] = useState(null);
  useGlobalLoadingBridge(loading, "backup");

  const backendStatus = useMemo(() => {
    const usingSupabase = authUsingSupabase();
    const organizationId = authGetOrganizationId();
    if (!usingSupabase) return "Local mode (Supabase not configured)";
    if (!organizationId) return "Supabase connected, organization not selected";
    return `Supabase connected (Org: ${organizationId.slice(0, 8)}...)`;
  }, []);

  const refreshOverview = useCallback(async (syncRemote = true) => {
    setLoading(true);
    try {
      const result = await createBackupSnapshot({ syncRemote });
      setCounts(result.counts || {});
      setWarnings(result.warnings || []);
      setMeta(result.snapshot?.meta || null);
    } catch (error) {
      toast.error("Backup refresh failed", error?.message || "Unable to refresh backup status.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshOverview(true);
  }, [refreshOverview]);

  async function handleExport() {
    setLoading(true);
    try {
      const result = await createBackupSnapshot({ syncRemote: true });
      const fileName = downloadBackupSnapshot(result.snapshot);
      markBackupReminderCompleted();
      setCounts(result.counts || {});
      setWarnings(result.warnings || []);
      setMeta(result.snapshot?.meta || null);
      toast.success("Backup downloaded", fileName);
    } catch (error) {
      toast.error("Backup export failed", error?.message || "Unable to export backup.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const ok = await confirm({
      title: "Restore backup on this device?",
      description: "This will replace current local data with the selected backup file.",
      confirmText: "Restore",
      cancelText: "Cancel",
      tone: "warning"
    });
    if (!ok) return;

    setLoading(true);
    try {
      const parsed = await parseBackupFile(file);
      const result = restoreBackupSnapshot(parsed);
      markBackupReminderCompleted();
      setCounts(result.counts || {});
      setWarnings([]);
      setMeta(parsed?.meta || null);
      toast.success("Backup restored", "Local data has been restored from backup file.");
      await refreshOverview(false);
    } catch (error) {
      toast.error("Restore failed", error?.message || "Unable to restore backup.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader
        title="Backup & Utilities"
        subtitle="Export and restore complete billing snapshots"
        right={
          <>
            <button
              type="button"
              onClick={() => refreshOverview(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Sync Status
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              Download JSON
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              Restore JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImport}
              className="hidden"
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <Cloud className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</p>
              <p className="text-sm font-semibold text-slate-900">{backendStatus}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schema Version</p>
              <p className="text-sm font-semibold text-slate-900">{meta?.schemaVersion || "-"}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last Generated</p>
              <p className="text-sm font-semibold text-slate-900">
                {meta?.generatedAt ? new Date(meta.generatedAt).toLocaleString() : "-"}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-sm font-semibold text-slate-900">Snapshot Coverage</p>
        <p className="mt-1 text-xs text-slate-500">
          Export includes core records, premium module records, company profile, and template settings.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COUNT_LABELS.map((entry) => (
            <div key={entry.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold text-slate-500">{entry.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {Number(counts?.[entry.key] || 0).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold text-slate-900">Sync Notes</p>
        {warnings.length ? (
          <ul className="mt-2 space-y-1 text-sm text-amber-700">
            {warnings.map((warning) => (
              <li key={warning}>- {warning}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-emerald-700">No sync warnings.</p>
        )}
      </Card>
    </div>
  );
}
