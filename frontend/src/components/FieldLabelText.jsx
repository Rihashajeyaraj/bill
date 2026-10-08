import React from "react";
import clsx from "clsx";

export default function FieldLabelText({
  children,
  label,
  required = false,
  optional = false,
  className,
  indicatorClassName,
  optionalClassName
}) {
  const labelText = label || children;
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-1", className)}>
      <span>{labelText}</span>
      {required ? (
        <span
          className={clsx("font-semibold leading-none text-rose-600", indicatorClassName)}
          aria-hidden="true"
        >
          *
        </span>
      ) : null}
      {!required && optional ? (
        <span className={clsx("text-xs font-medium app-muted-text", optionalClassName)}>
          (Optional)
        </span>
      ) : null}
    </span>
  );
}
