import React, { useState } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutDashboard, Building2, Activity, ShieldCheck, LogOut,
  ChevronRight, Globe, Zap, Menu, X, UserCheck
} from "lucide-react";
import { authLogout } from "../../services/auth.service";

const NAV = [
  { to: "/super-admin",           label: "Dashboard",      icon: LayoutDashboard },
  { to: "/super-admin/companies", label: "Companies",      icon: Building2 },
  { to: "/super-admin/requests",  label: "Seat Requests",  icon: UserCheck },
  { to: "/super-admin/activity",  label: "Activity Log",   icon: Activity },
];

export default function SuperAdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleExitAdmin = async () => {
    try {
      await authLogout();
    } catch (_) {}
    navigate("/login", { replace: true });
  };

  return (
    <div className="sa-root">
      {/* ── Sidebar ── */}
      <aside className={`sa-sidebar ${sidebarOpen ? "sa-sidebar--open" : ""}`}>
        {/* Brand */}
        <div className="sa-brand">
          <div className="sa-brand-icon">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="sa-brand-title">Twite Billing</p>
            <p className="sa-brand-sub">Super Admin</p>
          </div>
          <button className="sa-sidebar-close" onClick={() => setSidebarOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="sa-nav">
          <p className="sa-nav-label">Platform Management</p>
          {NAV.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/super-admin"
                ? location.pathname === "/super-admin"
                : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`sa-nav-item ${active ? "sa-nav-item--active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sa-sidebar-footer">
          <div className="sa-privacy-badge">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Tenant data isolated</span>
          </div>
          <button onClick={handleExitAdmin} className="sa-exit-btn" type="button">
            <LogOut className="w-3.5 h-3.5" />
            Exit Admin
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div className="sa-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Main ── */}
      <div className="sa-main">
        {/* Topbar */}
        <header className="sa-topbar">
          <button className="sa-menu-btn" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="sa-topbar-title">
            <Globe className="w-4 h-4 text-purple-600" />
            <span>Platform Console</span>
          </div>
          <div className="sa-topbar-right">
            <span className="sa-env-badge">
              <Zap className="w-3 h-3" /> Production
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="sa-content">
          <Outlet />
        </main>
      </div>

      <style>{`
        /* ── Root ── */
        .sa-root {
          display: flex;
          min-height: 100vh;
          background: #f8fafc;
          font-family: 'Inter', sans-serif;
          color: #0f172a;
        }

        /* ── Sidebar ── */
        .sa-sidebar {
          width: 240px;
          flex-shrink: 0;
          background: #ffffff;
          border-right: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
          z-index: 40;
          transition: transform 0.25s ease;
        }

        /* ── Brand ── */
        .sa-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 20px 16px 16px;
          border-bottom: 1px solid #f1f5f9;
        }
        .sa-brand-icon {
          width: 36px; height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, #7c3aed, #6d28d9);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(124,58,237,0.3);
        }
        .sa-brand-title { font-size: 13.5px; font-weight: 800; color: #0f172a; line-height: 1.2; }
        .sa-brand-sub { font-size: 10px; font-weight: 700; color: #7c3aed; letter-spacing: 0.05em; text-transform: uppercase; }
        .sa-sidebar-close { display: none; margin-left: auto; color: #64748b; }

        /* ── Nav ── */
        .sa-nav { padding: 16px 10px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .sa-nav-label {
          font-size: 9px; font-weight: 700; color: #94a3b8;
          text-transform: uppercase; letter-spacing: 0.1em;
          padding: 0 8px; margin-bottom: 6px;
        }
        .sa-nav-item {
          display: flex; align-items: center; gap: 10px;
          padding: 9.5px 12px; border-radius: 10px;
          color: #475569;
          font-size: 13px; font-weight: 600;
          text-decoration: none;
          transition: all 0.15s ease;
        }
        .sa-nav-item:hover { background: #f3e8ff; color: #6d28d9; }
        .sa-nav-item--active {
          background: linear-gradient(135deg, #7c3aed, #6d28d9);
          color: #ffffff;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(124,58,237,0.25);
        }

        /* ── Sidebar Footer ── */
        .sa-sidebar-footer {
          padding: 12px 10px 16px;
          border-top: 1px solid #f1f5f9;
          display: flex; flex-direction: column; gap: 8px;
        }
        .sa-privacy-badge {
          display: flex; align-items: center; gap: 6px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 8px; padding: 7px 10px;
          font-size: 10px; font-weight: 700; color: #047857;
        }
        .sa-exit-btn {
          display: flex; align-items: center; gap: 7px;
          width: 100%; cursor: pointer;
          padding: 8px 12px; border-radius: 9px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 11.5px; font-weight: 600;
          text-decoration: none;
          transition: all 0.15s ease;
        }
        .sa-exit-btn:hover { background: #e2e8f0; color: #0f172a; }

        /* ── Topbar ── */
        .sa-main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #f8fafc; }
        .sa-topbar {
          display: flex; align-items: center; gap: 12px;
          padding: 0 24px;
          height: 54px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          position: sticky; top: 0; z-index: 30;
        }
        .sa-menu-btn { display: none; color: #475569; padding: 4px; }
        .sa-topbar-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 13.5px; font-weight: 700; color: #0f172a;
        }
        .sa-topbar-right { margin-left: auto; }
        .sa-env-badge {
          display: flex; align-items: center; gap: 5px;
          background: #f3e8ff;
          border: 1px solid #d8b4fe;
          border-radius: 20px; padding: 4px 12px;
          font-size: 10.5px; font-weight: 700; color: #7c3aed;
          text-transform: uppercase; letter-spacing: 0.05em;
        }

        /* ── Content ── */
        .sa-content { flex: 1; overflow-y: auto; background: #f8fafc; }

        /* Mobile */
        @media (max-width: 768px) {
          .sa-sidebar {
            position: fixed; left: 0; top: 0; bottom: 0;
            transform: translateX(-100%);
            box-shadow: 4px 0 24px rgba(0,0,0,0.15);
          }
          .sa-sidebar--open { transform: translateX(0); }
          .sa-sidebar-close { display: flex; align-items: center; justify-content: center; }
          .sa-menu-btn { display: flex; }
          .sa-overlay {
            position: fixed; inset: 0; z-index: 35;
            background: rgba(15,23,42,0.4); backdrop-filter: blur(2px);
          }
        }
      `}</style>
    </div>
  );
}
