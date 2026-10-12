import React, { useEffect, useState } from "react";
import {
  Building2, Users, FileText, CheckCircle2, ShieldCheck,
  Activity, Package, UserCheck, TrendingUp, Zap, Globe
} from "lucide-react";
import { apiGet } from "../../services/apiClient";

function StatCard({ label, value, sub, subColor = "#059669", icon: Icon, iconBg = "#f3e8ff", iconColor = "#7c3aed" }) {
  return (
    <div className="bg-white border border-slate-200 hover:border-purple-300 rounded-2xl p-5 flex items-center justify-between gap-3 shadow-sm hover:shadow-md transition-all">
      <div>
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        <h3 className="text-3xl font-extrabold text-slate-900 leading-none">{value}</h3>
        {sub && (
          <p className="text-xs font-semibold mt-2 flex items-center gap-1" style={{ color: subColor }}>
            <CheckCircle2 className="w-3.5 h-3.5" /> {sub}
          </p>
        )}
      </div>
      {Icon && (
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg }}>
          <Icon className="w-6 h-6" style={{ color: iconColor }} />
        </div>
      )}
    </div>
  );
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet("/super-admin/dashboard")
      .then(setStats)
      .catch((err) => setError(err?.message || "Failed to load platform metrics."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-purple-600" />
          <h1 className="text-2xl font-extrabold text-slate-900">Platform Overview</h1>
        </div>
        <p className="text-sm text-slate-500 font-medium">
          Real-time SaaS system health &amp; usage monitoring
        </p>
      </div>

      {/* Privacy Banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center gap-3 mb-6">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
        <p className="text-xs text-emerald-900 font-medium">
          <strong className="text-emerald-700 font-bold">Privacy Guarantee:</strong> Only operational usage counts are shown. Tenant revenues, invoice amounts, and financial data are strictly isolated.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm font-medium">
          Loading platform metrics...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-xs font-semibold">
          {error}
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard label="Total Companies" value={stats?.total_companies ?? 0} sub={`${stats?.active_companies ?? 0} Active Companies`} icon={Building2} iconBg="#f3e8ff" iconColor="#7c3aed" />
            <StatCard label="Total Users" value={stats?.total_users ?? 0} sub={`${stats?.active_users ?? 0} Active Users`} icon={Users} iconBg="#e0e7ff" iconColor="#4f46e5" />
            <StatCard label="Pro Formas" value={stats?.total_proformas ?? 0} sub="Generated docs" subColor="#64748b" icon={FileText} iconBg="#fef3c7" iconColor="#d97706" />
            <StatCard label="Tax Invoices" value={stats?.total_invoices ?? 0} sub="Issued invoices" subColor="#64748b" icon={FileText} iconBg="#dcfce7" iconColor="#16a34a" />
            <StatCard label="Customers" value={stats?.total_customers ?? 0} sub="Cross-tenant" subColor="#64748b" icon={UserCheck} iconBg="#fce7f3" iconColor="#db2777" />
            <StatCard label="Catalog Items" value={stats?.total_items ?? 0} sub="Products & Services" subColor="#64748b" icon={Package} iconBg="#ccfbf1" iconColor="#0d9488" />
          </div>

          {/* System Status Card */}
          <div className="bg-gradient-to-r from-purple-500 to-indigo-600 rounded-2xl p-6 text-white shadow-md flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_#34d399]" />
              <div>
                <p className="text-base font-bold">All Systems Operational</p>
                <p className="text-xs text-purple-100 mt-0.5 font-medium">FastAPI + Supabase RLS — Fully Healthy</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/20 backdrop-blur-md px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider">
              <Zap className="w-4 h-4 text-amber-300" />
              <span>{stats?.system_status || "Healthy"}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
