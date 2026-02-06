import React, { useMemo } from "react";
import clsx from "clsx";
import {
  Dot,
  ReceiptIndianRupee,
  FileText,
  BookOpen,
  Layers,
  TrendingUp,
  Percent,
  Wallet,
  Scale,
  Landmark,
  Users,
  ListOrdered,
  ShoppingBag,
  Package,
  Boxes,
  Barcode,
  Tags,
  Banknote,
  BadgePercent,
  ClipboardList
} from "lucide-react";

function getShortLabel(label) {
  return label
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const REPORT_ICONS = {
  sale: ReceiptIndianRupee,
  purchase: FileText,
  "day-book": BookOpen,
  "all-transactions": Layers,
  "profit-loss": TrendingUp,
  "bill-wise-profit": Percent,
  "cash-flow": Wallet,
  "trial-balance": Scale,
  "balance-sheet": Landmark,
  "party-statement": Users,
  "party-wise-profit-loss": TrendingUp,
  "all-parties": ListOrdered,
  "party-report-by-item": ShoppingBag,
  "sale-purchase-by-party": ShoppingBag,
  "sale-purchase-by-party-group": ShoppingBag,
  "stock-summary": Boxes,
  "item-report-by-party": Package,
  "item-wise-profit-loss": TrendingUp,
  "item-category-wise-profit-loss": Tags,
  "low-stock-summary": Boxes,
  "stock-detail": Boxes,
  "item-detail": Barcode,
  "sale-purchase-report-by-item-category": Tags,
  "stock-summary-by-item-category": Tags,
  "item-wise-discount": BadgePercent,
  "bank-statement": Banknote,
  "discount-report": BadgePercent,
  "gst-report": ClipboardList,
  "gst-rate-report": ClipboardList,
  "form-27eq": ClipboardList,
  "tcs-receivable": ClipboardList,
  "tds-payable": ClipboardList,
  "tds-receivable": ClipboardList,
  expense: Wallet,
  "expense-category-report": Wallet,
  "expense-item-report": Wallet,
  "sale-purchase-orders": ClipboardList,
  "sale-purchase-order-item": ClipboardList
};

export default function ReportListItem({ report, active, onSelect, compact }) {
  const shortLabel = useMemo(() => getShortLabel(report.label), [report.label]);
  const Icon = REPORT_ICONS[report.id] || Dot;

  return (
    <button
      type="button"
      title={report.label}
      onClick={() => onSelect(report)}
      className={clsx(
        "w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition",
        active
          ? "bg-emerald-50 text-emerald-900 border border-emerald-100"
          : "hover:bg-slate-50 text-slate-700 border border-transparent"
      )}
    >
      <div
        className={clsx(
          "flex h-8 w-8 items-center justify-center rounded-xl text-xs font-semibold",
          active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
        )}
      >
        {compact ? shortLabel : <Icon className="h-4 w-4" />}
      </div>
      {compact ? null : (
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{report.label}</p>
          <p className="text-xs text-slate-500 truncate">{report.description}</p>
        </div>
      )}
    </button>
  );
}
