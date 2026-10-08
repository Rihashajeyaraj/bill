import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Bell,
  Users,
  Boxes,
  ReceiptIndianRupee,
  BadgePercent,
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  FileText,
  ShoppingCart,
  BarChart3,
  Building2,
  Settings,
  Download,
  History,
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import clsx from "clsx";
import { companyIsCompleted } from "../services/company.service";
import { authGetRole } from "../services/auth.service";
import { canAccessSettings, canViewReports } from "../services/roles";
import { useOrganization } from "../context/OrganizationContext";

const base = "app-sidebar-item";
const active = "app-sidebar-item is-active";

function routeMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Item({ to, icon: Icon, label, collapsed, onNavigate, activeMatchers = [], unavailable = false }) {
  const location = useLocation();
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors",
          isActive || activeMatchers.some((path) => routeMatches(location.pathname, path)) ? active : base,
          unavailable && "opacity-70 hover:opacity-100"
        )
      }
    >
      <Icon className="h-4.5 w-4.5 shrink-0" />
      {!collapsed ? (
        <div className="flex items-center justify-between flex-1 min-w-0">
          <span className="truncate">{label}</span>
          {unavailable ? (
            <span className="ml-auto text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/80 shrink-0">
              Soon
            </span>
          ) : null}
        </div>
      ) : null}
    </NavLink>
  );
}

