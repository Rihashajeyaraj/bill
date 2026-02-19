import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Building2, Download, RefreshCw, Wallet } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import { companyGetProfile } from "../services/company.service";
import { formatMoney } from "../modules/items/utils";
import { loadCashBankSnapshot } from "../services/cashBank.service";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";
import { useToast } from "../context/ToastContext";

const CHANNEL_FILTERS = ["All", "Cash", "Bank"];

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function toCsvValue(value) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function SummaryCard({ title, value, tone = "neutral", icon: Icon }) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "danger"
      ? "text-rose-600"
      : tone === "primary"
      ? "text-blue-600"
      : "text-slate-900";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
        </div>
        {Icon ? (
          <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function CashBank() {
  const toast = useToast();
  const company = companyGetProfile();
  const currency = company?.currency || "INR";
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("All");
  const [snapshot, setSnapshot] = useState({
    ledger: [],
    summary: {
      cashBalance: 0,
      bankBalance: 0,
      netFlow: 0,
      monthNet: 0,
      transactionCount: 0
    },
    syncedAt: ""
  });
  useGlobalLoadingBridge(loading, "cash-bank");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadCashBankSnapshot({ syncRemote: true });
      setSnapshot(next);
    } catch (error) {
      toast.error("Cash & Bank sync failed", error?.message || "Unable to load cash and bank ledger.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filteredLedger = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.ledger.filter((entry) => {
      const matchChannel = channelFilter === "All" || entry.channel === channelFilter;
      if (!matchChannel) return false;

      if (!query) return true;
      const haystack = `${entry.type} ${entry.reference} ${entry.counterparty} ${entry.mode} ${entry.status}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [snapshot.ledger, search, channelFilter]);

  const tableColumns = useMemo(
    () => [
      { key: "date", header: "Date", render: (row) => formatDate(row.date) },
      { key: "type", header: "Type" },
      { key: "reference", header: "Reference" },
      { key: "counterparty", header: "Counterparty" },
      { key: "channel", header: "Channel" },
      { key: "mode", header: "Mode" },
      {
        key: "inflow",
        header: "Inflow",
        render: (row) => (
          <span className="font-semibold text-emerald-600">{formatMoney(row.inflow, currency)}</span>
        )
      },
      {
        key: "outflow",
        header: "Outflow",
        render: (row) => (
          <span className="font-semibold text-rose-600">{formatMoney(row.outflow, currency)}</span>
        )
      },
      { key: "status", header: "Status" }
    ],
    [currency]
  );

  function exportCsv() {
    if (!filteredLedger.length) {
      toast.info("No transactions", "Nothing to export for current filter.");
      return;
    }

    const header = ["Date", "Type", "Reference", "Counterparty", "Channel", "Mode", "Inflow", "Outflow", "Status"];
    const lines = filteredLedger.map((entry) =>
      [
        entry.date,
        entry.type,
        entry.reference,
        entry.counterparty,
        entry.channel,
        entry.mode,
        entry.inflow,
        entry.outflow,
        entry.status
      ]
        .map(toCsvValue)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cash-bank-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  const syncText = snapshot.syncedAt ? `Last sync: ${new Date(snapshot.syncedAt).toLocaleString()}` : "Not synced yet";

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader
        title="Cash & Bank"
        subtitle="Unified cash and bank ledger from payments and expenses"
        right={
          <>
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          title="Cash Balance"
          value={formatMoney(snapshot.summary.cashBalance, currency)}
          tone={snapshot.summary.cashBalance >= 0 ? "success" : "danger"}
          icon={Wallet}
        />
        <SummaryCard
          title="Bank Balance"
          value={formatMoney(snapshot.summary.bankBalance, currency)}
          tone={snapshot.summary.bankBalance >= 0 ? "primary" : "danger"}
          icon={Building2}
        />
        <SummaryCard
          title="Net Flow"
          value={formatMoney(snapshot.summary.netFlow, currency)}
          tone={snapshot.summary.netFlow >= 0 ? "success" : "danger"}
          icon={snapshot.summary.netFlow >= 0 ? ArrowDownCircle : ArrowUpCircle}
        />
        <SummaryCard
          title="Current Month Net"
          value={formatMoney(snapshot.summary.monthNet, currency)}
          tone={snapshot.summary.monthNet >= 0 ? "success" : "danger"}
          icon={snapshot.summary.monthNet >= 0 ? ArrowDownCircle : ArrowUpCircle}
        />
        <SummaryCard
          title="Transactions"
          value={Number(snapshot.summary.transactionCount || 0).toLocaleString()}
          icon={RefreshCw}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {CHANNEL_FILTERS.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setChannelFilter(entry)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold ${
                  channelFilter === entry
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {entry}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search type, reference, party..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:w-80"
            />
            <span className="text-xs text-slate-500">{syncText}</span>
          </div>
        </div>
      </Card>

      <DataTable columns={tableColumns} rows={filteredLedger} emptyText="No cash/bank transactions found." />
    </div>
  );
}
