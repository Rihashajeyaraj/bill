import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import ThemeCard from "./ThemeCard";
import { THEME_CATEGORIES, THEME_PRESETS } from "./themePresets";
import "./themeModal.css";

function groupThemes(themes) {
  return THEME_CATEGORIES.map((category) => ({
    category,
    themes: themes.filter((theme) => theme.category === category)
  })).filter((entry) => entry.themes.length > 0);
}

export default function ThemeModal({
  open,
  themes = THEME_PRESETS,
  initialThemeId,
  onClose,
  onApply
}) {
  const groupedThemes = useMemo(() => groupThemes(themes), [themes]);
  const fallbackTheme = themes[0] || null;

  const [selectedId, setSelectedId] = useState(() => initialThemeId || fallbackTheme?.id || "");

  useEffect(() => {
    if (!open) return;
    setSelectedId(initialThemeId || fallbackTheme?.id || "");
  }, [open, initialThemeId, fallbackTheme]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onEsc(event) {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const selectedTheme =
    themes.find((theme) => theme.id === selectedId) || themes.find((theme) => theme.id === initialThemeId) || fallbackTheme;
  const activeTheme = themes.find((theme) => theme.id === initialThemeId) || fallbackTheme;

  function handleApply() {
    if (!selectedTheme) return;
    onApply?.(selectedTheme);
  }

  if (!open) return null;

  return (
    <div className="theme-modal" role="dialog" aria-modal="true" aria-label="Choose Theme">
      <div className="theme-modal__backdrop" onClick={onClose} />
      <div className="theme-modal__panel">
        <div className="theme-modal__header">
          <div>
            <h3 className="theme-modal__title">Choose Theme</h3>
            <p className="theme-modal__subtitle">Pick a visual style for your workspace.</p>
          </div>
          <button type="button" onClick={onClose} className="theme-modal__close" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="theme-modal__current-card">
          <div>
            <p className="theme-modal__muted">Currently Using</p>
            <p className="theme-modal__current-name">{activeTheme?.name || "No theme selected"}</p>
          </div>
          <span className={clsx("theme-modal__badge", activeTheme?.mode === "Dark" && "is-dark")}>
            {activeTheme?.mode || "Light"}
          </span>
        </div>

        <div className="theme-modal__body">
          {groupedThemes.map((group) => (
            <section key={group.category} className="theme-modal__section">
              <p className="theme-modal__section-title">{group.category}</p>
              <div className="theme-modal__grid">
                {group.themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    selected={selectedId === theme.id}
                    onSelect={(nextTheme) => setSelectedId(nextTheme.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="theme-modal__actions">
          <button type="button" className="theme-modal__btn theme-modal__btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="theme-modal__btn theme-modal__btn--primary" onClick={handleApply}>
            Apply Theme
          </button>
        </div>
      </div>
    </div>
  );
}
