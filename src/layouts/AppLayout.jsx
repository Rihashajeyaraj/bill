import React, { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import { UI } from "../theme/tokens";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const mainOffset = useMemo(() => (collapsed ? "ml-[84px]" : "ml-[260px]"), [collapsed]);
  const sidebarWidth = collapsed ? "84px" : "260px";

  return (
    <div
      className="h-screen overflow-hidden"
      style={{ background: UI.COLORS.bg, "--app-sidebar-width": sidebarWidth }}
    >
      <div className="sidebar">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>
      <div className={`${mainOffset} app-main-pad flex h-screen min-w-0 flex-col transition-all duration-200`}>
        <div className="topbar shrink-0">
          <Topbar collapsed={collapsed} />
        </div>
        <main className="app-main min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5 lg:py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
