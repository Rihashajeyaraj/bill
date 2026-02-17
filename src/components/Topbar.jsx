import React, { useMemo, useState } from "react";
import { ChevronDown, LogOut, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authGetRole, authGetUser, authLogout } from "../services/auth.service";
import { companyGetProfile } from "../services/company.service";

export default function Topbar() {
  const nav = useNavigate();
  const user = authGetUser();
  const role = authGetRole();
  const company = companyGetProfile();

  const [menu, setMenu] = useState(false);

  const companyName = useMemo(() => company?.companyName || "Your Company", [company]);

  async function logout() {
    await authLogout();
    nav("/login", { replace: true });
  }

  return (
    <header className="app-topbar sticky top-0 z-40 backdrop-blur">
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="app-topbar-logo h-9 w-9 rounded-2xl flex items-center justify-center overflow-hidden">
            {company?.logoBase64 ? (
              <img src={company.logoBase64} alt="logo" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full" style={{ background: "var(--app-gradient)" }} />
            )}
          </div>
          <div className="min-w-0">
            <p className="app-topbar-title text-sm font-semibold truncate">{companyName}</p>
            <p className="app-topbar-subtitle text-xs">BillJoy | Billing Suite</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <Search className="app-topbar-subtitle absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              placeholder="Search (optional)"
              className="app-topbar-search w-[320px] rounded-2xl px-10 py-2 text-sm outline-none"
              style={{ boxShadow: "none" }}
            />
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenu((v) => !v)}
            className="app-topbar-user-btn rounded-2xl px-3 py-2 shadow-soft flex items-center gap-2"
          >
            <div className="app-topbar-user-avatar h-8 w-8 rounded-2xl flex items-center justify-center text-xs font-bold">
              {(user?.name || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
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
    </header>
  );
}
