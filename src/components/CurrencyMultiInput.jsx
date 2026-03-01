import React, { useState } from "react";
import clsx from "clsx";

const DEFAULT_MAX = 3;

function normalizeCurrency(value) {
  return value.trim().toUpperCase();
}

export default function CurrencyMultiInput({
  value,
  onChange,
  placeholder = "INR",
  max = DEFAULT_MAX,
  error,
  ringColor,
  disabled
}) {
  const [draft, setDraft] = useState("");
  const currencies = Array.isArray(value) ? value : [];
  const atLimit = currencies.length >= max;

  function commitDraft() {
    if (disabled || atLimit) return;
    const next = normalizeCurrency(draft);
    if (!next) return;
    if (currencies.includes(next)) {
      setDraft("");
      return;
    }
    const updated = [...currencies, next].slice(0, max);
    onChange?.(updated);
    setDraft("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    }
    if (e.key === "Backspace" && !draft && currencies.length) {
      onChange?.(currencies.slice(0, -1));
    }
  }

  function removeCurrency(code) {
    if (disabled) return;
    onChange?.(currencies.filter((currency) => currency !== code));
  }

  return (
    <div>
      <div
        className={clsx(
          "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-sm",
          error ? "border-rose-300" : "border-slate-100",
          ringColor ? "focus-within:ring-4" : ""
        )}
        style={ringColor ? { "--tw-ring-color": ringColor } : undefined}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || atLimit}
          className={clsx(
            "flex-1 bg-transparent text-sm outline-none",
            disabled || atLimit ? "text-slate-400" : "text-slate-900"
          )}
        />
        <button
          type="button"
          onClick={commitDraft}
          disabled={disabled || atLimit || !draft.trim()}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {currencies.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {currencies.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
            >
              {code}
              <button
                type="button"
                onClick={() => removeCurrency(code)}
                disabled={disabled}
                className="text-slate-500 hover:text-slate-700"
                aria-label={`Remove ${code}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
