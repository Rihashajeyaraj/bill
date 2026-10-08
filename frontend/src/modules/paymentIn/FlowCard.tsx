import React from "react";
import clsx from "clsx";

interface FlowCardProps {
  title?: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}

export default function FlowCard({ title, subtitle, className, children }: FlowCardProps) {
  return (
    <section
      className={clsx(
        "rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-5",
        className
      )}
    >
      {title ? <p className="text-sm font-semibold text-slate-900">{title}</p> : null}
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
