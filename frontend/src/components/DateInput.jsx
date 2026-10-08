import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { isValidDateParts, parseDateInputToIso } from "../lib/dateUtils";

function isOutOfRange(iso, minIso, maxIso) {
  if (!iso) return false;
  if (minIso && iso < minIso) return true;
  if (maxIso && iso > maxIso) return true;
  return false;
}

function hasFourDigitYearFormat(value) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(value || "").trim());
}

function draftDigitsToIso(digits, requireFourDigitYear = false) {
  const text = String(digits || "").replace(/\D/g, "").slice(0, 8);
  if (requireFourDigitYear) {
    if (text.length !== 8) return "";
  } else if (text.length !== 6 && text.length !== 8) {
    return "";
  }
  const formatted = formatDraftDate(text);
  if (requireFourDigitYear && !hasFourDigitYearFormat(formatted)) return "";
  return parseDateInputToIso(formatted);
}

function formatDraftDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length < 2) return digits;
  if (digits.length === 2) return `${digits}/`;
  if (digits.length < 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

function formatIsoDateToInputDisplay(value, fallback = "") {
  const iso = parseDateInputToIso(value);
  if (!iso) return fallback;
  const [, year, month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  return `${day}/${month}/${year || ""}`;
}

function maxDaysForMonth(month, year = null) {
  if (month === 2) {
    if (typeof year === "number" && Number.isFinite(year)) {
      return isValidDateParts(year, 2, 29) ? 29 : 28;
    }
    return 29;
  }
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month >= 1 && month <= 12) return 31;
  return 0;
}

function isValidPartialDateDigits(digits, requireFourDigitYear = false) {
  const text = String(digits || "").replace(/\D/g, "").slice(0, 8);
  if (!text) return true;

  if (text.length >= 1) {
    const dayTens = Number(text[0]);
    if (dayTens > 3) return false;
  }

  if (text.length >= 2) {
    const day = Number(text.slice(0, 2));
    if (day < 1 || day > 31) return false;
  }

  if (text.length >= 3) {
    const monthTens = Number(text[2]);
    if (monthTens > 1) return false;
  }

  if (text.length >= 4) {
    const day = Number(text.slice(0, 2));
    const month = Number(text.slice(2, 4));
    const maxDay = maxDaysForMonth(month);
    if (month < 1 || month > 12) return false;
    if (day > maxDay) return false;
  }

  if ((!requireFourDigitYear && text.length === 6) || text.length === 8) {
    const day = Number(text.slice(0, 2));
    const month = Number(text.slice(2, 4));
    const year =
      text.length === 8
        ? Number(text.slice(4, 8))
        : (() => {
            const year2 = Number(text.slice(4, 6));
            return year2 >= 70 ? 1900 + year2 : 2000 + year2;
          })();
    if (!isValidDateParts(year, month, day)) return false;
  }

  return true;
}

function sanitizeDraftDigits(value, minIso = "", maxIso = "", requireFourDigitYear = false) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  let accepted = "";
  for (const digit of digits) {
    const candidate = `${accepted}${digit}`;
    if (!isValidPartialDateDigits(candidate, requireFourDigitYear)) continue;
    accepted = candidate;
  }
  return accepted;
}

function digitCountBeforeCaret(value, caret) {
  return String(value || "")
    .slice(0, Math.max(0, Number(caret || 0)))
    .replace(/\D/g, "").length;
}

function caretFromDigitCount(count) {
  const digits = Math.max(0, Math.min(8, Number(count || 0)));
  if (!digits) return 0;
  return Math.min(10, digits + Math.min(2, Math.floor(digits / 2)));
}

function applyDigitsToSelection(currentValue, selectionStart, selectionEnd, insertedText, minIso = "", maxIso = "", requireFourDigitYear = false) {
  const currentDigits = String(currentValue || "").replace(/\D/g, "");
  const startDigitIndex = digitCountBeforeCaret(currentValue, selectionStart);
  const endDigitIndex = digitCountBeforeCaret(currentValue, selectionEnd);
  const insertedDigits = String(insertedText || "").replace(/\D/g, "");
  const nextDigits = sanitizeDraftDigits(
    `${currentDigits.slice(0, startDigitIndex)}${insertedDigits}${currentDigits.slice(endDigitIndex)}`,
    minIso,
    maxIso,
    requireFourDigitYear
  );
  const nextDigitCaret = Math.min(startDigitIndex + insertedDigits.length, nextDigits.length);
  return {
    nextValue: formatDraftDate(nextDigits),
    nextCaret: caretFromDigitCount(nextDigitCaret)
  };
}

