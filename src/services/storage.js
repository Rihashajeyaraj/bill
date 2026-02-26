export const LS_KEYS = {
  auth_token: "auth_token",
  auth_user: "auth_user",
  auth_users: "auth_users",
  role: "role",
  organization_id: "organization_id",
  theme_mode: "theme_mode",
  theme_preset: "theme_preset",
  theme_overrides: "theme_overrides",
  theme_config: "theme_config",
  app_font_family: "app_font_family",
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
  expenses: "expenses",
  expense_categories: "expense_categories",
  app_notifications: "app_notifications",
  credit_notifications: "credit_notifications",
  activity_logs: "activity_logs",
  auto_backup_reminder: "auto_backup_reminder"
};

const failedOrgMigrationKeys = new Set();

export function ssGet(key, fallback = null) {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function ssSet(key, value) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

export function ssRemove(key) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(key);
}

function normalizeScopeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
}

function getCurrentAuthScopeId() {
  const user = ssGet(LS_KEYS.auth_user, null) || lsGet(LS_KEYS.auth_user, null);
  const candidate = user?.id || user?.email || "";
  return normalizeScopeValue(candidate);
}

function getCurrentOrganizationScopeId() {
  const sessionOrganizationId = ssGet(LS_KEYS.organization_id, "");
  const sessionScope = normalizeScopeValue(sessionOrganizationId);
  if (sessionScope) return sessionScope;

  // If user-scoped organization id exists (even empty), prefer it over legacy global key.
  if (typeof window !== "undefined") {
    const userScopedKey = toUserScopedKey(LS_KEYS.organization_id);
    if (userScopedKey && userScopedKey !== LS_KEYS.organization_id) {
      const raw = window.localStorage.getItem(userScopedKey);
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          return normalizeScopeValue(parsed);
        } catch {
          return "";
        }
      }
    }
  }

  const organizationId = lsGet(LS_KEYS.organization_id, "");
  return normalizeScopeValue(organizationId);
}

export function toUserScopedKey(baseKey, userId = "") {
  const scopeId = normalizeScopeValue(userId || getCurrentAuthScopeId());
  if (!scopeId) return baseKey;
  return `${baseKey}__user_${scopeId}`;
}

export function toOrganizationScopedKey(baseKey, organizationId = "") {
  const scopeId = normalizeScopeValue(organizationId || getCurrentOrganizationScopeId());
  if (scopeId) return `${baseKey}__org_${scopeId}`;
  return toUserScopedKey(baseKey);
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

export function lsGetOrganizationScoped(baseKey, fallback = null, organizationId = "") {
  const scopedKey = toOrganizationScopedKey(baseKey, organizationId);
  if (scopedKey === baseKey) return lsGet(baseKey, fallback);

  const raw = localStorage.getItem(scopedKey);
  if (raw === null) {
    // Backward compatibility: migrate legacy unscoped/user-scoped values
    // to the org-scoped key once, then keep reads isolated by organization.
    const legacyKeys = [toUserScopedKey(baseKey), baseKey].filter(
      (key, index, list) => key !== scopedKey && list.indexOf(key) === index
    );
    const migrationBlocked = failedOrgMigrationKeys.has(scopedKey);
    for (const legacyKey of legacyKeys) {
      if (!legacyKey) continue;
      const legacyRaw = localStorage.getItem(legacyKey);
      if (legacyRaw === null) continue;
      const legacyValue = lsGet(legacyKey, fallback);
      if (!migrationBlocked) {
        try {
          lsSet(scopedKey, legacyValue);
          lsRemove(legacyKey);
        } catch {
          // Quota/full-storage should not break read paths.
          // Keep using legacy key and skip migration attempts for this key in this session.
          failedOrgMigrationKeys.add(scopedKey);
        }
      }
      return legacyValue;
    }
    return fallback;
  }
  return lsGet(scopedKey, fallback);
}

export function lsSetOrganizationScoped(baseKey, value, organizationId = "") {
  const scopedKey = toOrganizationScopedKey(baseKey, organizationId);
  lsSet(scopedKey, value);
  return scopedKey;
}

export function lsRemoveOrganizationScoped(baseKey, organizationId = "") {
  const scopedKey = toOrganizationScopedKey(baseKey, organizationId);
  lsRemove(scopedKey);
}

export function isOrganizationScopedStorageEventKey(baseKey, storageKey) {
  if (!storageKey) return true;
  return (
    storageKey === baseKey ||
    storageKey.startsWith(`${baseKey}__org_`) ||
    storageKey.startsWith(`${baseKey}__user_`)
  );
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
