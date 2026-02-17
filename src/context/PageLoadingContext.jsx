import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  beginPageLoading,
  endPageLoading,
  getPageLoadingSnapshot,
  setRouteLoading,
  subscribePageLoading,
  withPageLoading
} from "../state/pageLoadingStore";

const PageLoadingContext = createContext(null);

export function PageLoadingProvider({ children }) {
  const [snapshot, setSnapshot] = useState(() => getPageLoadingSnapshot());

  useEffect(() => {
    return subscribePageLoading(() => {
      setSnapshot(getPageLoadingSnapshot());
    });
  }, []);

  const value = useMemo(
    () => ({
      ...snapshot,
      startLoading: beginPageLoading,
      stopLoading: endPageLoading,
      setRouteLoading,
      withLoading: withPageLoading
    }),
    [snapshot]
  );

  return <PageLoadingContext.Provider value={value}>{children}</PageLoadingContext.Provider>;
}

export function usePageLoading() {
  const context = useContext(PageLoadingContext);
  if (!context) throw new Error("usePageLoading must be used within PageLoadingProvider");
  return context;
}
