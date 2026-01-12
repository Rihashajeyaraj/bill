import { LS_KEYS, lsGet, lsRemove, lsSet } from "./storage";

const DEMO_USERS = [
  { email: "owner@demo.com", password: "owner123", name: "Owner User", role: "Owner" },
  { email: "manager@demo.com", password: "manager123", name: "Manager User", role: "Manager" },
  { email: "accountant@demo.com", password: "accountant123", name: "Accountant User", role: "Accountant" }
];

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

function getStoredUsers() {
  return lsGet(LS_KEYS.auth_users, []);
}

function setStoredUsers(list) {
  lsSet(LS_KEYS.auth_users, list);
}

export function authGetToken() {
  return lsGet(LS_KEYS.auth_token, "");
}

export function authGetUser() {
  return lsGet(LS_KEYS.auth_user, null);
}

export function authGetRole() {
  return lsGet(LS_KEYS.role, "Manager");
}

export function authLogin({ email, password }) {
  const users = [...DEMO_USERS, ...getStoredUsers()];
  const found = users.find(
    (u) => normalizeEmail(u.email) === normalizeEmail(email) && u.password === password
  );
  if (!found) {
    const err = new Error("Invalid email or password");
    err.code = "AUTH_INVALID";
    throw err;
  }

  const token = `mock_${btoa(`${found.email}:${Date.now()}`)}`;
  lsSet(LS_KEYS.auth_token, token);
  lsSet(LS_KEYS.auth_user, { email: found.email, name: found.name });
  lsSet(LS_KEYS.role, found.role);
  return { token, user: { email: found.email, name: found.name }, role: found.role };
}

export function authRegister({ name, email, password, role }) {
  const safeEmail = normalizeEmail(email);
  const safeName = (name || "").trim();
  const safeRole = role || "Owner";

  if (!safeName || !safeEmail || !password) {
    const err = new Error("Name, email, and password are required");
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  const users = [...DEMO_USERS, ...getStoredUsers()];
  const exists = users.some((u) => normalizeEmail(u.email) === safeEmail);
  if (exists) {
    const err = new Error("Email already registered");
    err.code = "AUTH_EXISTS";
    throw err;
  }

  const next = { name: safeName, email: safeEmail, password, role: safeRole };
  setStoredUsers([next, ...getStoredUsers()]);
  return next;
}

export function authLogout() {
  lsRemove(LS_KEYS.auth_token);
  lsRemove(LS_KEYS.auth_user);
  lsRemove(LS_KEYS.role);
}
