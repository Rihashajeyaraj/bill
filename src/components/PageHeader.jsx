import React from "react";
import clsx from "clsx";

export default function PageHeader({ title, subtitle, right, className }) {
  return (
    <div className={clsx("mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}
