import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

export default function FormSection({
  title,
  description = "",
  children,
  collapsible = false,
  defaultOpen = true,
  open,
  onToggle,
  className
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = useMemo(
    () => (typeof open === "boolean" ? open : internalOpen),
    [open, internalOpen]
  );

  function handleToggle() {
    if (!collapsible) return;
    const next = !isOpen;
    if (onToggle) onToggle(next);
    else setInternalOpen(next);
  }

  return (
    <section className={clsx("rounded-2xl border border-slate-200 bg-white p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        </div>
        {collapsible ? (
          <button
            type="button"
            onClick={handleToggle}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            aria-expanded={isOpen}
          >
            {isOpen ? "Hide" : "Show"}
            <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", isOpen ? "rotate-180" : "")} />
          </button>
        ) : null}
      </div>
      {isOpen ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
