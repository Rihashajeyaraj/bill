import React, { useEffect, useState } from "react";
import { useRoutes } from "react-router-dom";
import { routes } from "./routes";
import { ensureSeeded } from "./services/seed";
import { authBootstrapSession } from "./services/auth.service";
import { companyLoadMyOrganization } from "./services/company.service";

function isRequiredField(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (!["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return false;
  const inputType = String(target.getAttribute("type") || "").toLowerCase();
  if (["hidden", "checkbox", "radio", "file", "button", "submit", "reset"].includes(inputType)) {
    return false;
  }
  return target.hasAttribute("required") || target.getAttribute("aria-required") === "true";
}

function resolveRequiredLabel(target) {
  if (!(target instanceof HTMLElement)) return "this field";
  const explicit = String(target.getAttribute("data-required-label") || "").trim();
  if (explicit) return explicit;

  const ariaLabel = String(target.getAttribute("aria-label") || "").trim();
  if (ariaLabel) return ariaLabel;

  const name = String(target.getAttribute("name") || "").trim();
  if (name) return name.replace(/[_-]+/g, " ");

  const placeholder = String(target.getAttribute("placeholder") || "").trim();
  if (placeholder) return placeholder;

  const wrapperLabel = target.closest("label");
  const labelText = String(wrapperLabel?.textContent || "").replace(/\s+/g, " ").trim();
  if (labelText) return labelText.replace(/\*|\(Optional\)/gi, "").trim();

  return "this field";
}

function validationMessageFor(target) {
  return `Please fill ${resolveRequiredLabel(target)}.`;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const element = useRoutes(routes);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        ensureSeeded();
        const hasSession = await authBootstrapSession();
        if (hasSession) {
          await companyLoadMyOrganization();
        }
      } catch (error) {
        console.error("App bootstrap failed", error);
      } finally {
        if (mounted) setReady(true);
      }
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function clearValidation(target) {
      if (!isRequiredField(target) || typeof target.setCustomValidity !== "function") return;
      target.setCustomValidity("");
    }

    function applyValidation(target) {
      if (!isRequiredField(target) || typeof target.setCustomValidity !== "function") return;
      if (target.validity?.valueMissing) {
        target.setCustomValidity(validationMessageFor(target));
      } else {
        target.setCustomValidity("");
      }
    }

    function handleInvalid(event) {
      const target = event.target;
      if (!isRequiredField(target)) return;
      applyValidation(target);
    }

    function handleInput(event) {
      clearValidation(event.target);
    }

    function handleBlur(event) {
      const target = event.target;
      if (!isRequiredField(target)) return;
      applyValidation(target);
      if (target.validity?.valueMissing && typeof target.reportValidity === "function") {
        target.reportValidity();
      }
    }

    document.addEventListener("invalid", handleInvalid, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("change", handleInput, true);
    document.addEventListener("focusout", handleBlur, true);

    return () => {
      document.removeEventListener("invalid", handleInvalid, true);
      document.removeEventListener("input", handleInput, true);
      document.removeEventListener("change", handleInput, true);
      document.removeEventListener("focusout", handleBlur, true);
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm app-muted-text">
        Loading...
      </div>
    );
  }

  return element;
}
