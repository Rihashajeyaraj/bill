import React from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function ReportAccordion({ title, description, count, expanded, onToggle, collapsed, children }) {
  if (collapsed) {
    return <div className="space-y-2">{children}</div>;
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
          <p className="text-xs text-slate-500 truncate">{description}</p>
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5">{count}</span>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
      <div className={clsx("px-2 pb-2 space-y-1", expanded ? "block" : "hidden")}>{children}</div>
    </div>
  );
}
