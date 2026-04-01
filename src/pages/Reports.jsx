import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight,
  Briefcase,
  ChevronDown,
  ClipboardList,
  FileDown,
  FileSpreadsheet,
  Printer,
  Receipt,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet
} from "lucide-react";
import Card from "../components/Card";
import DateInput from "../components/DateInput";
import PageHeader from "../components/PageHeader";
import { useOrganization } from "../context/OrganizationContext";
import { useFinancialYears } from "../context/FinancialYearContext";
import { reportSections } from "../data/reports";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";
import { formatDateByPreference } from "../lib/formatPreferences";
import { formatMoney, normalizeText } from "../modules/parties/utils";
import { exportReportExcel, exportReportJson, exportReportPdf, printReport } from "../modules/reports/reportExport";
import { authGetRole } from "../services/auth.service";
import {
  buildAgingReport,
  buildAllPartiesReport,
  buildAllTransactionsReport,
  buildCashFlowReport,
  buildGstReport,
  buildPartyStatementReport,
  buildProfitLossReport,
  buildPurchaseReport,
  buildSaleReport,
  buildTdsReport,
  getDefaultReportFilters,
  getReportsDataset,
  listReportParties,
  PARTY_TYPES,
  syncReportsData,
  TRANSACTION_TYPE_OPTIONS
} from "../services/reports.service";
import { isAccounterRole, isOwnerRole } from "../services/roles";
import { applyFinancialYearRange } from "../services/financialYears.service";

const REPORT_PAGE_SIZE = 20;
const REPORT_SIDEBAR_MIN_WIDTH = 240;
const REPORT_SIDEBAR_MAX_WIDTH = 360;
const REPORT_SIDEBAR_DEFAULT_WIDTH = 290;
const SORTABLE_TRANSACTION_COLUMNS = new Set(["date", "transactionType", "reference", "partyName", "amount", "status"]);

function hasReportDatasetData(dataset) {
  if (!dataset || typeof dataset !== "object") return false;
  return Object.values(dataset).some((value) => Array.isArray(value) && value.length > 0);
}

function isIndiaCompany(profile = {}) {
  const country = String(profile?.country || profile?.countryCode || "").trim().toLowerCase();
  return country === "india" || country === "in";
}

function getVisibleReportSections(profile = {}) {
  const allowTdsReport = isIndiaCompany(profile);
  return reportSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => (item.id !== "tds-report" && item.id !== "gst-report") || allowTdsReport
      )
    }))
    .filter((section) => section.items.length > 0);
}

const REPORT_META = {
  "sale-report": {
    icon: Receipt,
    accent: "bg-emerald-50 text-emerald-700 border-emerald-200",
    activeAccent: "border-emerald-300 bg-emerald-50 text-emerald-950 shadow-md md:hover:border-emerald-400 md:hover:bg-emerald-100/80"
  },
  "purchase-report": {
    icon: Briefcase,
    accent: "bg-amber-50 text-amber-700 border-amber-200",
    activeAccent: "border-amber-300 bg-amber-50 text-amber-950 shadow-md md:hover:border-amber-400 md:hover:bg-amber-100/80"
  },
  "cash-flow": {
    icon: Wallet,
    accent: "bg-cyan-50 text-cyan-700 border-cyan-200",
    activeAccent: "border-cyan-300 bg-cyan-50 text-cyan-950 shadow-md md:hover:border-cyan-400 md:hover:bg-cyan-100/80"
  },
  "all-transactions": {
    icon: ArrowLeftRight,
    accent: "bg-slate-100 text-slate-700 border-slate-200",
    activeAccent: "border-slate-300 bg-slate-100 text-slate-900 shadow-md md:hover:border-slate-400 md:hover:bg-slate-200/80"
  },
  "party-statement": {
    icon: ClipboardList,
    accent: "bg-violet-50 text-violet-700 border-violet-200",
    activeAccent: "border-violet-300 bg-violet-50 text-violet-950 shadow-md md:hover:border-violet-400 md:hover:bg-violet-100/80"
  },
  "aging-report": {
    icon: Users,
    accent: "bg-rose-50 text-rose-700 border-rose-200",
    activeAccent: "border-rose-300 bg-rose-50 text-rose-950 shadow-md md:hover:border-rose-400 md:hover:bg-rose-100/80"
  },
  "all-parties": {
    icon: Users,
    accent: "bg-teal-50 text-teal-700 border-teal-200",
    activeAccent: "border-teal-300 bg-teal-50 text-teal-950 shadow-md md:hover:border-teal-400 md:hover:bg-teal-100/80"
  },
  "profit-loss": {
    icon: TrendingUp,
    accent: "bg-lime-50 text-lime-700 border-lime-200",
    activeAccent: "border-lime-300 bg-lime-50 text-lime-950 shadow-md md:hover:border-lime-400 md:hover:bg-lime-100/80"
  },
  "gst-report": {
    icon: FileSpreadsheet,
    accent: "bg-orange-50 text-orange-700 border-orange-200",
    activeAccent: "border-orange-300 bg-orange-50 text-orange-950 shadow-md md:hover:border-orange-400 md:hover:bg-orange-100/80"
  },
  "tds-report": {
    icon: FileSpreadsheet,
    accent: "bg-sky-50 text-sky-700 border-sky-200",
    activeAccent: "border-sky-300 bg-sky-50 text-sky-950 shadow-md md:hover:border-sky-400 md:hover:bg-sky-100/80"
  }
};

const AGING_BUCKET_COLUMNS = [
  { key: "bucket_0_30", label: "0-30 Days" },
  { key: "bucket_31_60", label: "31-60 Days" },
  { key: "bucket_61_90", label: "61-90 Days" },
  { key: "bucket_above_90", label: "Above 90 Days" }
];

const AGING_TRANSACTION_BADGES = {
  Invoice: "bg-slate-100 text-slate-700",
  Purchase: "bg-slate-100 text-slate-700",
  Payment: "bg-sky-50 text-sky-700",
  "Credit Note": "bg-rose-50 text-rose-700",
  "Debit Note": "bg-amber-50 text-amber-700"
};

function isAuthorizedReportRole(role) {
  return isOwnerRole(role) || isAccounterRole(role);
}

function paginateRows(rows, page, pageSize = REPORT_PAGE_SIZE) {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(startIndex, startIndex + pageSize),
    page: safePage,
    totalRows,
    totalPages,
    startIndex,
    endIndex: Math.min(startIndex + pageSize, totalRows)
  };
}

function MetricCard({ label, value, tone = "default" }) {
  const toneClasses =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
      : tone === "negative"
        ? "border-rose-200 bg-rose-50/80 text-rose-800"
        : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={clsx("rounded-3xl border p-4 sm:p-5", toneClasses)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-bold">{value}</p>
    </div>
  );
}

function InteractiveMetricCard({ label, value, tone = "default", active = false, onClick }) {
  const toneClasses =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
      : tone === "negative"
        ? "border-rose-200 bg-rose-50/80 text-rose-800"
        : "border-slate-200 bg-white text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 sm:p-5",
        toneClasses,
        active && "ring-2 ring-slate-900/70 shadow-md"
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-bold">{value}</p>
    </button>
  );
}

function formatCell(row, column, currency) {
  const value = row?.[column.key];
  if (column.format === "date") return formatDateByPreference(value, "-");
  if (column.format === "money") return formatMoney(value, currency);
  if (column.format === "number") return value ?? 0;
  if (column.format === "percent") return formatPercent(value);
  return value || "-";
}

function formatPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  return `${numericValue.toFixed(Math.abs(numericValue) >= 10 ? 1 : 2)}%`;
}

function buildExportPayload({ viewModel, currency }) {
  const footerRows = Array.isArray(viewModel.footerRows) ? viewModel.footerRows : [];
  return {
    title: viewModel.title,
    subtitle: viewModel.subtitle,
    filename: viewModel.filename || viewModel.title,
    summary: viewModel.metrics.map((item) => ({ label: item.label, value: item.value })),
    sections: [
      {
        title: viewModel.tableTitle || "Report Data",
        columns: viewModel.columns.map((column) => ({ label: column.label })),
        rows: [
          ...viewModel.exportRows.map((row) => viewModel.columns.map((column) => formatCell(row, column, currency))),
          ...footerRows
        ]
      }
    ]
  };
}

function SearchablePartySelect({ label, options, value, onChange, placeholder = "All Parties", disabled = false }) {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const searchInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedOption = useMemo(
    () => options.find((option) => option.id === value) || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const search = normalizeText(query);
    if (!search) return options;
    return options.filter((option) =>
      normalizeText([option.name, option.phone, option.email, option.address].join(" ")).includes(search)
    );
  }, [options, query]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function closeDropdown({ blur = false } = {}) {
    setOpen(false);
    if (!blur) return;
    window.requestAnimationFrame(() => {
      searchInputRef.current?.blur?.();
      triggerRef.current?.blur?.();
    });
  }

  return (
    <div className="text-xs font-semibold text-slate-600">
      <span>{label}</span>
      <div ref={containerRef} className="relative mt-2">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeDropdown({ blur: true });
            }
          }}
          className="flex h-11 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-700 shadow-sm outline-none transition hover:border-slate-300 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <div className="min-w-0">
            <p className={clsx("truncate font-medium", selectedOption ? "text-slate-900" : "text-slate-500")}>
              {selectedOption?.name || placeholder}
            </p>
            <p className="truncate text-xs text-slate-500">
              {selectedOption
                ? [selectedOption.phone, selectedOption.email].filter(Boolean).join(" | ") || "No contact details"
                : "Optional filter"}
            </p>
          </div>
          <ChevronDown className={clsx("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")} />
        </button>

        {open ? (
          <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-2">
              <label className="relative block">
                <input
                  ref={searchInputRef}
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeDropdown({ blur: true });
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const firstOption = filteredOptions[0];
                      if (!firstOption) return;
                      onChange(firstOption.id);
                      closeDropdown({ blur: true });
                    }
                  }}
                  placeholder="Search party"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:ring-4 focus:ring-slate-200"
                />
              </label>
            </div>

            <div className="max-h-72 overflow-auto py-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  closeDropdown({ blur: true });
                }}
                className={clsx("flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50", !value && "bg-emerald-50/70")}
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{placeholder}</p>
                  <p className="text-xs text-slate-500">Show all matching records</p>
                </div>
              </button>

              {filteredOptions.length ? (
                filteredOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onChange(option.id);
                      closeDropdown({ blur: true });
                    }}
                    className={clsx("flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50", option.id === value && "bg-emerald-50/70")}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{option.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {[option.phone, option.email].filter(Boolean).join(" | ") || "No contact details"}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-slate-500">No party matches this search.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReportSidebar({ sections, activeReport, onSelect }) {
  return (
    <div className="space-y-2">
      {sections.map((section) => (
        <Card key={section.id} className="p-2.5 sm:p-3">
          <div className="mb-1.5">
            <p className="text-[13px] font-semibold text-slate-900">{section.title}</p>
            <p
              className="mt-0.5 text-[10px] leading-4 text-slate-500"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden"
              }}
            >
              {section.description}
            </p>
          </div>

          <div className="space-y-0.5">
            {section.items.map((item) => {
              const meta = REPORT_META[item.id] || REPORT_META["all-transactions"];
              const Icon = meta.icon;
              const isActive = item.id === activeReport;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={clsx(
                    "w-full cursor-pointer rounded-xl border px-2.5 py-2 text-left transform-gpu transition-all duration-200 ease-out will-change-transform md:hover:-translate-y-0.5 md:hover:scale-[1.02] md:hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
                    isActive
                      ? meta.activeAccent
                      : "border-slate-200 bg-white md:hover:border-slate-300 md:hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={clsx("rounded-lg border p-1", meta.accent)}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold leading-4">{item.label}</p>
                      <p
                        className={clsx("mt-0.5 text-[10px] leading-4", isActive ? "text-slate-600" : "text-slate-500")}
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 1,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden"
                        }}
                      >
                        {item.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ReportTable({ columns, rows, currency, sortKey, sortDirection, onSort, emptyText = "No records found." }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200">
      <table className="w-full min-w-[620px] text-left text-xs sm:min-w-[720px] sm:text-sm xl:min-w-[880px]">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => {
              const sortable = typeof onSort === "function" && column.sortable;
              const active = sortable && sortKey === column.key;
              return (
                <th key={column.key} className={clsx("whitespace-nowrap px-3 py-3 font-semibold text-slate-700 sm:px-4", column.align === "right" && "text-right")}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className={clsx("inline-flex items-center gap-1", column.align === "right" && "ml-auto")}
                    >
                      {column.label}
                      {active ? <span className="text-xs">{sortDirection === "asc" ? "^" : "v"}</span> : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                {columns.map((column) => (
                  <td key={`${row.id}_${column.key}`} className={clsx("whitespace-nowrap px-3 py-3 text-slate-700 sm:px-4", column.align === "right" && "text-right", column.emphasis && "font-semibold text-slate-900")}>
                    {formatCell(row, column, currency)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-4 py-16 text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AgingReportTable({ rows, currency, expandedBucket, onToggle, emptyText = "No records found." }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200">
      <table className="w-full min-w-[680px] text-left text-xs sm:min-w-[760px] sm:text-sm xl:min-w-[980px]">
        <thead className="bg-slate-50">
          <tr>
            <th className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700 sm:px-4">Party Name</th>
            <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700 sm:px-4">Total Outstanding</th>
            {AGING_BUCKET_COLUMNS.map((column) => (
              <th key={column.key} className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700 sm:px-4">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => {
              const isExpandedRow = expandedBucket?.partyId === row.id;
              const activeBucketKey = isExpandedRow ? expandedBucket?.bucketKey : "";
              const activeBucketLabel = AGING_BUCKET_COLUMNS.find((column) => column.key === activeBucketKey)?.label || "";
              const activeDetails = activeBucketKey ? row?.bucketDetails?.[activeBucketKey] || [] : [];

              return (
                <React.Fragment key={row.id}>
                  <tr className={clsx("border-t border-slate-100", isExpandedRow && "bg-slate-50/60")}>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900 sm:px-4">{row.partyName || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-900 sm:px-4">{formatMoney(row.totalOutstanding, currency)}</td>
                    {AGING_BUCKET_COLUMNS.map((column) => {
                      const bucketValue = row?.[column.key] || 0;
                      const bucketDetails = row?.bucketDetails?.[column.key] || [];
                      const canExpand = bucketValue > 0 && bucketDetails.length > 0;
                      const isActive = activeBucketKey === column.key;

                      return (
                        <td key={`${row.id}_${column.key}`} className="whitespace-nowrap px-3 py-3 text-right sm:px-4">
                          {canExpand ? (
                            <button
                              type="button"
                              onClick={() => onToggle(row.id, column.key)}
                              className={clsx(
                                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold transition",
                                isActive
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                              )}
                              title={`View ${column.label} transactions`}
                            >
                              {formatMoney(bucketValue, currency)}
                              <ChevronDown className={clsx("h-4 w-4 transition", isActive && "rotate-180")} />
                            </button>
                          ) : (
                            <span className="text-slate-500">{formatMoney(bucketValue, currency)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  <tr className="border-t-0">
                    <td colSpan={2 + AGING_BUCKET_COLUMNS.length} className="p-0">
                      <div className={clsx("grid transition-all duration-200 ease-out", isExpandedRow ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                        <div className="overflow-hidden">
                          <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-4 sm:px-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {row.partyName} {activeBucketLabel ? `- ${activeBucketLabel}` : ""}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {activeDetails.length} transaction{activeDetails.length === 1 ? "" : "s"} linked to this aging bucket.
                                </p>
                              </div>
                              {activeBucketKey ? (
                                <button
                                  type="button"
                                  onClick={() => onToggle(row.id, activeBucketKey)}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                                >
                                  Collapse
                                </button>
                              ) : null}
                            </div>

                            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                              <table className="w-full min-w-[680px] text-left text-xs sm:min-w-[760px]">
                                <thead className="bg-slate-50">
                                  <tr>
                                    <th className="whitespace-nowrap px-3 py-3 font-semibold text-slate-600 sm:px-4">Date</th>
                                    <th className="whitespace-nowrap px-3 py-3 font-semibold text-slate-600 sm:px-4">Transaction Type</th>
                                    <th className="whitespace-nowrap px-3 py-3 font-semibold text-slate-600 sm:px-4">Reference Number</th>
                                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-600 sm:px-4">Amount</th>
                                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-600 sm:px-4">Days Pending</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activeDetails.length ? (
                                    activeDetails.map((detail) => (
                                      <tr key={detail.id} className="border-t border-slate-100">
                                        <td className="whitespace-nowrap px-3 py-3 text-slate-700 sm:px-4">{formatDateByPreference(detail.date, "-")}</td>
                                        <td className="whitespace-nowrap px-3 py-3 sm:px-4">
                                          <span className={clsx("inline-flex rounded-full px-2.5 py-1 font-semibold", AGING_TRANSACTION_BADGES[detail.transactionType] || "bg-slate-100 text-slate-700")}>
                                            {detail.transactionType}
                                          </span>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 text-slate-700 sm:px-4">{detail.reference || "-"}</td>
                                        <td className={clsx("whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4", detail.amount < 0 ? "text-rose-700" : "text-slate-900")}>
                                          {formatMoney(detail.amount, currency)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 text-right text-slate-700 sm:px-4">{detail.daysPending ?? 0}</td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr>
                                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                                        No transactions found for this aging bucket.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })
          ) : (
            <tr>
              <td colSpan={2 + AGING_BUCKET_COLUMNS.length} className="px-4 py-16 text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PaginationBar({ pageInfo, onChange }) {
  if (!pageInfo || pageInfo.totalPages <= 1) return null;
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-slate-500">
        Showing {pageInfo.startIndex + 1}-{pageInfo.endIndex} of {pageInfo.totalRows}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(pageInfo.page - 1)}
          disabled={pageInfo.page === 1}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-xs font-semibold text-slate-600">
          Page {pageInfo.page} of {pageInfo.totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(pageInfo.page + 1)}
          disabled={pageInfo.page === pageInfo.totalPages}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ProfitLossInsights({ viewModel, currency }) {
  const totals = viewModel?.totals || {};
  const topExpenseRows = Array.isArray(viewModel?.topExpenseRows) ? viewModel.topExpenseRows : [];
  const totalSales = Number(totals.totalSales || 0);
  const totalExpenses = Number(totals.totalExpenses || 0);
  const grossProfit = Number(totals.grossProfit || 0);
  const netProfit = Number(totals.netProfit || 0);
  const grossLabel = grossProfit < 0 ? "Gross Loss" : "Gross Profit";
  const netLabel = netProfit < 0 ? "Net Loss" : "Net Profit";

  const summaryRows = [
    { label: grossLabel, value: formatMoney(Math.abs(grossProfit), currency), tone: grossProfit < 0 ? "text-rose-700" : "text-emerald-700" },
    { label: "Total Expenses", value: formatMoney(totalExpenses, currency), tone: "text-slate-900" },
    { label: netLabel, value: formatMoney(Math.abs(netProfit), currency), tone: netProfit < 0 ? "text-rose-700" : "text-emerald-700" },
    { label: "Profit Margin", value: formatPercent(viewModel?.profitMargin), tone: netProfit < 0 ? "text-rose-700" : "text-slate-900" }
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Top Expense Categories</p>
              <p className="mt-1 text-xs text-slate-500">Highest expense categories within the selected financial year/date range.</p>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {topExpenseRows.length} categories
            </div>
          </div>

          {topExpenseRows.length ? (
            <div className="space-y-3">
              {topExpenseRows.map((row) => {
                const amount = Number(row?.amount || 0);
                const share = totalExpenses > 0 ? Math.max(0, Math.min(100, (amount / totalExpenses) * 100)) : 0;
                return (
                  <div key={row.category} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{row.category || "Uncategorized"}</p>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">{formatMoney(amount, currency)}</p>
                        <p className="text-xs text-slate-500">{formatPercent(share)}</p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-slate-900" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm text-slate-500">
              No expense entries exist for the selected filters. Profit values are currently based on sales and purchases only.
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
          <p className="text-sm font-semibold text-slate-900">Profit Snapshot</p>
          <p className="mt-1 text-xs text-slate-500">Summary values remain aligned with the simplified profit and loss formula.</p>

          <div className="mt-4 space-y-3">
            {summaryRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-600">{row.label}</span>
                <span className={clsx("text-sm font-semibold", row.tone)}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfitLossBreakdownModal({ mode, onClose, viewModel, currency }) {
  if (!mode || !viewModel) return null;

  const totals = viewModel.totals || {};
  const totalSales = Number(totals.totalSales || 0);
  const totalPurchase = Number(totals.totalPurchase ?? totals.totalPurchases ?? 0);
  const totalExpenses = Number(totals.totalExpenses || 0);
  const grossProfit = Number(totals.grossProfit || 0);
  const netProfit = Number(totals.netProfit || 0);
  const grossLabel = grossProfit < 0 ? "Gross Loss" : "Gross Profit";
  const netLabel = netProfit < 0 ? "Net Loss" : "Net Profit";
  const isGrossMode = mode === "gross-breakdown";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/40 p-3 sm:p-4" onClick={onClose}>
      <Card
        className="my-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-lg font-semibold text-slate-900">{isGrossMode ? "Gross Profit Breakdown" : "Net Profit Breakdown"}</p>
            <p className="mt-1 text-sm text-slate-500">Uses the same current filters and summary card totals.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-700">Sales</span>
              <span className="font-semibold text-slate-900">{formatMoney(totalSales, currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-700">(-) Purchase</span>
              <span className="font-semibold text-slate-900">{formatMoney(totalPurchase, currency)}</span>
            </div>
            <div className="border-t border-dashed border-slate-300 pt-3">
              <div className={clsx("flex items-center justify-between gap-3", isGrossMode && "rounded-2xl px-4 py-3", isGrossMode && (grossProfit < 0 ? "bg-rose-50" : "bg-emerald-50"))}>
                <span className="font-semibold text-slate-900">{grossLabel}</span>
                <span className={clsx(isGrossMode ? "text-base font-bold" : "font-semibold", grossProfit < 0 ? "text-rose-700" : "text-emerald-700")}>
                  {formatMoney(Math.abs(grossProfit), currency)}
                </span>
              </div>
            </div>

            {!isGrossMode ? (
              <>
                <div className="pt-2" />

                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-700">(-) Total Expenses</span>
                  <span className="font-semibold text-slate-900">{formatMoney(totalExpenses, currency)}</span>
                </div>
                <div className="border-t border-dashed border-slate-300 pt-3">
                  <div className={clsx("flex items-center justify-between gap-3 rounded-2xl px-4 py-3", netProfit < 0 ? "bg-rose-50" : "bg-emerald-50")}>
                    <span className="font-semibold text-slate-900">{netLabel}</span>
                    <span className={clsx("text-base font-bold", netProfit < 0 ? "text-rose-700" : "text-emerald-700")}>
                      {formatMoney(Math.abs(netProfit), currency)}
                    </span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function GstBreakdownPanel({ totals, currency }) {
  const rows = [
    {
      label: "CGST",
      output: totals.outputCgst,
      input: totals.inputCgst,
      payable: totals.payableCgst
    },
    {
      label: "SGST",
      output: totals.outputSgst,
      input: totals.inputSgst,
      payable: totals.payableSgst
    },
    {
      label: "IGST",
      output: totals.outputIgst,
      input: totals.inputIgst,
      payable: totals.payableIgst
    }
  ];

  return (
    <div className="mb-4 overflow-x-auto rounded-3xl border border-slate-200 bg-slate-50/70">
      <table className="w-full min-w-[560px] text-left text-xs sm:min-w-[640px] sm:text-sm xl:min-w-[720px]">
        <thead className="bg-slate-100/80">
          <tr>
            <th className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700 sm:px-4">GST Type</th>
            <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700 sm:px-4">Output GST</th>
            <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700 sm:px-4">Input GST</th>
            <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700 sm:px-4">Payable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-200">
              <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900 sm:px-4">{row.label}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right text-slate-700 sm:px-4">{formatMoney(row.output, currency)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right text-slate-700 sm:px-4">{formatMoney(row.input, currency)}</td>
              <td className={clsx("whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4", row.payable >= 0 ? "text-emerald-700" : "text-rose-700")}>
                {formatMoney(row.payable, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getDerivedPartyType(activeReport, partyType) {
  if (activeReport === "sale-report") return PARTY_TYPES.customer;
  if (activeReport === "gst-report") return PARTY_TYPES.customer;
  if (activeReport === "tds-report") return partyType || PARTY_TYPES.customer;
  if (activeReport === "purchase-report") return PARTY_TYPES.supplier;
  return partyType;
}

function PartyStatementTable({ columns, rows, currency, creditSummary, emptyText = "No records found." }) {
  const summaryRows = [
    { label: "TDS Credit Amount", value: creditSummary?.tdsCredit || 0 },
    { label: "Normal Credit Amount", value: creditSummary?.normalCredit || 0 },
    { label: "Net Credit Amount", value: creditSummary?.netCredit || 0 }
  ];
  const detailRows = [
    { key: "tdsCreditAmount", label: "TDS Credit Amount" },
    { key: "normalCreditAmount", label: "Normal Credit Amount" },
    { key: "netCreditAmount", label: "Net Credit Amount" }
  ];

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200">
      <table className="w-full min-w-[1120px] text-left text-xs sm:text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={clsx("whitespace-nowrap px-3 py-3 font-semibold text-slate-700 sm:px-4", column.align === "right" && "text-right")}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <React.Fragment key={row.id}>
                <tr className="border-t border-slate-100 hover:bg-slate-50/70">
                  {columns.map((column) => (
                    <td key={`${row.id}_${column.key}`} className={clsx("px-3 py-3 text-slate-700 sm:px-4", column.align === "right" && "text-right", column.emphasis && "font-semibold text-slate-900")}>
                      {formatCell(row, column, currency)}
                    </td>
                  ))}
                </tr>
                {detailRows.map((detail) => (
                  <tr key={`${row.id}_${detail.key}`} className="border-t border-slate-100 bg-slate-50/50">
                    <td colSpan={5} className="px-3 py-2 text-sm font-medium text-slate-600 sm:px-4">
                      {detail.label}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 sm:px-4">-</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 sm:px-4">
                      {formatMoney(row?.[detail.key] || 0, currency)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 sm:px-4">-</td>
                  </tr>
                ))}
              </React.Fragment>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-4 py-16 text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
        {rows.length ? (
          <tfoot className="bg-slate-50/70">
            {summaryRows.map((summary) => (
              <tr key={summary.label} className="border-t border-slate-200">
                <td colSpan={5} className="px-3 py-3 font-semibold text-slate-700 sm:px-4">
                  {summary.label}
                </td>
                <td className="px-3 py-3 text-slate-500 sm:px-4">-</td>
                <td className="px-3 py-3 font-semibold text-slate-900 sm:px-4">{formatMoney(summary.value, currency)}</td>
                <td className="px-3 py-3 text-slate-500 sm:px-4">-</td>
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function buildViewModel({ activeReport, data, currency, currentPage, agingMetricFilter }) {
  if (!data) return null;

  const paginateIfNeeded = (rows) => paginateRows(rows, currentPage, REPORT_PAGE_SIZE);

  switch (activeReport) {
    case "sale-report": {
      const pageInfo = paginateIfNeeded(data.rows);
      return {
        title: "Sale Report",
        subtitle: "Invoice list with paid and unpaid status for the selected period.",
        filename: "sale-report",
        metrics: [
          { label: "Total Sales", value: formatMoney(data.totals.totalSales, currency), tone: "positive" },
          { label: "Paid", value: formatMoney(data.totals.paidAmount, currency) },
          { label: "Unpaid", value: formatMoney(data.totals.unpaidAmount, currency), tone: data.totals.unpaidAmount > 0 ? "negative" : "default" },
          { label: "Invoices", value: data.totals.invoiceCount }
        ],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "reference", label: "Invoice No" },
          { key: "partyName", label: "Customer" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Paid", align: "right", format: "money" },
          { key: "unpaidAmount", label: "Unpaid", align: "right", format: "money" },
          { key: "status", label: "Status", align: "right" }
        ],
        tableTitle: "Invoices",
        rows: pageInfo.rows,
        exportRows: data.rows,
        pageInfo
      };
    }
    case "purchase-report": {
      const pageInfo = paginateIfNeeded(data.rows);
      return {
        title: "Purchase Report",
        subtitle: "Supplier bills with paid versus pending visibility.",
        filename: "purchase-report",
        metrics: [
          { label: "Total Purchases", value: formatMoney(data.totals.totalPurchases, currency) },
          { label: "Paid", value: formatMoney(data.totals.paidAmount, currency) },
          { label: "Pending", value: formatMoney(data.totals.pendingAmount, currency), tone: data.totals.pendingAmount > 0 ? "negative" : "default" },
          { label: "Bills", value: data.totals.billCount }
        ],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "reference", label: "Bill No" },
          { key: "partyName", label: "Supplier" },
          { key: "totalAmount", label: "Total", align: "right", format: "money" },
          { key: "paidAmount", label: "Paid", align: "right", format: "money" },
          { key: "pendingAmount", label: "Pending", align: "right", format: "money" },
          { key: "status", label: "Status", align: "right" }
        ],
        tableTitle: "Purchase Bills",
        rows: pageInfo.rows,
        exportRows: data.rows,
        pageInfo
      };
    }
    case "cash-flow": {
      const pageInfo = paginateIfNeeded(data.rows);
      return {
        title: "Cash Flow",
        subtitle: "Payments received, payments made, and expenses across the selected period.",
        filename: "cash-flow",
        metrics: [
          { label: "Cash In", value: formatMoney(data.totals.cashIn, currency), tone: "positive" },
          { label: "Cash Out", value: formatMoney(data.totals.cashOut, currency) },
          { label: "Net Cash Flow", value: formatMoney(data.totals.netCashFlow, currency), tone: data.totals.netCashFlow >= 0 ? "positive" : "negative" },
          { label: "Movements", value: data.rows.length }
        ],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "transactionType", label: "Type" },
          { key: "reference", label: "Reference" },
          { key: "partyName", label: "Party / Category" },
          { key: "cashIn", label: "Cash In", align: "right", format: "money" },
          { key: "cashOut", label: "Cash Out", align: "right", format: "money" },
          { key: "netAmount", label: "Net", align: "right", format: "money", emphasis: true }
        ],
        tableTitle: "Cash Movements",
        rows: pageInfo.rows,
        exportRows: data.rows,
        pageInfo
      };
    }
    case "all-transactions":
      return {
        title: "All Transactions",
        subtitle: "Global transaction ledger with search, sorting, and pagination.",
        filename: "all-transactions",
        metrics: [
          { label: "Transactions", value: data.totalRows },
          { label: "Showing Type", value: data.transactionType || "All" },
          { label: "Date Range", value: data.fromDate && data.toDate ? `${formatDateByPreference(data.fromDate, "-")} to ${formatDateByPreference(data.toDate, "-")}` : "All dates" },
          { label: "Search", value: data.search || "None" }
        ],
        columns: [
          { key: "date", label: "Date", format: "date", sortable: true },
          { key: "transactionType", label: "Type", sortable: true },
          { key: "reference", label: "Reference", sortable: true },
          { key: "partyName", label: "Party", sortable: true },
          { key: "amount", label: "Amount", align: "right", format: "money", sortable: true },
          { key: "status", label: "Status", align: "right", sortable: true }
        ],
        tableTitle: "Transaction Ledger",
        rows: data.rows,
        exportRows: data.allRows || data.rows,
        pageInfo: data
      };
    case "party-statement":
      return {
        title: "Party Statement",
        subtitle: data.party ? `${data.party.name} statement with opening, running, and closing balance.` : "Select a customer or supplier to generate the statement.",
        filename: data.party ? `${data.party.name}-statement` : "party-statement",
        metrics: data.party
          ? [
              { label: "Opening Balance", value: formatMoney(data.openingBalance, currency) },
              { label: "Total Debit", value: formatMoney(data.totals.debit, currency) },
              { label: "Total Credit", value: formatMoney(data.totals.credit, currency) },
              { label: "Closing Balance", value: formatMoney(data.closingBalance, currency), tone: data.closingBalance >= 0 ? "positive" : "negative" }
            ]
          : [],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "transactionType", label: "Transaction Type" },
          { key: "transactionMode", label: "Transaction Mode" },
          { key: "referenceNumber", label: "Reference Number" },
          { key: "invoiceNumber", label: "Invoice Number" },
          { key: "debit", label: "Debit", align: "right", format: "money" },
          { key: "credit", label: "Credit", align: "right", format: "money" },
          { key: "runningBalance", label: "Running Balance", align: "right", format: "money", emphasis: true }
        ],
        tableTitle: "Statement Entries",
        rows: data.rows,
        exportRows: data.allRows || data.rows,
        footerRows: data.party
          ? [
              ["", "", "", "", "TDS Credit Amount", "-", formatMoney(data.totals.tdsCredit, currency), ""],
              ["", "", "", "", "Normal Credit Amount", "-", formatMoney(data.totals.normalCredit, currency), ""],
              ["", "", "", "", "Net Credit Amount", "-", formatMoney(data.totals.netCredit, currency), ""]
            ]
          : [],
        creditSummary: {
          tdsCredit: data.totals.tdsCredit,
          normalCredit: data.totals.normalCredit,
          netCredit: data.totals.netCredit
        },
        pageInfo: data
      };
    case "aging-report": {
      const filteredRows =
        agingMetricFilter && agingMetricFilter !== "totalOutstanding"
          ? data.rows.filter((row) => Number(row?.[agingMetricFilter] || 0) > 0)
          : data.rows;
      const pageInfo = paginateIfNeeded(filteredRows);
      return {
        title: "Aging Report",
        subtitle: "Outstanding invoices grouped into aging buckets as of the selected date.",
        filename: "aging-report",
        metrics: [
          { label: "Total Outstanding", value: formatMoney(data.totals.totalOutstanding, currency), tone: data.totals.totalOutstanding > 0 ? "negative" : "default", metricKey: "totalOutstanding" },
          { label: "0-30 Days", value: formatMoney(data.totals.bucket_0_30, currency), metricKey: "bucket_0_30" },
          { label: "31-60 Days", value: formatMoney(data.totals.bucket_31_60, currency), metricKey: "bucket_31_60" },
          { label: "90+ Days", value: formatMoney(data.totals.bucket_above_90, currency), tone: data.totals.bucket_above_90 > 0 ? "negative" : "default", metricKey: "bucket_above_90" }
        ],
        columns: [
          { key: "partyName", label: "Party Name" },
          { key: "totalOutstanding", label: "Total Outstanding", align: "right", format: "money", emphasis: true },
          ...AGING_BUCKET_COLUMNS.map((column) => ({ key: column.key, label: column.label, align: "right", format: "money" }))
        ],
        tableTitle: "Outstanding Aging",
        rows: pageInfo.rows,
        exportRows: filteredRows,
        pageInfo
      };
    }
    case "all-parties": {
      const pageInfo = paginateIfNeeded(data.rows);
      return {
        title: "All Parties",
        subtitle: "Customer and supplier balances with recent activity.",
        filename: "all-parties",
        metrics: [
          { label: "Parties", value: data.totals.parties },
          { label: "Total Outstanding", value: formatMoney(data.totals.totalOutstanding, currency) },
          { label: "Overdue Parties", value: data.totals.overdueParties },
          { label: "Party Type", value: data.partyType }
        ],
        columns: [
          { key: "name", label: "Party Name" },
          { key: "type", label: "Type" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "outstanding", label: "Outstanding", align: "right", format: "money", emphasis: true },
          { key: "maxOverdueDays", label: "Max Overdue Days", align: "right", format: "number" },
          { key: "latestActivityDate", label: "Last Activity", align: "right", format: "date" }
        ],
        tableTitle: "Party Master",
        rows: pageInfo.rows,
        exportRows: data.rows,
        pageInfo
      };
    }
    case "profit-loss": {
      const totalPurchase = data.totals.totalPurchase ?? data.totals.totalPurchases ?? 0;
      const grossProfit = data.totals.grossProfit ?? data.totals.totalSales - totalPurchase;
      const netProfit = data.totals.netProfit ?? grossProfit - data.totals.totalExpenses;
      return {
        title: "Profit & Loss",
        subtitle: "Simple financial summary without complex accounting treatment.",
        filename: "profit-loss",
        metrics: [
          { label: "Total Sales", value: formatMoney(data.totals.totalSales, currency), tone: "positive" },
          { label: "Total Purchase", value: formatMoney(totalPurchase, currency) },
          {
            label: grossProfit < 0 ? "Gross Loss" : "Gross Profit",
            value: formatMoney(Math.abs(grossProfit), currency),
            tone: grossProfit < 0 ? "negative" : "positive",
            metricKey: "gross-breakdown"
          },
          { label: "Total Expenses", value: formatMoney(data.totals.totalExpenses, currency) },
          {
            label: netProfit < 0 ? "Net Loss" : "Net Profit",
            value: formatMoney(Math.abs(netProfit), currency),
            tone: netProfit >= 0 ? "positive" : "negative",
            metricKey: "net-breakdown"
          }
        ],
        columns: [
          { key: "category", label: "Expense Category" },
          { key: "amount", label: "Amount", align: "right", format: "money", emphasis: true }
        ],
        tableTitle: "Top Expense Categories",
        rows: data.expenseRows,
        exportRows: data.expenseRows,
        pageInfo: null,
        topExpenseRows: data.expenseRows.slice(0, 5),
        profitMargin: data.totals.totalSales > 0 ? (netProfit / data.totals.totalSales) * 100 : null,
        totals: {
          ...data.totals,
          totalPurchase,
          grossProfit,
          netProfit
        }
      };
    }
    case "gst-report": {
      const pageInfo = paginateIfNeeded(data.rows);
      return {
        title: "GST Report",
        subtitle: "Sales GST output, purchase GST input, and payable tax for the selected period.",
        filename: "gst-report",
        metrics: [
          { label: "Total Sales GST", value: formatMoney(data.totals.outputGst, currency), tone: "positive" },
          { label: "Total Purchase GST", value: formatMoney(data.totals.inputGst, currency) },
          { label: "GST Payable", value: formatMoney(data.totals.gstPayable, currency), tone: data.totals.gstPayable >= 0 ? "positive" : "negative" }
        ],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "reference", label: "Invoice No" },
          { key: "partyName", label: "Customer" },
          { key: "gstAmount", label: "GST Amount", align: "right", format: "money", emphasis: true }
        ],
        tableTitle: "Sales GST Entries",
        rows: pageInfo.rows,
        exportRows: data.rows,
        pageInfo,
        totals: data.totals,
        breakdown: [
          { label: "CGST", output: data.totals.outputCgst, input: data.totals.inputCgst, payable: data.totals.payableCgst },
          { label: "SGST", output: data.totals.outputSgst, input: data.totals.inputSgst, payable: data.totals.payableSgst },
          { label: "IGST", output: data.totals.outputIgst, input: data.totals.inputIgst, payable: data.totals.payableIgst }
        ]
      };
    }
    case "tds-report": {
      const pageInfo = paginateIfNeeded(data.rows);
      const isCustomerView = data.partyType === PARTY_TYPES.customer;
      return {
        title: "TDS Report",
        subtitle: isCustomerView
          ? "Customer payment TDS deducted through Payment In entries for the selected period."
          : "Supplier payment TDS deducted through Payment Out entries for the selected period.",
        filename: "tds-report",
        metrics: [
          { label: "Total TDS", value: formatMoney(data.totals.totalTds, currency), tone: data.totals.totalTds > 0 ? "positive" : "default" },
          { label: isCustomerView ? "Customers" : "Suppliers", value: isCustomerView ? data.totals.customers : data.totals.suppliers },
          { label: "Entries", value: data.rows.length }
        ],
        columns: [
          { key: "date", label: "Date", format: "date" },
          { key: "invoiceReference", label: isCustomerView ? "Invoice No" : "Bill No" },
          { key: "partyName", label: isCustomerView ? "Customer" : "Supplier" },
          { key: "tdsRate", label: "TDS %", align: "right", format: "percent" },
          { key: "tdsAmount", label: "TDS Amount", align: "right", format: "money", emphasis: true },
          { key: "finalPaidAmount", label: isCustomerView ? "Received Amount" : "Final Paid", align: "right", format: "money" }
        ],
        tableTitle: "TDS Entries",
        rows: pageInfo.rows,
        exportRows: data.rows,
        pageInfo
      };
    }
    default:
      return null;
  }
}

export default function Reports() {
  const role = authGetRole();
  const canAccess = isAuthorizedReportRole(role);
  const { currency = "USD", profile: organizationProfile = {} } = useOrganization();
  const { years, selectedYear, selectFinancialYear, activeRange } = useFinancialYears();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => getDefaultReportFilters());
  const [dataset, setDataset] = useState(() => getReportsDataset(activeRange));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [sidebarWidth, setSidebarWidth] = useState(REPORT_SIDEBAR_DEFAULT_WIDTH);
  const [expandedAgingBucket, setExpandedAgingBucket] = useState(null);
  const [agingMetricFilter, setAgingMetricFilter] = useState("totalOutstanding");
  const [profitBreakdownMode, setProfitBreakdownMode] = useState("");
  const resizeStateRef = useRef(null);
  const deferredDataset = useDeferredValue(dataset);
  const deferredFilters = useDeferredValue(filters);
  const deferredPage = useDeferredValue(page);
  const hasCachedDataset = useMemo(() => hasReportDatasetData(dataset), [dataset]);
  useGlobalLoadingBridge(loading && !hasCachedDataset, "reports-module");

  const visibleReportSections = useMemo(
    () => getVisibleReportSections(organizationProfile),
    [organizationProfile]
  );
  const visibleReportOrder = useMemo(
    () => visibleReportSections.flatMap((section) => section.items.map((item) => item.id)),
    [visibleReportSections]
  );
  const activeReport = visibleReportOrder.includes(searchParams.get("report")) ? searchParams.get("report") : visibleReportOrder[0];

  const partyTypeForOptions = useMemo(
    () => getDerivedPartyType(activeReport, filters.partyType),
    [activeReport, filters.partyType]
  );

  const partyOptions = useMemo(() => {
    if (activeReport === "all-transactions") {
      return [...(dataset?.parties || [])].sort((left, right) => left.name.localeCompare(right.name));
    }
    if (activeReport === "sale-report" || activeReport === "purchase-report" || activeReport === "party-statement" || activeReport === "aging-report" || activeReport === "all-parties" || activeReport === "tds-report") {
      return listReportParties(dataset, partyTypeForOptions);
    }
    return [];
  }, [activeReport, dataset, partyTypeForOptions]);

  useEffect(() => {
    if (!selectedYear) return;
    setFilters((current) => applyFinancialYearRange(current, selectedYear));
  }, [selectedYear?.id, selectedYear?.startDate, selectedYear?.endDate]);

  useEffect(() => {
    if (searchParams.get("report") !== activeReport) {
      setSearchParams({ report: activeReport }, { replace: true });
    }
  }, [activeReport, searchParams, setSearchParams]);

  useEffect(() => {
    if (filters.partyId && !partyOptions.some((option) => option.id === filters.partyId)) {
      setFilters((current) => ({ ...current, partyId: "" }));
    }
  }, [filters.partyId, partyOptions]);

  useEffect(() => {
    setPage(1);
  }, [
    activeReport,
    filters.asOfDate,
    filters.fromDate,
    filters.partyId,
    filters.partyType,
    filters.search,
    filters.sortDirection,
    filters.sortKey,
    filters.toDate,
    filters.transactionType
  ]);

  useEffect(() => {
    setExpandedAgingBucket(null);
    setAgingMetricFilter("totalOutstanding");
  }, [activeReport, filters.asOfDate, filters.partyId, filters.partyType, dataset]);

  useEffect(() => {
    if (activeReport !== "profit-loss") {
      setProfitBreakdownMode("");
    }
  }, [activeReport]);

  useEffect(() => {
    if (!profitBreakdownMode) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setProfitBreakdownMode("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [profitBreakdownMode]);

  useEffect(() => {
    function handleMouseMove(event) {
      if (!resizeStateRef.current) return;
      const { startX, startWidth } = resizeStateRef.current;
      const delta = event.clientX - startX;
      const nextWidth = Math.max(
        REPORT_SIDEBAR_MIN_WIDTH,
        Math.min(REPORT_SIDEBAR_MAX_WIDTH, startWidth + delta)
      );
      setSidebarWidth(nextWidth);
    }

    function handleMouseUp() {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!canAccess) return undefined;
    let mounted = true;

    async function loadReports() {
      if (!hasCachedDataset) setLoading(true);
      setError("");
      try {
        const nextDataset = await syncReportsData(activeRange);
        if (!mounted) return;
        startTransition(() => {
          setDataset(nextDataset);
        });
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError?.message || "Failed to load reports.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadReports();
    return () => {
      mounted = false;
    };
  }, [canAccess, activeRange?.fromDate, activeRange?.toDate]);

  const reportResult = useMemo(() => {
    try {
      switch (activeReport) {
        case "sale-report":
          return buildSaleReport(deferredDataset, {
            fromDate: deferredFilters.fromDate,
            toDate: deferredFilters.toDate,
            partyId: deferredFilters.partyId
          });
        case "purchase-report":
          return buildPurchaseReport(deferredDataset, {
            fromDate: deferredFilters.fromDate,
            toDate: deferredFilters.toDate,
            partyId: deferredFilters.partyId
          });
        case "cash-flow":
          return buildCashFlowReport(deferredDataset, {
            fromDate: deferredFilters.fromDate,
            toDate: deferredFilters.toDate
          });
        case "all-transactions":
          return buildAllTransactionsReport(
            deferredDataset,
            {
              fromDate: deferredFilters.fromDate,
              toDate: deferredFilters.toDate,
              transactionType: deferredFilters.transactionType,
              partyId: deferredFilters.partyId,
              search: deferredFilters.search,
              sortKey: deferredFilters.sortKey,
              sortDirection: deferredFilters.sortDirection
            },
            { page: deferredPage, pageSize: REPORT_PAGE_SIZE }
          );
        case "party-statement":
          return buildPartyStatementReport(
            deferredDataset,
            {
              partyType: deferredFilters.partyType,
              partyId: deferredFilters.partyId,
              fromDate: deferredFilters.fromDate,
              toDate: deferredFilters.toDate
            },
            { page: deferredPage, pageSize: REPORT_PAGE_SIZE }
          );
        case "aging-report":
          return buildAgingReport(deferredDataset, {
            partyType: deferredFilters.partyType,
            partyId: deferredFilters.partyId,
            asOfDate: deferredFilters.asOfDate
          });
        case "all-parties":
          return buildAllPartiesReport(deferredDataset, {
            partyType: deferredFilters.partyType,
            search: deferredFilters.search
          });
        case "profit-loss":
          return buildProfitLossReport(deferredDataset, {
            fromDate: deferredFilters.fromDate,
            toDate: deferredFilters.toDate
          });
        case "gst-report":
          return buildGstReport(deferredDataset, {
            fromDate: deferredFilters.fromDate,
            toDate: deferredFilters.toDate,
            organizationCountry: organizationProfile?.country || organizationProfile?.countryCode || ""
          });
        case "tds-report":
          return buildTdsReport(deferredDataset, {
            fromDate: deferredFilters.fromDate,
            toDate: deferredFilters.toDate,
            partyId: deferredFilters.partyId,
            organizationCountry: organizationProfile?.country || organizationProfile?.countryCode || ""
          });
        default:
          return null;
      }
    } catch (reportError) {
      return { error: reportError?.message || "Failed to generate report." };
    }
  }, [activeReport, deferredDataset, deferredFilters, deferredPage, organizationProfile]);

  const viewModel = useMemo(
    () => (reportResult?.error ? null : buildViewModel({ activeReport, data: reportResult, currency, currentPage: page, agingMetricFilter })),
    [activeReport, reportResult, currency, page, agingMetricFilter]
  );

  function handleRefresh() {
    setLoading(true);
    setError("");
    syncReportsData(activeRange)
      .then((nextDataset) =>
        startTransition(() => {
          setDataset(nextDataset);
        })
      )
      .catch((loadError) => setError(loadError?.message || "Failed to refresh reports."))
      .finally(() => setLoading(false));
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSort(columnKey) {
    if (!SORTABLE_TRANSACTION_COLUMNS.has(columnKey)) return;
    setFilters((current) => ({
      ...current,
      sortKey: columnKey,
      sortDirection: current.sortKey === columnKey && current.sortDirection === "asc" ? "desc" : "asc"
    }));
  }

  function handleExport(mode) {
    if (!viewModel) return;
    const payload = buildExportPayload({ viewModel, currency });
    if (mode === "print") printReport(payload);
    if (mode === "pdf") exportReportPdf(payload);
    if (mode === "excel") exportReportExcel(payload);
    if (mode === "json") exportReportJson(payload);
  }

  function handleSidebarResizeStart(event) {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handleAgingBucketToggle(partyId, bucketKey) {
    setExpandedAgingBucket((current) =>
      current?.partyId === partyId && current?.bucketKey === bucketKey ? null : { partyId, bucketKey }
    );
  }

  function renderFilters() {
    const showDateRange = ["sale-report", "purchase-report", "cash-flow", "all-transactions", "party-statement", "profit-loss", "gst-report", "tds-report"].includes(activeReport);
    const showPartyType = ["party-statement", "aging-report", "all-parties", "tds-report"].includes(activeReport);
    const showPartySelect = ["sale-report", "purchase-report", "all-transactions", "party-statement", "aging-report", "tds-report"].includes(activeReport);
    const showAsOfDate = activeReport === "aging-report";
    const showTransactionType = activeReport === "all-transactions";
    const showSearch = activeReport === "all-transactions" || activeReport === "all-parties";
    const partyLabel =
      activeReport === "sale-report"
        ? "Customer"
        : activeReport === "purchase-report"
          ? "Supplier"
          : activeReport === "tds-report"
            ? "Party"
          : "Party";
    const placeholder =
      activeReport === "sale-report"
        ? "All Customers"
        : activeReport === "purchase-report"
          ? "All Suppliers"
          : activeReport === "tds-report"
            ? "All Parties"
          : "All Parties";

    return (
      <Card className="p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {years.length ? (
            <label className="text-xs font-semibold text-slate-600">
              Financial Year
              <select
                value={selectedYear?.id || ""}
                onChange={(event) => selectFinancialYear(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-100"
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    FY {year.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {showPartyType ? (
            <label className="text-xs font-semibold text-slate-600">
              Party Type
              <select
                value={filters.partyType}
                onChange={(event) => updateFilter("partyType", event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-100"
              >
                <option value={PARTY_TYPES.customer}>Customer</option>
                <option value={PARTY_TYPES.supplier}>Supplier</option>
              </select>
            </label>
          ) : null}

          {showPartySelect ? (
            <SearchablePartySelect
              label={partyLabel}
              options={partyOptions}
              value={filters.partyId}
              onChange={(value) => updateFilter("partyId", value)}
              placeholder={placeholder}
              disabled={loading}
            />
          ) : null}

          {showDateRange ? (
            <label className="text-xs font-semibold text-slate-600">
              From Date
              <DateInput
                value={filters.fromDate}
                onChange={(value) => updateFilter("fromDate", value)}
                max={filters.toDate || undefined}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm"
              />
            </label>
          ) : null}

          {showDateRange ? (
            <label className="text-xs font-semibold text-slate-600">
              To Date
              <DateInput
                value={filters.toDate}
                onChange={(value) => updateFilter("toDate", value)}
                min={filters.fromDate || undefined}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm"
              />
            </label>
          ) : null}

          {showAsOfDate ? (
            <label className="text-xs font-semibold text-slate-600">
              As of Date
              <DateInput
                value={filters.asOfDate}
                onChange={(value) => updateFilter("asOfDate", value)}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm"
              />
            </label>
          ) : null}

          {showTransactionType ? (
            <label className="text-xs font-semibold text-slate-600">
              Transaction Type
              <select
                value={filters.transactionType}
                onChange={(event) => updateFilter("transactionType", event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-100"
              >
                {TRANSACTION_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {showSearch ? (
            <label className="text-xs font-semibold text-slate-600">
              Search
              <div className="relative mt-2">
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder={activeReport === "all-transactions" ? "Search by party, reference, or status" : "Search party"}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-100"
                />
              </div>
            </label>
          ) : null}
        </div>
      </Card>
    );
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 pb-24">
        <PageHeader title="Reports" subtitle="Reports are limited to Admin and Accountant users." />
        <Card className="p-10 text-center text-sm text-slate-500">
          You do not have permission to access the reporting module.
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1760px] space-y-4 pb-24">
      <PageHeader
        title="Reports"
        subtitle="Clean, business-focused reporting for transactions, parties, and finance."
        right={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
        }
      />

      {error ? (
        <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</Card>
      ) : null}

      {reportResult?.error ? (
        <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{reportResult.error}</Card>
      ) : null}

      <div
        className="grid gap-4 2xl:grid-cols-[var(--reports-sidebar-width)_14px_minmax(0,1fr)] 2xl:gap-0"
        style={{ "--reports-sidebar-width": `${sidebarWidth}px` }}
      >
        <div className="min-w-0">
          <ReportSidebar
            sections={visibleReportSections}
            activeReport={activeReport}
            onSelect={(reportId) => setSearchParams({ report: reportId })}
          />
        </div>

        <div className="relative hidden 2xl:flex items-stretch justify-center">
          <div className="w-px bg-slate-200" />
          <button
            type="button"
            aria-label="Resize reports panel"
            onMouseDown={handleSidebarResizeStart}
            className="absolute inset-y-0 left-1/2 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center group"
          >
            <span className="h-20 w-1 rounded-full bg-slate-300 transition group-hover:bg-slate-500 group-active:bg-slate-700" />
          </button>
        </div>

        <div className="min-w-0 space-y-4">
          {renderFilters()}

          {viewModel ? (
            <>
              <Card className="p-4 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{viewModel.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{viewModel.subtitle}</p>
                  </div>

                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center">
                    <button type="button" onClick={() => handleExport("print")} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:w-auto">
                      <Printer className="h-4 w-4" />
                      Print
                    </button>
                    <button type="button" onClick={() => handleExport("pdf")} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:w-auto">
                      <FileDown className="h-4 w-4" />
                      Export PDF
                    </button>
                    <button type="button" onClick={() => handleExport("excel")} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:w-auto">
                      <FileSpreadsheet className="h-4 w-4" />
                      Export Excel
                    </button>
                    <button type="button" onClick={() => handleExport("json")} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:w-auto">
                      <FileDown className="h-4 w-4" />
                      Export JSON
                    </button>
                  </div>
                </div>

                {viewModel.metrics.length ? (
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {viewModel.metrics.map((metric) => (
                      metric.metricKey && activeReport === "aging-report" ? (
                        <InteractiveMetricCard
                          key={metric.label}
                          label={metric.label}
                          value={metric.value}
                          tone={metric.tone}
                          active={agingMetricFilter === metric.metricKey}
                          onClick={() => {
                            setExpandedAgingBucket(null);
                            setPage(1);
                            setAgingMetricFilter(metric.metricKey);
                          }}
                        />
                      ) : metric.metricKey && activeReport === "profit-loss" ? (
                        <InteractiveMetricCard
                          key={metric.label}
                          label={metric.label}
                          value={metric.value}
                          tone={metric.tone}
                          active={profitBreakdownMode === metric.metricKey}
                          onClick={() => setProfitBreakdownMode(metric.metricKey)}
                        />
                      ) : (
                        <MetricCard key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />
                      )
                    ))}
                  </div>
                ) : null}
              </Card>

              <Card className="p-4 sm:p-6">
                {activeReport === "profit-loss" ? (
                  <ProfitLossInsights viewModel={viewModel} currency={currency} />
                ) : (
                  <>
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{viewModel.tableTitle}</p>
                        <p className="text-xs text-slate-500">Built for large datasets with filtered exports and paginated viewing.</p>
                      </div>
                      <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        {(viewModel.pageInfo?.totalRows ?? viewModel.exportRows.length) || 0} rows
                      </div>
                    </div>

                    {activeReport === "gst-report" ? (
                      <>
                        <GstBreakdownPanel totals={viewModel.totals} currency={currency} />
                        <ReportTable
                          columns={viewModel.columns}
                          rows={viewModel.rows}
                          currency={currency}
                          sortKey={filters.sortKey}
                          sortDirection={filters.sortDirection}
                          onSort={null}
                          emptyText="No GST entries found for the selected filters."
                        />
                      </>
                    ) : activeReport === "aging-report" ? (
                      <AgingReportTable
                        rows={viewModel.rows}
                        currency={currency}
                        expandedBucket={expandedAgingBucket}
                        onToggle={handleAgingBucketToggle}
                        emptyText="No records found for the selected filters."
                      />
                    ) : activeReport === "party-statement" ? (
                      <PartyStatementTable
                        columns={viewModel.columns}
                        rows={viewModel.rows}
                        currency={currency}
                        creditSummary={viewModel.creditSummary}
                        emptyText={viewModel.pageInfo?.party ? "No records found for the selected filters." : "Select a party to generate the statement."}
                      />
                    ) : (
                      <ReportTable
                        columns={viewModel.columns}
                        rows={viewModel.rows}
                        currency={currency}
                        sortKey={filters.sortKey}
                        sortDirection={filters.sortDirection}
                        onSort={activeReport === "all-transactions" ? handleSort : null}
                        emptyText={activeReport === "party-statement" ? "Select a party to generate the statement." : "No records found for the selected filters."}
                      />
                    )}

                    <PaginationBar pageInfo={viewModel.pageInfo} onChange={setPage} />
                  </>
                )}
              </Card>
            </>
          ) : (
            <Card className="p-10 text-center text-sm text-slate-500">
              Select a report to begin.
            </Card>
          )}
        </div>
      </div>

      {activeReport === "profit-loss" ? (
        <ProfitLossBreakdownModal
          mode={profitBreakdownMode}
          onClose={() => setProfitBreakdownMode("")}
          viewModel={viewModel}
          currency={currency}
        />
      ) : null}
    </div>
  );
}
