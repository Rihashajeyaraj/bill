import { LS_KEYS, lsGet, lsGetUserScoped, lsSetUserScoped } from "../services/storage";

export const DEFAULT_TEMPLATE_CONFIG = {
  templateId: "standard",
  primaryColor: "#1f6b45",
  bgColor: "#ffffff",
  fontFamily: "Inter",
  logoUrl: "",
  logoPosition: "left"
};
let runtimeTemplateConfig = { ...DEFAULT_TEMPLATE_CONFIG };

function isQuotaExceededError(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code === 22 ||
    error?.code === 1014
  );
}

function normalizeTemplateConfig(config = {}) {
  return { ...DEFAULT_TEMPLATE_CONFIG, ...(config || {}) };
}

function slimTemplateConfig(config = {}) {
  const normalized = normalizeTemplateConfig(config);
  return { ...normalized, logoUrl: "" };
}

export function getInvoiceTemplateConfig() {
  const scoped = lsGetUserScoped(LS_KEYS.invoiceTemplateConfig, null);
  if (scoped && typeof scoped === "object") {
    const normalized = normalizeTemplateConfig(scoped);
    runtimeTemplateConfig = normalized;
    return normalized;
  }

  const legacy = lsGet(LS_KEYS.invoiceTemplateConfig, null);
  if (legacy && typeof legacy === "object") {
    const normalized = normalizeTemplateConfig(legacy);
    runtimeTemplateConfig = normalized;
    return normalized;
  }

  return runtimeTemplateConfig;
}

export function setInvoiceTemplateConfig(config) {
  const normalized = normalizeTemplateConfig(config);
  runtimeTemplateConfig = normalized;

  try {
    lsSetUserScoped(LS_KEYS.invoiceTemplateConfig, normalized);
    return normalized;
  } catch (error) {
    if (!isQuotaExceededError(error)) return normalized;
    const slim = slimTemplateConfig(normalized);
    runtimeTemplateConfig = slim;
    try {
      lsSetUserScoped(LS_KEYS.invoiceTemplateConfig, slim);
    } catch {
      // Best effort only: keep runtime config even when persistent storage is full.
    }
    return slim;
  }
}

export function invoiceTemplateIsCompleted() {
  return !!lsGetUserScoped(LS_KEYS.invoiceTemplateCompleted, false);
}

export function setInvoiceTemplateCompleted(status) {
  lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, !!status);
}
