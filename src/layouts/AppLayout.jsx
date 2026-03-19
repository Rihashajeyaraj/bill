import React, { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import PageLoader from "../components/PageLoader";
import { usePageLoading } from "../context/PageLoadingContext";
import { useOrganization } from "../context/OrganizationContext";

const DESKTOP_QUERY = "(min-width: 1024px)";

function isDesktopViewport() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

export default function AppLayout() {
  const { organizationId } = useOrganization();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => isDesktopViewport());
  const location = useLocation();
  const routeTimerRef = useRef(null);
  const { isLoading, setRouteLoading } = usePageLoading();
  const effectiveCollapsed = useMemo(() => (isDesktop ? collapsed : false), [collapsed, isDesktop]);
  const mainOffset = useMemo(
    () => (effectiveCollapsed ? "lg:ml-[84px]" : "lg:ml-[260px]"),
    [effectiveCollapsed]
  );
  const sidebarWidth = effectiveCollapsed ? "84px" : "260px";

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const handleChange = (event) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setRouteLoading(true);
    if (routeTimerRef.current) {
      window.clearTimeout(routeTimerRef.current);
    }
    routeTimerRef.current = window.setTimeout(() => {
      setRouteLoading(false);
      routeTimerRef.current = null;
    }, 320);
  }, [location.pathname, location.search, setRouteLoading]);

  useEffect(() => {
    if (isDesktop) setMobileNavOpen(false);
  }, [isDesktop]);

  useEffect(
    () => () => {
      if (routeTimerRef.current) {
        window.clearTimeout(routeTimerRef.current);
      }
      setRouteLoading(false);
    },
    [setRouteLoading]
  );

  return (
    <div
      key={organizationId || "no-organization"}
      className="app-shell h-dvh overflow-hidden lg:h-screen"
      style={{ "--app-sidebar-width": sidebarWidth }}
    >
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] lg:hidden"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <div
        className={`sidebar fixed inset-y-0 left-0 z-[60] transition-transform duration-200 ease-out ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <Sidebar
          collapsed={effectiveCollapsed}
          onToggle={() => setCollapsed((v) => !v)}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </div>
      <div className={`${mainOffset} app-main-pad ml-0 flex h-dvh min-w-0 flex-col transition-all duration-200 lg:h-screen`}>
        <div className="topbar shrink-0">
          <Topbar onOpenSidebar={() => setMobileNavOpen(true)} />
        </div>
        <main
          className="app-main relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <Outlet />
          <PageLoader visible={isLoading} />
        </main>
      </div>
    </div>
  );
}
