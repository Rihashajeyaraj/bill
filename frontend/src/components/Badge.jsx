import React from "react";
import clsx from "clsx";

export default function Badge({ tone = "neutral", children }) {
  const cls =
    tone === "success"
      ? "app-badge--success"
      : tone === "warning"
      ? "app-badge--warning"
      : tone === "danger"
      ? "app-badge--danger"
      : "app-badge--neutral";

  return (
    <span className={clsx("app-badge inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", cls)}>
      {children}
    </span>
  );
}
