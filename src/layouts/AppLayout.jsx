import React, { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import { UI } from "../theme/tokens";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const mainPad = useMemo(() => (collapsed ? "pl-[84px]" : "pl-[260px]"), [collapsed]);

  return (
    <div className="min-h-screen" style={{ background: UI.COLORS.bg }}>
      <div className="sidebar">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </div>
      <div className={`${mainPad} transition-all duration-200 app-main-pad`}>
        <div className="topbar">
          <Topbar collapsed={collapsed} />
        </div>
        <main className="px-5 py-5 app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
