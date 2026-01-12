import React from "react";
import clsx from "clsx";
import { UI } from "../theme/tokens";

export default function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex rounded-2xl border border-slate-100 bg-white p-1 shadow-soft">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={clsx(
              "px-3.5 py-2 text-sm font-semibold rounded-xl transition",
              active ? "text-white" : "text-slate-600 hover:bg-slate-50"
            )}
            style={active ? { background: UI.GRADIENT } : {}}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
