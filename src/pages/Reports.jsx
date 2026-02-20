import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Briefcase,
  ClipboardList,
  FileDown,
  LineChart as LineChartIcon,
  Package,
  Printer,
  Receipt,
  Search,
  Users
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";
import Badge from "../components/Badge";
import { useOrganization } from "../context/OrganizationContext";
import { LS_KEYS, lsGet } from "../services/storage";
import { invoicesSyncFromRemote } from "../services/invoices.service";
import { purchasesSyncFromRemote } from "../services/purchases.service";
import { paymentsSyncFromRemote } from "../services/payments.service";
import { expensesSyncFromRemote } from "../services/expenses.service";
import { syncPartiesFromRemote } from "../modules/parties/store";
import { syncItemsFromRemote } from "../modules/items/store";
import { formatMoney, normalizeText } from "../modules/items/utils";
import { useGlobalLoadingBridge } from "../hooks/useGlobalLoadingBridge";

const SCOPE_OPTIONS = ["All", "Sales", "Purchase", "Party", "Item"];

const REPORT_CARDS = [
  {
    id: "sales",
    label: "Sales",
    scope: "Sales",
    description: "Invoice revenue and credit impact.",
    metricLabel: "Net Sales",
    metricValue: 1284000,
    delta: 0.082,
    icon: Receipt
  },
  {
    id: "purchases",
    label: "Purchases",
    scope: "Purchase",
    description: "Bills, debit notes, and spend mix.",
    metricLabel: "Net Purchase",
    metricValue: 844600,
    delta: -0.031,
    icon: Briefcase
  },
  {
    id: "receivables",
    label: "Receivables",
    scope: "Party",
    description: "Customer outstanding and aging.",
    metricLabel: "Outstanding",
    metricValue: 392200,
    delta: 0.054,
    icon: Users
  },
  {
    id: "payables",
    label: "Payables",
    scope: "Party",
    description: "Supplier outstanding and due risk.",
    metricLabel: "Payables",
    metricValue: 266800,
    delta: -0.018,
    icon: Users
  },
  {
    id: "items",
    label: "Items",
    scope: "Item",
    description: "Top items, stock, and margins.",
    metricLabel: "Top Item Sales",
    metricValue: 214200,
    delta: 0.064,
    icon: Package
  },
  {
    id: "parties",
    label: "Parties",
    scope: "Party",
    description: "Top parties and statement health.",
    metricLabel: "Top Party",
    metricValue: 164800,
    delta: 0.041,
    icon: ClipboardList
  }
];

