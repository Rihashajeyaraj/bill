import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatIsoDateToDisplay, parseDateInputToIso } from "../lib/dateUtils";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function parseIsoDate(value) {
  const iso = parseDateInputToIso(value);
  if (!iso) return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    iso,
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3])
  };
}

function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const startWeekDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < startWeekDay; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, iso });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function clampMonth(year, month, delta) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

export default function DateInput({
  value,
  onChange,
  onRawChange,
  placeholder = "DD/MM/YYYY",
  className = "",
  disabled = false,
  min = "",
  max = "",
  ...props
}) {
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const selectedDate = useMemo(() => parseIsoDate(value), [value]);
  const minIso = parseDateInputToIso(min);
  const maxIso = parseDateInputToIso(max);
  const [view, setView] = useState(() => {
    const base = selectedDate || parseIsoDate(new Date().toISOString());
    return { year: base?.year || new Date().getFullYear(), month: base?.month || new Date().getMonth() };
  });

  useEffect(() => {
    if (!selectedDate) return;
    setView({ year: selectedDate.year, month: selectedDate.month });
  }, [selectedDate]);

  useEffect(() => {
    if (!open) return undefined;

    function updatePosition() {
      const anchor = wrapperRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.max(rect.width, 280);
      const viewportWidth = window.innerWidth;
      const left = Math.min(rect.left, Math.max(12, viewportWidth - panelWidth - 12));
      const top = rect.bottom + 8;
      setPanelStyle({
        position: "fixed",
        top: `${top}px`,
        left: `${Math.max(12, left)}px`,
        width: `${panelWidth}px`
      });
    }

    function handlePointerDown(event) {
      if (wrapperRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const displayValue = formatIsoDateToDisplay(value, "");
  const monthCells = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month]);

  function isOutOfRange(iso) {
    if (!iso) return true;
    if (minIso && iso < minIso) return true;
    if (maxIso && iso > maxIso) return true;
    return false;
  }

  function handleToggle() {
    if (disabled) return;
    setOpen((prev) => !prev);
  }

  function handleSelect(iso) {
    if (!iso || isOutOfRange(iso)) return;
    onRawChange?.(iso);
    onChange?.(iso);
    setOpen(false);
  }

  function handleClear(event) {
    event.preventDefault();
    event.stopPropagation();
    onRawChange?.("");
    onChange?.("");
    setOpen(false);
  }

  const panel =
    open && panelStyle
      ? createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="z-[160] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
              <button
                type="button"
                onClick={() => setView((prev) => clampMonth(prev.year, prev.month, -1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-900">{MONTH_LABELS[view.month]}</p>
                <p className="text-xs text-slate-500">{view.year}</p>
              </div>
              <button
                type="button"
                onClick={() => setView((prev) => clampMonth(prev.year, prev.month, 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="px-3 py-3">
              <div className="mb-2 grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="py-1 text-center text-[11px] font-semibold uppercase text-slate-400">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthCells.map((cell, index) => {
                  if (!cell) {
                    return <div key={`empty-${index}`} className="h-10" />;
                  }
                  const selected = cell.iso === selectedDate?.iso;
                  const blocked = isOutOfRange(cell.iso);
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={blocked}
                      onClick={() => handleSelect(cell.iso)}
                      className={`h-10 rounded-xl text-sm transition ${
                        selected
                          ? "bg-blue-600 font-semibold text-white"
                          : blocked
                            ? "cursor-not-allowed text-slate-300"
                            : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3">
              <button
                type="button"
                onClick={handleClear}
                disabled={!value}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className={`${className} flex w-full items-center justify-between text-left ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          {...props}
        >
          <span className={displayValue ? "" : "text-slate-400"}>{displayValue || placeholder}</span>
          <CalendarDays className="ml-3 h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </div>
      {panel}
    </>
  );
}
