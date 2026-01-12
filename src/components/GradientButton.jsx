import React from "react";
import clsx from "clsx";
import { UI } from "../theme/tokens";

export default function GradientButton({ className, children, ...props }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white",
        "shadow-soft border border-white/30 hover:opacity-95 active:opacity-90 focus:outline-none focus:ring-4",
        className
      )}
      style={{
        background: UI.GRADIENT,
        boxShadow: "0 10px 24px rgba(2,6,23,0.10)",
        outline: "none"
      }}
    >
      {children}
    </button>
  );
}