export default function Sidebar({ collapsed, onToggle, onNavigate }) {
  const location = useLocation();
  const width = collapsed ? "w-[84px]" : "w-[260px]";
  const headerPadding = collapsed ? "px-2" : "px-4";
  const toggleSize = collapsed ? "h-7 w-7 rounded-xl" : "h-9 w-9 rounded-2xl";
  const { profile: company = {} } = useOrganization();
  const role = authGetRole();
  const setupComplete = companyIsCompleted();
  const canOpenSettings = canAccessSettings(role);
  const canOpenReports = canViewReports(role);
  const showCompanySetup = canAccessSettings(role) && !setupComplete;
  const salesActive = routeMatches(location.pathname, "/app/sales") || routeMatches(location.pathname, "/sales");
  const purchaseActive = routeMatches(location.pathname, "/app/purchase") ||
    routeMatches(location.pathname, "/purchase") ||
    routeMatches(location.pathname, "/app/purchases");
  const adjustmentsActive = routeMatches(location.pathname, "/app/sales/credit-note") ||
    routeMatches(location.pathname, "/app/purchase/debit-note");
  const paymentsActive = routeMatches(location.pathname, "/app/sales/payment-in") ||
    routeMatches(location.pathname, "/app/purchases/payment-out") ||
    routeMatches(location.pathname, "/app/purchase/payment-out");
  const [openGroups, setOpenGroups] = useState(() => ({
    sales: true,
    payments: paymentsActive,
    purchase: false,
    adjustments: false,
    otherUnavailable: false
  }));

  useEffect(() => {
    setOpenGroups((prev) => ({
      sales: prev.sales || salesActive,
      payments: prev.payments || paymentsActive,
      purchase: prev.purchase || purchaseActive,
      adjustments: prev.adjustments || adjustmentsActive,
      otherUnavailable: prev.otherUnavailable
    }));
  }, [salesActive, purchaseActive, adjustmentsActive, paymentsActive]);

  const companyName = useMemo(() => {
    const value = String(company?.companyName || "").trim();
    return value || "BillJoy";
  }, [company?.companyName]);

  const items = useMemo(() => {
    return [
      // Core V1 Modules
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      {
        type: "group",
        key: "sales",
        icon: FileText,
        label: "Sales",
        children: [
          {
            to: "/app/sales/proformas/history",
            icon: FileText,
            label: "Pro Forma Invoice",
            activeMatchers: ["/sales/proformas", "/app/sales/proformas"]
          },
          {
            to: "/app/sales/invoice/history",
            icon: ReceiptIndianRupee,
            label: "Tax Invoice",
            activeMatchers: ["/sales/invoices", "/app/sales/invoice"]
          }
        ]
      },
      {
        type: "group",
        key: "payments",
        icon: Wallet,
        label: "Payments",
        children: [
          { to: "/app/sales/payment-in", icon: ArrowDownToLine, label: "Payment In" }
        ]
      },
      ...(canOpenReports ? [{ to: "/app/reports", icon: BarChart3, label: "Reports" }] : []),

      // Unavailable Modules (V2 Scope)
      {
        type: "group",
        key: "otherUnavailable",
        icon: Settings,
        label: "Other Modules",
        unavailable: true,
        children: [
          { to: "/app/parties", icon: Users, label: "Parties", unavailable: true },
          { to: "/app/items", icon: Boxes, label: "Items", unavailable: true },
          { to: "/app/purchase/history", icon: ShoppingCart, label: "Purchase", unavailable: true },
          { to: "/app/purchases/payment-out", icon: ArrowUpFromLine, label: "Payment Out", unavailable: true },
          { to: "/app/sales/credit-note", icon: BadgePercent, label: "Credit Notes", unavailable: true },
          { to: "/app/purchase/debit-note", icon: BadgePercent, label: "Debit Notes", unavailable: true },
          { to: "/app/purchase/expense", icon: Wallet, label: "Expenses", unavailable: true },
          { to: "/app/notifications", icon: Bell, label: "Notifications", unavailable: true },
          { to: "/app/company-settings", icon: Settings, label: "Company Settings", unavailable: true },
          { to: "/app/backup", icon: Download, label: "Backup", unavailable: true },
          { to: "/app/audit-history", icon: History, label: "Audit History", unavailable: true }
        ]
      }
    ];
  }, [canOpenReports]);

  const groupIsActive = {
    sales: salesActive,
    payments: paymentsActive,
    purchase: purchaseActive,
    adjustments: adjustmentsActive,
    otherUnavailable: false
  };

  return (
    <aside
      className={clsx("app-sidebar h-dvh lg:h-screen", width)}
    >
      <div className="h-full flex flex-col">
        <div className={clsx("app-sidebar-header flex items-center justify-between", headerPadding)}>
          <div className="app-sidebar-brand min-w-0">
            <div className="app-sidebar-logo shrink-0">
              {company?.logoBase64 ? (
                <img src={company.logoBase64} alt="Company logo" className="app-sidebar-logo-img" />
              ) : (
                <div className="app-sidebar-placeholder flex h-full w-full items-center justify-center text-xs font-semibold text-white">
                  {companyName.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            {!collapsed ? (
              <div className="app-sidebar-brand-copy min-w-0">
                <p className="app-sidebar-title text-sm font-semibold truncate">{companyName}</p>
                <p className="app-sidebar-subtitle text-xs leading-5">Billing Suite</p>
              </div>
            ) : null}
          </div>
          <button
            onClick={onToggle}
            className={clsx("app-sidebar-toggle hidden items-center justify-center shrink-0 lg:flex", toggleSize)}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="px-3 py-2 flex-1 overflow-auto">
          {items.map((it) =>
            it.type === "group" ? (
              <div key={it.key} className="mb-1">
                <button
                  type="button"
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [it.key]: !prev[it.key] }))}
                  className={clsx(
                    "w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors",
                    groupIsActive[it.key] ? active : base
                  )}
                >
                  <it.icon className="h-4.5 w-4.5" />
                  {!collapsed ? (
                    <>
                      <span className="truncate">{it.label}</span>
                      <ChevronDown
                        className={clsx(
                          "ml-auto h-4 w-4 transition-transform",
                          openGroups[it.key] ? "rotate-180" : ""
                        )}
                      />
                    </>
                  ) : null}
                </button>
                {!collapsed ? (
                  <div
                    className={clsx(
                      "mt-1 space-y-1 pl-4 overflow-hidden transition-all duration-200 ease-in-out",
                      openGroups[it.key] ? "max-h-96 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                    )}
                  >
                    {it.children.map((child) => (
                      <Item key={child.to} {...child} collapsed={false} onNavigate={onNavigate} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div key={it.to} className="mb-1">
                <Item {...it} collapsed={collapsed} onNavigate={onNavigate} />
              </div>
            )
          )}
        </nav>

        <div className="app-sidebar-tip-wrap px-3 py-4">
          <div className="app-sidebar-tip rounded-2xl p-3">
            {!collapsed ? (
              <a
                href="https://twite.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="app-sidebar-tip-link block w-full no-underline transition"
              >
                <div className="app-sidebar-tip-branding">
                  <div className="app-sidebar-tip-copy">Created by</div>
                  <div className="app-sidebar-tip-title">Twite AI Technologies</div>
                </div>
              </a>
            ) : (
              <div className="app-sidebar-tip-dot h-3 w-3 rounded-full" />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
