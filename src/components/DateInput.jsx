import React, { useEffect, useMemo, useState } from "react";
import { formatIsoDateToDisplay, parseDateInputToIso } from "../lib/dateUtils";

function isOutOfRange(iso, minIso, maxIso) {
  if (!iso) return false;
  if (minIso && iso < minIso) return true;
  if (maxIso && iso > maxIso) return true;
  return false;
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
  const displayValue = useMemo(() => formatIsoDateToDisplay(value, ""), [value]);
  const minIso = useMemo(() => parseDateInputToIso(min), [min]);
  const maxIso = useMemo(() => parseDateInputToIso(max), [max]);
  const [draftValue, setDraftValue] = useState(displayValue);

  useEffect(() => {
    setDraftValue(displayValue);
  }, [displayValue]);

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
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draftValue}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        onRawChange?.(nextValue);
      }}
      onBlur={(event) => commitValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitValue(event.currentTarget.value);
          event.currentTarget.blur();
        }
      }}
      className={`${className} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      {...props}
    />
  );
}
