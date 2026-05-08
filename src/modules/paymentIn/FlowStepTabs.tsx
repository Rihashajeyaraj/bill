import React from "react";
import clsx from "clsx";

interface FlowStepTabsProps {
  steps: string[];
  activeStep: number;
  onChange: (index: number) => void;
}

export default function FlowStepTabs({ steps, activeStep, onChange }: FlowStepTabsProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <div className="grid grid-cols-3 gap-1">
        {steps.map((step, index) => {
          const active = index === activeStep;
          return (
            <button
              key={step}
              type="button"
              onClick={() => onChange(index)}
              className={clsx(
                "rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold transition sm:text-xs",
                active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <span className={clsx("mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]", active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700")}>
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
