import React from "react";
import clsx from "clsx";
import { Check } from "lucide-react";

export default function ThemeCard({ theme, selected, onSelect }) {
  const Icon = theme.icon;

  return (
    <button
      type="button"
      className={clsx("theme-card", selected && "is-selected")}
      style={{
        "--theme-grad-start": theme.gradient?.[0] || "#0f766e",
        "--theme-grad-end": theme.gradient?.[1] || "#22c55e",
        "--theme-accent": theme.accentColor || theme.gradient?.[0] || "#0f766e"
      }}
      onClick={() => onSelect?.(theme)}
    >
      <span className="theme-card__gradient" />
      <div className="theme-card__body">
        <div className="theme-card__topline">
          <span className="theme-card__icon-wrap">
            <Icon className="h-4 w-4" />
          </span>
          <span className={clsx("theme-card__badge", theme.mode === "Dark" && "is-dark")}>
            {theme.mode}
          </span>
        </div>
        <p className="theme-card__title">{theme.name}</p>
      </div>
      <span className={clsx("theme-card__check", selected && "is-visible")} aria-hidden>
        <Check className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
