import React from "react";
import clsx from "clsx";
import FieldLabelText from "./FieldLabelText";

function parseLabelMeta(label) {
  if (typeof label !== "string") {
    return {
      text: label,
      hasRequiredMarker: false,
      hasOptionalMarker: false
    };
  }

  const trimmed = label.trim();
  const hasRequiredMarker = /\*\s*$/.test(trimmed);
  const withoutRequired = trimmed.replace(/\s*\*+\s*$/, "").trim();
  const hasOptionalMarker = /\(optional\)\s*$/i.test(withoutRequired);
  const text = withoutRequired.replace(/\s*\(optional\)\s*$/i, "").trim() || withoutRequired;

  return {
    text,
    hasRequiredMarker,
    hasOptionalMarker
  };
}

export default function FormField({
  label,
  hint,
  children,
  className,
  required,
  optional,
  showIndicator = true,
  error
}) {
  const labelMeta = parseLabelMeta(label);
  const isRequired = typeof required === "boolean" ? required : labelMeta.hasRequiredMarker;
  const isOptional =
    typeof optional === "boolean" ? optional : !isRequired || labelMeta.hasOptionalMarker;
  const hasError = !!error;

  return (
    <label
      className={clsx("form-field flex flex-col", className)}
      data-invalid={hasError ? "true" : "false"}
    >
      <div className="flex flex-col gap-1">
        <FieldLabelText
          className="text-sm font-semibold leading-6 app-main-text"
          required={showIndicator && isRequired}
          optional={showIndicator && !isRequired && isOptional}
        >
          {labelMeta.text}
        </FieldLabelText>
        {hint ? <span className="text-xs leading-5 app-muted-text">{hint}</span> : null}
      </div>
      <div className="mt-2 flex flex-col">{children}</div>
    </label>
  );
}