export default function DateInput({
  value,
  onChange,
  onRawChange,
  onValidationError,
  placeholder = "DD/MM/YYYY",
  className = "",
  disabled = false,
  min = "",
  max = "",
  requireFourDigitYear = false,
  style,
  ...props
}) {
  const inputRef = useRef(null);
  const pickerInputRef = useRef(null);
  const nextCaretRef = useRef(null);
  const displayValue = useMemo(() => formatIsoDateToInputDisplay(value, ""), [value]);
  const minIso = useMemo(() => parseDateInputToIso(min), [min]);
  const maxIso = useMemo(() => parseDateInputToIso(max), [max]);
  const [draftValue, setDraftValue] = useState(displayValue);

  useEffect(() => {
    setDraftValue(displayValue);
  }, [displayValue]);

  useLayoutEffect(() => {
    if (nextCaretRef.current === null) return;
    const element = inputRef.current;
    if (!element) return;
    const caret = nextCaretRef.current;
    nextCaretRef.current = null;
    element.setSelectionRange(caret, caret);
  }, [draftValue]);

  function updateDraft(nextValue, nextCaret) {
    setDraftValue(nextValue);
    onRawChange?.(nextValue);
    if (typeof nextCaret === "number") {
      nextCaretRef.current = nextCaret;
    }
  }

  function commitValue(rawValue) {
    const trimmed = String(rawValue || "").trim();
    if (!trimmed) {
      onRawChange?.("");
      onChange?.("");
      setDraftValue("");
      return;
    }

    if (requireFourDigitYear && trimmed.length !== 10) {
      onRawChange?.(trimmed);
      onChange?.("");
      setDraftValue("");
      onValidationError?.("Year must contain 4 digits in DD/MM/YYYY format.");
      return;
    }

    const iso = parseDateInputToIso(trimmed);
    const invalidFourDigitYear = requireFourDigitYear && !hasFourDigitYearFormat(trimmed);
    if (!iso || invalidFourDigitYear || isOutOfRange(iso, minIso, maxIso)) {
      onRawChange?.(trimmed);
      onChange?.("");
      setDraftValue(trimmed);
      onValidationError?.("Enter a valid date in DD/MM/YYYY format with a 4-digit year.");
      return;
    }

    onRawChange?.(trimmed);
    onChange?.(iso);
    setDraftValue(formatIsoDateToInputDisplay(iso, trimmed));
  }

  function openPicker() {
    if (disabled) return;
    const picker = pickerInputRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.focus();
    picker.click();
  }

  return (
    <div className="relative">
      <div
        className={`flex h-12 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-100 transition-all shadow-2xs ${className} ${
          disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : ""
        }`}
        style={style}
      >
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          aria-label="Open calendar"
          className={`relative z-10 flex h-full shrink-0 items-center justify-center pr-2 text-amber-500 transition ${
            disabled ? "cursor-not-allowed opacity-60" : "hover:text-amber-600"
          }`}
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={draftValue}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            const nextDigits = sanitizeDraftDigits(event.target.value, minIso, maxIso, requireFourDigitYear);
            const nextValue = formatDraftDate(nextDigits);
            const nextCaret = caretFromDigitCount(
              Math.min(
                digitCountBeforeCaret(event.target.value, event.target.selectionStart),
                nextDigits.length
              )
            );
            updateDraft(nextValue, nextCaret);
            if (!nextDigits.length) {
              onRawChange?.("");
              onChange?.("");
              return;
            }
            if (nextDigits.length === 8) {
              const nextIso = draftDigitsToIso(nextDigits, requireFourDigitYear);
              if (nextIso && !isOutOfRange(nextIso, minIso, maxIso)) {
                onRawChange?.(nextValue);
                onChange?.(nextIso);
              }
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = event.clipboardData?.getData("text") || "";
            const { nextValue, nextCaret } = applyDigitsToSelection(
              draftValue,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              pasted,
              minIso,
              maxIso,
              requireFourDigitYear
            );
            updateDraft(nextValue, nextCaret);
          }}
          onBlur={(event) => commitValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitValue(event.currentTarget.value);
              event.currentTarget.blur();
              return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) return;

            const allowedKeys = [
              "Backspace",
              "Delete",
              "Tab",
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End"
            ];
            if (allowedKeys.includes(event.key)) {
              const input = event.currentTarget;
              const start = input.selectionStart ?? 0;
              const end = input.selectionEnd ?? 0;
              if (start !== end) return;

              if (event.key === "Backspace" && start > 0 && draftValue[start - 1] === "/") {
                event.preventDefault();
                const digits = draftValue.replace(/\D/g, "");
                const digitIndex = digitCountBeforeCaret(draftValue, start) - 1;
                if (digitIndex < 0) return;
                const nextDigits = `${digits.slice(0, digitIndex)}${digits.slice(digitIndex + 1)}`;
                updateDraft(formatDraftDate(nextDigits), caretFromDigitCount(digitIndex));
              } else if (event.key === "Delete" && draftValue[start] === "/") {
                event.preventDefault();
                const digits = draftValue.replace(/\D/g, "");
                const digitIndex = digitCountBeforeCaret(draftValue, start);
                const nextDigits = `${digits.slice(0, digitIndex)}${digits.slice(digitIndex + 1)}`;
                updateDraft(formatDraftDate(nextDigits), caretFromDigitCount(digitIndex));
              }
              return;
            }

            if (!/^\d$/.test(event.key)) {
              event.preventDefault();
            }
          }}
          className={`h-full min-w-0 flex-1 appearance-none border-0 bg-transparent py-0 pl-1 pr-0 text-slate-900 font-medium placeholder:text-slate-400 placeholder:font-normal focus:outline-none ${
            disabled ? "cursor-not-allowed opacity-60" : ""
          }`}
          {...props}
        />
      </div>
      <input
        ref={pickerInputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={parseDateInputToIso(value) || ""}
        min={minIso || undefined}
        max={maxIso || undefined}
        onChange={(event) => {
          const nextIso = event.target.value || "";
          const nextDisplay = formatIsoDateToInputDisplay(nextIso, "");
          onRawChange?.(nextDisplay);
          onChange?.(nextIso);
          setDraftValue(nextDisplay);
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      />
    </div>
  );
}
