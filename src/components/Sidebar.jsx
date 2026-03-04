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

function Item({ to, icon: Icon, label, collapsed, onNavigate, activeMatchers = [] }) {
  const location = useLocation();
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors",
          isActive || activeMatchers.some((path) => routeMatches(location.pathname, path)) ? active : base
        )
      }
    >
      <Icon className="h-4.5 w-4.5" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
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
    sales: salesActive,
    purchase: purchaseActive,
    adjustments: adjustmentsActive,
    payments: paymentsActive
  }));

  useEffect(() => {
    setOpenGroups((prev) => ({
      sales: prev.sales || salesActive,
      purchase: prev.purchase || purchaseActive,
      adjustments: prev.adjustments || adjustmentsActive,
      payments: prev.payments || paymentsActive
    }));
  }, [salesActive, purchaseActive, adjustmentsActive, paymentsActive]);

  const companyName = useMemo(() => {
    const value = String(company?.companyName || "").trim();
    return value || "BillJoy";
  }, [company?.companyName]);

  const items = useMemo(() => {
    const baseItems = [
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/app/notifications", icon: Bell, label: "Notifications" },
      { to: "/app/parties", icon: Users, label: "Parties" },
      { to: "/app/items", icon: Boxes, label: "Items" },
      {
        type: "group",
        key: "sales",
        icon: FileText,
        label: "Sales",
        children: [
          {
            to: "/app/sales/proformas/new",
            icon: FileText,
            label: "Pro Forma Invoice",
            activeMatchers: ["/sales/proformas", "/app/sales/proformas"]
          },
          {
            to: "/app/sales/invoice",
            icon: ReceiptIndianRupee,
            label: "Invoice",
            activeMatchers: ["/sales/invoices", "/app/sales/invoice"]
          }
        ]
      },
      {
        type: "group",
        key: "purchase",
        icon: ShoppingCart,
        label: "Purchase",
        children: [
          {
            to: "/app/purchase/proformas/new",
            icon: FileText,
            label: "Pro Forma Purchase Order",
            activeMatchers: ["/purchase/proformas", "/app/purchase/proformas"]
          },
          {
            to: "/app/purchase/bill",
            icon: FileText,
            label: "Purchase Bill",
            activeMatchers: ["/purchase/bills", "/app/purchase/bill"]
          }
        ]
      },
      {
        type: "group",
        key: "adjustments",
        icon: BadgePercent,
        label: "Adjustments",
        children: [
          { to: "/app/sales/credit-note", icon: BadgePercent, label: "Credit Note" },
          { to: "/app/purchase/debit-note", icon: BadgePercent, label: "Debit Note" }
        ]
      },
      {
        type: "group",
        key: "payments",
        icon: Wallet,
        label: "Payments",
        children: [
          { to: "/app/sales/payment-in", icon: ArrowDownToLine, label: "Payment In" },
          { to: "/app/purchases/payment-out", icon: ArrowUpFromLine, label: "Payment Out" }
        ]
      },
      { to: "/app/purchase/expense", icon: Wallet, label: "Expense" },
      ...(canOpenReports ? [{ to: "/app/reports", icon: BarChart3, label: "Reports" }] : []),
      ...(canOpenSettings
        ? [
            { to: "/app/company-settings", icon: Settings, label: "Settings" },
            { to: "/app/backup", icon: Download, label: "Backup" }
          ]
        : [])
    ];
    if (showCompanySetup) {
      const insertAt = baseItems.findIndex((item) => item.to === "/app/company-settings");
      baseItems.splice(insertAt === -1 ? baseItems.length : insertAt, 0, {
        to: "/app/company-setup",
        icon: Building2,
        label: "Company Setup"
      });
    }
    return baseItems;
  }, [showCompanySetup, canOpenReports, canOpenSettings]);

  const groupIsActive = {
    sales: salesActive,
    purchase: purchaseActive,
    adjustments: adjustmentsActive,
    payments: paymentsActive
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
              <>
                <p className="app-sidebar-tip-title text-sm font-semibold">Tip</p>
                <p className="app-sidebar-tip-copy mt-1 text-xs">
                  {showCompanySetup
                    ? "Complete Company Setup to unlock the dashboard."
                    : canOpenSettings
                      ? "Edit company details in Settings -> Company Profile."
                      : "Ask Owner to update company settings and access permissions."}
                </p>
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
