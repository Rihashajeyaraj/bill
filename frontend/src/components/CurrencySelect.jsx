import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { CURRENCY_MASTER, getCurrencyByCode } from "../lib/currencyMaster";

export default function CurrencySelect({
  value = "INR",
  onChange,
  disabled = false,
  placeholder = "Select currency ▼",
  className = ""
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  const selectedCurrency = useMemo(() => getCurrencyByCode(value), [value]);

  // Filter currencies based on search term (code, name, symbol)
  const filteredCurrencies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CURRENCY_MASTER;
    return CURRENCY_MASTER.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Handle outside click to close dropdown
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Auto focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery("");
    }
  }, [isOpen]);

  const handleSelect = (currencyCode) => {
    onChange?.(currencyCode);
    setIsOpen(false);
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* TRIGGER BUTTON (48px Height) */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 flex items-center justify-between text-sm font-medium text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all shadow-2xs ${
          disabled ? "cursor-not-allowed bg-slate-50 text-slate-500" : "hover:border-slate-300"
        } ${className}`}
      >
        <span className="truncate">
          {selectedCurrency
            ? `${selectedCurrency.code} (${selectedCurrency.symbol}) — ${selectedCurrency.name}`
            : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* DROPDOWN MENU */}
      {isOpen && !disabled && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* SEARCH INPUT */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/70">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search currency..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all"
              />
            </div>
          </div>

          {/* CURRENCY LIST */}
          <div className="max-h-60 overflow-y-auto py-1 text-xs divide-y divide-slate-50">
            {filteredCurrencies.length > 0 ? (
              filteredCurrencies.map((c) => {
                const isSelected = c.code === value;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleSelect(c.code)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-sky-50 text-sky-900 font-bold"
                        : "hover:bg-slate-50 text-slate-700 font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-800 font-bold text-xs shrink-0">
                        {c.symbol}
                      </span>
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 mr-1.5">{c.code}</span>
                        <span className="text-slate-500 truncate">{c.name}</span>
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-sky-600 shrink-0" />}
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-4 text-center text-slate-400 italic">
                No matching currencies found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
