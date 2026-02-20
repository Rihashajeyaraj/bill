import { LS_KEYS, lsGetUserScoped, lsSet, lsSetUserScoped } from "../services/storage";

export const DEFAULT_TEMPLATE_CONFIG = {
  templateId: "standard",
  primaryColor: "#1f6b45",
  bgColor: "#ffffff",
  fontFamily: "Inter",
  logoUrl: "",
  logoPosition: "left"
};

export function getInvoiceTemplateConfig() {
  return lsGetUserScoped(LS_KEYS.invoiceTemplateConfig, DEFAULT_TEMPLATE_CONFIG);
}

export function setInvoiceTemplateConfig(config) {
  lsSetUserScoped(LS_KEYS.invoiceTemplateConfig, config);
  lsSet(LS_KEYS.invoiceTemplateConfig, config);
}

export function invoiceTemplateIsCompleted() {
  return !!lsGetUserScoped(LS_KEYS.invoiceTemplateCompleted, false);
}

export function setInvoiceTemplateCompleted(status) {
  lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, !!status);
  lsSet(LS_KEYS.invoiceTemplateCompleted, !!status);
}
