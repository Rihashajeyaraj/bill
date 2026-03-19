import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  authGetOrganizationId,
  authGetToken,
  authListOrganizations,
  authSelectOrganization
} from "../services/auth.service";
import {
  companyGetCountryCode,
  companyGetCountryName,
  companyLoadMyOrganization,
  companyGetProfile,
  ORGANIZATION_UPDATED_EVENT
} from "../services/company.service";
import {
  isOrganizationScopedStorageEventKey,
  isUserScopedStorageEventKey,
  LS_KEYS
} from "../services/storage";

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

function stripLeadingCountryCode(countryValue, countryCode) {
  const country = String(countryValue || "").trim();
  const code = String(countryCode || "")
    .trim()
    .toUpperCase();
  if (!country || !code) return country;
  const duplicatePrefix = new RegExp(`^${code}\\s+`, "i");
  return country.replace(duplicatePrefix, "").trim();
}

function buildOrganizationState(profile = null) {
  const organizationId = String(authGetOrganizationId() || "").trim();
  const source = organizationId ? profile || companyGetProfile() || {} : {};
  const countryCodeRaw = String(source?.countryCode || source?.country_code || "")
    .trim()
    .toUpperCase();
  const countryRaw = String(source?.country || source?.country_name || "").trim();
  const countryCode = countryCodeRaw || companyGetCountryCode(countryRaw || "India");
  const country = stripLeadingCountryCode(
    countryRaw || companyGetCountryName(countryCode || "IN"),
    countryCode
  );
  const currency =
    normalizeCurrencyCode(source?.currency || source?.base_currency || source?.tax?.currency) || "INR";

  return {
    organizationId,
    profile: source,
    country,
    countryCode,
    countryLabel: country,
    currency,
    currencySymbol: resolveCurrencySymbol(currency)
  };
}

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const [organization, setOrganization] = useState(() => buildOrganizationState());
  const [organizations, setOrganizations] = useState([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState("");

  const refreshOrganization = useCallback(() => {
    setOrganization(buildOrganizationState());
  }, []);

  const refreshOrganizations = useCallback(async () => {
    if (!authGetToken()) {
      setOrganizations([]);
      return [];
    }

    setOrganizationsLoading(true);
    try {
      const nextRows = await authListOrganizations();
      const safeRows = Array.isArray(nextRows) ? nextRows : [];
      setOrganizations(safeRows);
      return safeRows;
    } catch {
      setOrganizations([]);
      return [];
    } finally {
      setOrganizationsLoading(false);
    }
  }, []);

  const switchOrganization = useCallback(
    async (nextOrganizationId) => {
      const safeOrganizationId = String(nextOrganizationId || "").trim();
      if (!safeOrganizationId) {
        throw new Error("Company selection is required.");
      }
      if (safeOrganizationId === String(authGetOrganizationId() || "").trim()) {
        refreshOrganization();
        return { organizationId: safeOrganizationId };
      }

      setSwitchingOrganizationId(safeOrganizationId);
      try {
        const selected = await authSelectOrganization(safeOrganizationId);
        await companyLoadMyOrganization(safeOrganizationId);
        refreshOrganization();
        await refreshOrganizations();
        return selected;
      } finally {
        setSwitchingOrganizationId("");
      }
    },
    [refreshOrganization, refreshOrganizations]
  );

  useEffect(() => {
    const onStorage = (event) => {
      if (
        !event?.key ||
        isOrganizationScopedStorageEventKey(LS_KEYS.company_profile, event.key) ||
        isUserScopedStorageEventKey(LS_KEYS.organization_id, event.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.organization_id, event.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.companyProfileCompleted, event.key)
      ) {
        refreshOrganization();
        void refreshOrganizations();
      }
    };

    const onProfileChanged = (event) => {
      if (event?.detail && typeof event.detail === "object") {
        setOrganization(buildOrganizationState(event.detail));
        void refreshOrganizations();
        return;
      }
      refreshOrganization();
      void refreshOrganizations();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshOrganization);
    window.addEventListener("focus", refreshOrganizations);
    window.addEventListener(ORGANIZATION_UPDATED_EVENT, onProfileChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshOrganization);
      window.removeEventListener("focus", refreshOrganizations);
      window.removeEventListener(ORGANIZATION_UPDATED_EVENT, onProfileChanged);
    };
  }, [refreshOrganization, refreshOrganizations]);

  useEffect(() => {
    void refreshOrganizations();
  }, [refreshOrganizations]);

  const value = useMemo(
    () => ({
      ...organization,
      currentOrganization: organizations.find(
        (entry) => String(entry?.organizationId || "").trim() === String(organization.organizationId || "").trim()
      ) || null,
      organizations,
      organizationsLoading,
      switchingOrganizationId,
      refreshOrganization,
      refreshOrganizations,
      switchOrganization
    }),
    [
      organization,
      organizations,
      organizationsLoading,
      switchingOrganizationId,
      refreshOrganization,
      refreshOrganizations,
      switchOrganization
    ]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) throw new Error("useOrganization must be used within OrganizationProvider");
  return context;
}
