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
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className={`${mainPad} transition-all duration-200`}>
        <Topbar collapsed={collapsed} />
        <main className="px-5 py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
