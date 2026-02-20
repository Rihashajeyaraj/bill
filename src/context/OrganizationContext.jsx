import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  companyGetCountryCode,
  companyGetCountryName,
  companyGetProfile,
  ORGANIZATION_UPDATED_EVENT
} from "../services/company.service";
import { isUserScopedStorageEventKey, LS_KEYS } from "../services/storage";

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function resolveCurrencySymbol(currencyCode) {
  const code = normalizeCurrencyCode(currencyCode);
  if (!code) return "";
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).formatToParts(0);
    const symbol = parts.find((part) => part.type === "currency")?.value || "";
    return symbol || `${code} `;
  } catch {
    return `${code} `;
  }
}

function buildOrganizationState(profile = null) {
  const source = profile || companyGetProfile() || {};
  const countryCodeRaw = String(source?.countryCode || source?.country_code || "")
    .trim()
    .toUpperCase();
  const countryRaw = String(source?.country || source?.country_name || "").trim();
  const countryCode = countryCodeRaw || companyGetCountryCode(countryRaw || "India");
  const country = countryRaw || companyGetCountryName(countryCode || "IN");
  const currency =
    normalizeCurrencyCode(source?.currency || source?.base_currency || source?.tax?.currency) || "INR";

  return {
    profile: source,
    country,
    countryCode,
    countryLabel: `${countryCode} ${country}`.trim(),
    currency,
    currencySymbol: resolveCurrencySymbol(currency)
  };
}

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const [organization, setOrganization] = useState(() => buildOrganizationState());

  const refreshOrganization = useCallback(() => {
    setOrganization(buildOrganizationState());
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (
        !event?.key ||
        isUserScopedStorageEventKey(LS_KEYS.company_profile, event.key) ||
        isUserScopedStorageEventKey(LS_KEYS.organization_id, event.key) ||
        isUserScopedStorageEventKey(LS_KEYS.companyProfileCompleted, event.key)
      ) {
        refreshOrganization();
      }
    };

    const onProfileChanged = (event) => {
      setOrganization(buildOrganizationState(event?.detail || null));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshOrganization);
    window.addEventListener(ORGANIZATION_UPDATED_EVENT, onProfileChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshOrganization);
      window.removeEventListener(ORGANIZATION_UPDATED_EVENT, onProfileChanged);
    };
  }, [refreshOrganization]);

  const value = useMemo(
    () => ({
      ...organization,
      refreshOrganization
    }),
    [organization, refreshOrganization]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) throw new Error("useOrganization must be used within OrganizationProvider");
  return context;
}
