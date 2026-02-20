export const LS_KEYS = {
  auth_token: "auth_token",
  auth_user: "auth_user",
  auth_users: "auth_users",
  role: "role",
  organization_id: "organization_id",
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

function normalizeScopeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
}

function getCurrentAuthScopeId() {
  const user = lsGet(LS_KEYS.auth_user, null);
  const candidate = user?.id || user?.email || "";
  return normalizeScopeValue(candidate);
}

export function toUserScopedKey(baseKey, userId = "") {
  const scopeId = normalizeScopeValue(userId || getCurrentAuthScopeId());
  if (!scopeId) return baseKey;
  return `${baseKey}__user_${scopeId}`;
}

export function lsGetUserScoped(baseKey, fallback = null, userId = "") {
  const scopedKey = toUserScopedKey(baseKey, userId);
  if (scopedKey === baseKey) return lsGet(baseKey, fallback);

  const raw = localStorage.getItem(scopedKey);
  if (raw === null) return fallback;
  return lsGet(scopedKey, fallback);
}

export function lsSetUserScoped(baseKey, value, userId = "") {
  const scopedKey = toUserScopedKey(baseKey, userId);
  lsSet(scopedKey, value);
  return scopedKey;
}

export function lsRemoveUserScoped(baseKey, userId = "") {
  const scopedKey = toUserScopedKey(baseKey, userId);
  lsRemove(scopedKey);
}

export function isUserScopedStorageEventKey(baseKey, storageKey) {
  if (!storageKey) return true;
  return storageKey === baseKey || storageKey.startsWith(`${baseKey}__user_`);
}

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
