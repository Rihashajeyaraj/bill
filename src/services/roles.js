export const ROLE_LABELS = {
  owner: "Owner",
  accounter: "Accounter",
  staff: "Staff"
};

export const ROLE_OPTIONS = [ROLE_LABELS.owner, ROLE_LABELS.accounter, ROLE_LABELS.staff];

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