const REPORT_CONTENT = {
  sales: {
    summary: [
      { label: "Gross Sales", value: 1420000, tone: "default" },
      { label: "Credit Given", value: 96000, tone: "warn" },
      { label: "Net Sales", value: 1324000, tone: "success" },
      { label: "Invoice Count", value: 214, tone: "default", format: "count" }
    ],
    chart: {
      type: "line",
      data: [
        { label: "Aug", amount: 182000, count: 32 },
        { label: "Sep", amount: 205000, count: 38 },
        { label: "Oct", amount: 226000, count: 41 },
        { label: "Nov", amount: 214000, count: 36 },
        { label: "Dec", amount: 252000, count: 39 },
        { label: "Jan", amount: 285000, count: 44 }
      ]
    },
    details: {
      columns: [
        { key: "date", label: "Date" },
        { key: "doc", label: "Invoice" },
        { key: "party", label: "Customer" },
        { key: "amount", label: "Amount", align: "right", format: "money" },
        { key: "credit", label: "Credit", align: "right", format: "money" },
        { key: "net", label: "Net", align: "right", format: "money" },
        { key: "status", label: "Status", format: "status" }
      ],
      rows: [
        {
          id: "S-1021",
          date: "2026-02-02",
          doc: "INV-1021",
          party: "Nova Retail",
          amount: 86400,
          credit: 6400,
          net: 80000,
          status: "Paid"
        },
        {
          id: "S-1022",
          date: "2026-02-03",
          doc: "INV-1022",
          party: "Atlas Labs",
          amount: 112000,
          credit: 12000,
          net: 100000,
          status: "Partial"
        },
        {
          id: "S-1023",
          date: "2026-02-04",
          doc: "INV-1023",
          party: "Bright Foods",
          amount: 54000,
          credit: 0,
          net: 54000,
          status: "Paid"
        },
        {
          id: "S-1024",
          date: "2026-02-06",
          doc: "INV-1024",
          party: "Cresta Media",
          amount: 76000,
          credit: 6000,
          net: 70000,
          status: "Pending"
        },
        {
          id: "S-1025",
          date: "2026-02-07",
          doc: "INV-1025",
          party: "Rogue Studio",
          amount: 94000,
          credit: 8000,
          net: 86000,
          status: "Paid"
        }
      ]
    }
  },
  purchases: {
    summary: [
      { label: "Gross Purchase", value: 910000, tone: "default" },
      { label: "Debit Added", value: 64000, tone: "warn" },
      { label: "Net Purchase", value: 846000, tone: "danger" },
      { label: "Bills Pending", value: 48, tone: "default", format: "count" }
    ],
    chart: {
      type: "bar",
      data: [
        { label: "Aug", amount: 124000, count: 18 },
        { label: "Sep", amount: 138000, count: 21 },
        { label: "Oct", amount: 156000, count: 19 },
        { label: "Nov", amount: 142000, count: 20 },
        { label: "Dec", amount: 162000, count: 22 },
        { label: "Jan", amount: 188000, count: 25 }
      ]
    },
    details: {
      columns: [
        { key: "date", label: "Date" },
        { key: "doc", label: "Bill" },
        { key: "party", label: "Supplier" },
        { key: "amount", label: "Amount", align: "right", format: "money" },
        { key: "debit", label: "Debit", align: "right", format: "money" },
        { key: "net", label: "Net", align: "right", format: "money" },
        { key: "status", label: "Status", format: "status" }
      ],
      rows: [
        {
          id: "P-5501",
          date: "2026-02-01",
          doc: "BILL-5501",
          party: "Keystone Supply",
          amount: 92000,
          debit: 8000,
          net: 100000,
          status: "Applied"
        },
        {
          id: "P-5502",
          date: "2026-02-02",
          doc: "BILL-5502",
          party: "Summit Hardware",
          amount: 72000,
          debit: 0,
          net: 72000,
          status: "Paid"
        },
        {
          id: "P-5503",
          date: "2026-02-04",
          doc: "BILL-5503",
          party: "Helios Textiles",
          amount: 110000,
          debit: 6000,
          net: 116000,
          status: "Pending"
        },
        {
          id: "P-5504",
          date: "2026-02-05",
          doc: "BILL-5504",
          party: "Polar Packaging",
          amount: 88000,
          debit: 4000,
          net: 92000,
          status: "Paid"
        }
      ]
    }
  },
  receivables: {
    summary: [
      { label: "Total Outstanding", value: 392200, tone: "danger" },
      { label: "Overdue 60+", value: 84000, tone: "warn" },
      { label: "Partially Paid", value: 0, tone: "default" },
      { label: "Oldest Due", value: 0, tone: "default", format: "days" }
    ],
    chart: {
      type: "pie",
      data: [
        { label: "0-30 days", amount: 164000, count: 34 },
        { label: "31-60 days", amount: 98000, count: 21 },
        { label: "61-90 days", amount: 62000, count: 12 },
        { label: "90+ days", amount: 68200, count: 8 }
      ]
    },
    details: {
      columns: [
        { key: "party", label: "Customer" },
        { key: "invoice", label: "Invoice" },
        { key: "due", label: "Due Date" },
        { key: "amount", label: "Balance", align: "right", format: "money" },
        { key: "bucket", label: "Aging" },
        { key: "status", label: "Status", format: "status" }
      ],
      rows: [
        {
          id: "R-1",
          party: "Nova Retail",
          invoice: "INV-1018",
          due: "2026-02-10",
          amount: 42000,
          paid_amount: 18000,
          bucket: "0-30",
          status: "Partial"
        },
        {
          id: "R-2",
          party: "Atlas Labs",
          invoice: "INV-1009",
          due: "2026-01-20",
          amount: 58000,
          bucket: "31-60",
          status: "Overdue"
        },
        {
          id: "R-3",
          party: "Vento Logistics",
          invoice: "INV-995",
          due: "2025-12-28",
          amount: 22000,
          paid_amount: 12000,
          bucket: "61-90",
          status: "Partial"
        },
        {
          id: "R-4",
          party: "Cresta Media",
          invoice: "INV-986",
          due: "2025-11-25",
          amount: 46200,
          bucket: "90+",
          status: "Overdue"
        }
      ]
    }
  },
  payables: {
    summary: [
      { label: "Supplier Outstanding", value: 266800, tone: "danger" },
      { label: "Due This Week", value: 68000, tone: "warn" },
      { label: "Partially Paid", value: 0, tone: "default" },
      { label: "Oldest Due", value: 0, tone: "default", format: "days" }
    ],
    chart: {
      type: "pie",
      data: [
        { label: "0-30 days", amount: 108000, count: 22 },
        { label: "31-60 days", amount: 76000, count: 15 },
        { label: "61-90 days", amount: 52000, count: 9 },
        { label: "90+ days", amount: 30800, count: 6 }
      ]
    },
    details: {
      columns: [
        { key: "party", label: "Supplier" },
        { key: "bill", label: "Bill" },
        { key: "due", label: "Due Date" },
        { key: "amount", label: "Balance", align: "right", format: "money" },
        { key: "bucket", label: "Aging" },
        { key: "status", label: "Status", format: "status" }
      ],
      rows: [
        {
          id: "P-1",
          party: "Keystone Supply",
          bill: "BILL-5481",
          due: "2026-02-12",
          amount: 38000,
          paid_amount: 14000,
          bucket: "0-30",
          status: "Partial"
        },
        {
          id: "P-2",
          party: "Summit Hardware",
          bill: "BILL-5466",
          due: "2026-01-25",
          amount: 52000,
          bucket: "31-60",
          status: "Overdue"
        },
        {
          id: "P-3",
          party: "Helios Textiles",
          bill: "BILL-5428",
          due: "2025-12-18",
          amount: 32000,
          paid_amount: 9000,
          bucket: "61-90",
          status: "Partial"
        },
        {
          id: "P-4",
          party: "Polar Packaging",
          bill: "BILL-5409",
          due: "2025-11-12",
          amount: 18800,
          bucket: "90+",
          status: "Overdue"
        }
      ]
    }
  },
  tax: {
    summary: [
      { label: "Output Tax", value: 184600, tone: "default" },
      { label: "Input Tax", value: 66200, tone: "default" },
      { label: "Net Payable", value: 118400, tone: "danger" },
      { label: "Filed Coverage", value: 82, tone: "default", format: "percent" }
    ],
    chart: {
      type: "bar",
      data: [
        { label: "Aug", amount: 22000, count: 38 },
        { label: "Sep", amount: 26000, count: 42 },
        { label: "Oct", amount: 24000, count: 40 },
        { label: "Nov", amount: 28000, count: 46 },
        { label: "Dec", amount: 30000, count: 48 },
        { label: "Jan", amount: 32400, count: 51 }
      ]
    },
    details: {
      columns: [
        { key: "rate", label: "Rate" },
        { key: "taxable", label: "Taxable", align: "right", format: "money" },
        { key: "output", label: "Output Tax", align: "right", format: "money" },
        { key: "input", label: "Input Tax", align: "right", format: "money" },
        { key: "net", label: "Net", align: "right", format: "money" }
      ],
      rows: [
        { id: "T-1", rate: "0%", taxable: 84000, output: 0, input: 0, net: 0 },
        { id: "T-2", rate: "5%", taxable: 220000, output: 11000, input: 4200, net: 6800 },
        { id: "T-3", rate: "12%", taxable: 310000, output: 37200, input: 14800, net: 22400 },
        { id: "T-4", rate: "18%", taxable: 420000, output: 75600, input: 18800, net: 56800 }
      ]
    }
  },
  items: {
    summary: [
      { label: "Top Item Sales", value: 214200, tone: "success" },
      { label: "Low Stock Items", value: 6, tone: "warn", format: "count" },
      { label: "Avg Margin", value: 32, tone: "default", format: "percent" },
      { label: "Inventory Value", value: 486000, tone: "default" }
    ],
    chart: {
      type: "bar",
      data: [
        { label: "Aero Chair", amount: 214200, count: 42 },
        { label: "Nimbus Desk", amount: 178500, count: 31 },
        { label: "Flux Lamp", amount: 142800, count: 44 },
        { label: "Orbit Shelf", amount: 119200, count: 26 },
        { label: "Slate Stool", amount: 98600, count: 29 }
      ]
    },
    details: {
      columns: [
        { key: "item", label: "Item" },
        { key: "category", label: "Category" },
        { key: "sold", label: "Units Sold", align: "right", format: "count" },
        { key: "revenue", label: "Revenue", align: "right", format: "money" },
        { key: "margin", label: "Margin", align: "right", format: "percent" },
        { key: "status", label: "Stock", format: "status" }
      ],
      rows: [
        {
          id: "I-1",
          item: "Aero Chair",
          category: "Furniture",
          sold: 42,
          revenue: 214200,
          margin: 34,
          status: "Healthy"
        },
        {
          id: "I-2",
          item: "Nimbus Desk",
          category: "Furniture",
          sold: 31,
          revenue: 178500,
          margin: 28,
          status: "Low"
        },
        {
          id: "I-3",
          item: "Flux Lamp",
          category: "Lighting",
          sold: 44,
          revenue: 142800,
          margin: 38,
          status: "Healthy"
        },
        {
          id: "I-4",
          item: "Orbit Shelf",
          category: "Storage",
          sold: 26,
          revenue: 119200,
          margin: 31,
          status: "Low"
        }
      ]
    }
  },
  parties: {
    summary: [
      { label: "Active Parties", value: 128, tone: "default", format: "count" },
      { label: "Top Customer", value: "-", tone: "success", format: "text" },
      { label: "Top Supplier", value: "-", tone: "danger", format: "text" },
      { label: "New Parties (This Month)", value: 0, tone: "default", format: "count" }
    ],
    chart: {
      type: "line",
      data: [
        { label: "Nova Retail", amount: 164800, count: 12 },
        { label: "Atlas Labs", amount: 142200, count: 9 },
        { label: "Bright Foods", amount: 126400, count: 8 },
        { label: "Cresta Media", amount: 112900, count: 7 },
        { label: "Rogue Studio", amount: 98400, count: 6 }
      ]
    },
    details: {
      columns: [
        { key: "party", label: "Party" },
        { key: "type", label: "Type" },
        { key: "transactions", label: "Transactions", align: "right", format: "count" },
        { key: "value", label: "Value", align: "right", format: "money" },
        { key: "outstanding", label: "Outstanding", align: "right", format: "money" },
        { key: "status", label: "Status", format: "status" }
      ],
      rows: [
        {
          id: "PT-1",
          party: "Nova Retail",
          type: "Customer",
          transactions: 12,
          value: 164800,
          outstanding: 42000,
          created_at: "2026-02-03",
          status: "Healthy"
        },
        {
          id: "PT-2",
          party: "Atlas Labs",
          type: "Customer",
          transactions: 9,
          value: 142200,
          outstanding: 58000,
          created_at: "2026-01-19",
          status: "Attention"
        },
        {
          id: "PT-3",
          party: "Keystone Supply",
          type: "Supplier",
          transactions: 6,
          value: 118600,
          outstanding: 32000,
          created_at: "2026-02-08",
          status: "On Track"
        },
        {
          id: "PT-4",
          party: "Summit Hardware",
          type: "Supplier",
          transactions: 5,
          value: 98600,
          outstanding: 28000,
          created_at: "2025-12-11",
          status: "Attention"
        }
      ]
    }
  }
};

