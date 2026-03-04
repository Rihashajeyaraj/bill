import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Download, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import { authGetOrganizationId, authGetRole, authUsingSupabase } from "../services/auth.service";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import {
  createOwnerOrganizationBackup,
  createBackupSnapshot,
  downloadBackupSnapshot,
  fetchOwnerOrganizationBackupSnapshot,
  listOwnerOrganizationBackups,
  parseBackupFile,
  restoreBackupSnapshot
} from "../services/backup.service";
import { markBackupReminderCompleted } from "../services/activity.service";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";
import { canAccessSettings } from "../services/roles";

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
  { key: "paymentOutPremium", label: "Payment Out (Premium)" },
  { key: "salesProformas", label: "Sales Proformas" },
  { key: "purchaseProformas", label: "Purchase Proformas" },
  { key: "itemBarcodes", label: "Item Barcodes" },
  { key: "auditEvents", label: "Audit Events" }
];

export default function BackupUtilities() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [counts, setCounts] = useState({});
  const [warnings, setWarnings] = useState([]);
  const [meta, setMeta] = useState(null);
  const [remoteBackups, setRemoteBackups] = useState([]);
  useGlobalLoadingBridge(loading, "backup");

  const isOwner = useMemo(() => canAccessSettings(authGetRole()), []);
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

  const refreshRemoteBackups = useCallback(async () => {
    if (!isOwner || !authUsingSupabase() || !authGetOrganizationId()) {
      setRemoteBackups([]);
      return;
    }
    setRemoteLoading(true);
    try {
      const rows = await listOwnerOrganizationBackups(20);
      setRemoteBackups(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error("Failed to load backup history", error?.message || "Unable to load owner backups.");
    } finally {
      setRemoteLoading(false);
    }
  }, [isOwner, toast]);

  useEffect(() => {
    void refreshOverview(true);
    void refreshRemoteBackups();
  }, [refreshOverview, refreshRemoteBackups]);

  async function handleOwnerBackup() {
    if (!isOwner) {
      toast.error("Permission denied", "Only owner can create organization backups.");
      return;
    }
    setLoading(true);
    try {
      const result = await createOwnerOrganizationBackup({ reason: "manual-export", storeSnapshot: true });
      const fileName = downloadBackupSnapshot(result.snapshot);
      markBackupReminderCompleted();
      setCounts(result.counts || {});
      setWarnings(result.warnings || []);
      setMeta(result.snapshot?.meta || null);
      toast.success("Owner backup created", fileName);
      await refreshRemoteBackups();
    } catch (error) {
      toast.error("Owner backup failed", error?.message || "Unable to create owner backup.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadHistoryBackup(backupId) {
    const id = String(backupId || "").trim();
    if (!id) return;
    setLoading(true);
    try {
      const snapshot = await fetchOwnerOrganizationBackupSnapshot(id);
      const fileName = downloadBackupSnapshot(snapshot);
      toast.success("Backup downloaded", fileName);
    } catch (error) {
      toast.error("Download failed", error?.message || "Unable to download selected backup.");
    } finally {
      setLoading(false);
    }
  }

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
            {isOwner ? (
              <button
                type="button"
                onClick={handleOwnerBackup}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                Owner Backup
              </button>
            ) : null}
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

      {isOwner ? (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Owner Backup History</p>
            <button
              type="button"
              onClick={() => refreshRemoteBackups()}
              disabled={loading || remoteLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${remoteLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          {remoteBackups.length ? (
            <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Generated</th>
                    <th className="px-3 py-2 font-semibold">Reason</th>
                    <th className="px-3 py-2 font-semibold">Schema</th>
                    <th className="px-3 py-2 font-semibold">Checksum</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {remoteBackups.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">
                        {entry.generatedAt ? new Date(entry.generatedAt).toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{entry.reason || "manual"}</td>
                      <td className="px-3 py-2 text-slate-700">{entry.schemaVersion || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {String(entry.checksumSha256 || "").slice(0, 20) || "-"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleDownloadHistoryBackup(entry.id)}
                          disabled={loading}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              {remoteLoading ? "Loading backups..." : "No owner backups found yet."}
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
