import React from "react";
import clsx from "clsx";

interface FlowStepTabsProps {
  steps: string[];
  activeStep: number;
  onChange: (index: number) => void;
}

export default function FlowStepTabs({ steps, activeStep, onChange }: FlowStepTabsProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {steps.map((step, index) => {
          const active = index === activeStep;
          return (
            <button
              key={step}
              type="button"
              onClick={() => onChange(index)}
              className={clsx(
                "rounded-xl px-3 py-2 text-left text-xs font-semibold transition sm:text-sm",
                active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <span className={clsx("mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700")}>
                {index + 1}
              </span>
              {step}
            </button>
          );
        })}
      </div>
    </div>
  );
}
