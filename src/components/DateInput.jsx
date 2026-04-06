import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatIsoDateToDisplay, isValidDateParts, parseDateInputToIso } from "../lib/dateUtils";

function isOutOfRange(iso, minIso, maxIso) {
  if (!iso) return false;
  if (minIso && iso < minIso) return true;
  if (maxIso && iso > maxIso) return true;
  return false;
}

function draftDigitsToIso(digits) {
  const text = String(digits || "").replace(/\D/g, "").slice(0, 6);
  if (text.length !== 6) return "";
  return parseDateInputToIso(formatDraftDate(text));
}

function formatDraftDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (!digits) return "";
  if (digits.length < 2) return digits;
  if (digits.length === 2) return `${digits}/`;
  if (digits.length < 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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

function isValidPartialDateDigits(digits) {
  const text = String(digits || "").replace(/\D/g, "").slice(0, 6);
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

  if (text.length === 6) {
    const day = Number(text.slice(0, 2));
    const month = Number(text.slice(2, 4));
    const year2 = Number(text.slice(4, 6));
    const year = year2 >= 70 ? 1900 + year2 : 2000 + year2;
    if (!isValidDateParts(year, month, day)) return false;
  }

  return true;
}

function sanitizeDraftDigits(value, minIso = "", maxIso = "") {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  let accepted = "";
  for (const digit of digits) {
    const candidate = `${accepted}${digit}`;
    if (!isValidPartialDateDigits(candidate)) continue;
    const candidateIso = draftDigitsToIso(candidate);
    if (candidateIso && isOutOfRange(candidateIso, minIso, maxIso)) continue;
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
  const digits = Math.max(0, Math.min(6, Number(count || 0)));
  if (!digits) return 0;
  return Math.min(8, digits + Math.min(2, Math.floor(digits / 2)));
}

function applyDigitsToSelection(currentValue, selectionStart, selectionEnd, insertedText, minIso = "", maxIso = "") {
  const currentDigits = String(currentValue || "").replace(/\D/g, "");
  const startDigitIndex = digitCountBeforeCaret(currentValue, selectionStart);
  const endDigitIndex = digitCountBeforeCaret(currentValue, selectionEnd);
  const insertedDigits = String(insertedText || "").replace(/\D/g, "");
  const nextDigits = sanitizeDraftDigits(
    `${currentDigits.slice(0, startDigitIndex)}${insertedDigits}${currentDigits.slice(endDigitIndex)}`,
    minIso,
    maxIso
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
  placeholder = "DD/MM/YY",
  className = "",
  disabled = false,
  min = "",
  max = "",
  ...props
}) {
  const inputRef = useRef(null);
  const nextCaretRef = useRef(null);
  const displayValue = useMemo(() => formatIsoDateToDisplay(value, ""), [value]);
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

    const iso = parseDateInputToIso(trimmed);
    if (!iso || isOutOfRange(iso, minIso, maxIso)) {
      onRawChange?.(trimmed);
      onChange?.("");
      setDraftValue(trimmed);
      return;
    }

    onRawChange?.(trimmed);
    onChange?.(iso);
    setDraftValue(formatIsoDateToDisplay(iso, trimmed));
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={8}
      value={draftValue}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => {
        const nextDigits = sanitizeDraftDigits(event.target.value, minIso, maxIso);
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
        if (nextDigits.length === 6) {
          const nextIso = draftDigitsToIso(nextDigits);
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
          maxIso
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
      className={`text-slate-700 placeholder:text-slate-400 ${className} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      {...props}
    />
  );
}
