import React from "react";
import clsx from "clsx";
import FieldLabelText from "./FieldLabelText";

function isNativeField(element) {
  if (!React.isValidElement(element) || typeof element.type !== "string") return false;
  return ["input", "select", "textarea"].includes(element.type);
}

function shouldSkipRequired(element) {
  if (!isNativeField(element)) return true;
  const inputType = String(element.props?.type || "").toLowerCase();
  return ["hidden", "checkbox", "radio", "file", "button", "submit", "reset"].includes(inputType);
}

function buildRequiredMessage(labelText) {
  const text = String(labelText || "").trim() || "This field";
  return `Please fill ${text}.`;
}

function enhanceChildren(children, { isRequired, hasError, labelText }) {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;

    if (!shouldSkipRequired(child)) {
      const existingOnInvalid = child.props?.onInvalid;
      const existingOnInput = child.props?.onInput;
      const existingOnChange = child.props?.onChange;
      const requiredMessage = buildRequiredMessage(labelText);

      return React.cloneElement(child, {
        required: isRequired || child.props?.required,
        "aria-required": isRequired || child.props?.["aria-required"] ? "true" : undefined,
        "aria-invalid": hasError ? "true" : child.props?.["aria-invalid"],
        "data-required-label": labelText,
        onInvalid: (event) => {
          const target = event?.target;
          if (target?.validity?.valueMissing) {
            target.setCustomValidity(requiredMessage);
          }
          if (typeof existingOnInvalid === "function") {
            existingOnInvalid(event);
          }
        },
        onInput: (event) => {
          const target = event?.target;
          if (target?.setCustomValidity) {
            target.setCustomValidity("");
          }
          if (typeof existingOnInput === "function") {
            existingOnInput(event);
          }
        },
        onChange: (event) => {
          const target = event?.target;
          if (target?.setCustomValidity) {
            target.setCustomValidity("");
          }
          if (typeof existingOnChange === "function") {
            existingOnChange(event);
          }
        }
      });
    }

    if (child.props?.children) {
      return React.cloneElement(child, {
        children: enhanceChildren(child.props.children, { isRequired, hasError, labelText })
      });
    }

    return child;
  });
}

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
  const enhancedChildren = enhanceChildren(children, {
    isRequired,
    hasError,
    labelText: labelMeta.text
  });

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
      <div className="mt-2 flex flex-col">{enhancedChildren}</div>
    </label>
  );
}
