import { LS_KEYS, lsGet, lsSet } from "../services/storage";

export const DEFAULT_TEMPLATE_CONFIG = {
  templateId: "standard",
  primaryColor: "#1f6b45",
  bgColor: "#ffffff",
  fontFamily: "Inter",
  logoUrl: "",
  logoPosition: "left"
};

export function getInvoiceTemplateConfig() {
  return lsGet(LS_KEYS.invoiceTemplateConfig, DEFAULT_TEMPLATE_CONFIG);
}

export function setInvoiceTemplateConfig(config) {
  lsSet(LS_KEYS.invoiceTemplateConfig, config);
}

export function invoiceTemplateIsCompleted() {
  return !!lsGet(LS_KEYS.invoiceTemplateCompleted, false);
}

export function setInvoiceTemplateCompleted(status) {
  lsSet(LS_KEYS.invoiceTemplateCompleted, !!status);
}
