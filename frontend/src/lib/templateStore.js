import {
  LS_KEYS,
  lsGet,
  lsGetOrganizationScoped,
  lsGetUserScoped,
  lsSetOrganizationScoped,
  lsSetUserScoped,
  ssGet,
  ssSet
} from "../services/storage";
import { buildGoogleFontHref, resolveAppFont, toAppFontStack } from "../theme/fontPresets";

export const DEFAULT_TEMPLATE_CONFIG = {
  templateId: "new_globe_export",
  primaryColor: "#1f6b45",
  bgColor: "#ffffff",
  fontFamily: "Inter",
  logoUrl: "",
  logoPosition: "left"
};
let runtimeTemplateConfig = { ...DEFAULT_TEMPLATE_CONFIG };
const INVOICE_FONT_LINK_ID = "invoice-font-google-font";

function isQuotaExceededError(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code === 22 ||
    error?.code === 1014
  );
}

function normalizeTemplateConfig(config = {}) {
  const normalized = { ...DEFAULT_TEMPLATE_CONFIG, ...(config || {}) };
  return {
    ...normalized,
    fontFamily: resolveAppFont(normalized.fontFamily)
  };
}

function slimTemplateConfig(config = {}) {
  const normalized = normalizeTemplateConfig(config);
  return { ...normalized, logoUrl: "" };
}

function ensureInvoiceFontLink(fontFamily) {
  if (typeof document === "undefined") return;
  const href = buildGoogleFontHref(fontFamily);
  let link = document.getElementById(INVOICE_FONT_LINK_ID);
  if (!link || String(link.tagName || "").toLowerCase() !== "link") {
    link = document.createElement("link");
    link.id = INVOICE_FONT_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
}

export function applyInvoiceTemplateFont(config = {}) {
  if (typeof document === "undefined") return;
  const safeFont = resolveAppFont(config.fontFamily || DEFAULT_TEMPLATE_CONFIG.fontFamily);
  document.documentElement.style.setProperty("--invoice-font-family", toAppFontStack(safeFont));
  ensureInvoiceFontLink(safeFont);
}

export function getInvoiceTemplateConfig() {
  const sessionValue = ssGet(LS_KEYS.invoiceTemplateConfig, null);
  if (sessionValue && typeof sessionValue === "object") {
    const normalized = normalizeTemplateConfig(sessionValue);
    runtimeTemplateConfig = normalized;
    applyInvoiceTemplateFont(normalized);
    return normalized;
  }

  const scoped = lsGetOrganizationScoped(LS_KEYS.invoiceTemplateConfig, null);
  if (scoped && typeof scoped === "object") {
    const normalized = normalizeTemplateConfig(scoped);
    runtimeTemplateConfig = normalized;
    applyInvoiceTemplateFont(normalized);
    return normalized;
  }

  const userScoped = lsGetUserScoped(LS_KEYS.invoiceTemplateConfig, null);
  if (userScoped && typeof userScoped === "object") {
    const normalized = normalizeTemplateConfig(userScoped);
    runtimeTemplateConfig = normalized;
    applyInvoiceTemplateFont(normalized);
    return normalized;
  }

  const legacy = lsGet(LS_KEYS.invoiceTemplateConfig, null);
  if (legacy && typeof legacy === "object") {
    const normalized = normalizeTemplateConfig(legacy);
    runtimeTemplateConfig = normalized;
    applyInvoiceTemplateFont(normalized);
    return normalized;
  }

  applyInvoiceTemplateFont(runtimeTemplateConfig);
  return runtimeTemplateConfig;
}

export function setInvoiceTemplateConfig(config) {
  const normalized = normalizeTemplateConfig(config);
  runtimeTemplateConfig = normalized;
  applyInvoiceTemplateFont(normalized);

  try {
    ssSet(LS_KEYS.invoiceTemplateConfig, normalized);
    lsSetOrganizationScoped(LS_KEYS.invoiceTemplateConfig, normalized);
    lsSetUserScoped(LS_KEYS.invoiceTemplateConfig, normalized);
    return normalized;
  } catch (error) {
    if (!isQuotaExceededError(error)) return normalized;
    const slim = slimTemplateConfig(normalized);
    runtimeTemplateConfig = slim;
    applyInvoiceTemplateFont(slim);
    try {
      ssSet(LS_KEYS.invoiceTemplateConfig, slim);
      lsSetOrganizationScoped(LS_KEYS.invoiceTemplateConfig, slim);
      lsSetUserScoped(LS_KEYS.invoiceTemplateConfig, slim);
    } catch {
      // Best effort only: keep runtime config even when persistent storage is full.
    }
    return slim;
  }
}

export function invoiceTemplateIsCompleted() {
  const sessionValue = ssGet(LS_KEYS.invoiceTemplateCompleted, null);
  if (typeof sessionValue === "boolean") return sessionValue;
  const orgScoped = lsGetOrganizationScoped(LS_KEYS.invoiceTemplateCompleted, null);
  if (typeof orgScoped === "boolean") return orgScoped;
  return !!lsGetUserScoped(LS_KEYS.invoiceTemplateCompleted, false);
}

export function setInvoiceTemplateCompleted(status) {
  ssSet(LS_KEYS.invoiceTemplateCompleted, !!status);
  lsSetOrganizationScoped(LS_KEYS.invoiceTemplateCompleted, !!status);
  lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, !!status);
}
