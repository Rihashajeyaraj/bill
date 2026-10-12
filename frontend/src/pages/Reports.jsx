import React, { useState, useEffect, useMemo, useCallback } from "react";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Wallet,
  PiggyBank,
  AlertCircle,
  FileText,
  Receipt,
  Search,
  RotateCcw,
  Printer,
  FileDown,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Filter,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  Phone,
  Hash,
  RefreshCw
} from "lucide-react";
import Card from "../components/Card";
import DateInput from "../components/DateInput";
import PageHeader from "../components/PageHeader";
import { useOrganization } from "../context/OrganizationContext";
import { useFinancialYears } from "../context/FinancialYearContext";
import { useToast } from "../context/ToastContext";
import { apiClient } from "../services/apiClient";
import { exportReportExcel, exportReportPdf, printReport } from "../modules/reports/reportExport";
import { authGetRole } from "../services/auth.service";
import { isAccounterRole, isOwnerRole } from "../services/roles";
import { formatMoney } from "../modules/parties/utils";
import { REPORT_TYPES } from "../data/reports";

function isAuthorizedReportRole(role) {
  return isOwnerRole(role) || isAccounterRole(role);
}

// Strictly format all displayed dates as DD/MM/YYYY
export function formatDateDDMMYYYY(val) {
  if (!val || val === "-" || val === "null" || val === "undefined") return "-";
  const s = String(val).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (s.includes("-")) {
    const parts = s.slice(0, 10).split("-");
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }
  return s;
}

const REPORT_ICONS = {
  "customer-wise": Users,
  "payment-wise": Wallet,
  "advances": PiggyBank,
  "balance-due": AlertCircle,
  "proforma": FileText,
  "tax-invoices": Receipt
};

