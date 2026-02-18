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
import { companyGetProfile } from "../services/company.service";

const base = "app-sidebar-item";
const active = "app-sidebar-item is-active";

function Item({ to, icon: Icon, label, collapsed }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors",
          isActive ? active : base
        )
      }
    >
      <Icon className="h-4.5 w-4.5" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </NavLink>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  const width = collapsed ? "w-[84px]" : "w-[260px]";
  const company = companyGetProfile();
  const companyName = useMemo(() => {
    const value = String(company?.companyName || "").trim();
    return value || "BillJoy";
  }, [company?.companyName]);

  const items = useMemo(() => {
    return [
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/app/parties", icon: Users, label: "Parties" },
      { to: "/app/items", icon: Boxes, label: "Items" },
      { to: "/app/sales/invoice", icon: ReceiptIndianRupee, label: "Invoices" },
      { to: "/app/purchase/bill", icon: FileText, label: "Purchases" },
      { to: "/app/sales/credit-note", icon: BadgePercent, label: "Credit Note" },
      { to: "/app/purchase/debit-note", icon: BadgePercent, label: "Debit Note" },
      { to: "/app/sales/payment-in", icon: ArrowDownToLine, label: "Payment In" },
      { to: "/app/purchases/payment-out", icon: ArrowUpFromLine, label: "Payment Out" },
      { to: "/app/company-setup", icon: Building2, label: "Company Setup" },
      { to: "/invoice-template-setup", icon: LayoutTemplate, label: "Invoice Template" },
      { to: "/app/reports", icon: BarChart3, label: "Reports" },
      { to: "/app/company-settings", icon: Settings, label: "Settings" }
    ];
  }, []);

  return (
    <aside
      className={clsx("app-sidebar fixed left-0 top-0 z-50 h-screen", width)}
    >
      <div className="h-full flex flex-col">
        <div className="px-4 py-4 flex items-center justify-between">
          <div className="min-w-0">
            {!collapsed ? (
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-10 w-10 rounded-2xl border border-white/20 bg-white/70 flex items-center justify-center overflow-hidden shrink-0">
                  {company?.logoBase64 ? (
                    <img src={company.logoBase64} alt="Company logo" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ background: "var(--app-gradient)" }} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="app-sidebar-title text-sm font-semibold truncate">{companyName}</p>
                  <p className="app-sidebar-subtitle text-xs">Billing Suite</p>
                </div>
              </div>
            ) : (
              <div className="h-9 w-9 rounded-2xl border border-white/20 bg-white/70 flex items-center justify-center overflow-hidden">
                {company?.logoBase64 ? (
                  <img src={company.logoBase64} alt="Company logo" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full" style={{ background: "var(--app-gradient)" }} />
                )}
              </div>
            )}
          </div>
          <button
            onClick={onToggle}
            className="app-sidebar-toggle h-9 w-9 rounded-2xl flex items-center justify-center"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="px-3 py-2 flex-1 overflow-auto">
          {items.map((it, idx) =>
            it.section ? (
              <div key={`sec_${idx}`} className={clsx("mt-3 mb-2", collapsed ? "px-1" : "px-2")}>
                {!collapsed ? <p className="app-sidebar-subtitle text-xs font-semibold uppercase">{it.section}</p> : null}
              </div>
            ) : (
              <div key={it.to} className="mb-1">
                <Item {...it} collapsed={collapsed} />
              </div>
            )
          )}
        </nav>

        <div className="app-sidebar-tip-wrap px-3 py-4">
          <div className="app-sidebar-tip rounded-2xl p-3">
            {!collapsed ? (
              <>
                <p className="app-sidebar-tip-title text-sm font-semibold">Tip</p>
                <p className="app-sidebar-tip-copy mt-1 text-xs">Complete Company Setup to unlock the dashboard.</p>
              </>
            ) : (
              <div className="app-sidebar-tip-dot h-3 w-3 rounded-full" />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