const PIE_COLORS = ["#1f6b45", "#2e8d5a", "#8fbfa7", "#dbe8e2"];

function toLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatIsoAsDmy(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatValue(value, format, currency) {
  if (format === "money") return formatMoney(value, currency);
  if (format === "count") return Number(value ?? 0).toLocaleString();
  if (format === "percent") return `${Number(value ?? 0)}%`;
  if (format === "days") return `${Number(value ?? 0).toLocaleString()} days`;
  if (format === "text") return String(value || "-");
  return value ?? "-";
}

function overdueDaysFromDueDate(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = today.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / (24 * 60 * 60 * 1000)) : 0;
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("paid") || normalized.includes("healthy") || normalized.includes("on track")) {
    return "success";
  }
  if (normalized.includes("overdue") || normalized.includes("low") || normalized.includes("attention")) {
    return "danger";
  }
  if (normalized.includes("partial") || normalized.includes("pending") || normalized.includes("applied")) {
    return "warning";
  }
  return "neutral";
}

function MetricDelta({ delta }) {
  const isUp = delta >= 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold",
        isUp ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(delta * 100).toFixed(1)}%
    </span>
  );
}

function ReportCard({ report, active, currency, onSelect }) {
  const Icon = report.icon || BarChart3;
  return (
    <button
      type="button"
      onClick={() => onSelect(report.id)}
      className={clsx(
        "group w-full rounded-3xl border p-4 text-left shadow-soft transition",
        active
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-emerald-200"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              "flex h-11 w-11 items-center justify-center rounded-2xl",
              active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{report.label}</p>
            <p className="text-xs text-slate-500">{report.description}</p>
          </div>
        </div>
        <MetricDelta delta={report.delta} />
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500">{report.metricLabel}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatMoney(report.metricValue, currency)}
          </p>
        </div>
        <div className="text-xs text-slate-400">Tap to open</div>
      </div>
    </button>
  );
}

function ChartBlock({ type, data, metric, currency }) {
  const isMoney = metric === "amount";
  const valueFormatter = (value) => (isMoney ? formatMoney(value, currency) : value);
  if (type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Tooltip formatter={valueFormatter} />
          <Legend verticalAlign="bottom" height={36} />
          <Pie
            data={data}
            dataKey={metric}
            nameKey="label"
            innerRadius={65}
            outerRadius={110}
            paddingAngle={3}
          >
            {data.map((entry, index) => (
              <Cell key={`${entry.label}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#e2ebe5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={60} />
          <Tooltip formatter={valueFormatter} />
          <Line type="monotone" dataKey={metric} stroke="#1f6b45" strokeWidth={3} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="4 4" stroke="#e2ebe5" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={60} />
        <Tooltip formatter={valueFormatter} />
        <Bar dataKey={metric} radius={[8, 8, 0, 0]} fill="#2e8d5a" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LoadingBlock() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-32 rounded-full bg-slate-200" />
      <div className="h-7 w-40 rounded-full bg-slate-200" />
      <div className="h-32 w-full rounded-2xl bg-slate-200" />
    </div>
  );
}

function parseAmount(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function arrayFromLs(key) {
  const value = lsGet(key, []);
  return Array.isArray(value) ? value : [];
}

function toIsoDate(value) {
  if (!value) return "";
  const raw = String(value);
  if (raw.length >= 10 && raw[4] === "-" && raw[7] === "-") return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

const COUNTRY_ALIAS = {
  india: "india",
  in: "india",
  "sri lanka": "sri lanka",
  lk: "sri lanka",
  sl: "sri lanka",
  uae: "uae",
  ae: "uae",
  usa: "usa",
  us: "usa",
  "united states": "usa",
  uk: "uk",
  gb: "uk",
  "united kingdom": "uk",
  ireland: "ireland",
  ie: "ireland"
};

function normalizeCountryKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return COUNTRY_ALIAS[key] || key;
}

function recordCountry(record) {
  if (!record || typeof record !== "object") return "";
  return (
    record.country ||
    record.countryCode ||
    record?.metadata?.country ||
    record?.companySnapshot?.country ||
    ""
  );
}

function countryMatches(recordValue, targetCountry) {
  const target = normalizeCountryKey(targetCountry);
  const source = normalizeCountryKey(recordValue);
  if (!source) return true;
  return source === target;
}

function dateInRange(dateValue, fromDate, toDate) {
  const iso = toIsoDate(dateValue);
  if (!iso) return false;
  if (fromDate && iso < fromDate) return false;
  if (toDate && iso > toDate) return false;
  return true;
}

function monthLabelFromDate(dateValue) {
  const parsed = new Date(`${toIsoDate(dateValue)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, { month: "short" });
}

function bucketForDays(days) {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function computeDaysOverdue(dueDate) {
  const iso = toIsoDate(dueDate);
  if (!iso) return 0;
  const due = new Date(`${iso}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = today.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / (24 * 60 * 60 * 1000)) : 0;
}

function buildLiveReportContent({ fromDate, toDate, country }) {
  const invoices = arrayFromLs(LS_KEYS.invoices).filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const purchases = arrayFromLs(LS_KEYS.purchases).filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const parties = arrayFromLs(LS_KEYS.parties).filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const items = arrayFromLs(LS_KEYS.items);
  const creditLegacy = arrayFromLs(LS_KEYS.creditNotes).filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const creditPremium = arrayFromLs("creditNotesPremiumV1").filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const debitPremium = arrayFromLs("debitNotesPremiumV1").filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const salesPayments = arrayFromLs("paymentInPremiumV1").filter((row) =>
    countryMatches(recordCountry(row), country)
  );
  const purchasePayments = arrayFromLs("paymentOutPremiumV1").filter((row) =>
    countryMatches(recordCountry(row), country)
  );

  const invoiceRows = invoices.filter((row) =>
    dateInRange(row?.invoiceDate || row?.date || row?.created_at, fromDate, toDate)
  );
  const purchaseRows = purchases.filter((row) =>
    dateInRange(row?.billDate || row?.invoiceDate || row?.date || row?.created_at, fromDate, toDate)
  );

  const creditRows = [...creditLegacy, ...creditPremium].filter((row) =>
    dateInRange(row?.creditDate || row?.creditNoteDate || row?.created_at, fromDate, toDate)
  );
  const debitRows = debitPremium.filter((row) =>
    dateInRange(row?.debitNoteDate || row?.created_at, fromDate, toDate)
  );

  const creditByInvoice = new Map();
  creditRows.forEach((row) => {
    const amount = parseAmount(
      row?.totals?.total ?? row?.totals?.grandTotal ?? row?.totals?.amount ?? row?.amount
    );
    const key = row?.linkedInvoiceId || row?.referenceInvoiceId || row?.linkedInvoiceNo || row?.referenceInvoiceNo;
    if (!key) return;
    creditByInvoice.set(key, (creditByInvoice.get(key) || 0) + amount);
  });

  const debitByBill = new Map();
  debitRows.forEach((row) => {
    const amount = parseAmount(row?.totals?.total ?? row?.totals?.grandTotal ?? row?.amount);
    const key = row?.linkedPurchaseInvoiceId || row?.relatedBillId || row?.linkedPurchaseInvoiceNo;
    if (!key) return;
    debitByBill.set(key, (debitByBill.get(key) || 0) + amount);
  });

  const salesDetailRows = invoiceRows.map((row) => {
    const amount = parseAmount(
      row?.totals?.grandTotal ?? row?.totals?.total ?? row?.grandTotal ?? row?.total
    );
    const balance = Math.max(
      0,
      parseAmount(
        row?.totals?.balance ?? row?.remainingBalance ?? row?.balanceAmount ?? amount
      )
    );
    const credit =
      creditByInvoice.get(row?.id) ||
      creditByInvoice.get(row?.invoiceNo) ||
      0;
    return {
      id: row?.id || row?.invoiceNo,
      date: toIsoDate(row?.invoiceDate || row?.date || row?.created_at),
      doc: row?.invoiceNo || row?.id || "-",
      party: row?.partyName || row?.buyer?.name || "Customer",
      amount,
      credit,
      net: Math.max(0, amount - credit),
      status: balance <= 0 ? "Paid" : balance < amount ? "Partial" : "Pending"
    };
  });

  const purchaseDetailRows = purchaseRows.map((row) => {
    const amount = parseAmount(
      row?.totals?.grandTotal ?? row?.totals?.finalTotal ?? row?.totals?.total ?? row?.grandTotal
    );
    const balance = Math.max(
      0,
      parseAmount(row?.totals?.balance ?? row?.remainingBalance ?? row?.balanceAmount ?? amount)
    );
    const debit =
      debitByBill.get(row?.id) ||
      debitByBill.get(row?.billNumber) ||
      0;
    return {
      id: row?.id || row?.billNumber,
      date: toIsoDate(row?.billDate || row?.invoiceDate || row?.date || row?.created_at),
      doc: row?.billNumber || row?.invoiceNo || row?.id || "-",
      party: row?.partyName || row?.supplierName || "Supplier",
      amount,
      debit,
      net: amount + debit,
      status: balance <= 0 ? "Paid" : balance < amount ? "Partial" : "Pending"
    };
  });

  const receivablesRows = invoiceRows
    .map((row) => {
      const amount = Math.max(
        0,
        parseAmount(
          row?.totals?.balance ?? row?.remainingBalance ?? row?.balanceAmount ?? row?.totals?.grandTotal
        )
      );
      const paidAmount = Math.max(0, parseAmount(row?.totals?.grandTotal) - amount);
      if (amount <= 0) return null;
      const due = toIsoDate(row?.dueDate || row?.invoiceDate || row?.date || row?.created_at);
      const overdueDays = computeDaysOverdue(due);
      return {
        id: row?.id || row?.invoiceNo,
        party: row?.partyName || row?.buyer?.name || "Customer",
        invoice: row?.invoiceNo || row?.id || "-",
        due,
        amount,
        paid_amount: paidAmount,
        bucket: bucketForDays(overdueDays),
        status: overdueDays > 0 ? "Overdue" : paidAmount > 0 ? "Partial" : "Pending"
      };
    })
    .filter(Boolean);

  const payablesRows = purchaseRows
    .map((row) => {
      const amount = Math.max(
        0,
        parseAmount(
          row?.totals?.balance ?? row?.remainingBalance ?? row?.balanceAmount ?? row?.totals?.grandTotal
        )
      );
      const paidAmount = Math.max(0, parseAmount(row?.totals?.grandTotal) - amount);
      if (amount <= 0) return null;
      const due = toIsoDate(row?.dueDate || row?.billDate || row?.date || row?.created_at);
      const overdueDays = computeDaysOverdue(due);
      return {
        id: row?.id || row?.billNumber,
        party: row?.partyName || row?.supplierName || "Supplier",
        bill: row?.billNumber || row?.invoiceNo || row?.id || "-",
        due,
        amount,
        paid_amount: paidAmount,
        bucket: bucketForDays(overdueDays),
        status: overdueDays > 0 ? "Overdue" : paidAmount > 0 ? "Partial" : "Pending"
      };
    })
    .filter(Boolean);

  const salesByMonthMap = new Map();
  salesDetailRows.forEach((row) => {
    const label = monthLabelFromDate(row.date);
    if (!label) return;
    const current = salesByMonthMap.get(label) || { label, amount: 0, count: 0 };
    current.amount += parseAmount(row.amount);
    current.count += 1;
    salesByMonthMap.set(label, current);
  });
  const salesByMonth = Array.from(salesByMonthMap.values());

  const purchasesByMonthMap = new Map();
  purchaseDetailRows.forEach((row) => {
    const label = monthLabelFromDate(row.date);
    if (!label) return;
    const current = purchasesByMonthMap.get(label) || { label, amount: 0, count: 0 };
    current.amount += parseAmount(row.amount);
    current.count += 1;
    purchasesByMonthMap.set(label, current);
  });
  const purchasesByMonth = Array.from(purchasesByMonthMap.values());

  const itemSalesMap = new Map();
  invoiceRows.forEach((row) => {
    const lines = Array.isArray(row?.lines) ? row.lines : [];
    lines.forEach((line) => {
      const key = line?.itemName || line?.name || "Unknown";
      const current = itemSalesMap.get(key) || { sold: 0, revenue: 0 };
      current.sold += parseAmount(line?.qty ?? line?.quantity);
      current.revenue += parseAmount(line?.amount ?? line?.lineTotal ?? line?.net);
      itemSalesMap.set(key, current);
    });
  });

  const itemDetailsRows = Array.from(itemSalesMap.entries())
    .map(([itemName, stat]) => {
      const itemMeta =
        items.find((entry) => String(entry?.name || "").toLowerCase() === String(itemName).toLowerCase()) ||
        {};
      const salesRate = parseAmount(itemMeta?.salesRate ?? itemMeta?.price);
      const purchaseRate = parseAmount(itemMeta?.purchaseRate ?? itemMeta?.metadata?.purchasePrice);
      const margin = salesRate > 0 ? ((salesRate - purchaseRate) / salesRate) * 100 : 0;
      const stock = parseAmount(itemMeta?.stockQty ?? itemMeta?.openingStock ?? itemMeta?.metadata?.openingStock);
      const lowStockThreshold = parseAmount(itemMeta?.lowStockAlert ?? itemMeta?.metadata?.lowStockQty);
      return {
        id: `item_${itemName}`,
        item: itemName,
        category: itemMeta?.category || "General",
        sold: parseAmount(stat.sold),
        revenue: parseAmount(stat.revenue),
        margin: Number(margin.toFixed(2)),
        status: lowStockThreshold > 0 && stock <= lowStockThreshold ? "Low" : "Healthy"
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const partyDetailsRows = parties.map((party) => {
    const type = String(party?.type || "Customer");
    const byName = String(party?.name || "").toLowerCase();
    const byId = String(party?.id || "");
    const sales = salesDetailRows
      .filter((row) => String(row.party || "").toLowerCase() === byName)
      .reduce((sum, row) => sum + parseAmount(row.net), 0);
    const purchase = purchaseDetailRows
      .filter((row) => String(row.party || "").toLowerCase() === byName)
      .reduce((sum, row) => sum + parseAmount(row.net), 0);
    const receivable = receivablesRows
      .filter((row) => String(row.party || "").toLowerCase() === byName)
      .reduce((sum, row) => sum + parseAmount(row.amount), 0);
    const payable = payablesRows
      .filter((row) => String(row.party || "").toLowerCase() === byName)
      .reduce((sum, row) => sum + parseAmount(row.amount), 0);
    const value = type.toLowerCase() === "supplier" ? purchase : sales;
    const outstanding = type.toLowerCase() === "supplier" ? payable : receivable;
    return {
      id: byId || `party_${party?.name || Math.random().toString(16).slice(2)}`,
      party: party?.name || "Party",
      type,
      transactions: type.toLowerCase() === "supplier" ? purchaseDetailRows.length : salesDetailRows.length,
      value,
      outstanding,
      created_at: party?.created_at,
      status: outstanding > 0 ? "Attention" : "Healthy"
    };
  });

  const grossSales = salesDetailRows.reduce((sum, row) => sum + parseAmount(row.amount), 0);
  const totalCredit = salesDetailRows.reduce((sum, row) => sum + parseAmount(row.credit), 0);
  const netSales = grossSales - totalCredit;

  const grossPurchase = purchaseDetailRows.reduce((sum, row) => sum + parseAmount(row.amount), 0);
  const totalDebit = purchaseDetailRows.reduce((sum, row) => sum + parseAmount(row.debit), 0);
  const netPurchase = grossPurchase + totalDebit;

  const totalReceived = salesPayments.reduce(
    (sum, row) => sum + parseAmount(row?.totals?.amountReceived),
    0
  );
  const totalPaid = purchasePayments.reduce(
    (sum, row) => sum + parseAmount(row?.totals?.amountPaid),
    0
  );

  return {
    ...REPORT_CONTENT,
    sales: {
      ...REPORT_CONTENT.sales,
      summary: [
        { label: "Gross Sales", value: grossSales, tone: "default" },
        { label: "Credit Given", value: totalCredit, tone: "warn" },
        { label: "Net Sales", value: netSales, tone: "success" },
        { label: "Invoice Count", value: salesDetailRows.length, tone: "default", format: "count" }
      ],
      chart: { type: "line", data: salesByMonth.length ? salesByMonth : REPORT_CONTENT.sales.chart.data },
      details: { ...REPORT_CONTENT.sales.details, rows: salesDetailRows.length ? salesDetailRows : REPORT_CONTENT.sales.details.rows }
    },
    purchases: {
      ...REPORT_CONTENT.purchases,
      summary: [
        { label: "Gross Purchase", value: grossPurchase, tone: "default" },
        { label: "Debit Added", value: totalDebit, tone: "warn" },
        { label: "Net Purchase", value: netPurchase, tone: "danger" },
        { label: "Bills Pending", value: payablesRows.length, tone: "default", format: "count" }
      ],
      chart: {
        type: "bar",
        data: purchasesByMonth.length ? purchasesByMonth : REPORT_CONTENT.purchases.chart.data
      },
      details: {
        ...REPORT_CONTENT.purchases.details,
        rows: purchaseDetailRows.length ? purchaseDetailRows : REPORT_CONTENT.purchases.details.rows
      }
    },
    receivables: {
      ...REPORT_CONTENT.receivables,
      summary: [
        {
          label: "Total Outstanding",
          value: receivablesRows.reduce((sum, row) => sum + parseAmount(row.amount), 0),
          tone: "danger"
        },
        {
          label: "Overdue 60+",
          value: receivablesRows
            .filter((row) => computeDaysOverdue(row.due) > 60)
            .reduce((sum, row) => sum + parseAmount(row.amount), 0),
          tone: "warn"
        },
        { label: "Collected", value: totalReceived, tone: "default" },
        { label: "Open Invoices", value: receivablesRows.length, tone: "default", format: "count" }
      ],
      details: {
        ...REPORT_CONTENT.receivables.details,
        rows: receivablesRows.length ? receivablesRows : REPORT_CONTENT.receivables.details.rows
      }
    },
    payables: {
      ...REPORT_CONTENT.payables,
      summary: [
        {
          label: "Supplier Outstanding",
          value: payablesRows.reduce((sum, row) => sum + parseAmount(row.amount), 0),
          tone: "danger"
        },
        {
          label: "Due This Week",
          value: payablesRows
            .filter((row) => computeDaysOverdue(row.due) >= 0 && computeDaysOverdue(row.due) <= 7)
            .reduce((sum, row) => sum + parseAmount(row.amount), 0),
          tone: "warn"
        },
        { label: "Payments Out", value: totalPaid, tone: "default" },
        { label: "Open Bills", value: payablesRows.length, tone: "default", format: "count" }
      ],
      details: {
        ...REPORT_CONTENT.payables.details,
        rows: payablesRows.length ? payablesRows : REPORT_CONTENT.payables.details.rows
      }
    },
    items: {
      ...REPORT_CONTENT.items,
      details: {
        ...REPORT_CONTENT.items.details,
        rows: itemDetailsRows.length ? itemDetailsRows.slice(0, 100) : REPORT_CONTENT.items.details.rows
      },
      chart: {
        ...REPORT_CONTENT.items.chart,
        data: itemDetailsRows.length
          ? itemDetailsRows.slice(0, 6).map((row) => ({
              label: row.item,
              amount: row.revenue,
              count: row.sold
            }))
          : REPORT_CONTENT.items.chart.data
      }
    },
    parties: {
      ...REPORT_CONTENT.parties,
      details: {
        ...REPORT_CONTENT.parties.details,
        rows: partyDetailsRows.length ? partyDetailsRows : REPORT_CONTENT.parties.details.rows
      }
    }
  };
}

export default function Reports() {
  const { country = "India", countryCode = "IN", currency = "USD" } = useOrganization();

  const todayIso = toLocalIsoDate(new Date());
  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [scope, setScope] = useState("All");

  const [activeReport, setActiveReport] = useState("sales");
  const [metric, setMetric] = useState("amount");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");
  const [partyTypeFilter, setPartyTypeFilter] = useState("All");
  const [sortConfig, setSortConfig] = useState({ key: "", direction: "asc" });
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  useGlobalLoadingBridge(loading, "reports");

  const scopedReports = useMemo(() => {
    if (scope === "All") return REPORT_CARDS;
    return REPORT_CARDS.filter((report) => report.scope === scope);
  }, [scope]);

  useEffect(() => {
    if (!scopedReports.length) return;
    const exists = scopedReports.some((report) => report.id === activeReport);
    if (!exists) {
      setActiveReport(scopedReports[0].id);
    }
  }, [scopedReports, activeReport]);

  useEffect(() => {
    let mounted = true;
    async function syncReportData() {
      setLoading(true);
      try {
        await Promise.all([
          syncPartiesFromRemote(),
          syncItemsFromRemote(),
          invoicesSyncFromRemote(),
          purchasesSyncFromRemote(),
          paymentsSyncFromRemote(),
          expensesSyncFromRemote()
        ]);
      } catch {
        // Continue with cached local data.
      } finally {
        if (!mounted) return;
        setDataVersion((prev) => prev + 1);
        setLoading(false);
      }
    }
    syncReportData();
    return () => {
      mounted = false;
    };
  }, [fromDate, toDate, country, scope]);

  const reportContent = useMemo(
    () => buildLiveReportContent({ fromDate, toDate, country }),
    [fromDate, toDate, country, dataVersion]
  );

  const activeContent = reportContent?.[activeReport] || REPORT_CONTENT[activeReport];
  const chartLabel = metric === "amount" ? "Amount" : "Count";
  const detailsRows = activeContent?.details?.rows || [];

  const summaryCards = useMemo(() => {
    const base = activeContent?.summary || [];
    if (activeReport === "parties") {
      const activeParties = detailsRows.length;
      const customers = detailsRows.filter((row) => String(row?.type || "").toLowerCase() === "customer");
      const suppliers = detailsRows.filter((row) => String(row?.type || "").toLowerCase() === "supplier");
      const scoreByRow = (row) => Math.max(Number(row?.value ?? 0), Number(row?.outstanding ?? 0));
      const topCustomer = customers.reduce(
        (best, row) => (scoreByRow(row) > scoreByRow(best) ? row : best),
        customers[0] || null
      );
      const topSupplier = suppliers.reduce(
        (best, row) => (scoreByRow(row) > scoreByRow(best) ? row : best),
        suppliers[0] || null
      );
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      const newPartiesThisMonth = detailsRows.filter((row) => {
        const raw = row?.created_at || row?.createdAt;
        if (!raw) return false;
        const createdAt = new Date(raw);
        if (Number.isNaN(createdAt.getTime())) return false;
        return createdAt.getMonth() === thisMonth && createdAt.getFullYear() === thisYear;
      }).length;

      return [
        { label: "Active Parties", value: activeParties, tone: "default", format: "count" },
        { label: "Top Customer", value: topCustomer?.party || "-", tone: "success", format: "text" },
        { label: "Top Supplier", value: topSupplier?.party || "-", tone: "danger", format: "text" },
        { label: "New Parties (This Month)", value: newPartiesThisMonth, tone: "default", format: "count" }
      ];
    }

    if (activeReport !== "receivables" && activeReport !== "payables") return base;

    const partiallyPaidAmount = detailsRows
      .filter((row) => Number(row?.paid_amount ?? row?.paidAmount ?? 0) > 0 && Number(row?.amount ?? 0) > 0)
      .reduce((sum, row) => sum + Number(row?.amount ?? 0), 0);

    const oldestDueDays = detailsRows
      .filter((row) => Number(row?.amount ?? 0) > 0)
      .reduce((max, row) => Math.max(max, overdueDaysFromDueDate(row?.due)), 0);

    const leadLabel = activeReport === "payables" ? "Supplier Outstanding" : "Total Outstanding";
    const secondLabel = activeReport === "payables" ? "Due This Week" : "Overdue 60+";

    return [
      base[0] || { label: leadLabel, value: 0, tone: "danger" },
      base[1] || { label: secondLabel, value: 0, tone: "warn" },
      { label: "Partially Paid", value: partiallyPaidAmount, tone: partiallyPaidAmount > 0 ? "warn" : "default" },
      { label: "Oldest Due", value: oldestDueDays, tone: oldestDueDays >= 60 ? "danger" : "default", format: "days" }
    ];
  }, [activeContent, activeReport, detailsRows]);

  const filteredRows = useMemo(() => {
    const rows = detailsRows;
    const query = normalizeText(detailSearch);
    const searchedRows = query
      ? rows.filter((row) =>
          Object.values(row)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : rows;
    const matchRows =
      activeReport === "parties" && partyTypeFilter !== "All"
        ? searchedRows.filter(
            (row) =>
              String(row?.type || "").toLowerCase() === partyTypeFilter.toLowerCase()
          )
        : searchedRows;

    if (!sortConfig.key) return matchRows;
    const sorted = [...matchRows].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      if (typeof aValue === "number" && typeof bValue === "number") {
        return aValue - bValue;
      }
      return String(aValue ?? "").localeCompare(String(bValue ?? ""));
    });
    return sortConfig.direction === "desc" ? sorted.reverse() : sorted;
  }, [detailsRows, detailSearch, activeReport, partyTypeFilter, sortConfig]);

  function toggleSort(key) {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  }

  const tableColumns = activeContent?.details?.columns || [];

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24">
      <PageHeader
        title="Reports"
        subtitle="Insights - Finance - Performance"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileDown className="h-4 w-4" />
              Export PDF
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Boxes className="h-4 w-4" />
              Export Excel
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        }
      />

      <div className="sticky top-4 z-20 rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-soft backdrop-blur">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[140px]">
              <p className="text-xs font-semibold text-slate-500">Date Range</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    setFromDate(next);
                    if (next && toDate && next > toDate) setToDate(next);
                  }}
                  lang="en-GB"
                  max={toDate || undefined}
                  className="w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    setToDate(next);
                    if (next && fromDate && next < fromDate) setFromDate(next);
                  }}
                  lang="en-GB"
                  min={fromDate || undefined}
                  className="w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500">Country</p>
            <div className="mt-2 w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
              {countryCode} {country}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500">Report Scope</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SCOPE_OPTIONS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setScope(entry)}
                  className={clsx(
                    "rounded-full border px-4 py-2 text-sm font-semibold",
                    scope === entry
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {entry}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {scopedReports.length ? (
          scopedReports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              active={report.id === activeReport}
              currency={currency}
              onSelect={setActiveReport}
            />
          ))
        ) : (
          <Card className="p-6 text-center text-sm text-slate-500">
            No reports available for the selected scope.
          </Card>
        )}
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {REPORT_CARDS.find((report) => report.id === activeReport)?.label}
            </p>
            <p className="text-xs text-slate-500">
              Filters applied: {formatIsoAsDmy(fromDate)} to {formatIsoAsDmy(toDate)} - {countryCode} {country}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMetric("amount")}
              className={clsx(
                "rounded-full border px-4 py-2 text-xs font-semibold",
                metric === "amount"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600"
              )}
            >
              Amount
            </button>
            <button
              type="button"
              onClick={() => setMetric("count")}
              className={clsx(
                "rounded-full border px-4 py-2 text-xs font-semibold",
                metric === "count"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600"
              )}
            >
              Count
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => (
                <div key={`summary-loading-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <LoadingBlock />
                </div>
              ))
            : summaryCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold text-slate-500">{card.label}</p>
                  <p
                    title={card.format === "text" ? String(card.value || "-") : undefined}
                    className={clsx(
                      "mt-2 text-2xl font-bold",
                      card.format === "text" && "truncate whitespace-nowrap text-xl leading-tight",
                      card.tone === "success"
                        ? "text-emerald-600"
                        : card.tone === "danger"
                        ? "text-rose-600"
                        : card.tone === "warn"
                        ? "text-amber-600"
                        : "text-slate-900"
                    )}
                  >
                    {formatValue(card.value, card.format || "money", currency)}
                  </p>
                </div>
              ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Trend ({chartLabel})</p>
                <p className="text-xs text-slate-500">Visual read of the selected report.</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <LineChartIcon className="h-4 w-4" />
                {metric === "amount" ? "Currency" : "Count"}
              </div>
            </div>
            <div className="mt-4">
              {loading ? (
                <LoadingBlock />
              ) : (
                <ChartBlock
                  type={activeContent?.chart?.type}
                  data={activeContent?.chart?.data}
                  metric={metric}
                  currency={currency}
                />
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Highlights</p>
                <Badge tone="success">Auto insights</Badge>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li>Top 3 accounts contribute 54% of the total volume.</li>
                <li>Receivables aging improved by 6 days since last month.</li>
                <li>Tax payable is down 2.7% after input offsets.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Quick Actions</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Export PDF
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Boxes className="h-3.5 w-3.5" />
                  Export Excel
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Details</p>
            <p className="text-xs text-slate-500">Expandable data table with sorting and search.</p>
          </div>
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {detailsOpen ? "Collapse" : "Expand"}
          </button>
        </div>

        {detailsOpen ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={detailSearch}
                  onChange={(event) => setDetailSearch(event.target.value)}
                  placeholder="Search within report"
                  className="w-full rounded-full border border-slate-200 bg-slate-50 px-10 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200"
                />
              </label>
              {activeReport === "parties" ? (
                <select
                  value={partyTypeFilter}
                  onChange={(event) => setPartyTypeFilter(event.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
                >
                  <option value="All">All Parties</option>
                  <option value="Customer">Customer</option>
                  <option value="Supplier">Supplier</option>
                </select>
              ) : null}
              <span className="text-xs text-slate-500">Click row to drill down to source</span>
            </div>

            <div className="overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {tableColumns.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={clsx(
                          "cursor-pointer px-4 py-3 font-semibold text-slate-700",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        <div
                          className={clsx(
                            "flex items-center gap-2",
                            col.align === "right" ? "justify-end" : "justify-start"
                          )}
                        >
                          {col.label}
                          {sortConfig.key === col.key ? (
                            <span className="text-[10px] text-slate-400">
                              {sortConfig.direction === "asc" ? "ASC" : "DESC"}
                            </span>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={tableColumns.length} className="px-4 py-10 text-center text-slate-500">
                        Loading report data...
                      </td>
                    </tr>
                  ) : filteredRows.length ? (
                    filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedRow(row.id)}
                        className={clsx(
                          "border-t border-slate-100 hover:bg-slate-50/70",
                          selectedRow === row.id ? "bg-emerald-50/60" : ""
                        )}
                      >
                        {tableColumns.map((col) => (
                          <td
                            key={`${row.id}-${col.key}`}
                            className={clsx("px-4 py-3", col.align === "right" ? "text-right" : "text-left")}
                          >
                            {col.format === "status" ? (
                              <Badge tone={statusTone(row[col.key])}>{row[col.key]}</Badge>
                            ) : (
                              formatValue(row[col.key], col.format, currency)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={tableColumns.length} className="px-4 py-10 text-center text-slate-500">
                        No data for selected filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Details are collapsed to keep the page fast. Expand to view the sortable report table.
          </div>
        )}
      </Card>
    </div>
  );
}
