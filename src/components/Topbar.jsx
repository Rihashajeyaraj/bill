import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Building2, Check, ChevronDown, LogOut, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { authGetRole, authGetUser, authLogout } from "../services/auth.service";
import { useOrganization } from "../context/OrganizationContext";
import { useFinancialYears } from "../context/FinancialYearContext";
import { useAppShell } from "../context/AppShellContext";
import { useToast } from "../context/ToastContext";
import { formatDateByPreference, formatTimeByPreference } from "../lib/formatPreferences";
import { canAccessPathForRole } from "../services/accessControl";

function pathForNext(next) {
  if (next === "organization_setup") return "/company-setup";
  if (next === "invoice_template_setup") return "/invoice-template-setup";
  return "/dashboard";
}

export default function Topbar({ onOpenSidebar }) {
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const user = authGetUser();
  const role = authGetRole();
  const {
    organizationId,
    profile: company = {},
    organizations,
    organizationsLoading,
    switchingOrganizationId,
    switchOrganization
  } = useOrganization();
  const { years, selectedYear, selectFinancialYear } = useFinancialYears();
  const { unreadCount } = useAppShell();
  const companyName = String(company?.companyName || "").trim();

  const [companyMenu, setCompanyMenu] = useState(false);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const companyMenuRef = useRef(null);
  const menuRef = useRef(null);

  const weekdayText = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long"
      }).format(now),
    [now]
  );
  const dateText = useMemo(
    () => formatDateByPreference(now),
    [now]
  );
  const timeText = useMemo(
    () => formatTimeByPreference(now),
    [now]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!menu && !companyMenu) return;

    function handleOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenu(false);
      }
      if (companyMenuRef.current && !companyMenuRef.current.contains(event.target)) {
        setCompanyMenu(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenu(false);
        setCompanyMenu(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [companyMenu, menu]);

  async function logout() {
    await authLogout();
    nav("/login", { replace: true });
  }

  async function handleCompanySwitch(nextOrganizationId) {
    const safeOrganizationId = String(nextOrganizationId || "").trim();
    if (!safeOrganizationId || safeOrganizationId === String(organizationId || "").trim()) {
      setCompanyMenu(false);
      return;
    }

    const selected = await switchOrganization(safeOrganizationId);
    setCompanyMenu(false);

    const nextPath = pathForNext(selected?.next);
    if (nextPath !== "/dashboard") {
      nav(nextPath, { replace: true });
      return;
    }

    if (!canAccessPathForRole(authGetRole(), location.pathname)) {
      nav("/dashboard", { replace: true });
      return;
    }
  }

  return (
    <header className="app-topbar sticky top-0 z-40 backdrop-blur">
      <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onOpenSidebar}
              className="app-topbar-user-btn inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 flex-col">
              <p className="app-topbar-title truncate text-sm font-semibold sm:text-base lg:text-lg">{companyName || "My Shop"}</p>
              <p className="app-topbar-subtitle truncate text-[11px] sm:text-xs">
                <span className="hidden sm:inline">
                  {weekdayText} | {dateText} | {timeText}
                </span>
                <span className="sm:hidden">
                  {dateText} | {timeText}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => nav("/app/notifications")}
              className="app-topbar-user-btn relative inline-flex h-11 w-11 items-center justify-center rounded-2xl p-0 shadow-soft"
              aria-label="Open notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="app-topbar-notice absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </button>

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenu((v) => !v)}
                className="app-topbar-user-btn flex items-center gap-2 rounded-2xl px-2 py-1.5 shadow-soft sm:px-3 sm:py-2"
              >
                <div className="app-topbar-user-avatar flex h-8 w-8 items-center justify-center rounded-2xl text-xs font-bold">
                  {company?.logoBase64 ? (
                    <img
                      src={company.logoBase64}
                      alt="Company logo"
                      className="h-full w-full rounded-2xl object-contain bg-white p-1"
                    />
                  ) : (
                    (companyName || user?.name || "U").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="hidden max-w-[120px] text-left xl:block">
                  <p className="app-topbar-title truncate text-sm font-semibold leading-4">{user?.name || "User"}</p>
                  <p className="app-topbar-subtitle truncate text-xs leading-4">{role}</p>
                </div>
                <ChevronDown className="app-topbar-subtitle h-4 w-4" />
              </button>

              {menu ? (
                <div className="app-topbar-menu absolute right-0 mt-2 w-56 rounded-2xl shadow-soft overflow-hidden">
                  <div className="app-topbar-menu-heading px-4 py-3">
                    <p className="app-topbar-title text-sm font-semibold">{user?.email}</p>
                    <p className="app-topbar-subtitle text-xs">Role: {role}</p>
                  </div>
                  <button
                    onClick={logout}
                    className="app-topbar-menu-btn w-full px-4 py-3 text-left text-sm font-semibold flex items-center gap-2"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full sm:w-auto">
            {selectedYear ? (
              <label className="w-full sm:w-[220px] sm:shrink-0">
                <span className="sr-only">Financial year</span>
                <select
                  value={selectedYear?.id || ""}
                  onChange={(event) => selectFinancialYear(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-soft outline-none focus:ring-4 focus:ring-slate-100"
                >
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>
                      FY {year.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <div className="relative" ref={companyMenuRef}>
            <button
              type="button"
              onClick={() => setCompanyMenu((current) => !current)}
              className="app-topbar-user-btn flex w-full min-w-0 items-center gap-2 rounded-2xl px-3 py-2 shadow-soft sm:w-auto sm:max-w-[260px]"
              aria-label="Switch company"
            >
              <Building2 className="h-4 w-4 shrink-0" />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-semibold text-slate-900">{companyName || "Select Company"}</p>
                <p className="truncate text-xs text-slate-500">
                  {organizationsLoading ? "Loading companies..." : `${organizations.length || 0} companies`}
                </p>
              </div>
              <ChevronDown className="app-topbar-subtitle h-4 w-4 shrink-0" />
            </button>

            {companyMenu ? (
              <div className="app-topbar-menu absolute right-0 mt-2 w-72 rounded-2xl shadow-soft overflow-hidden">
                <div className="app-topbar-menu-heading px-4 py-3">
                  <p className="app-topbar-title text-sm font-semibold">Switch Company</p>
                  <p className="app-topbar-subtitle text-xs">Choose a company without logging out.</p>
                </div>

                <div className="max-h-80 overflow-y-auto py-1">
                  {organizations.length ? (
                    organizations.map((entry) => {
                      const isCurrent = String(entry?.organizationId || "").trim() === String(organizationId || "").trim();
                      const isSwitching = switchingOrganizationId === entry?.organizationId;
                      return (
                        <button
                          key={entry.organizationId}
                          type="button"
                          onClick={() => {
                            void handleCompanySwitch(entry.organizationId).catch((error) => {
                              toast.error("Unable to switch company", error?.message || "Please try again.");
                            });
                          }}
                          disabled={isSwitching}
                          className="app-topbar-menu-btn flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{entry.companyName || "Untitled Company"}</p>
                            <p className="truncate text-xs text-slate-500">
                              {entry.role} | {entry.countryCode || "-"}
                            </p>
                          </div>
                          <div className="shrink-0">
                            {isSwitching ? (
                              <span className="text-xs font-semibold text-slate-500">Opening...</span>
                            ) : isCurrent ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">
                                <Check className="h-3.5 w-3.5" />
                                Current
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-4 py-4 text-sm text-slate-500">No companies available.</div>
                  )}
                </div>
              </div>
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
