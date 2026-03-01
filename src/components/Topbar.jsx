import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, LogOut, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authGetRole, authGetUser, authLogout } from "../services/auth.service";
import { useOrganization } from "../context/OrganizationContext";
import { useAppShell } from "../context/AppShellContext";
import { formatDateByPreference, formatTimeByPreference } from "../lib/formatPreferences";

export default function Topbar({ onOpenSidebar }) {
  const nav = useNavigate();
  const user = authGetUser();
  const role = authGetRole();
  const { profile: company = {} } = useOrganization();
  const { unreadCount } = useAppShell();
  const companyName = String(company?.companyName || "").trim();

  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(() => new Date());
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
    if (!menu) return;

    function handleOutside(event) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target)) {
        setMenu(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenu(false);
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
  }, [menu]);

  async function logout() {
    await authLogout();
    nav("/login", { replace: true });
  }

  return (
    <header className="app-topbar sticky top-0 z-40 backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 lg:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="app-topbar-user-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-col">
            <p className="app-topbar-title truncate text-sm font-semibold sm:text-base">{companyName || "My Shop"}</p>
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
            className="app-topbar-user-btn relative inline-flex h-10 w-10 items-center justify-center rounded-2xl p-0 shadow-soft"
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
              <div className="app-topbar-user-avatar h-8 w-8 rounded-2xl flex items-center justify-center text-xs font-bold">
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
              <div className="hidden text-left sm:block">
                <p className="app-topbar-title text-sm font-semibold leading-4">{user?.name || "User"}</p>
                <p className="app-topbar-subtitle text-xs leading-4">{role}</p>
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
    </header>
  );
}
