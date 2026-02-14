export const LS_KEYS = {
  auth_token: "auth_token",
  auth_user: "auth_user",
  auth_users: "auth_users",
  role: "role",
  theme_mode: "theme_mode",
  theme_preset: "theme_preset",
  company_profile: "company_profile",
  companyProfileCompleted: "companyProfileCompleted",
  invoiceTemplateConfig: "invoiceTemplateConfig",
  invoiceTemplateCompleted: "invoiceTemplateCompleted",
  parties: "parties",
  items: "items",
  invoices: "invoices",
  creditNotes: "creditNotes",
  purchases: "purchases",
  payments: "payments",
  expenses: "expenses"
};

export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function lsRemove(key) {
  localStorage.removeItem(key);
}

export function uid(prefix = "") {
  return `${prefix}${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
