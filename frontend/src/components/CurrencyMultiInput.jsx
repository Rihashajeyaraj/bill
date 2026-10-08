import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

const DEFAULT_MAX = 3;
const FALLBACK_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AED",
  "LKR",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "SGD",
  "HKD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "ZAR",
  "SAR",
  "QAR",
  "KWD",
  "OMR",
  "BHD",
  "MYR",
  "THB",
  "IDR",
  "PHP",
  "PKR",
  "BDT",
  "NPR",
  "RUB",
  "BRL",
  "MXN"
];

function normalizeCurrency(value) {
  return value.trim().toUpperCase();
}

function listAllCurrencies() {
  const hasSupportedValues = typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function";
  if (hasSupportedValues) {
    try {
      const values = Intl.supportedValuesOf("currency");
      if (Array.isArray(values) && values.length) {
        return values
          .map((code) => normalizeCurrency(String(code || "")))
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right));
      }
    } catch {
      // Fall back to a static list for older browsers.
    }
  }
  return FALLBACK_CURRENCIES.slice();
}

const ALL_CURRENCIES = listAllCurrencies();

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
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);
  const currencies = Array.isArray(value) ? value : [];
  const atLimit = currencies.length >= max;
  const normalizedCurrencies = useMemo(
    () =>
      Array.from(
        new Set(
          currencies
            .map((code) => normalizeCurrency(String(code || "")))
            .filter(Boolean)
        )
      ),
    [currencies]
  );
  const filteredCurrencies = useMemo(() => {
    const search = normalizeCurrency(draft);
    if (!search) return ALL_CURRENCIES;
    return ALL_CURRENCIES.filter((code) => code.includes(search));
  }, [draft]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleOutside(event) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target)) return;
      setMenuOpen(false);
    }
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  function commitDraft() {
    if (disabled || atLimit) return;
    const next = normalizeCurrency(draft);
    if (!next) return;
    if (!/^[A-Z]{3}$/.test(next)) return;
    if (normalizedCurrencies.includes(next)) {
      setDraft("");
      return;
    }
    const updated = [...normalizedCurrencies, next].slice(0, max);
    onChange?.(updated);
    setDraft("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    }
    if (e.key === "ArrowDown") {
      setMenuOpen(true);
    }
    if (e.key === "Escape") {
      setMenuOpen(false);
    }
    if (e.key === "Backspace" && !draft && normalizedCurrencies.length) {
      onChange?.(normalizedCurrencies.slice(0, -1));
    }
  }

  function removeCurrency(code) {
    if (disabled) return;
    onChange?.(normalizedCurrencies.filter((currency) => currency !== code));
  }

  function toggleCurrency(code) {
    if (disabled) return;
    const normalized = normalizeCurrency(code);
    const exists = normalizedCurrencies.includes(normalized);
    if (exists) {
      onChange?.(normalizedCurrencies.filter((currency) => currency !== normalized));
      return;
    }
    if (normalizedCurrencies.length >= max) return;
    onChange?.([...normalizedCurrencies, normalized]);
  }

  return (
    <div ref={rootRef} className="relative">
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
          onChange={(event) => {
            setDraft(event.target.value);
            setMenuOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setMenuOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setMenuOpen(false), 80)}
          onKeyDown={handleKeyDown}
          placeholder={atLimit ? "Limit reached" : placeholder}
          disabled={disabled}
          className={clsx(
            "flex-1 bg-transparent text-sm outline-none",
            disabled ? "text-slate-400" : "text-slate-900"
          )}
        />
      </div>

      {menuOpen && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
          {filteredCurrencies.length ? (
            filteredCurrencies.map((code) => {
              const selected = normalizedCurrencies.includes(code);
              const limitReached = !selected && atLimit;
              return (
                <button
                  key={code}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    toggleCurrency(code);
                  }}
                  disabled={limitReached}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm",
                    selected
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-700 hover:bg-slate-50",
                    limitReached ? "cursor-not-allowed opacity-50" : ""
                  )}
                >
                  <span>{code}</span>
                  {selected ? <span className="text-[11px] font-semibold">Selected</span> : null}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-2 text-xs text-slate-500">No matching currencies</p>
          )}
        </div>
      ) : null}

      {normalizedCurrencies.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {normalizedCurrencies.map((code) => (
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
