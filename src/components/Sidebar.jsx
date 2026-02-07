import React, { useMemo } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  LayoutTemplate,
  Users,
  Boxes,
  ReceiptIndianRupee,
  BadgePercent,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  BarChart3,
  Building2,
  Settings,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import clsx from "clsx";
import { UI } from "../theme/tokens";

const base = "text-white/80 hover:bg-white/10";
const active = "text-white";

function Item({ to, icon: Icon, label, collapsed }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition",
          isActive ? active : base
        )
      }
      style={({ isActive }) => (isActive ? { background: UI.GRADIENT } : {})}
    >
      <Icon className="h-4.5 w-4.5" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </NavLink>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  const width = collapsed ? "w-[84px]" : "w-[260px]";

  const items = useMemo(() => {
    return [
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/app/company-setup", icon: Building2, label: "Company Setup" },
      { to: "/invoice-template-setup", icon: LayoutTemplate, label: "Invoice Template" },
      { to: "/app/parties", icon: Users, label: "Parties" },
      { to: "/app/items", icon: Boxes, label: "Items" },
      { to: "/app/sales/invoice", icon: ReceiptIndianRupee, label: "Invoices" },
      { to: "/app/purchase/bill", icon: FileText, label: "Purchases" },
      { to: "/app/sales/credit-note", icon: BadgePercent, label: "Credit Note" },
      { to: "/app/purchase/debit-note", icon: BadgePercent, label: "Debit Note" },
      { to: "/app/sales/payment-in", icon: ArrowDownToLine, label: "Payment In" },
      { to: "/app/purchases/payment-out", icon: ArrowUpFromLine, label: "Payment Out" },
      { to: "/app/reports", icon: BarChart3, label: "Reports" },
      { to: "/app/company-settings", icon: Settings, label: "Settings" }
    ];
  }, []);

  return (
    <aside
      className={clsx("fixed left-0 top-0 z-50 h-screen border-r border-white/10 text-white", width)}
      style={{ background: UI.GRADIENT }}
    >
      <div className="h-full flex flex-col">
        <div className="px-4 py-4 flex items-center justify-between">
          <div className="min-w-0">
            {!collapsed ? (
              <>
                <p className="text-sm font-semibold text-white">BillJoy</p>
                <p className="text-xs text-white/70">Billing Suite</p>
              </>
            ) : (
              <div className="h-9 w-9 rounded-2xl bg-white/10" />
            )}
          </div>
          <button
            onClick={onToggle}
            className="h-9 w-9 rounded-2xl border border-white/20 bg-white/10 hover:bg-white/15 flex items-center justify-center"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="px-3 py-2 flex-1 overflow-auto">
          {items.map((it, idx) =>
            it.section ? (
              <div key={`sec_${idx}`} className={clsx("mt-3 mb-2", collapsed ? "px-1" : "px-2")}>
                {!collapsed ? <p className="text-xs font-semibold text-white/60 uppercase">{it.section}</p> : null}
              </div>
            ) : (
              <div key={it.to} className="mb-1">
                <Item {...it} collapsed={collapsed} />
              </div>
            )
          )}
        </nav>

        <div className="px-3 py-4 border-t border-slate-100">
          <div className="rounded-2xl p-3 border border-slate-100" style={{ background: UI.COLORS.cream }}>
            {!collapsed ? (
              <>
                <p className="text-sm font-semibold text-slate-900">Tip</p>
                <p className="text-xs text-slate-600 mt-1">Complete Company Setup to unlock the dashboard.</p>
              </>
            ) : (
              <div className="h-3 w-3 rounded-full" style={{ background: UI.COLORS.deepRed }} />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