export default function Reports() {
  const role = authGetRole();
  const canAccess = isAuthorizedReportRole(role);
  const toast = useToast();
  const { currency = "INR" } = useOrganization();
  const { years, selectedYear, selectFinancialYear, activeRange } = useFinancialYears();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active report tab
  const activeReport = useMemo(() => {
    const r = searchParams.get("report");
    const valid = REPORT_TYPES.some((t) => t.id === r);
    return valid ? r : "customer-wise";
  }, [searchParams]);

  // Filters state
  const [fromDate, setFromDate] = useState(activeRange?.fromDate || "");
  const [toDate, setToDate] = useState(activeRange?.toDate || "");
  const [customerId, setCustomerId] = useState("");
  const [invoiceType, setInvoiceType] = useState("");
  const [status, setStatus] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [includePaid, setIncludePaid] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Staged search input
  const [stagedSearch, setStagedSearch] = useState("");

  // Customer row accordion expanded state
  const [expandedCustomerIds, setExpandedCustomerIds] = useState(new Set());

  // Update dates when active financial year range changes
  useEffect(() => {
    if (activeRange?.fromDate) setFromDate(activeRange.fromDate);
    if (activeRange?.toDate) setToDate(activeRange.toDate);
  }, [activeRange?.fromDate, activeRange?.toDate]);

  // Fetch Customers list for customer filter dropdown
  const { data: customerList = [] } = useQuery({
    queryKey: ["customers-dropdown"],
    queryFn: async () => {
      try {
        const res = await apiClient.getParties("customer");
        return Array.isArray(res) ? res : res?.data || [];
      } catch (e) {
        return [];
      }
    },
    staleTime: 60000
  });

  // Switch report tab
  const handleSelectReport = (reportId) => {
    setSearchParams({ report: reportId });
    setExpandedCustomerIds(new Set());
  };

  // Build query params for report endpoint
  const reportParams = useMemo(() => {
    const params = {
      start_date: fromDate || undefined,
      end_date: toDate || undefined,
      customer_id: customerId || undefined,
      q: searchQuery || undefined
    };

    if (activeReport === "balance-due") {
      params.invoice_type = invoiceType || undefined;
      params.status = status || undefined;
      params.include_paid = includePaid ? "true" : undefined;
    } else if (activeReport === "payment-wise") {
      params.payment_mode = paymentMode || undefined;
    } else if (activeReport === "proforma" || activeReport === "tax-invoices") {
      params.status = status || undefined;
    }

    return params;
  }, [activeReport, fromDate, toDate, customerId, searchQuery, invoiceType, status, paymentMode, includePaid]);

  // Query server for active report data
  const {
    data: reportResult,
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ["report-data", activeReport, reportParams],
    queryFn: async () => {
      switch (activeReport) {
        case "customer-wise":
          return await apiClient.getCustomerWiseReport(reportParams);
        case "payment-wise":
          return await apiClient.getPaymentsReport(reportParams);
        case "advances":
          return await apiClient.getAdvanceReceivedReport(reportParams);
        case "balance-due":
          return await apiClient.getBalanceDueReport(reportParams);
        case "proforma":
          return await apiClient.getProformaReport(reportParams);
        case "tax-invoices":
          return await apiClient.getTaxInvoicesReport(reportParams);
        default:
          return await apiClient.getCustomerWiseReport(reportParams);
      }
    },
    enabled: canAccess,
    keepPreviousData: true
  });

  const summary = reportResult?.summary || {};
  const rows = reportResult?.data || [];

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeReport, reportParams]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);

  // Toggle Customer Row expansion
  const toggleCustomerExpand = (cid) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  // Reset filters
  const handleResetFilters = () => {
    setFromDate(activeRange?.fromDate || "");
    setToDate(activeRange?.toDate || "");
    setCustomerId("");
    setInvoiceType("");
    setStatus("");
    setPaymentMode("");
    setIncludePaid(false);
    setSearchQuery("");
    setStagedSearch("");
  };

  // Apply search
  const handleApplyFilters = () => {
    setSearchQuery(stagedSearch.trim());
  };

  // Export & Print handler
  const handleExport = (exportType) => {
    const currentMeta = REPORT_TYPES.find((t) => t.id === activeReport) || REPORT_TYPES[0];
    
    // Build summary rows for export
    let exportSummary = [];
    let exportColumns = [];
    let exportRows = [];

    if (activeReport === "customer-wise") {
      exportSummary = [
        { label: "Total Customers", value: summary.total_customers ?? rows.length },
        { label: "Total Invoice Amount", value: formatMoney(summary.total_invoice_amount, currency) },
        { label: "Total Received", value: formatMoney(summary.total_amount_received, currency) },
        { label: "Total Outstanding", value: formatMoney(summary.total_outstanding, currency) }
      ];
      exportColumns = [
        { label: "Customer Name" },
        { label: "Phone" },
        { label: "GSTIN" },
        { label: "Pro Forma Count" },
        { label: "Tax Invoice Count" },
        { label: "Total Invoice Amount" },
        { label: "Advance Received" },
        { label: "Additional Payments" },
        { label: "Total Received" },
        { label: "Balance Due" }
      ];
      exportRows = rows.map((r) => [
        r.customer_name || "-",
        r.phone || "-",
        r.gstin || "-",
        r.proforma_count ?? 0,
        r.tax_invoice_count ?? 0,
        formatMoney(r.total_invoice_amount, currency),
        formatMoney(r.advance_received, currency),
        formatMoney(r.additional_payments_received, currency),
        formatMoney(r.total_received, currency),
        formatMoney(r.balance_due, currency)
      ]);
    } else if (activeReport === "payment-wise") {
      exportSummary = [
        { label: "Receipt Count", value: summary.receipt_count ?? rows.length },
        { label: "Total Payments Received", value: formatMoney(summary.total_payments_received, currency) },
        { label: "Cash Received", value: formatMoney(summary.cash_received, currency) },
        { label: "Bank / UPI Received", value: formatMoney(summary.bank_upi_received, currency) }
      ];
      exportColumns = [
        { label: "Payment Date" },
        { label: "Receipt Number" },
        { label: "Customer Name" },
        { label: "Invoice Number" },
        { label: "Payment Method" },
        { label: "Reference Number" },
        { label: "Amount Received" },
        { label: "Notes" }
      ];
      exportRows = rows.map((r) => [
        formatDateDDMMYYYY(r.payment_date),
        r.receipt_number || "-",
        r.customer_name || "-",
        r.invoice_number || "-",
        r.payment_method || "-",
        r.reference_number || "-",
        formatMoney(r.amount_received, currency),
        r.notes || "-"
      ]);
    } else if (activeReport === "advances") {
      exportSummary = [
        { label: "Total Advances Received", value: formatMoney(summary.total_advances_received, currency) },
        { label: "Advance Receipts Count", value: summary.advance_receipts_count ?? rows.length },
        { label: "Advances Applied to Tax Invoices", value: formatMoney(summary.advances_applied_to_tax_invoices, currency) },
        { label: "Unapplied Advance Balance", value: formatMoney(summary.unapplied_advance_balance, currency) }
      ];
      exportColumns = [
        { label: "Receipt Date" },
        { label: "Pro Forma Invoice No" },
        { label: "Customer Name" },
        { label: "Invoice Total" },
        { label: "Advance Received" },
        { label: "Advance Applied" },
        { label: "Remaining Balance" },
        { label: "Tax Invoice Number" },
        { label: "Status" }
      ];
      exportRows = rows.map((r) => [
        formatDateDDMMYYYY(r.receipt_date),
        r.proforma_invoice_no || "-",
        r.customer_name || "-",
        formatMoney(r.invoice_total, currency),
        formatMoney(r.advance_received, currency),
        formatMoney(r.advance_applied, currency),
        formatMoney(r.remaining_balance, currency),
        r.tax_invoice_number || "-",
        r.status || "-"
      ]);
    } else if (activeReport === "balance-due") {
      exportSummary = [
        { label: "Total Outstanding", value: formatMoney(summary.total_outstanding, currency) },
        { label: "Overdue Amount", value: formatMoney(summary.overdue_amount, currency) },
        { label: "Unpaid Invoices", value: summary.unpaid_invoices_count ?? 0 },
        { label: "Partially Paid Invoices", value: summary.partially_paid_invoices_count ?? 0 }
      ];
      exportColumns = [
        { label: "Invoice Date" },
        { label: "Invoice Number" },
        { label: "Invoice Type" },
        { label: "Customer Name" },
        { label: "Invoice Total" },
        { label: "Advance Received" },
        { label: "Additional Payments" },
        { label: "Total Received" },
        { label: "Balance Due" },
        { label: "Due Date" },
        { label: "Days Overdue" },
        { label: "Status" }
      ];
      exportRows = rows.map((r) => [
        formatDateDDMMYYYY(r.invoice_date),
        r.invoice_number || "-",
        r.invoice_type || "-",
        r.customer_name || "-",
        formatMoney(r.invoice_total, currency),
        formatMoney(r.advance_received, currency),
        formatMoney(r.additional_payments_received, currency),
        formatMoney(r.total_received, currency),
        formatMoney(r.balance_due, currency),
        formatDateDDMMYYYY(r.due_date),
        r.days_overdue > 0 ? `${r.days_overdue} days` : "-",
        r.payment_status || "-"
      ]);
    } else if (activeReport === "proforma") {
      exportSummary = [
        { label: "Total Pro Forma Invoices", value: summary.total_proforma_invoices ?? rows.length },
        { label: "Total Pro Forma Value", value: formatMoney(summary.total_proforma_value, currency) },
        { label: "Total Advances Received", value: formatMoney(summary.total_advances_received, currency) },
        { label: "Converted to Tax Invoices", value: summary.converted_count ?? 0 },
        { label: "Pending Conversion", value: summary.pending_conversion_count ?? 0 }
      ];
      exportColumns = [
        { label: "Pro Forma Number" },
        { label: "Invoice Date" },
        { label: "Valid Till" },
        { label: "Customer Name" },
        { label: "Total Before Tax" },
        { label: "GST Amount" },
        { label: "Invoice Total" },
        { label: "Advance Received" },
        { label: "Balance Payable" },
        { label: "Conversion Status" },
        { label: "Converted Tax Invoice" }
      ];
      exportRows = rows.map((r) => [
        r.proforma_number || "-",
        formatDateDDMMYYYY(r.invoice_date),
        formatDateDDMMYYYY(r.valid_till),
        r.customer_name || "-",
        formatMoney(r.total_before_tax, currency),
        formatMoney(r.gst_amount, currency),
        formatMoney(r.invoice_total, currency),
        formatMoney(r.advance_received, currency),
        formatMoney(r.balance_payable, currency),
        r.conversion_status || "-",
        r.converted_tax_invoice_number || "-"
      ]);
    } else if (activeReport === "tax-invoices") {
      exportSummary = [
        { label: "Tax Invoices", value: summary.total_tax_invoices ?? rows.length },
        { label: "Total Taxable Value", value: formatMoney(summary.total_taxable_value, currency) },
        { label: "Total GST", value: formatMoney(summary.total_gst, currency) },
        { label: "Total Invoice Value", value: formatMoney(summary.total_invoice_value, currency) },
        { label: "Total Received", value: formatMoney(summary.total_received, currency) },
        { label: "Total Outstanding", value: formatMoney(summary.total_outstanding, currency) }
      ];
      exportColumns = [
        { label: "Invoice Number" },
        { label: "Invoice Date" },
        { label: "Customer Name" },
        { label: "GSTIN" },
        { label: "Taxable Amount" },
        { label: "CGST" },
        { label: "SGST" },
        { label: "IGST" },
        { label: "Total GST" },
        { label: "Invoice Total" },
        { label: "Advance Received" },
        { label: "Additional Payments" },
        { label: "Balance Due" },
        { label: "Due Date" },
        { label: "Status" }
      ];
      exportRows = rows.map((r) => [
        r.invoice_number || "-",
        formatDateDDMMYYYY(r.invoice_date),
        r.customer_name || "-",
        r.customer_gstin || "-",
        formatMoney(r.taxable_amount, currency),
        formatMoney(r.cgst, currency),
        formatMoney(r.sgst, currency),
        formatMoney(r.igst, currency),
        formatMoney(r.total_gst, currency),
        formatMoney(r.invoice_total, currency),
        formatMoney(r.advance_received, currency),
        formatMoney(r.additional_payments, currency),
        formatMoney(r.balance_due, currency),
        formatDateDDMMYYYY(r.due_date),
        r.payment_status || "-"
      ]);
    }

    const payload = {
      title: currentMeta.label,
      subtitle: currentMeta.description,
      filename: `${currentMeta.id}-report`,
      summary: exportSummary,
      sections: [
        {
          title: currentMeta.label,
          columns: exportColumns,
          rows: exportRows
        }
      ]
    };

    if (exportType === "print") printReport(payload);
    else if (exportType === "pdf") exportReportPdf(payload);
    else if (exportType === "excel") exportReportExcel(payload);
  };

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <PageHeader title="Reports & Analytics" subtitle="Access restricted to Organization Owners and Accountants." />
        <Card className="mt-6 p-8 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <h3 className="mt-4 text-lg font-bold text-slate-800">Permission Denied</h3>
          <p className="mt-2 text-sm text-slate-500">You do not have sufficient permissions to view Billing & Payment Reports.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* 1. Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">
            View customer billing, invoice transactions, advance receipts and outstanding balances.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport("print")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            title="Print Report"
          >
            <Printer className="h-4 w-4 text-slate-500" />
            <span>Print</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport("pdf")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            title="Export PDF"
          >
            <FileDown className="h-4 w-4 text-rose-500" />
            <span>Export PDF</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport("excel")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            title="Export Excel"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            title="Refresh Data"
          >
            <RefreshCw className={clsx("h-4 w-4", isFetching && "animate-spin text-slate-900")} />
          </button>
        </div>
      </div>

      {/* 2. Report Selector Tabs */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-full items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5 text-xs font-medium sm:min-w-0">
          {REPORT_TYPES.map((tab) => {
            const Icon = REPORT_ICONS[tab.id] || FileText;
            const isActive = tab.id === activeReport;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectReport(tab.id)}
                className={clsx(
                  "flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-150",
                  isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                )}
              >
                <Icon className={clsx("h-4 w-4", isActive ? "text-emerald-600" : "text-slate-400")} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Common Filters Bar */}
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {/* Financial Year Filter */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Financial Year</label>
            <select
              value={selectedYear?.id || ""}
              onChange={(e) => {
                const yr = years.find((y) => y.id === e.target.value);
                if (yr) {
                  selectFinancialYear(yr);
                  if (yr.startDate) setFromDate(yr.startDate);
                  if (yr.endDate) setToDate(yr.endDate);
                }
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label || y.name}
                </option>
              ))}
            </select>
          </div>

          {/* Customer Filter */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Customer</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            >
              <option value="">All Customers</option>
              {customerList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name || c.name || "Customer"}
                </option>
              ))}
            </select>
          </div>

          {/* From Date Filter */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">From Date</label>
            <DateInput
              value={fromDate}
              onChange={setFromDate}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none"
            />
          </div>

          {/* To Date Filter */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">To Date</label>
            <DateInput
              value={toDate}
              onChange={setToDate}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none"
            />
          </div>

          {/* Contextual Filter: Invoice Type (for Balance Due) */}
          {activeReport === "balance-due" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Invoice Type</label>
              <select
                value={invoiceType}
                onChange={(e) => setInvoiceType(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              >
                <option value="">All Types</option>
                <option value="invoice">Tax Invoice</option>
                <option value="proforma">Pro Forma</option>
              </select>
            </div>
          ) : null}

          {/* Contextual Filter: Payment Mode (for Payment-wise) */}
          {activeReport === "payment-wise" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              >
                <option value="">All Modes</option>
                <option value="cash">Cash</option>
                <option value="bank transfer">Bank Transfer</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          ) : null}

          {/* Contextual Filter: Payment Status (for Balance Due, Tax Invoices) */}
          {activeReport === "balance-due" || activeReport === "tax-invoices" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Payment Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              >
                <option value="">All Statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="overdue">Overdue</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          ) : null}

          {/* Contextual Filter: Conversion Status (for Pro Forma) */}
          {activeReport === "proforma" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Conversion Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_conversion">Pending Conversion</option>
                <option value="converted">Converted</option>
              </select>
            </div>
          ) : null}

          {/* Search by Customer Name or Invoice Number */}
          <div className="sm:col-span-2 lg:col-span-2 xl:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={stagedSearch}
                onChange={(e) => setStagedSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApplyFilters();
                }}
                placeholder="Search by customer name, invoice no..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Bottom row: Balance Due toggle and action buttons */}
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {activeReport === "balance-due" && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includePaid}
                  onChange={(e) => setIncludePaid(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <span>Include Fully Paid Invoices</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyFilters}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <Filter className="h-3.5 w-3.5" />
              <span>Apply Filters</span>
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </Card>

      {/* Error state with retry */}
      {error ? (
        <Card className="border-rose-200 bg-rose-50/50 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
          <h4 className="mt-2 text-sm font-semibold text-rose-800">Failed to load report data</h4>
          <p className="mt-1 text-xs text-rose-600">{error?.message || "An unexpected error occurred while communicating with the server."}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </button>
        </Card>
      ) : null}

      {/* 4. Dynamic Summary Cards per Report */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        {activeReport === "customer-wise" && (
          <>
            <SummaryCard label="Total Customers" value={summary.total_customers ?? rows.length} />
            <SummaryCard label="Total Invoice Amount" value={formatMoney(summary.total_invoice_amount, currency)} />
            <SummaryCard label="Total Received" value={formatMoney(summary.total_amount_received, currency)} tone="positive" />
            <SummaryCard label="Total Outstanding" value={formatMoney(summary.total_outstanding, currency)} tone={summary.total_outstanding > 0 ? "negative" : "default"} />
          </>
        )}

        {activeReport === "payment-wise" && (
          <>
            <SummaryCard label="Number of Receipts" value={summary.receipt_count ?? rows.length} />
            <SummaryCard label="Total Payments Received" value={formatMoney(summary.total_payments_received, currency)} tone="positive" />
            <SummaryCard label="Cash Received" value={formatMoney(summary.cash_received, currency)} />
            <SummaryCard label="Bank / UPI Received" value={formatMoney(summary.bank_upi_received, currency)} />
          </>
        )}

        {activeReport === "advances" && (
          <>
            <SummaryCard label="Total Advances Received" value={formatMoney(summary.total_advances_received, currency)} tone="positive" />
            <SummaryCard label="Number of Advance Receipts" value={summary.advance_receipts_count ?? rows.length} />
            <SummaryCard label="Advances Applied to Tax Invoices" value={formatMoney(summary.advances_applied_to_tax_invoices, currency)} />
            <SummaryCard label="Unapplied Advance Balance" value={formatMoney(summary.unapplied_advance_balance, currency)} tone="warning" />
          </>
        )}

        {activeReport === "balance-due" && (
          <>
            <SummaryCard label="Total Outstanding" value={formatMoney(summary.total_outstanding, currency)} tone={summary.total_outstanding > 0 ? "negative" : "default"} />
            <SummaryCard label="Overdue Amount" value={formatMoney(summary.overdue_amount, currency)} tone={summary.overdue_amount > 0 ? "negative" : "default"} />
            <SummaryCard label="Unpaid Invoices" value={summary.unpaid_invoices_count ?? 0} />
            <SummaryCard label="Partially Paid Invoices" value={summary.partially_paid_invoices_count ?? 0} />
          </>
        )}

        {activeReport === "proforma" && (
          <>
            <SummaryCard label="Total Pro Forma Invoices" value={summary.total_proforma_invoices ?? rows.length} />
            <SummaryCard label="Total Pro Forma Value" value={formatMoney(summary.total_proforma_value, currency)} />
            <SummaryCard label="Advances Received" value={formatMoney(summary.total_advances_received, currency)} tone="positive" />
            <SummaryCard label="Converted / Pending" value={`${summary.converted_count ?? 0} / ${summary.pending_conversion_count ?? 0}`} />
          </>
        )}

        {activeReport === "tax-invoices" && (
          <>
            <SummaryCard label="Tax Invoices" value={summary.total_tax_invoices ?? rows.length} />
            <SummaryCard label="Total Taxable Value" value={formatMoney(summary.total_taxable_value, currency)} />
            <SummaryCard label="Total GST" value={formatMoney(summary.total_gst, currency)} />
            <SummaryCard label="Total Invoice Value" value={formatMoney(summary.total_invoice_value, currency)} tone="positive" />
          </>
        )}
      </div>

      {/* 5. Report Table Content */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="h-8 w-8 animate-spin text-slate-600" />
            <p className="mt-3 text-xs font-semibold text-slate-600">Loading authoritative report data...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-slate-100 p-4 text-slate-400">
              <Search className="h-8 w-8" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-slate-800">No records found</h4>
            <p className="mt-1 text-xs text-slate-500">
              Try adjusting your date range, customer filter, or search term.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {activeReport === "customer-wise" && (
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">
                  <tr>
                    <th className="w-8 px-3 py-3.5"></th>
                    <th className="px-3 py-3.5">Customer Name</th>
                    <th className="px-3 py-3.5">Phone</th>
                    <th className="px-3 py-3.5">GSTIN</th>
                    <th className="px-3 py-3.5 text-center">Pro Forma</th>
                    <th className="px-3 py-3.5 text-center">Tax Invoices</th>
                    <th className="px-3 py-3.5 text-right">Invoice Total</th>
                    <th className="px-3 py-3.5 text-right">Advance Rec.</th>
                    <th className="px-3 py-3.5 text-right">Addl. Payments</th>
                    <th className="px-3 py-3.5 text-right">Total Received</th>
                    <th className="px-3 py-3.5 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedRows.map((row) => {
                    const isExpanded = expandedCustomerIds.has(row.customer_id);
                    return (
                      <React.Fragment key={row.customer_id}>
                        <tr
                          onClick={() => toggleCustomerExpand(row.customer_id)}
                          className={clsx(
                            "cursor-pointer transition hover:bg-slate-50/80",
                            isExpanded && "bg-slate-50/50"
                          )}
                        >
                          <td className="px-3 py-3 text-slate-400">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-700" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            )}
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-900">{row.customer_name || "-"}</td>
                          <td className="px-3 py-3 font-mono text-slate-600">{row.phone || "-"}</td>
                          <td className="px-3 py-3 font-mono text-slate-600">{row.gstin || "-"}</td>
                          <td className="px-3 py-3 text-center">{row.proforma_count}</td>
                          <td className="px-3 py-3 text-center">{row.tax_invoice_count}</td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900">
                            {formatMoney(row.total_invoice_amount, currency)}
                          </td>
                          <td className="px-3 py-3 text-right text-emerald-700 font-medium">
                            {formatMoney(row.advance_received, currency)}
                          </td>
                          <td className="px-3 py-3 text-right text-slate-700 font-medium">
                            {formatMoney(row.additional_payments_received, currency)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-emerald-700">
                            {formatMoney(row.total_received, currency)}
                          </td>
                          <td
                            className={clsx(
                              "px-3 py-3 text-right font-bold",
                              row.balance_due > 0 ? "text-rose-600" : "text-slate-900"
                            )}
                          >
                            {formatMoney(row.balance_due, currency)}
                          </td>
                        </tr>

                        {/* Customer Row Click Detail Expansion */}
                        {isExpanded && (
                          <tr className="bg-slate-50/40">
                            <td colSpan={11} className="px-6 py-4">
                              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                  <p className="text-xs font-bold text-slate-800">
                                    {row.customer_name} — Invoices & Payments History
                                  </p>
                                  <span className="text-[11px] text-slate-500">
                                    {row.invoices?.length || 0} Documents &bull; {row.payments?.length || 0} Receipts
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                  {/* Invoices List */}
                                  <div>
                                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                      Billing Invoices
                                    </p>
                                    {row.invoices && row.invoices.length > 0 ? (
                                      <div className="overflow-hidden rounded-xl border border-slate-100">
                                        <table className="w-full text-left text-[11px]">
                                          <thead className="bg-slate-50 font-semibold text-slate-600">
                                            <tr>
                                              <th className="px-2.5 py-1.5">No</th>
                                              <th className="px-2.5 py-1.5">Type</th>
                                              <th className="px-2.5 py-1.5">Date</th>
                                              <th className="px-2.5 py-1.5 text-right">Total</th>
                                              <th className="px-2.5 py-1.5 text-right">Balance</th>
                                              <th className="px-2.5 py-1.5 text-center">Status</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {row.invoices.map((inv) => (
                                              <tr key={inv.id}>
                                                <td className="px-2.5 py-1.5 font-medium text-slate-900">{inv.invoice_no}</td>
                                                <td className="px-2.5 py-1.5 text-slate-500">{inv.document_type}</td>
                                                <td className="px-2.5 py-1.5 text-slate-600">{formatDateDDMMYYYY(inv.date)}</td>
                                                <td className="px-2.5 py-1.5 text-right font-medium">{formatMoney(inv.grand_total, currency)}</td>
                                                <td className="px-2.5 py-1.5 text-right font-medium text-rose-600">{formatMoney(inv.balance_due, currency)}</td>
                                                <td className="px-2.5 py-1.5 text-center">
                                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                                    {inv.status}
                                                  </span>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-slate-400">No invoices on record for this customer.</p>
                                    )}
                                  </div>

                                  {/* Payments List */}
                                  <div>
                                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                      Payment Receipts
                                    </p>
                                    {row.payments && row.payments.length > 0 ? (
                                      <div className="overflow-hidden rounded-xl border border-slate-100">
                                        <table className="w-full text-left text-[11px]">
                                          <thead className="bg-slate-50 font-semibold text-slate-600">
                                            <tr>
                                              <th className="px-2.5 py-1.5">Receipt No</th>
                                              <th className="px-2.5 py-1.5">Date</th>
                                              <th className="px-2.5 py-1.5">Mode</th>
                                              <th className="px-2.5 py-1.5">Reference</th>
                                              <th className="px-2.5 py-1.5 text-right">Amount</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {row.payments.map((pmt) => (
                                              <tr key={pmt.id}>
                                                <td className="px-2.5 py-1.5 font-medium text-slate-900">{pmt.payment_no}</td>
                                                <td className="px-2.5 py-1.5 text-slate-600">{formatDateDDMMYYYY(pmt.payment_date)}</td>
                                                <td className="px-2.5 py-1.5 text-slate-600">{pmt.payment_mode}</td>
                                                <td className="px-2.5 py-1.5 font-mono text-slate-500">{pmt.reference_no}</td>
                                                <td className="px-2.5 py-1.5 text-right font-semibold text-emerald-700">
                                                  {formatMoney(pmt.amount, currency)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-slate-400">No direct payment receipts recorded.</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}

            {activeReport === "payment-wise" && (
              <table className="w-full min-w-[800px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3.5 py-3.5">Payment Date</th>
                    <th className="px-3.5 py-3.5">Receipt Number</th>
                    <th className="px-3.5 py-3.5">Customer Name</th>
                    <th className="px-3.5 py-3.5">Invoice Number</th>
                    <th className="px-3.5 py-3.5">Payment Method</th>
                    <th className="px-3.5 py-3.5">Reference Number</th>
                    <th className="px-3.5 py-3.5 text-right">Amount Received</th>
                    <th className="px-3.5 py-3.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-3.5 py-3 font-medium text-slate-900">
                        {formatDateDDMMYYYY(row.payment_date)}
                      </td>
                      <td className="px-3.5 py-3 font-semibold text-slate-900">{row.receipt_number || "-"}</td>
                      <td className="px-3.5 py-3 font-medium text-slate-900">{row.customer_name || "-"}</td>
                      <td className="px-3.5 py-3 font-mono text-slate-600">{row.invoice_number || "-"}</td>
                      <td className="px-3.5 py-3 text-slate-600">{row.payment_method || "-"}</td>
                      <td className="px-3.5 py-3 font-mono text-slate-600">{row.reference_number || "-"}</td>
                      <td className="px-3.5 py-3 text-right font-bold text-emerald-700">
                        {formatMoney(row.amount_received, currency)}
                      </td>
                      <td className="max-w-[180px] truncate px-3.5 py-3 text-slate-500" title={row.notes}>
                        {row.notes || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === "advances" && (
              <table className="w-full min-w-[850px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3.5 py-3.5">Receipt / Advance Date</th>
                    <th className="px-3.5 py-3.5">Pro Forma No</th>
                    <th className="px-3.5 py-3.5">Customer Name</th>
                    <th className="px-3.5 py-3.5 text-right">Invoice Total</th>
                    <th className="px-3.5 py-3.5 text-right">Advance Received</th>
                    <th className="px-3.5 py-3.5 text-right">Advance Applied</th>
                    <th className="px-3.5 py-3.5 text-right">Remaining Balance</th>
                    <th className="px-3.5 py-3.5">Tax Invoice No</th>
                    <th className="px-3.5 py-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedRows.map((row, idx) => (
                    <tr key={row.proforma_id || idx} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-3.5 py-3 font-medium text-slate-900">
                        {formatDateDDMMYYYY(row.receipt_date)}
                      </td>
                      <td className="px-3.5 py-3 font-semibold text-slate-900">{row.proforma_invoice_no}</td>
                      <td className="px-3.5 py-3 font-medium text-slate-900">{row.customer_name}</td>
                      <td className="px-3.5 py-3 text-right font-medium text-slate-900">
                        {formatMoney(row.invoice_total, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-emerald-700">
                        {formatMoney(row.advance_received, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-semibold text-slate-800">
                        {formatMoney(row.advance_applied, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-rose-600">
                        {formatMoney(row.remaining_balance, currency)}
                      </td>
                      <td className="px-3.5 py-3 font-mono font-medium text-slate-900">
                        {row.tax_invoice_number || "-"}
                      </td>
                      <td className="px-3.5 py-3 text-center">
                        <span
                          className={clsx(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
                            row.status === "Converted"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-700"
                          )}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === "balance-due" && (
              <table className="w-full min-w-[950px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3.5 py-3.5">Invoice Date</th>
                    <th className="px-3.5 py-3.5">Invoice Number</th>
                    <th className="px-3.5 py-3.5">Invoice Type</th>
                    <th className="px-3.5 py-3.5">Customer Name</th>
                    <th className="px-3.5 py-3.5 text-right">Invoice Total</th>
                    <th className="px-3.5 py-3.5 text-right">Advance Received</th>
                    <th className="px-3.5 py-3.5 text-right">Additional Payments</th>
                    <th className="px-3.5 py-3.5 text-right">Total Received</th>
                    <th className="px-3.5 py-3.5 text-right">Balance Due</th>
                    <th className="px-3.5 py-3.5">Due Date</th>
                    <th className="px-3.5 py-3.5 text-center">Overdue</th>
                    <th className="px-3.5 py-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedRows.map((row) => (
                    <tr key={row.invoice_id} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-3.5 py-3 text-slate-600">
                        {formatDateDDMMYYYY(row.invoice_date)}
                      </td>
                      <td className="px-3.5 py-3 font-semibold text-slate-900">{row.invoice_number}</td>
                      <td className="px-3.5 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {row.invoice_type}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 font-medium text-slate-900">{row.customer_name}</td>
                      <td className="px-3.5 py-3 text-right font-medium text-slate-900">
                        {formatMoney(row.invoice_total, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right text-emerald-700 font-medium">
                        {formatMoney(row.advance_received, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right text-slate-700 font-medium">
                        {formatMoney(row.additional_payments_received, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-semibold text-emerald-700">
                        {formatMoney(row.total_received, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-rose-600">
                        {formatMoney(row.balance_due, currency)}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-slate-600">
                        {formatDateDDMMYYYY(row.due_date)}
                      </td>
                      <td className="px-3.5 py-3 text-center">
                        {row.days_overdue > 0 ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                            {row.days_overdue}d Overdue
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3.5 py-3 text-center">
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            row.payment_status === "Paid"
                              ? "bg-emerald-50 text-emerald-700"
                              : row.payment_status === "Overdue"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : row.payment_status === "Partially Paid"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                          )}
                        >
                          {row.payment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === "proforma" && (
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3.5 py-3.5">Pro Forma Number</th>
                    <th className="px-3.5 py-3.5">Invoice Date</th>
                    <th className="px-3.5 py-3.5">Valid Till</th>
                    <th className="px-3.5 py-3.5">Customer Name</th>
                    <th className="px-3.5 py-3.5 text-right">Total Before Tax</th>
                    <th className="px-3.5 py-3.5 text-right">GST Amount</th>
                    <th className="px-3.5 py-3.5 text-right">Invoice Total</th>
                    <th className="px-3.5 py-3.5 text-right">Advance Received</th>
                    <th className="px-3.5 py-3.5 text-right">Balance Payable</th>
                    <th className="px-3.5 py-3.5 text-center">Status</th>
                    <th className="px-3.5 py-3.5">Converted Tax Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedRows.map((row) => (
                    <tr key={row.proforma_id} className="hover:bg-slate-50/60">
                      <td className="px-3.5 py-3 font-semibold text-slate-900">{row.proforma_number}</td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-slate-600">
                        {formatDateDDMMYYYY(row.invoice_date)}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-3 text-slate-600">
                        {formatDateDDMMYYYY(row.valid_till)}
                      </td>
                      <td className="px-3.5 py-3 font-medium text-slate-900">{row.customer_name}</td>
                      <td className="px-3.5 py-3 text-right font-medium text-slate-800">
                        {formatMoney(row.total_before_tax, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-medium text-slate-800">
                        {formatMoney(row.gst_amount, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-slate-900">
                        {formatMoney(row.invoice_total, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-semibold text-emerald-700">
                        {formatMoney(row.advance_received, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-rose-600">
                        {formatMoney(row.balance_payable, currency)}
                      </td>
                      <td className="px-3.5 py-3 text-center">
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            row.conversion_status === "Converted"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          )}
                        >
                          {row.conversion_status}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 font-mono font-medium text-slate-900">
                        {row.converted_tax_invoice_number || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === "tax-invoices" && (
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/80 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3 py-3.5">Invoice Number</th>
                    <th className="px-3 py-3.5">Invoice Date</th>
                    <th className="px-3 py-3.5">Customer Name</th>
                    <th className="px-3 py-3.5">Customer GSTIN</th>
                    <th className="px-3 py-3.5 text-right">Taxable Amount</th>
                    <th className="px-3 py-3.5 text-right">CGST</th>
                    <th className="px-3 py-3.5 text-right">SGST</th>
                    <th className="px-3 py-3.5 text-right">IGST</th>
                    <th className="px-3 py-3.5 text-right">Total GST</th>
                    <th className="px-3 py-3.5 text-right">Invoice Total</th>
                    <th className="px-3 py-3.5 text-right">Advance / Prev.</th>
                    <th className="px-3 py-3.5 text-right">Addl. Payments</th>
                    <th className="px-3 py-3.5 text-right">Balance Due</th>
                    <th className="px-3 py-3.5">Due Date</th>
                    <th className="px-3 py-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {paginatedRows.map((row) => (
                    <tr key={row.invoice_id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-3 font-semibold text-slate-900">{row.invoice_number}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                        {formatDateDDMMYYYY(row.invoice_date)}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900">{row.customer_name}</td>
                      <td className="px-3 py-3 font-mono text-slate-600">{row.customer_gstin || "-"}</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-800">
                        {formatMoney(row.taxable_amount, currency)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{formatMoney(row.cgst, currency)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{formatMoney(row.sgst, currency)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{formatMoney(row.igst, currency)}</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-800">
                        {formatMoney(row.total_gst, currency)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-900">
                        {formatMoney(row.invoice_total, currency)}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-emerald-700">
                        {formatMoney(row.advance_received, currency)}
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-slate-700">
                        {formatMoney(row.additional_payments, currency)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-rose-600">
                        {formatMoney(row.balance_due, currency)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                        {formatDateDDMMYYYY(row.due_date)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            row.payment_status === "Paid"
                              ? "bg-emerald-50 text-emerald-700"
                              : row.payment_status === "Overdue"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : row.payment_status === "Partially Paid"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                          )}
                        >
                          {row.payment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {rows.length > pageSize && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 px-5 py-3.5 bg-slate-50/60 rounded-b-2xl">
            <div className="text-xs text-slate-500 font-medium">
              Showing <span className="font-semibold text-slate-700">{Math.min((currentPage - 1) * pageSize + 1, rows.length)}</span> to{" "}
              <span className="font-semibold text-slate-700">{Math.min(currentPage * pageSize, rows.length)}</span> of{" "}
              <span className="font-semibold text-slate-700">{rows.length}</span> entries
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 font-medium shadow-sm focus:border-slate-400 focus:outline-none"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition"
                >
                  Prev
                </button>
                <span className="px-2 text-xs font-semibold text-slate-700">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, tone = "default" }) {
  const toneClasses =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50/50 text-emerald-800"
      : tone === "negative"
      ? "border-rose-200 bg-rose-50/50 text-rose-800"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50/50 text-amber-800"
      : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={clsx("overflow-hidden rounded-2xl border p-4 shadow-sm", toneClasses)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{value}</p>
    </div>
  );
}
