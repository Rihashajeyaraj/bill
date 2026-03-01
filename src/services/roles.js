import { LS_KEYS, lsGetOrganizationScoped } from "./storage";

export const ROLE_LABELS = {
  owner: "Owner",
  accounter: "Accounter",
  staff: "Staff"
};

export const ROLE_OPTIONS = [ROLE_LABELS.owner, ROLE_LABELS.accounter, ROLE_LABELS.staff];

const DEFAULT_ROLE_PERMISSIONS = {
  [ROLE_LABELS.owner]: { create: true, edit: true, delete: true, reports: true, approvals: true },
  [ROLE_LABELS.accounter]: { create: true, edit: true, delete: false, reports: true, approvals: true },
  [ROLE_LABELS.staff]: { create: true, edit: false, delete: false, reports: false, approvals: false }
};

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeRolePermissions(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    [ROLE_LABELS.owner]: {
      create: toBool(source?.[ROLE_LABELS.owner]?.create, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.owner].create),
      edit: toBool(source?.[ROLE_LABELS.owner]?.edit, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.owner].edit),
      delete: toBool(source?.[ROLE_LABELS.owner]?.delete, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.owner].delete),
      reports: toBool(source?.[ROLE_LABELS.owner]?.reports, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.owner].reports),
      approvals: toBool(
        source?.[ROLE_LABELS.owner]?.approvals,
        DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.owner].approvals
      )
    },
    [ROLE_LABELS.accounter]: {
      create: toBool(
        source?.[ROLE_LABELS.accounter]?.create,
        DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.accounter].create
      ),
      edit: toBool(source?.[ROLE_LABELS.accounter]?.edit, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.accounter].edit),
      delete: toBool(
        source?.[ROLE_LABELS.accounter]?.delete,
        DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.accounter].delete
      ),
      reports: toBool(
        source?.[ROLE_LABELS.accounter]?.reports,
        DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.accounter].reports
      ),
      approvals: toBool(
        source?.[ROLE_LABELS.accounter]?.approvals,
        DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.accounter].approvals
      )
    },
    [ROLE_LABELS.staff]: {
      create: toBool(source?.[ROLE_LABELS.staff]?.create, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.staff].create),
      edit: toBool(source?.[ROLE_LABELS.staff]?.edit, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.staff].edit),
      delete: toBool(source?.[ROLE_LABELS.staff]?.delete, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.staff].delete),
      reports: toBool(source?.[ROLE_LABELS.staff]?.reports, DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.staff].reports),
      approvals: toBool(
        source?.[ROLE_LABELS.staff]?.approvals,
        DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.staff].approvals
      )
    }
  };
}

function getSavedRolePermissions() {
  const profile = lsGetOrganizationScoped(LS_KEYS.company_profile, null);
  const permissions = profile?.settings?.users?.roles;
  return normalizeRolePermissions(permissions);
}

function getPermissionsForRole(value) {
  const role = normalizeRoleLabel(value);
  const permissions = getSavedRolePermissions();
  return permissions?.[role] || DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS[ROLE_LABELS.staff];
}

export function normalizeRoleLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "owner") return ROLE_LABELS.owner;
  if (normalized === "accounter" || normalized === "accountant") return ROLE_LABELS.accounter;
  return ROLE_LABELS.staff;
}

export function toDbRole(value) {
  return normalizeRoleLabel(value).toLowerCase();
}

export function fromDbRole(value) {
  return normalizeRoleLabel(value);
}

export function isOwnerRole(value) {
  return normalizeRoleLabel(value) === ROLE_LABELS.owner;
}

export function isAccounterRole(value) {
  return normalizeRoleLabel(value) === ROLE_LABELS.accounter;
}

export function isStaffRole(value) {
  return normalizeRoleLabel(value) === ROLE_LABELS.staff;
}

export function canApplyApprovals(value) {
  return !!getPermissionsForRole(value).approvals;
}

export function canViewReports(value) {
  return !!getPermissionsForRole(value).reports;
}

export function canAccessSettings(value) {
  return isOwnerRole(value);
}

export function canCreateEntries(value) {
  return !!getPermissionsForRole(value).create;
}

export function canEditEntries(value) {
  return !!getPermissionsForRole(value).edit;
}

export function canDeleteEntries(value) {
  return !!getPermissionsForRole(value).delete;
}

export function roleTypeLabel(value) {
  return canApplyApprovals(value) ? "Admin" : "Staff";
}
