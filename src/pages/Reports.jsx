import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  TrendingUp,
  Wallet,
  Banknote
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import DataTable from "../components/DataTable";
import Card from "../components/Card";
import StatCard from "../components/StatCard";
import ReportAccordion from "../components/reports/ReportAccordion";
import ReportListItem from "../components/reports/ReportListItem";
import { reportSections } from "../data/reports";
import { UI } from "../theme/tokens";
import clsx from "clsx";

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [expandedSections, setExpandedSections] = useState(() =>
    reportSections.reduce((acc, section) => ({ ...acc, [section.id]: true }), {})
  );

  const activeReportId = searchParams.get("report");

  const flatReports = useMemo(
    () =>
      reportSections.flatMap((section) =>
        section.items.map((item) => ({
          ...item,
          sectionId: section.id,
          sectionTitle: section.title
        }))
      ),
    []
  );

  const activeReport = useMemo(
    () => flatReports.find((report) => report.id === activeReportId) || null,
    [activeReportId, flatReports]
  );

  const filteredSections = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return reportSections;
    }

    return reportSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const blob = [item.label, item.description, ...(item.tags || [])].join(" ").toLowerCase();
          return blob.includes(search);
        })
      }))
      .filter((section) => section.items.length > 0);
  }, [query]);

  const handleSelect = (report) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("report", report.id);
    setSearchParams(nextParams);
  };

  const toggleSection = (sectionId) => {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const reportColumns = activeReport?.columns || [
    { key: "date", header: "Date" },
    { key: "party", header: "Party" },
    { key: "amount", header: "Amount" }
  ];

  const isSaleReport = activeReport?.id === "sale";

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Choose a report from the library to load its data in the workspace."
        right={
          <div className="flex items-center gap-2">
            <button className="h-10 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-white">
              <Filter className="h-4 w-4 inline-flex mr-2" />
              Filters
            </button>
            <button
              className="h-10 rounded-2xl px-4 text-sm font-semibold text-white shadow-soft"
              style={{ background: UI.GRADIENT }}
            >
              <Download className="h-4 w-4 inline-flex mr-2" />
              Export
            </button>
          </div>
        }
      />

      <div
        className={clsx(
          "grid grid-cols-1 gap-5 transition-all duration-300",
          navCollapsed ? "xl:grid-cols-[96px_1fr]" : "xl:grid-cols-[320px_1fr]"
        )}
      >
        <Card className="p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            {navCollapsed ? (
              <div className="h-9 w-9 rounded-2xl flex items-center justify-center bg-emerald-50 text-emerald-700 text-xs font-semibold">
                RP
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-slate-900">Report Library</p>
                <p className="text-xs text-slate-500">Browse by section</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setNavCollapsed((prev) => !prev)}
              className="h-9 w-9 rounded-2xl border border-slate-100 flex items-center justify-center hover:bg-slate-50"
            >
              {navCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <div className={clsx("relative", navCollapsed && "hidden")}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reports"
              className="w-full rounded-2xl border border-slate-100 bg-white px-9 py-2 text-sm outline-none focus:border-emerald-200"
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-1 scroll-smooth max-h-[calc(100vh-280px)]">
            <div className="space-y-3">
              {filteredSections.map((section) => (
                <ReportAccordion
                  key={section.id}
                  title={section.title}
                  description={section.description}
                  count={section.items.length}
                  expanded={expandedSections[section.id]}
                  collapsed={navCollapsed}
                  onToggle={() => toggleSection(section.id)}
                >
                  {section.items.map((report) => (
                    <ReportListItem
                      key={report.id}
                      report={report}
                      compact={navCollapsed}
                      active={activeReport?.id === report.id}
                      onSelect={handleSelect}
                    />
                  ))}
                </ReportAccordion>
              ))}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {!activeReport ? (
            <EmptyState
              icon={BarChart3}
              title="Select a report"
              description="Pick a report from the left panel to load its data in the workspace."
            />
          ) : isSaleReport ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">Transaction report</p>
                  <h2 className="text-2xl font-semibold text-slate-900">Sale Invoices</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button className="h-10 rounded-full bg-rose-500 px-5 text-sm font-semibold text-white shadow-soft hover:bg-rose-600">
                    <Plus className="h-4 w-4 inline-flex mr-2" />
                    Add Sale
                  </button>
                  <button className="h-10 w-10 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                    <Settings className="h-4 w-4 mx-auto" />
                  </button>
                </div>
              </div>

              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-slate-600">Filter by :</span>
                  {["All Sale Invoices", "Pick a date", "All Firms", "All Users"].map((label) => (
                    <button
                      key={label}
                      className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm text-slate-500">Total Sales Amount</p>
                <p className="text-2xl font-semibold text-slate-900">₹ 0</p>
                <div className="mt-2 text-sm text-slate-500">
                  Received: <span className="font-semibold text-slate-700">₹ 0</span> | Balance:{" "}
                  <span className="font-semibold text-slate-700">₹ 0</span>
                </div>
              </Card>

              <Card className="p-8">
                <div className="flex flex-col items-center text-center gap-2">
                  <div className="h-20 w-20 rounded-full bg-blue-100 flex items-center justify-center">
                    <BarChart3 className="h-8 w-8 text-blue-500" />
                  </div>
                  <p className="text-base font-semibold text-slate-800">No Transactions to show</p>
                  <p className="text-sm text-slate-500">You haven't added any transactions yet.</p>
                  <button className="mt-2 rounded-full bg-rose-500 px-6 py-2 text-sm font-semibold text-white hover:bg-rose-600">
                    <Plus className="h-4 w-4 inline-flex mr-2" />
                    Add Sale
                  </button>
                </div>
              </Card>
            </>
          ) : (
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500">{activeReport.sectionTitle}</p>
                    <h2 className="text-xl font-semibold text-slate-900 truncate">{activeReport.label}</h2>
                    <p className="text-sm text-slate-500 mt-1">{activeReport.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="h-9 rounded-2xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <SlidersHorizontal className="h-3.5 w-3.5 inline-flex mr-2" />
                      Customize
                    </button>
                    <button
                      className="h-9 rounded-2xl px-3 text-xs font-semibold text-white"
                      style={{ background: UI.GRADIENT }}
                    >
                      Run Report
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(activeReport.filters || []).map((filter) => (
                    <span
                      key={filter}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                    >
                      {filter}
                    </span>
                  ))}
                </div>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard title="Total Value" value="₹0.00" icon={Wallet} hint="Awaiting report run" />
                <StatCard title="Net Movement" value="₹0.00" icon={TrendingUp} hint="No entries selected" />
                <StatCard title="Opening Balance" value="₹0.00" icon={Banknote} hint="Select a date range" />
              </div>

              <Card className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <SlidersHorizontal className="h-4 w-4" />
                  Configure date range, party, and grouping to populate the table.
                </div>
                <button className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Save View
                </button>
              </Card>

              <DataTable columns={reportColumns} rows={[]} emptyText="No data loaded yet. Run the report to fetch results." />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
