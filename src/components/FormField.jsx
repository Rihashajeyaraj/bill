import React from "react";
import clsx from "clsx";

export default function FormField({ label, hint, children, className }) {
  return (
    <label className={clsx("block", className)}>
      <div className="flex items-end justify-between">
        <span className="text-sm font-semibold app-main-text">{label}</span>
        {hint ? <span className="text-xs app-muted-text">{hint}</span> : null}
      </div>
      <div className="mt-2">{children}</div>
    </label>
  );
}
