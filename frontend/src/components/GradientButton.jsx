import React from "react";
import clsx from "clsx";

export default function GradientButton({ className, children, ...props }) {
  return (
    <button
      {...props}
      className={clsx(
        "app-gradient-btn inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold",
        "shadow-soft border border-white/30 hover:opacity-95 active:opacity-90 focus:outline-none focus:ring-4",
        className
      )}
    >
      {children}
    </button>
  );
}
