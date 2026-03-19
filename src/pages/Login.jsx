import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LockKeyhole,
  Mail,
  ReceiptIndianRupee,
  User,
  ShieldCheck,
  Eye,
  EyeOff,
  ArrowRight,
  Shield,
  Headphones,
  Globe,
  Moon,
  Sun,
  ChevronDown
} from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import {
  authLogin,
  authRegister,
  authUsingSupabase
} from "../services/auth.service";
import {
  companyIsCompleted,
  companyLoadMyOrganization
} from "../services/company.service";
import { ROLE_LABELS, ROLE_OPTIONS, isOwnerRole } from "../services/roles";
import { invoiceTemplateIsCompleted } from "../lib/templateStore";

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "ta", label: "தமிழ்", flag: "🇮🇳" }
];

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const isLogin = mode === "login";

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: ROLE_LABELS.owner,
    registerCode: ""
  });

  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState("en");
  const [langDropOpen, setLangDropOpen] = useState(false);
  const usingSupabase = useMemo(() => authUsingSupabase(), []);
  const currentLang = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  // Close lang dropdown when clicking outside
  useEffect(() => {
    if (!langDropOpen) return;
    const close = () => setLangDropOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [langDropOpen]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const modeParam = String(params.get("mode") || "").trim().toLowerCase();
    const inviteName = String(params.get("name") || "").trim();
    const inviteEmail = String(params.get("email") || "").trim();
    const inviteCode = String(
      params.get("registerCode") || params.get("register_code") || ""
    ).trim().toUpperCase();
    const inviteRoleRaw = String(params.get("role") || "").trim().toLowerCase();

    let inviteRole = "";
    if (inviteRoleRaw === "owner") inviteRole = ROLE_LABELS.owner;
    else if (inviteRoleRaw === "accounter" || inviteRoleRaw === "accountant")
      inviteRole = ROLE_LABELS.accounter;
    else if (inviteRoleRaw === "staff") inviteRole = ROLE_LABELS.staff;

    const hasInvitePayload = Boolean(
      modeParam === "signup" || inviteName || inviteEmail || inviteCode || inviteRole
    );
    if (!hasInvitePayload) return;

    setMode("signup");
    setErr("");
    if (inviteCode) setNotice("Invite link detected. Complete signup to join organization.");
    setSignupForm((prev) => ({
      ...prev,
      name: inviteName || prev.name,
      email: inviteEmail || prev.email,
      role: inviteRole || prev.role,
      registerCode: inviteCode || prev.registerCode
    }));
  }, [location.search]);

  function switchMode(next, nextNotice = "") {
    setMode(next);
    setErr("");
    setNotice(nextNotice);
  }

  function redirectAfterAuth(next, role) {
    if (next === "organization_select") { nav("/organization-select", { replace: true }); return; }
    if (next === "organization_setup") { nav("/company-setup", { replace: true }); return; }
    if (next === "invoice_template_setup") { nav("/invoice-template-setup", { replace: true }); return; }
    if (!isOwnerRole(role)) { nav("/dashboard", { replace: true }); return; }
    if (!companyIsCompleted()) { nav("/company-setup", { replace: true }); return; }
    if (!invoiceTemplateIsCompleted()) { nav("/invoice-template-setup", { replace: true }); return; }
    nav("/dashboard", { replace: true });
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setErr(""); setNotice(""); setSubmitting(true);
    try {
      const result = await authLogin({ email: loginForm.email, password: loginForm.password });
      if (result?.organizationId) await companyLoadMyOrganization(result.organizationId);
      redirectAfterAuth(result?.next, result?.role || ROLE_LABELS.staff);
    } catch (ex) {
      setErr(ex.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignupSubmit(e) {
    e.preventDefault();
    setErr(""); setNotice("");
    if (!signupForm.email.trim()) { setErr("Email is required."); return; }
    if (!signupForm.password) { setErr("Password is required."); return; }
    if (signupForm.password !== signupForm.confirmPassword) { setErr("Passwords do not match."); return; }
    if (!isOwnerRole(signupForm.role) && !signupForm.registerCode.trim()) {
      setErr("Register code is required for Accounter or Staff."); return;
    }
    setSubmitting(true);
    try {
      const result = await authRegister({
        name: signupForm.name,
        email: signupForm.email,
        password: signupForm.password,
        role: signupForm.role,
        registerCode: signupForm.registerCode
      });
      if (result?.requiresEmailVerification) {
        switchMode("login", "Registration successful. Check your email for verification, then login.");
        return;
      }
      if (result?.next === "organization_setup") {
        nav("/company-setup", { replace: true });
      } else {
        if (result?.organizationId) await companyLoadMyOrganization(result.organizationId);
        redirectAfterAuth(result?.next, result?.role || signupForm.role);
      }
    } catch (ex) {
      setErr(ex.message || "Register failed");
    } finally {
      setSubmitting(false);
    }
  }

  const dm = darkMode;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        .lp-root {
          font-family: 'Inter', sans-serif;
          min-height: 100dvh;
          background: ${dm ? '#0f172a' : '#dceef5'};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(12px, 2vw, 24px);
          transition: background 0.3s ease;
          position: relative;
          overflow: hidden;
          box-sizing: border-box;
        }
        .lp-root::before {
          content: '';
          position: fixed;
          top: -100px; left: -100px;
          width: 420px; height: 420px;
          background: radial-gradient(circle, rgba(99,202,183,0.22) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none; z-index: 0;
        }
        .lp-root::after {
          content: '';
          position: fixed;
          bottom: -80px; right: -60px;
          width: 360px; height: 360px;
          background: radial-gradient(circle, rgba(59,130,246,0.16) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none; z-index: 0;
        }

        .lp-topbar {
          display: none;
        }

        .lp-lang-chevron {
          transition: transform 0.2s ease;
        }
        .lp-lang-chevron.open { transform: rotate(180deg); }

        .lp-lang-menu {
          position: absolute;
          top: calc(100% + 8px); right: 0;
          background: ${dm ? '#1e293b' : '#ffffff'};
          border: 1px solid ${dm ? '#334155' : '#e2e8f0'};
          border-radius: 14px;
          box-shadow: 0 12px 36px rgba(0,0,0,0.16);
          overflow: hidden;
          z-index: 999;
          min-width: 140px;
          animation: lpDropIn 0.17s ease;
        }
        @keyframes lpDropIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .lp-lang-opt {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 16px;
          font-size: 13px; font-weight: 500;
          color: ${dm ? '#e2e8f0' : '#1e293b'};
          cursor: pointer;
          transition: background 0.15s;
          font-family: 'Inter', sans-serif;
          border: none; width: 100%;
          background: none; text-align: left;
        }
        .lp-lang-opt:hover { background: ${dm ? '#334155' : '#f1f5f9'}; }
        .lp-lang-opt.active {
          background: ${dm ? 'rgba(34,197,94,0.12)' : '#f0fdf4'};
          color: #16a34a; font-weight: 600;
        }
        .lp-lang-check { margin-left: auto; color: #16a34a; font-size: 13px; }

        .lp-dark-toggle {
          width: 48px; height: 26px;
          background: ${dm ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : '#d1d5db'};
          border-radius: 13px;
          cursor: pointer; border: none;
          position: relative;
          transition: background 0.3s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .lp-dark-toggle::after {
          content: '';
          position: absolute;
          top: 3px; left: ${dm ? '25px' : '3px'};
          width: 20px; height: 20px;
          background: white; border-radius: 50%;
          transition: left 0.25s ease;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }

        /* Main card */
        .lp-card {
          position: relative; z-index: 10;
          width: 100%; max-width: 1000px;
          background: ${dm ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.9)'};
          border-radius: 28px;
          box-shadow: 0 28px 80px rgba(0,0,0,0.14), 0 0 0 1px rgba(255,255,255,0.55);
          overflow: hidden;
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: min(600px, calc(100dvh - 48px));
          max-height: calc(100dvh - 48px);
          backdrop-filter: blur(20px);
        }
        @media (max-width: 768px) {
          .lp-card {
            grid-template-columns: 1fr;
            min-height: auto;
            max-height: calc(100dvh - 24px);
          }
          .lp-hero { display: none; }
        }

        /* ── LEFT HERO ── */
        .lp-hero {
          position: relative; overflow: hidden;
          padding: 36px 30px 24px;
          background: linear-gradient(150deg, #d8f0f5 0%, #c0e8ef 18%, #cdeee6 45%, #ddf5ed 70%, #eefaf6 100%);
          display: flex; flex-direction: column; gap: 0;
          min-height: 0;
        }
        .lp-hero-orb1 {
          position: absolute; top: -60px; right: -80px;
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(99,202,183,0.32) 0%, transparent 65%);
          border-radius: 50%; pointer-events: none;
        }
        .lp-hero-orb2 {
          position: absolute; bottom: -70px; left: -50px;
          width: 270px; height: 270px;
          background: radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 65%);
          border-radius: 50%; pointer-events: none;
        }
        .lp-hero-orb3 {
          position: absolute; top: 40%; right: -20px;
          width: 140px; height: 140px;
          background: radial-gradient(circle, rgba(134,239,172,0.28) 0%, transparent 65%);
          border-radius: 50%; pointer-events: none;
        }

        .lp-logo-row {
          display: flex; align-items: center; gap: 10px;
          position: relative; z-index: 2; margin-bottom: 20px;
        }
        .lp-logo-icon {
          width: 42px; height: 42px; border-radius: 12px;
          background: linear-gradient(135deg, #22c55e, #16a34a);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 6px 16px rgba(34,197,94,0.35); flex-shrink: 0;
        }
        .lp-logo-icon svg { color: white; }
        .lp-logo-name { font-size: 17px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; }
        .lp-logo-sub { font-size: 11px; color: #475569; font-weight: 400; }

        .lp-heading {
          position: relative; z-index: 2;
          font-size: 28px; font-weight: 800; color: #0f172a;
          letter-spacing: -0.5px; line-height: 1.2; margin-bottom: 10px;
        }
        .lp-heading .accent {
          color: #16a34a; position: relative; display: inline-block;
        }
        .lp-heading .accent::after {
          content: '';
          position: absolute; bottom: -3px; left: 0;
          width: 100%; height: 3px;
          background: linear-gradient(90deg, #22c55e, #4ade80);
          border-radius: 2px;
        }

        .lp-desc {
          position: relative; z-index: 2;
          font-size: 13px; color: #334155;
          line-height: 1.65; margin-bottom: 8px;
        }

        .lp-anim {
          position: relative; z-index: 2;
          flex: 1; min-height: 175px;
          display: flex; align-items: center; justify-content: center;
          margin: 0 -6px;
        }

        .lp-features {
          position: relative; z-index: 2;
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 8px; margin-top: 10px; margin-bottom: 14px;
        }
        .lp-feat-card {
          background: rgba(255,255,255,0.75);
          border: 1px solid rgba(255,255,255,0.9);
          border-radius: 14px; padding: 10px 8px;
          display: flex; align-items: center; gap: 7px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.05);
          backdrop-filter: blur(8px);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          cursor: default;
        }
        .lp-feat-card:hover { transform: translateY(-2px); box-shadow: 0 7px 18px rgba(0,0,0,0.09); }
        .lp-feat-icon {
          width: 28px; height: 28px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .lp-feat-label { font-size: 11px; font-weight: 600; color: #1e293b; line-height: 1.2; }

        .lp-hero-foot {
          position: relative; z-index: 2;
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .lp-hero-foot {
          display: none;
        }
        .lp-pill {
          display: flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(255,255,255,0.9);
          border-radius: 20px; padding: 5px 11px;
          font-size: 11.5px; font-weight: 500; color: #334155;
          backdrop-filter: blur(6px); cursor: pointer;
          transition: background 0.2s;
          box-shadow: 0 2px 6px rgba(0,0,0,0.05);
          font-family: 'Inter', sans-serif;
          border: none; position: relative;
        }
        .lp-pill { border: 1px solid rgba(255,255,255,0.9); }
        .lp-pill:hover { background: rgba(255,255,255,0.9); }
        .lp-pill-toggle {
          width: 34px; height: 18px;
          background: ${dm ? '#4f46e5' : '#d1d5db'};
          border-radius: 9px; position: relative;
          transition: background 0.25s; display: inline-block;
          flex-shrink: 0;
        }
        .lp-pill-toggle::after {
          content: ''; position: absolute;
          top: 2px; left: ${dm ? '18px' : '2px'};
          width: 14px; height: 14px;
          background: white; border-radius: 50%;
          transition: left 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.18);
        }
        .lp-copyright {
          position: relative; z-index: 2;
          font-size: 11px; color: #64748b; text-align: center;
        }

        /* Hero lang dropdown (opens upward) */
        .lp-pill-lang-wrap { position: relative; }
        .lp-pill-lang-menu {
          position: absolute;
          bottom: calc(100% + 8px); left: 0;
          background: rgba(255,255,255,0.98);
          border: 1px solid #e2e8f0; border-radius: 14px;
          box-shadow: 0 8px 26px rgba(0,0,0,0.12);
          overflow: hidden; z-index: 999;
          min-width: 140px;
          animation: lpDropIn 0.17s ease;
        }

        /* ── RIGHT FORM PANEL ── */
        .lp-form-panel {
          background: ${dm ? 'rgba(15,23,42,0.98)' : '#ffffff'};
          padding: 40px 36px;
          display: flex; flex-direction: column; justify-content: center;
          transition: background 0.3s;
          overflow-y: auto;
          min-height: 0;
          box-sizing: border-box;
        }
        @media (max-width: 640px) {
          .lp-form-panel { padding: 28px 20px; }
        }

        .lp-kicker {
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.28em; color: ${dm ? '#94a3b8' : '#64748b'};
          text-transform: uppercase;
        }
        .lp-title {
          font-size: 30px; font-weight: 800;
          color: ${dm ? '#f1f5f9' : '#0f172a'};
          letter-spacing: -0.5px; margin: 4px 0 2px; line-height: 1.15;
        }
        .lp-subtitle {
          font-size: 13px; color: ${dm ? '#94a3b8' : '#64748b'};
          margin-bottom: 22px;
        }

        .lp-label {
          display: block; font-size: 12px; font-weight: 600;
          color: ${dm ? '#cbd5e1' : '#374151'}; margin-bottom: 6px;
        }
        .lp-input-wrap { position: relative; margin-bottom: 14px; display: flex; align-items: center; }
        .lp-input {
          width: 100%;
          background: ${dm ? '#1e293b' : '#f8fafc'};
          border: 1.5px solid ${dm ? '#334155' : '#e2e8f0'};
          border-radius: 50px; padding: 12px 16px 12px 56px;
          font-size: 13.5px; color: ${dm ? '#e2e8f0' : '#1e293b'};
          font-family: 'Inter', sans-serif; outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box; line-height: 1.35;
        }
        .lp-input.lp-input--plain {
          padding-left: 16px;
        }
        .lp-input::placeholder { color: ${dm ? '#64748b' : '#94a3b8'}; }
        .lp-input:focus {
          border-color: #22c55e;
          box-shadow: 0 0 0 3px rgba(34,197,94,0.14);
        }
        .lp-iicon {
          position: absolute; left: 18px; top: 50%;
          transform: translateY(-50%);
          color: ${dm ? '#64748b' : '#94a3b8'}; pointer-events: none;
          width: 18px; height: 18px; z-index: 1;
        }
        .lp-iicon-r {
          position: absolute; right: 14px; top: 50%;
          transform: translateY(-50%);
          color: ${dm ? '#64748b' : '#94a3b8'}; cursor: pointer;
          background: none; border: none; padding: 4px;
          display: flex; align-items: center; z-index: 1;
          transition: color 0.2s;
        }
        .lp-iicon-r:hover { color: ${dm ? '#cbd5e1' : '#475569'}; }

        .lp-select {
          width: 100%;
          background: ${dm ? '#1e293b' : '#f8fafc'};
          border: 1.5px solid ${dm ? '#334155' : '#e2e8f0'};
          border-radius: 50px; padding: 11px 16px;
          font-size: 13.5px; color: ${dm ? '#e2e8f0' : '#1e293b'};
          font-family: 'Inter', sans-serif; outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          margin-bottom: 14px; appearance: none; cursor: pointer;
        }
        .lp-select:focus {
          border-color: #22c55e;
          box-shadow: 0 0 0 3px rgba(34,197,94,0.14);
        }

        .lp-forgot {
          text-align: right; margin-top: -8px; margin-bottom: 18px;
        }
        .lp-forgot-btn {
          background: none; border: none;
          font-size: 12px; color: #16a34a; font-weight: 500;
          cursor: pointer; font-family: 'Inter', sans-serif;
          padding: 0; transition: opacity 0.2s;
        }
        .lp-forgot-btn:hover { opacity: 0.75; }

        .lp-submit {
          width: 100%; height: 50px;
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 60%, #15803d 100%);
          color: white; border: none; border-radius: 50px;
          font-size: 15px; font-weight: 700;
          font-family: 'Inter', sans-serif; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          transition: all 0.25s ease;
          box-shadow: 0 8px 22px rgba(34,197,94,0.38);
          position: relative; overflow: hidden; margin-bottom: 16px;
        }
        .lp-submit::before {
          content: ''; position: absolute;
          top: 0; left: -100%; width: 100%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent);
          transition: left 0.4s ease;
        }
        .lp-submit:hover::before { left: 100%; }
        .lp-submit:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(34,197,94,0.44); }
        .lp-submit:active { transform: translateY(0); }
        .lp-submit:disabled { opacity: 0.65; cursor: not-allowed; transform: none; }

        .lp-or {
          display: flex; align-items: center; gap: 10px;
          margin: 2px 0 14px;
        }
        .lp-or-line {
          flex: 1; height: 1px;
          background: ${dm ? '#334155' : '#e5e7eb'};
        }
        .lp-or-text {
          font-size: 11px; font-weight: 600;
          color: ${dm ? '#475569' : '#94a3b8'}; letter-spacing: 0.08em;
        }

        .lp-foot-text {
          text-align: center; font-size: 13px;
          color: ${dm ? '#94a3b8' : '#64748b'};
        }
        .lp-link-btn {
          background: none; border: none; font-size: 13px;
          font-weight: 700; color: #16a34a; cursor: pointer;
          font-family: 'Inter', sans-serif; padding: 0;
          text-decoration: underline; text-underline-offset: 2px;
          transition: opacity 0.2s;
        }
        .lp-link-btn:hover { opacity: 0.75; }

        .lp-err {
          background: #fef2f2; border: 1px solid #fecaca;
          color: #b91c1c; border-radius: 12px;
          padding: 10px 14px; font-size: 13px; margin-bottom: 14px;
        }
        .lp-ok {
          background: #f0fdf4; border: 1px solid #bbf7d0;
          color: #15803d; border-radius: 12px;
          padding: 10px 14px; font-size: 13px; margin-bottom: 14px;
        }
        .lp-demo {
          background: #fffbeb; border: 1px solid #fde68a;
          color: #92400e; border-radius: 12px;
          padding: 10px 14px; font-size: 12px; margin-bottom: 16px;
        }
      `}</style>

      {/* Top right controls */}
      <div className="lp-topbar">
        <div className="lp-lang-wrap" onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="lp-lang-btn"
            onClick={() => setLangDropOpen((o) => !o)}
            role="button"
            aria-haspopup="listbox"
            aria-expanded={langDropOpen}
            id="lang-btn-topbar"
          >
            <Globe style={{ width: 14, height: 14, color: '#3b82f6' }} />
            <span style={{ fontSize: 14 }}>{currentLang.flag}</span>
            <span>{currentLang.label}</span>
            <ChevronDown
              className={`lp-lang-chevron${langDropOpen ? ' open' : ''}`}
              style={{ width: 12, height: 12 }}
            />
          </div>
          {langDropOpen && (
            <div className="lp-lang-menu" role="listbox">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  className={`lp-lang-opt${language === lang.code ? ' active' : ''}`}
                  onClick={() => { setLanguage(lang.code); setLangDropOpen(false); }}
                  role="option"
                  aria-selected={language === lang.code}
                >
                  <span style={{ fontSize: 16 }}>{lang.flag}</span>
                  <span>{lang.label}</span>
                  {language === lang.code && <span className="lp-lang-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="lp-dark-toggle"
          onClick={() => setDarkMode(!darkMode)}
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
          id="dark-mode-btn"
        />
      </div>

      <div className="lp-root">
        <div className="lp-card">

          {/* ── LEFT HERO PANEL ── */}
          <div className="lp-hero">
            <div className="lp-hero-orb1" />
            <div className="lp-hero-orb2" />
            <div className="lp-hero-orb3" />

            {/* Logo */}
            <div className="lp-logo-row">
              <div className="lp-logo-icon">
                <ReceiptIndianRupee style={{ width: 20, height: 20 }} />
              </div>
              <div>
                <div className="lp-logo-name">Twite Billing</div>
                <div className="lp-logo-sub">Smart billing for growing businesses</div>
              </div>
            </div>

            {/* Heading */}
            <div className="lp-heading">
              {isLogin
                ? <><span>Welcome </span><span className="accent">Back!</span></>
                : <><span>Create </span><span className="accent">Account!</span></>
              }
            </div>

            {/* Description */}
            <p className="lp-desc">
              Simplify billing, invoicing,{" "}
              <strong style={{ color: '#16a34a' }}>GST</strong>{" "}
              and reports in one place.
            </p>

            {/* Lottie Animation */}
            <div className="lp-anim">
              <DotLottieReact
                src="https://lottie.host/710a03f2-f726-46a8-b0cd-8a7ff41f703c/jLQlsvDDaW.lottie"
                autoplay
                loop
                style={{ width: "100%", height: "190px" }}
              />
            </div>

            {/* Feature Cards */}
            <div className="lp-features">
              <div className="lp-feat-card">
                <div className="lp-feat-icon" style={{ background: 'rgba(34,197,94,0.12)' }}>
                  <Shield style={{ width: 15, height: 15, color: '#16a34a' }} />
                </div>
                <span className="lp-feat-label">Fast &amp; Secure</span>
              </div>
              <div className="lp-feat-card">
                <div className="lp-feat-icon" style={{ background: 'rgba(234,179,8,0.12)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                    stroke="#ca8a04" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l3 3"/>
                  </svg>
                </div>
                <span className="lp-feat-label">GST Ready</span>
              </div>
              <div className="lp-feat-card">
                <div className="lp-feat-icon" style={{ background: 'rgba(59,130,246,0.12)' }}>
                  <Headphones style={{ width: 15, height: 15, color: '#2563eb' }} />
                </div>
                <span className="lp-feat-label">24/7 Support</span>
              </div>
            </div>

            {/* Bottom controls */}
            <div className="lp-hero-foot">
              {/* Language pill (opens upward) */}
              <div className="lp-pill-lang-wrap" onMouseDown={(e) => e.stopPropagation()}>
                <div
                  className="lp-pill"
                  onClick={() => setLangDropOpen((o) => !o)}
                  role="button"
                  id="lang-btn-hero"
                >
                  <Globe style={{ width: 13, height: 13, color: '#3b82f6' }} />
                  <span style={{ fontSize: 14 }}>{currentLang.flag}</span>
                  <span>{currentLang.label}</span>
                  <ChevronDown
                    className={`lp-lang-chevron${langDropOpen ? ' open' : ''}`}
                    style={{ width: 11, height: 11 }}
                  />
                </div>
                {langDropOpen && (
                  <div className="lp-pill-lang-menu" role="listbox">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        className={`lp-lang-opt${language === lang.code ? ' active' : ''}`}
                        onClick={() => { setLanguage(lang.code); setLangDropOpen(false); }}
                        role="option"
                        aria-selected={language === lang.code}
                      >
                        <span style={{ fontSize: 16 }}>{lang.flag}</span>
                        <span>{lang.label}</span>
                        {language === lang.code && <span className="lp-lang-check">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Dark mode pill */}
              <div className="lp-pill" onClick={() => setDarkMode(!darkMode)} id="dark-mode-pill">
                {darkMode
                  ? <Moon style={{ width: 13, height: 13, color: '#818cf8' }} />
                  : <Sun style={{ width: 13, height: 13, color: '#f59e0b' }} />
                }
                <span>Dark Mode</span>
                <div className="lp-pill-toggle" />
              </div>
            </div>

            <p className="lp-copyright">© 2024 Twite Billing. All Rights Reserved.</p>
          </div>

          {/* ── RIGHT FORM PANEL ── */}
          <div className="lp-form-panel">
            <p className="lp-kicker">{isLogin ? "WELCOME" : "REGISTER"}</p>
            <h1 className="lp-title">{isLogin ? "Login" : "Register"}</h1>
            <p className="lp-subtitle">{isLogin ? "Login to continue" : "Create your user account"}</p>

            {!usingSupabase && (
              <div className="lp-demo">
                Supabase env keys are not configured. App is running in local demo mode.
              </div>
            )}
            {err && <div className="lp-err">{err}</div>}
            {notice && <div className="lp-ok">{notice}</div>}

            <form onSubmit={isLogin ? handleLoginSubmit : handleSignupSubmit}>
              {isLogin ? (
                <>
                  {/* Email */}
                  <label><span className="lp-label">Email</span></label>
                  <div className="lp-input-wrap">
                    <input
                      id="login-email"
                      type="email"
                      className="lp-input lp-input--plain"
                      placeholder="Enter your registered email"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                      autoComplete="email"
                    />
                  </div>

                  {/* Password */}
                  <label><span className="lp-label">Password</span></label>
                  <div className="lp-input-wrap">
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      className="lp-input lp-input--plain"
                      placeholder="Enter your password"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                      autoComplete="current-password"
                        style={{ paddingRight: '52px' }}
                    />
                    <button type="button" className="lp-iicon-r"
                      onClick={() => setShowPassword(!showPassword)} aria-label="Toggle password">
                      {showPassword
                        ? <EyeOff style={{ width: 17, height: 17 }} />
                        : <Eye style={{ width: 17, height: 17 }} />}
                    </button>
                  </div>

                  {/* Forgot */}
                  <div className="lp-forgot">
                    <button type="button" className="lp-forgot-btn" id="forgot-password-btn">
                      Forgot Password?
                    </button>
                  </div>

                  {/* Submit */}
                  <button type="submit" className="lp-submit" disabled={submitting} id="login-btn">
                    <LockKeyhole style={{ width: 17, height: 17 }} />
                    {submitting ? "Please wait..." : "Login"}
                    {!submitting && <ArrowRight style={{ width: 17, height: 17, marginLeft: 4 }} />}
                  </button>

                  {/* OR */}
                  <div className="lp-or">
                    <div className="lp-or-line" />
                    <span className="lp-or-text">OR</span>
                    <div className="lp-or-line" />
                  </div>

                  {/* Switch to register */}
                  <p className="lp-foot-text">
                    Don&apos;t have an account?{" "}
                    <button type="button" className="lp-link-btn" onClick={() => switchMode("signup")} id="go-register-btn">
                      Register
                    </button>
                  </p>
                </>
              ) : (
                <>
                  {/* Full Name */}
                  <label><span className="lp-label">Full Name (optional)</span></label>
                  <div className="lp-input-wrap">
                    <input id="signup-name" className="lp-input lp-input--plain" placeholder="Full name"
                      value={signupForm.name}
                      onChange={(e) => setSignupForm((p) => ({ ...p, name: e.target.value }))} />
                  </div>

                  {/* Email */}
                  <label><span className="lp-label">Email</span></label>
                  <div className="lp-input-wrap">
                    <input id="signup-email" type="email" className="lp-input lp-input--plain" placeholder="Email address"
                      value={signupForm.email} autoComplete="email"
                      onChange={(e) => setSignupForm((p) => ({ ...p, email: e.target.value }))} />
                  </div>

                  {/* Password */}
                  <label><span className="lp-label">Password</span></label>
                  <div className="lp-input-wrap">
                    <input id="signup-password" type={showPassword ? "text" : "password"}
                      className="lp-input lp-input--plain" placeholder="Enter your password"
                      value={signupForm.password}
                      onChange={(e) => setSignupForm((p) => ({ ...p, password: e.target.value }))}
                        style={{ paddingRight: '52px' }} />
                    <button type="button" className="lp-iicon-r" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff style={{ width: 17, height: 17 }} /> : <Eye style={{ width: 17, height: 17 }} />}
                    </button>
                  </div>

                  {/* Confirm Password */}
                  <label><span className="lp-label">Confirm Password</span></label>
                  <div className="lp-input-wrap">
                    <input id="signup-confirm" type={showConfirmPassword ? "text" : "password"}
                      className="lp-input lp-input--plain" placeholder="Confirm your password"
                      value={signupForm.confirmPassword}
                      onChange={(e) => setSignupForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                        style={{ paddingRight: '52px' }} />
                    <button type="button" className="lp-iicon-r" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                      {showConfirmPassword ? <EyeOff style={{ width: 17, height: 17 }} /> : <Eye style={{ width: 17, height: 17 }} />}
                    </button>
                  </div>

                  {/* Role */}
                  <label><span className="lp-label">Role</span></label>
                  <select id="signup-role" className="lp-select"
                    value={signupForm.role}
                    onChange={(e) => setSignupForm((p) => ({ ...p, role: e.target.value }))}>
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>

                  {/* Register Code */}
                  {!isOwnerRole(signupForm.role) && (
                    <>
                      <label><span className="lp-label">Register Code</span></label>
                      <div className="lp-input-wrap">
                        <input id="signup-code" className="lp-input lp-input--plain"
                          placeholder="Paste organization register code"
                          value={signupForm.registerCode}
                          onChange={(e) => setSignupForm((p) => ({ ...p, registerCode: e.target.value.toUpperCase() }))} />
                      </div>
                    </>
                  )}

                  {/* Submit */}
                  <button type="submit" className="lp-submit" disabled={submitting} id="register-btn">
                    <User style={{ width: 17, height: 17 }} />
                    {submitting ? "Please wait..." : "Create Account"}
                    {!submitting && <ArrowRight style={{ width: 17, height: 17, marginLeft: 4 }} />}
                  </button>

                  {/* Switch to login */}
                  <p className="lp-foot-text">
                    Already have an account?{" "}
                    <button type="button" className="lp-link-btn" onClick={() => switchMode("login")} id="go-login-btn">
                      Login
                    </button>
                  </p>
                </>
              )}
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
