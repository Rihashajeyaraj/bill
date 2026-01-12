import React from "react";
import clsx from "clsx";

export default function FormField({ label, hint, children, className }) {
  return (
    <label className={clsx("block", className)}>
      <div className="flex items-end justify-between">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
      <div className="mt-2">{children}</div>
    </label>
  );
}
