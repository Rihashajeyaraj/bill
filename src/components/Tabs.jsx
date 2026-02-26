import React from "react";
import clsx from "clsx";

export default function Tabs({ tabs, value, onChange }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="inline-flex min-w-max rounded-2xl border app-tabs-wrap p-1 shadow-soft">
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              className={clsx(
                "px-3.5 py-2 text-sm font-semibold rounded-xl transition",
                active ? "app-tabs-active" : "app-tabs-item"
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
