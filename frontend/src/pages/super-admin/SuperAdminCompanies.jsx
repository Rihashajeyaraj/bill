import React, { useEffect, useState } from "react";
import {
  Building2, Plus, Search, CheckCircle2, KeyRound, Users,
  FileText, Eye, X, Copy, Check, ChevronRight, ShieldCheck,
  UserCheck, Sparkles, AlertCircle, LayoutDashboard, Receipt,
  CreditCard, BarChart3, Package, Shield, UserPlus
} from "lucide-react";
import { apiGet, apiPost } from "../../services/apiClient";

function Btn({ children, onClick, variant = "primary", type = "button", loading, small, disabled }) {
  const styles = {
    primary: { background: "linear-gradient(135deg, #7c3aed, #6d28d9)", color: "#fff", border: "none" },
    secondary: { background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1" },
    ghost: { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0" },
    emerald: { background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none" },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        ...styles[variant],
        padding: small ? "6px 14px" : "9.5px 22px",
        borderRadius: 10, fontSize: 12.5, fontWeight: 700,
        cursor: (loading || disabled) ? "not-allowed" : "pointer",
        opacity: (loading || disabled) ? 0.6 : 1,
        display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
        boxShadow: variant === "primary" ? "0 4px 14px rgba(124,58,237,0.25)" : "none"
      }}
    >
      {loading ? "Processing..." : children}
    </button>
  );
}

function CopyBtn({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-purple-700 bg-slate-100 hover:bg-purple-50 border border-slate-200 rounded-md px-2 py-1 transition-colors"
      title={`Copy ${label || "value"}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
}

const AVAILABLE_MODULES = [
  { id: "dashboard", label: "Dashboard Overview", desc: "Executive metrics, sales stats & quick actions", defaultEnabled: true },
  { id: "proforma", label: "Proforma Invoices", desc: "Draft, send & 1-click Convert to Tax Invoice", defaultEnabled: true },
  { id: "invoices", label: "Tax Invoices", desc: "GST Tax Invoices & billing history", defaultEnabled: true },
  { id: "payment_in", label: "Payment Receipts (Payment In)", desc: "Record customer payments & receipts", defaultEnabled: true },
  { id: "reports", label: "Reports & Customer Statements", desc: "Party ledger statements & aging report", defaultEnabled: true },
  { id: "parties", label: "Customer & Vendor Catalog", desc: "Manage party master & addresses", defaultEnabled: true },
  { id: "items", label: "Products & Items Catalog", desc: "Product catalog, HSN codes & GST rates", defaultEnabled: true },
  { id: "settings", label: "Company Settings & Users", desc: "Company profile, user management & sequence counters", defaultEnabled: true },
];

export default function SuperAdminCompanies() {
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal Wizard State (Steps 1 to 5)
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);

  // Form Fields
  // Step 1: Company Basic Info
  const [companyName, setCompanyName] = useState("");
  const [stateName, setStateName] = useState("Tamil Nadu");
  const [countryCode, setCountryCode] = useState("IN");
  const [gstin, setGstin] = useState("");

  // Step 2: Admin Credentials
  const [adminRole, setAdminRole] = useState("owner");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [passMode, setPassMode] = useState("auto");
  const [customPassword, setCustomPassword] = useState("");

  // Step 3: Module & Page Access Control
  const [enabledModules, setEnabledModules] = useState([
    "dashboard", "proforma", "invoices", "payment_in", "reports", "parties", "items", "settings"
  ]);
  const [maxUsersLimit, setMaxUsersLimit] = useState(1);

  const [saving, setSaving] = useState(false);
  const [creds, setCreds] = useState(null);
  const [formError, setFormError] = useState("");

  const load = () => {
    setLoading(true);
    apiGet("/super-admin/companies")
      .then((d) => setCompanies(d || []))
      .catch((e) => setError(e?.message || "Failed to load."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const resetForm = () => {
    setStep(1);
    setCompanyName("");
    setStateName("Tamil Nadu");
    setCountryCode("IN");
    setGstin("");
    setAdminRole("owner");
    setAdminEmail("");
    setAdminName("");
    setPassMode("auto");
    setCustomPassword("");
    setEnabledModules([
      "dashboard", "proforma", "invoices", "payment_in", "reports", "parties", "items", "settings"
    ]);
    setMaxUsersLimit(1);
    setFormError("");
    setCreds(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleStep1Next = (e) => {
    e.preventDefault();
    setFormError("");
    if (!companyName.trim()) {
      setFormError("Company Name is required.");
      return;
    }
    setStep(2);
  };

  const handleStep2Next = (e) => {
    e.preventDefault();
    setFormError("");
    if (!adminEmail.trim()) {
      setFormError("Admin Email is required.");
      return;
    }
    if (passMode === "custom" && (!customPassword || customPassword.length < 6)) {
      setFormError("Custom password must be at least 6 characters.");
      return;
    }
    setStep(3);
  };

  const handleStep3Next = (e) => {
    e.preventDefault();
    setFormError("");
    if (enabledModules.length === 0) {
      setFormError("Please select at least one module/page for tenant access.");
      return;
    }
    setStep(4);
  };

  const toggleModule = (id) => {
    setEnabledModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  async function handleFinalCreate() {
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        company_name: companyName.trim(),
        admin_email: adminEmail.trim(),
        admin_name: adminName.trim() || undefined,
        admin_password: passMode === "custom" ? customPassword : undefined,
        role: adminRole,
        country_code: countryCode,
        state_name: stateName.trim(),
        gstin: gstin.trim() || undefined,
        enabled_modules: enabledModules,
        max_users_limit: maxUsersLimit,
      };

      const res = await apiPost("/super-admin/companies", payload);
      setCreds(res?.credentials || null);
      setStep(5);
      load();
    } catch (err) {
      setFormError(err?.message || "Failed to create tenant company.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = companies.filter((c) =>
    (c.company_name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Tenant Companies</h1>
          <p className="text-sm text-slate-500 font-medium">Manage multi-tenant companies, page permissions &amp; login limits</p>
        </div>
        <Btn onClick={openCreateModal}>
          <Plus className="w-4 h-4" /> Create Tenant Company
        </Btn>
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tenant companies..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-purple-500 shadow-sm"
          />
        </div>
        <span className="text-xs text-slate-500 font-bold">
          {companies.length} companies registered
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm font-medium">Loading tenant companies...</div>
        ) : error ? (
          <div className="p-4 text-red-600 text-xs font-semibold">{error}</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                {["Company", "Users", "Pro Formas", "Invoices", "Status", "Created"].map((h) => (
                  <th key={h} className={`px-4 py-3 text-[11px] font-extrabold text-slate-500 uppercase tracking-wider ${h === "Company" ? "text-left" : "text-center"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-purple-50/40 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-purple-700" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">{c.company_name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">ID: {c.id.substring(0, 8)}...</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs font-bold text-slate-700">{c.users_count}</td>
                  <td className="px-4 py-3.5 text-center text-xs font-bold text-slate-700">{c.proformas_count}</td>
                  <td className="px-4 py-3.5 text-center text-xs font-bold text-slate-700">{c.invoices_count}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center text-[11px] text-slate-500">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs font-medium">
                    No tenant companies registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* MULTI-STEP CREATION MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl my-8">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center shadow-md">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Provision Tenant Company</h3>
                  <p className="text-xs text-slate-500 font-medium">Multi-step setup &amp; module access wizard</p>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} className="bg-slate-100 hover:bg-slate-200 rounded-lg p-1.5 text-slate-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Wizard Steps Progress Bar (During steps 1-4) */}
            {step <= 4 && (
              <div className="flex items-center justify-between mb-6 px-1">
                {[
                  { num: 1, label: "Info" },
                  { num: 2, label: "Credentials" },
                  { num: 3, label: "Access" },
                  { num: 4, label: "Review" }
                ].map((s, idx) => (
                  <React.Fragment key={s.num}>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                        step === s.num
                          ? "bg-purple-600 text-white ring-4 ring-purple-100"
                          : step > s.num
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-100 text-slate-400"
                      }`}>
                        {step > s.num ? <Check className="w-3.5 h-3.5" /> : s.num}
                      </div>
                      <span className={`text-[11px] font-bold ${step === s.num ? "text-purple-700" : "text-slate-400"}`}>
                        {s.label}
                      </span>
                    </div>
                    {idx < 3 && <div className={`flex-1 h-0.5 mx-1 ${step > idx + 1 ? "bg-emerald-400" : "bg-slate-100"}`} />}
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Error Message */}
            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-red-700 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{formError}</span>
              </div>
            )}

            {/* ── STEP 1: COMPANY BASIC DETAILS ── */}
            {step === 1 && (
              <form onSubmit={handleStep1Next}>
                <div className="space-y-3.5">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Company Name *</label>
                    <input
                      type="text" required value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="e.g. Acme Tech Enterprises Pvt Ltd"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-purple-500 focus:bg-white transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">State *</label>
                      <input
                        type="text" required value={stateName}
                        onChange={(e) => setStateName(e.target.value)}
                        placeholder="e.g. Tamil Nadu"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">Country</label>
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                      >
                        <option value="IN">India (IN)</option>
                        <option value="US">United States (US)</option>
                        <option value="AE">United Arab Emirates (AE)</option>
                        <option value="SG">Singapore (SG)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">GSTIN / Tax Registration No (Optional)</label>
                    <input
                      type="text" value={gstin}
                      onChange={(e) => setGstin(e.target.value)}
                      placeholder="33AAAAA0000A1Z5"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-slate-100">
                  <Btn variant="ghost" onClick={() => setShowModal(false)}>Cancel</Btn>
                  <Btn type="submit">
                    Next: Credentials <ChevronRight className="w-4 h-4" />
                  </Btn>
                </div>
              </form>
            )}

            {/* ── STEP 2: TENANT ADMIN / ACCOUNTANT CREDENTIALS ── */}
            {step === 2 && (
              <form onSubmit={handleStep2Next}>
                <div className="space-y-3.5">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Initial Credential Role *</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setAdminRole("owner")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          adminRole === "owner"
                            ? "border-purple-600 bg-purple-50/60 ring-2 ring-purple-100"
                            : "border-slate-200 bg-slate-50 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-extrabold text-purple-900 mb-0.5">
                          <span>👑 Tenant Owner / Admin</span>
                        </div>
                        <p className="text-[10px] text-slate-500">Full administrative authority over company</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAdminRole("accounter")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          adminRole === "accounter"
                            ? "border-purple-600 bg-purple-50/60 ring-2 ring-purple-100"
                            : "border-slate-200 bg-slate-50 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-extrabold text-purple-900 mb-0.5">
                          <span>💼 Tenant Accountant</span>
                        </div>
                        <p className="text-[10px] text-slate-500">Billing, pro forma &amp; payment access</p>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Tenant Admin Email *</label>
                    <input
                      type="email" required value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@tenantcompany.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Admin Full Name</label>
                    <input
                      type="text" value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="John Smith"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Password Generation *</label>
                    <div className="flex items-center gap-4 text-xs font-semibold mb-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio" name="passMode" value="auto"
                          checked={passMode === "auto"}
                          onChange={() => setPassMode("auto")}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <span>Auto-generate secure password</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio" name="passMode" value="custom"
                          checked={passMode === "custom"}
                          onChange={() => setPassMode("custom")}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <span>Specify custom password</span>
                      </label>
                    </div>

                    {passMode === "custom" && (
                      <input
                        type="text" required value={customPassword}
                        onChange={(e) => setCustomPassword(e.target.value)}
                        placeholder="Enter initial temporary password"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-purple-500 focus:bg-white font-mono"
                      />
                    )}
                  </div>
                </div>

                <div className="flex justify-between gap-2 pt-6 mt-4 border-t border-slate-100">
                  <Btn variant="secondary" onClick={() => setStep(1)}>Back</Btn>
                  <Btn type="submit">
                    Next: Page Access <ChevronRight className="w-4 h-4" />
                  </Btn>
                </div>
              </form>
            )}

            {/* ── STEP 3: PAGE & MODULE ACCESS CONTROL ── */}
            {step === 3 && (
              <form onSubmit={handleStep3Next}>
                <div className="space-y-3.5">
                  <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3 text-xs text-purple-900 font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-4 h-4 text-purple-600 shrink-0" />
                      <span>Default Login Seat Allocation:</span>
                    </div>
                    <span className="font-extrabold bg-purple-600 text-white px-2.5 py-0.5 rounded-md text-[11px]">
                      1 Active Seat Default
                    </span>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Select Permitted Pages / Modules for Tenant:
                    </label>
                    <p className="text-[11px] text-slate-500 mb-2.5">
                      Only checked pages will be enabled in tenant sidebar. Others will be hidden/restricted.
                    </p>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {AVAILABLE_MODULES.map((mod) => {
                        const checked = enabledModules.includes(mod.id);
                        return (
                          <label
                            key={mod.id}
                            className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                              checked
                                ? "bg-purple-50/40 border-purple-300"
                                : "bg-slate-50/50 border-slate-200 opacity-60 hover:opacity-100"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleModule(mod.id)}
                              className="mt-0.5 text-purple-600 focus:ring-purple-500 rounded"
                            />
                            <div>
                              <p className="text-xs font-bold text-slate-900">{mod.label}</p>
                              <p className="text-[10.5px] text-slate-500">{mod.desc}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-2 pt-5 mt-4 border-t border-slate-100">
                  <Btn variant="secondary" onClick={() => setStep(2)}>Back</Btn>
                  <Btn type="submit">
                    Next: Review &amp; Create <ChevronRight className="w-4 h-4" />
                  </Btn>
                </div>
              </form>
            )}

            {/* ── STEP 4: REVIEW & CREATE CONFIRMATION ── */}
            {step === 4 && (
              <div>
                <p className="text-xs text-slate-500 font-medium mb-4">Please verify company details, admin credentials &amp; page permissions before provisioning:</p>

                <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-4 space-y-3 mb-5 text-xs">
                  <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                    <span className="text-purple-700 font-bold uppercase tracking-wider">Company Name</span>
                    <span className="font-extrabold text-slate-900">{companyName}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                    <span className="text-purple-700 font-bold uppercase tracking-wider">State / Country</span>
                    <span className="font-bold text-slate-800">{stateName}, {countryCode}</span>
                  </div>
                  {gstin && (
                    <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                      <span className="text-purple-700 font-bold uppercase tracking-wider">GSTIN</span>
                      <span className="font-bold text-slate-800 font-mono">{gstin}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                    <span className="text-purple-700 font-bold uppercase tracking-wider">Initial Role</span>
                    <span className="font-extrabold text-purple-900 bg-purple-100 px-2 py-0.5 rounded">
                      {adminRole === "owner" ? "👑 Tenant Owner / Admin" : "💼 Tenant Accountant"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                    <span className="text-purple-700 font-bold uppercase tracking-wider">Admin Email</span>
                    <span className="font-bold text-slate-900 font-mono">{adminEmail}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                    <span className="text-purple-700 font-bold uppercase tracking-wider">User Seat Limit</span>
                    <span className="font-extrabold text-purple-800 bg-purple-100 px-2 py-0.5 rounded">1 Login Seat</span>
                  </div>
                  <div>
                    <span className="text-purple-700 font-bold uppercase tracking-wider block mb-1">Permitted Pages ({enabledModules.length}):</span>
                    <div className="flex flex-wrap gap-1">
                      {enabledModules.map((m) => (
                        <span key={m} className="bg-white border border-purple-200 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-2 pt-4 border-t border-slate-100">
                  <Btn variant="secondary" onClick={() => setStep(3)}>Back</Btn>
                  <Btn variant="primary" loading={saving} onClick={handleFinalCreate}>
                    <KeyRound className="w-4 h-4" /> Provision Company &amp; Issue Credentials
                  </Btn>
                </div>
              </div>
            )}

            {/* ── STEP 5: SUCCESS CREDENTIALS DISPLAY ── */}
            {step === 5 && creds && (
              <div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span className="text-sm font-extrabold text-emerald-900">Tenant Company &amp; Credentials Created!</span>
                  </div>
                  <p className="text-xs text-emerald-800 mb-4 font-medium">
                    Share these credentials with the tenant owner/admin to allow them to access their portal:
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-white border border-emerald-200 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Company</p>
                        <p className="text-xs font-extrabold text-slate-900">{companyName}</p>
                      </div>
                      <CopyBtn value={companyName} label="Company Name" />
                    </div>

                    <div className="flex items-center justify-between bg-white border border-emerald-200 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Assigned Role</p>
                        <p className="text-xs font-extrabold text-purple-700">{creds.role}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-white border border-emerald-200 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Admin Email</p>
                        <p className="text-xs font-bold text-slate-900 font-mono">{creds.admin_email}</p>
                      </div>
                      <CopyBtn value={creds.admin_email} label="Email" />
                    </div>

                    <div className="flex items-center justify-between bg-white border border-emerald-200 rounded-lg px-3 py-2.5">
                      <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Password</p>
                        <p className="text-xs font-bold text-emerald-700 font-mono">{creds.admin_password}</p>
                      </div>
                      <CopyBtn value={creds.admin_password} label="Password" />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Btn variant="emerald" onClick={() => setShowModal(false)}>
                    <CheckCircle2 className="w-4 h-4" /> Done &amp; Return to List
                  </Btn>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
