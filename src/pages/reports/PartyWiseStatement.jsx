import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, FileDown, FileSpreadsheet, Printer, Search } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import Badge from "../../components/Badge";
import DateInput from "../../components/DateInput";
import { useOrganization } from "../../context/OrganizationContext";
import { useGlobalLoadingBridge } from "../../hooks/useGlobalLoadingBridge";
import { formatDateByPreference } from "../../lib/formatPreferences";
import { formatMoney, normalizeText } from "../../modules/parties/utils";
import {
  exportPartyReportExcel,
  exportPartyReportPdf,
  printPartyReport
} from "../../modules/reports/customerStatementExport";
import {
  fetchPartyWiseStatementReport,
  listPartyReportParties
} from "../../services/customerStatement.service";
import { authGetRole } from "../../services/auth.service";
import { isAccounterRole, isOwnerRole } from "../../services/roles";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIsoDate() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function statementPeriodLabel(report) {
  const fromDate = report?.period?.from_date;
  const toDate = report?.period?.to_date || report?.period?.as_of_date;
  const fromLabel = fromDate ? formatDateByPreference(fromDate, "All time") : "All time";
  const toLabel = toDate ? formatDateByPreference(toDate, "Today") : "Today";
  return `${fromLabel} to ${toLabel}`;
}

function reportHeading(report, partyType) {
  if (report?.party?.name) return report.party.name;
  return partyType === "Supplier" ? "All Suppliers" : "All Customers";
}

function summaryTone(amount) {
  return Number(amount || 0) >= 0
    ? "border-emerald-200 bg-emerald-50/60 text-emerald-700"
    : "border-rose-200 bg-rose-50/60 text-rose-700";
}

function SummaryCard({ title, value, currency, emphasized = false }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        emphasized ? summaryTone(value) : "border-slate-200 bg-white text-slate-900"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className={`mt-3 text-2xl font-bold ${emphasized ? "" : "text-slate-900"}`}>
        {formatMoney(value, currency)}
      </p>
    </div>
  );
}

