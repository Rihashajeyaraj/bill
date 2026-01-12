import React from "react";
import clsx from "clsx";

export default function Badge({ tone = "neutral", children }) {
  const cls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
      : tone === "warning"
      ? "bg-amber-50 text-amber-700 border-amber-100"
      : tone === "danger"
      ? "bg-rose-50 text-rose-700 border-rose-100"
      : "bg-slate-50 text-slate-700 border-slate-100";

  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", cls)}>
      {children}
    </span>
  );
}
