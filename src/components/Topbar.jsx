import React, { useMemo, useState } from "react";
import { ChevronDown, LogOut, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { UI } from "../theme/tokens";
import { authGetRole, authGetUser, authLogout } from "../services/auth.service";
import { companyGetProfile } from "../services/company.service";

export default function Topbar() {
  const nav = useNavigate();
  const user = authGetUser();
  const role = authGetRole();
  const company = companyGetProfile();

  const [menu, setMenu] = useState(false);

  const companyName = useMemo(() => company?.companyName || "Your Company", [company]);

  function logout() {
    authLogout();
    nav("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/85 backdrop-blur">
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-2xl border border-slate-100 flex items-center justify-center overflow-hidden">
            {company?.logoBase64 ? (
              <img src={company.logoBase64} alt="logo" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full" style={{ background: UI.GRADIENT }} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{companyName}</p>
            <p className="text-xs text-slate-500">BillJoy | Billing Suite</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              placeholder="Search (optional)"
              className="w-[320px] rounded-2xl border border-slate-100 bg-slate-50/60 px-10 py-2 text-sm outline-none focus:ring-4"
              style={{ boxShadow: "none", "--tw-ring-color": UI.COLORS.ring }}
            />
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenu((v) => !v)}
            className="rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-soft hover:bg-slate-50 flex items-center gap-2"
          >
            <div className="h-8 w-8 rounded-2xl bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-700">
              {(user?.name || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold text-slate-900 leading-4">{user?.name || "User"}</p>
              <p className="text-xs text-slate-500 leading-4">{role}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </button>

          {menu ? (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-100 bg-white shadow-soft overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-900">{user?.email}</p>
                <p className="text-xs text-slate-500">Role: {role}</p>
              </div>
              <button
                onClick={logout}
                className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
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
