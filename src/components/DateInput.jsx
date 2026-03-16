import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatIsoDateToDisplay, parseDateInputToIso } from "../lib/dateUtils";

function isOutOfRange(iso, minIso, maxIso) {
  if (!iso) return false;
  if (minIso && iso < minIso) return true;
  if (maxIso && iso > maxIso) return true;
  return false;
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

function applyDigitsToSelection(currentValue, selectionStart, selectionEnd, insertedText) {
  const currentDigits = String(currentValue || "").replace(/\D/g, "");
  const startDigitIndex = digitCountBeforeCaret(currentValue, selectionStart);
  const endDigitIndex = digitCountBeforeCaret(currentValue, selectionEnd);
  const insertedDigits = String(insertedText || "").replace(/\D/g, "");
  const nextDigits = `${currentDigits.slice(0, startDigitIndex)}${insertedDigits}${currentDigits.slice(endDigitIndex)}`.slice(0, 6);
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
        const nextValue = formatDraftDate(event.target.value);
        const nextCaret = caretFromDigitCount(
          Math.min(
            digitCountBeforeCaret(event.target.value, event.target.selectionStart),
            nextValue.replace(/\D/g, "").length
          )
        );
        updateDraft(nextValue, nextCaret);
      }}
      onPaste={(event) => {
        event.preventDefault();
        const pasted = event.clipboardData?.getData("text") || "";
        const { nextValue, nextCaret } = applyDigitsToSelection(
          draftValue,
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
          pasted
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
      className={`${className} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      {...props}
    />
  );
}
