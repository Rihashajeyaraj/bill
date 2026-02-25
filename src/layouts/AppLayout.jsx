import React, { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import PageLoader from "../components/PageLoader";
import { usePageLoading } from "../context/PageLoadingContext";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const routeTimerRef = useRef(null);
  const { isLoading, setRouteLoading } = usePageLoading();
  const mainOffset = useMemo(() => (collapsed ? "ml-[84px]" : "ml-[260px]"), [collapsed]);
  const sidebarWidth = collapsed ? "84px" : "260px";

  useEffect(() => {
    setRouteLoading(true);
    if (routeTimerRef.current) {
      window.clearTimeout(routeTimerRef.current);
    }
    routeTimerRef.current = window.setTimeout(() => {
      setRouteLoading(false);
      routeTimerRef.current = null;
    }, 320);
  }, [location.pathname, location.search, setRouteLoading]);

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
      className="app-shell h-screen overflow-hidden"
      style={{ "--app-sidebar-width": sidebarWidth }}
    >
      <div className="sidebar">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>
      <div className={`${mainOffset} app-main-pad flex h-screen min-w-0 flex-col transition-all duration-200`}>
        <div className="topbar shrink-0">
          <Topbar collapsed={collapsed} />
        </div>
        <main
          className="app-main relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-4 lg:px-5 lg:py-5"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <Outlet />
          <PageLoader visible={isLoading} />
        </main>
      </div>
    </div>
  );
}
