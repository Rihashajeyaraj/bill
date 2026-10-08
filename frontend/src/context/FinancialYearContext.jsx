import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyFinancialYearRange,
  financialYearsGetCurrent,
  financialYearsGetSelected,
  financialYearsList,
  financialYearsSetSelected,
  financialYearsSyncFromRemote,
  FINANCIAL_YEARS_UPDATED_EVENT
} from "../services/financialYears.service";
import {
  isOrganizationScopedStorageEventKey,
  LS_KEYS
} from "../services/storage";
import { useOrganization } from "./OrganizationContext";

const FinancialYearContext = createContext(null);

export function FinancialYearProvider({ children }) {
  const { profile } = useOrganization();
  const [years, setYears] = useState(() => financialYearsList());
  const [selectedYear, setSelectedYear] = useState(() => financialYearsGetSelected());

  const refreshFinancialYears = useCallback(async () => {
    try {
      const nextRows = await financialYearsSyncFromRemote(profile);
      setYears(nextRows);
      setSelectedYear(financialYearsGetSelected());
    } catch {
      const fallbackRows = financialYearsList();
      setYears(fallbackRows);
      setSelectedYear(financialYearsGetSelected());
    }
  }, [profile]);

  const selectFinancialYear = useCallback((nextId) => {
    const nextRows = financialYearsSetSelected(nextId);
    setYears(nextRows);
    setSelectedYear(financialYearsGetSelected());
  }, []);

  useEffect(() => {
    void refreshFinancialYears();
  }, [refreshFinancialYears]);

  useEffect(() => {
    const onStorage = (event) => {
      if (
        isOrganizationScopedStorageEventKey(LS_KEYS.financial_years, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.selected_financial_year_id, event?.key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.company_profile, event?.key)
      ) {
        setYears(financialYearsList());
        setSelectedYear(financialYearsGetSelected());
      }
    };

    const onUpdated = () => {
      setYears(financialYearsList());
      setSelectedYear(financialYearsGetSelected());
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(FINANCIAL_YEARS_UPDATED_EVENT, onUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(FINANCIAL_YEARS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  const value = useMemo(
    () => ({
      years,
      selectedYear,
      currentYear: financialYearsGetCurrent(),
      activeRange: applyFinancialYearRange({}, selectedYear),
      refreshFinancialYears,
      selectFinancialYear
    }),
    [years, selectedYear, refreshFinancialYears, selectFinancialYear]
  );

  return <FinancialYearContext.Provider value={value}>{children}</FinancialYearContext.Provider>;
}

export function useFinancialYears() {
  const context = useContext(FinancialYearContext);
  if (!context) throw new Error("useFinancialYears must be used within FinancialYearProvider");
  return context;
}
