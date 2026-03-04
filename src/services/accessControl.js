import { canAccessSettings, canViewReports } from "./roles";

const OWNER_ONLY_PREFIXES = [
  "/app/company-settings",
  "/app/company-setup",
  "/company-setup",
  "/app/invoice-template-setup",
  "/invoice-template-setup",
  "/app/backup",
  "/app/audit-history"
];

const REPORTS_PREFIXES = ["/app/reports"];

function routeMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function canAccessPathForRole(role, pathname) {
  const path = String(pathname || "").trim();
  if (!path) return true;

  if (OWNER_ONLY_PREFIXES.some((prefix) => routeMatchesPrefix(path, prefix))) {
    return canAccessSettings(role);
  }

  if (REPORTS_PREFIXES.some((prefix) => routeMatchesPrefix(path, prefix))) {
    return canViewReports(role);
  }

  return true;
}

export function isOwnerOnlyPath(pathname) {
  const path = String(pathname || "").trim();
  if (!path) return false;
  return OWNER_ONLY_PREFIXES.some((prefix) => routeMatchesPrefix(path, prefix));
}