function SearchablePartySelect({
  parties,
  partyType,
  value,
  onChange,
  disabled = false
}) {
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const allLabel = partyType === "Supplier" ? "All Suppliers" : "All Customers";
  const selectedParty = useMemo(
    () => parties.find((party) => party.id === value) || null,
    [parties, value]
  );

  const filteredParties = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return parties;
    return parties.filter((party) =>
      [party.name, party.phone, party.email, party.address]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [parties, query]);

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

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-700 shadow-sm outline-none transition hover:border-slate-300 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="min-w-0">
          <p className={`truncate font-medium ${selectedParty ? "text-slate-900" : "text-slate-500"}`}>
            {selectedParty?.name || allLabel}
          </p>
          <p className="truncate text-xs text-slate-500">
            {selectedParty
              ? [selectedParty.phone, selectedParty.email].filter(Boolean).join(" | ") || "No contact details"
              : "Leave unselected to see aging for all parties"}
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 p-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${partyType.toLowerCase()}`}
                className="search-field-input search-field-input-icon h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-10 text-sm outline-none focus:ring-4 focus:ring-slate-200"
              />
            </label>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 ${
                !value ? "bg-emerald-50/70" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{allLabel}</p>
                <p className="text-xs text-slate-500">Aging summary for every {partyType.toLowerCase()}</p>
              </div>
              {!value ? <Badge tone="success">Selected</Badge> : null}
            </button>

            {filteredParties.length ? (
              filteredParties.map((party) => (
                <button
                  key={party.id}
                  type="button"
                  onClick={() => {
                    onChange(party.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 ${
                    party.id === value ? "bg-emerald-50/70" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{party.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[party.phone, party.email].filter(Boolean).join(" | ") || "No contact details"}
                    </p>
                  </div>
                  {party.id === value ? <Badge tone="success">Selected</Badge> : null}
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-slate-500">No party found for this search.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PartyWiseStatement({
  pageTitle = "Party Wise Statement",
  pageSubtitle = "Customer and supplier statements with outstanding aging analysis."
}) {
  const role = authGetRole();
  const canAccess = isOwnerRole(role) || isAccounterRole(role);
  const { currency = "USD" } = useOrganization();

  const [partyType, setPartyType] = useState("Customer");
  const [parties, setParties] = useState([]);
  const [partyId, setPartyId] = useState("");
  const [fromDate, setFromDate] = useState(monthStartIsoDate());
  const [toDate, setToDate] = useState(todayIsoDate());
  const [report, setReport] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingParties, setLoadingParties] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState("");
  useGlobalLoadingBridge(loadingParties || loadingReport, "party-wise-statement");

  useEffect(() => {
    if (!canAccess) return undefined;
    let mounted = true;

    async function loadParties() {
      setLoadingParties(true);
      try {
        const rows = await listPartyReportParties({ partyType });
        if (!mounted) return;
        setParties(rows);
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError?.message || "Failed to load parties.");
      } finally {
        if (mounted) setLoadingParties(false);
      }
    }

    loadParties();
    return () => {
      mounted = false;
    };
  }, [canAccess, partyType]);

  useEffect(() => {
    setPartyId("");
    setReport(null);
    setCurrentPage(1);
    setError("");
  }, [partyType]);

  const selectedParty = useMemo(
    () => parties.find((party) => party.id === partyId) || report?.party || null,
    [parties, partyId, report]
  );

  const pageSize = 20;
  const totalTransactions = report?.transactions?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalTransactions / pageSize));
  const pageTransactions = useMemo(() => {
    const allTransactions = Array.isArray(report?.transactions) ? report.transactions : [];
    const startIndex = (currentPage - 1) * pageSize;
    return allTransactions.slice(startIndex, startIndex + pageSize);
  }, [report, currentPage]);
  const agingTotals = useMemo(() => {
    const rows = Array.isArray(report?.aging_summary) ? report.aging_summary : [];
    return rows.reduce(
      (totals, row) => ({
        totalOutstanding: totals.totalOutstanding + Number(row?.total_outstanding || 0),
        current: totals.current + Number(row?.current || 0),
        above90: totals.above90 + Number(row?.bucket_above_90 || 0)
      }),
      { totalOutstanding: 0, current: 0, above90: 0 }
    );
  }, [report]);

  async function handleGenerateReport() {
    if (fromDate && toDate && fromDate > toDate) {
      setError("From Date cannot be after To Date.");
      return;
    }

    setError("");
    setLoadingReport(true);
    try {
      const nextReport = await fetchPartyWiseStatementReport({
        partyType,
        partyId,
        fromDate,
        toDate
      });
      setReport(nextReport);
      setCurrentPage(1);
    } catch (loadError) {
      setReport(null);
      setError(loadError?.message || "Failed to generate report.");
    } finally {
      setLoadingReport(false);
    }
  }

  function handlePrint() {
    if (!report) return;
    printPartyReport(report, currency);
  }

  function handlePdfDownload() {
    if (!report) return;
    exportPartyReportPdf(report, currency);
  }

  function handleExcelExport() {
    if (!report) return;
    exportPartyReportExcel(report, currency);
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 pb-24">
        <PageHeader
          title={pageTitle}
          subtitle="Reports access is limited to Admin and Accountant roles."
          right={
            <Link
              to="/app/reports"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to Reports
            </Link>
          }
        />
        <Card className="p-8 text-center text-sm text-slate-500">
          You do not have permission to access this report.
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1420px] space-y-4 pb-24">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        right={
          <Link
            to="/app/reports"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Reports
          </Link>
        }
      />

      <Card className="p-6">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.7fr_1.35fr_0.8fr_0.8fr_auto]">
          <label className="text-xs font-semibold text-slate-600">
            Party Type
            <select
              value={partyType}
              onChange={(event) => setPartyType(event.target.value)}
              className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-100"
            >
              <option value="Customer">Customer</option>
              <option value="Supplier">Supplier</option>
            </select>
          </label>

          <label className="text-xs font-semibold text-slate-600">
            Party Name
            <SearchablePartySelect
              parties={parties}
              partyType={partyType}
              value={partyId}
              onChange={setPartyId}
              disabled={loadingParties || loadingReport}
            />
          </label>

          <label className="text-xs font-semibold text-slate-600">
            From Date
            <DateInput
              value={fromDate}
              onChange={(nextValue) => setFromDate(nextValue)}
              max={toDate || undefined}
              className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm"
            />
          </label>

          <label className="text-xs font-semibold text-slate-600">
            To Date
            <DateInput
              value={toDate}
              onChange={(nextValue) => setToDate(nextValue)}
              min={fromDate || undefined}
              className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleGenerateReport}
              disabled={loadingParties || loadingReport}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-soft transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingReport ? "Generating..." : "Generate Report"}
            </button>
          </div>
        </div>

        {selectedParty ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">{selectedParty.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              {[selectedParty.phone, selectedParty.email, selectedParty.address]
                .filter(Boolean)
                .join(" | ") || "No contact details available"}
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Aging summary will be generated for all {partyType.toLowerCase()}s when no specific party is selected.
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </Card>

      {report ? (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-slate-900">{reportHeading(report, partyType)}</p>
                <p className="mt-1 text-sm text-slate-500">Statement Period: {statementPeriodLabel(report)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  As of {formatDateByPreference(report?.period?.as_of_date || todayIsoDate(), "-")} with full transaction history and outstanding aging.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={handlePdfDownload}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileDown className="h-4 w-4" />
                  Export PDF
                </button>
                <button
                  type="button"
                  onClick={handleExcelExport}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Export Excel
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {report.party ? (
                <>
                  <SummaryCard title="Opening Balance" value={report.opening_balance} currency={currency} />
                  <SummaryCard title="Total Debit" value={report.totals?.debit} currency={currency} />
                  <SummaryCard title="Total Credit" value={report.totals?.credit} currency={currency} />
                  <SummaryCard title="Closing Balance" value={report.closing_balance} currency={currency} emphasized />
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtered Parties</p>
                    <p className="mt-3 text-2xl font-bold text-slate-900">{report.aging_summary?.length || 0}</p>
                  </div>
                  <SummaryCard title="Total Outstanding" value={agingTotals.totalOutstanding} currency={currency} emphasized />
                  <SummaryCard title="Current Bucket" value={agingTotals.current} currency={currency} />
                  <SummaryCard title="90+ Days" value={agingTotals.above90} currency={currency} />
                </>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Transaction Statement</p>
                <p className="text-xs text-slate-500">Invoice and payment flow with running balance.</p>
              </div>
              <Badge tone="neutral">{totalTransactions} transactions</Badge>
            </div>

            {report.party ? (
              <>
                <div className="mt-4 overflow-auto rounded-3xl border border-slate-200">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
                        <th className="px-4 py-3 font-semibold text-slate-700">Transaction Type</th>
                        <th className="px-4 py-3 font-semibold text-slate-700">Reference Number</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Debit</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Credit</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageTransactions.length ? (
                        pageTransactions.map((row) => (
                          <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                            <td className="px-4 py-3 text-slate-700">{formatDateByPreference(row.date, "-")}</td>
                            <td className="px-4 py-3 text-slate-700">{row.transaction_type}</td>
                            <td className="px-4 py-3 text-slate-700">{row.reference_number || "-"}</td>
                            <td className="px-4 py-3 text-right text-slate-700">
                              {row.debit ? formatMoney(row.debit, currency) : "-"}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-700">
                              {row.credit ? formatMoney(row.credit, currency) : "-"}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">
                              {formatMoney(row.running_balance, currency)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-16 text-center text-slate-500">
                            No transactions found for the selected period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalTransactions > pageSize ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      Showing {(currentPage - 1) * pageSize + 1}-
                      {Math.min(currentPage * pageSize, totalTransactions)} of {totalTransactions}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        disabled={currentPage === 1}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-xs font-semibold text-slate-600">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                        disabled={currentPage === totalPages}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                Select a specific {partyType.toLowerCase()} to view the full statement table. Aging summary below already covers the selected filter.
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Aging Summary</p>
                <p className="text-xs text-slate-500">Outstanding balances grouped by aging buckets.</p>
              </div>
              <Badge tone="neutral">{report.aging_summary?.length || 0} parties</Badge>
            </div>

            <div className="mt-4 overflow-auto rounded-3xl border border-slate-200">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">Party Name</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Total Outstanding</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Current</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">0-30 Days</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">31-60 Days</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">61-90 Days</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">90+ Days</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(report.aging_summary) && report.aging_summary.length ? (
                    report.aging_summary.map((row) => (
                      <tr key={row.party_id || row.party_name} className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-medium text-slate-900">{row.party_name}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatMoney(row.total_outstanding, currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">{formatMoney(row.current, currency)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{formatMoney(row.bucket_0_30, currency)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{formatMoney(row.bucket_31_60, currency)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{formatMoney(row.bucket_61_90, currency)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{formatMoney(row.bucket_above_90, currency)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                        No outstanding balances found for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card className="p-10 text-center text-sm text-slate-500">
          Choose party type, filters, and Generate Report to view the statement and aging summary.
        </Card>
      )}
    </div>
  );
}
