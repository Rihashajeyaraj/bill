import { LS_KEYS, lsGet, lsSet } from "./storage";

export const COUNTRIES = ["India", "Sri Lanka", "UAE", "USA", "United Kingdom", "Ireland"];

export function companyIsCompleted() {
  return !!lsGet(LS_KEYS.companyProfileCompleted, false);
}

export function companySetCompleted(status) {
  lsSet(LS_KEYS.companyProfileCompleted, !!status);
}

export function companyGetProfile() {
  return lsGet(LS_KEYS.company_profile, null);
}

export function companySaveProfile(profile) {
  lsSet(LS_KEYS.company_profile, profile);
  lsSet(LS_KEYS.companyProfileCompleted, true);
  return profile;
}

export function companyUpdateProfile(partial) {
  const prev = companyGetProfile() || {};
  const next = { ...prev, ...partial, updated_at: new Date().toISOString() };
  lsSet(LS_KEYS.company_profile, next);
  return next;
}
