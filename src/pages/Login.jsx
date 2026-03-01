import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, Mail, ReceiptIndianRupee, User, ShieldCheck } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import Card from "../components/Card";
import {
  authLogin,
  authRegister,
  authUsingSupabase
} from "../services/auth.service";
import { companyIsCompleted, companyLoadMyOrganization } from "../services/company.service";
import { ROLE_LABELS, ROLE_OPTIONS, isOwnerRole } from "../services/roles";
import { invoiceTemplateIsCompleted } from "../lib/templateStore";

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const isLogin = mode === "login";

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: ""
  });

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
  const usingSupabase = useMemo(() => authUsingSupabase(), []);

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const modeParam = String(params.get("mode") || "")
      .trim()
      .toLowerCase();
    const inviteName = String(params.get("name") || "").trim();
    const inviteEmail = String(params.get("email") || "").trim();
    const inviteCode = String(params.get("registerCode") || params.get("register_code") || "")
      .trim()
      .toUpperCase();
    const inviteRoleRaw = String(params.get("role") || "")
      .trim()
      .toLowerCase();

    let inviteRole = "";
    if (inviteRoleRaw === "owner") inviteRole = ROLE_LABELS.owner;
    else if (inviteRoleRaw === "accounter" || inviteRoleRaw === "accountant") {
      inviteRole = ROLE_LABELS.accounter;
    } else if (inviteRoleRaw === "staff") {
      inviteRole = ROLE_LABELS.staff;
    }

    const hasInvitePayload = Boolean(
      modeParam === "signup" || inviteName || inviteEmail || inviteCode || inviteRole
    );
    if (!hasInvitePayload) return;

    setMode("signup");
    setErr("");
    if (inviteCode) {
      setNotice("Invite link detected. Complete signup to join organization.");
    }
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
    if (next === "organization_select") {
      nav("/organization-select", { replace: true });
      return;
    }
    if (next === "organization_setup") {
      nav("/company-setup", { replace: true });
      return;
    }
    if (next === "invoice_template_setup") {
      nav("/invoice-template-setup", { replace: true });
      return;
    }
    if (!isOwnerRole(role)) {
      nav("/dashboard", { replace: true });
      return;
    }
    if (!companyIsCompleted()) {
      nav("/company-setup", { replace: true });
      return;
    }
    if (!invoiceTemplateIsCompleted()) {
      nav("/invoice-template-setup", { replace: true });
      return;
    }
    nav("/dashboard", { replace: true });
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setErr("");
    setNotice("");
    setSubmitting(true);

    try {
      const result = await authLogin({ email: loginForm.email, password: loginForm.password });
      if (result?.organizationId) {
        await companyLoadMyOrganization(result.organizationId);
      }
      redirectAfterAuth(result?.next, result?.role || ROLE_LABELS.staff);
    } catch (ex) {
      setErr(ex.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignupSubmit(e) {
    e.preventDefault();
    setErr("");
    setNotice("");

    if (!signupForm.email.trim()) {
      setErr("Email is required.");
      return;
    }
    if (!signupForm.password) {
      setErr("Password is required.");
      return;
    }
    if (signupForm.password !== signupForm.confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }
    if (!isOwnerRole(signupForm.role) && !signupForm.registerCode.trim()) {
      setErr("Register code is required for Accounter or Staff.");
      return;
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
        switchMode(
          "login",
          "Registration successful. Check your email for verification, then login."
        );
        return;
      }

      if (result?.next === "organization_setup") {
        nav("/company-setup", { replace: true });
      } else {
        if (result?.organizationId) {
          await companyLoadMyOrganization(result.organizationId);
        }
        redirectAfterAuth(result?.next, result?.role || signupForm.role);
      }
    } catch (ex) {
      setErr(ex.message || "Register failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page min-h-screen flex items-center justify-center px-4 py-8">
      <Card className="auth-card w-full max-w-5xl p-0 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div
            className={`auth-hero relative p-8 md:p-10 transition-all duration-500 ease-out ${
              isLogin ? "md:order-1" : "md:order-2"
            }`}
          >
            <div className="auth-hero-orb absolute -right-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full" />
            <div className="auth-hero-orb absolute -left-20 -top-20 h-56 w-56 rounded-full" />
            <div className="auth-hero-orb absolute right-10 -bottom-16 h-44 w-44 rounded-full" />
            <div className="relative z-10 flex h-full flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="auth-hero-badge h-11 w-11 rounded-full flex items-center justify-center">
                  <ReceiptIndianRupee className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">BillJoy</p>
                  <p className="auth-hero-copy text-xs">India-first billing software</p>
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-semibold">
                  {isLogin ? "Welcome Back" : "Create Account"}
                </h2>
                <p className="auth-hero-copy mt-3 max-w-sm text-sm">
                  Owner creates organization.
                  <br />
                  Accounter and Staff join with register code.
                  <br />
                  India GST workflow ready.
                </p>
              </div>

              <div className="auth-visual mt-1 flex-1 min-h-[230px] overflow-hidden rounded-3xl p-3 backdrop-blur-sm">
                <DotLottieReact
                  src="https://lottie.host/710a03f2-f726-46a8-b0cd-8a7ff41f703c/jLQlsvDDaW.lottie"
                  autoplay
                  loop
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            </div>
          </div>

          <div
            className={`auth-form-panel p-8 md:p-10 transition-all duration-500 ease-out ${
              isLogin ? "md:order-2" : "md:order-1"
            }`}
          >
            <p className="auth-kicker text-xs font-semibold uppercase tracking-[0.3em]">
              {isLogin ? "WELCOME" : "REGISTER"}
            </p>
            <h1 className="auth-title mt-2 text-2xl font-semibold">
              {isLogin ? "Login" : "Register"}
            </h1>
            <p className="auth-description mt-2 text-sm">
              {isLogin ? "Login to continue" : "Create your user account"}
            </p>

            {!usingSupabase ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                Supabase env keys are not configured. App is running in local demo mode.
              </div>
            ) : null}

            <form className="mt-6 space-y-4" onSubmit={isLogin ? handleLoginSubmit : handleSignupSubmit}>
              {err ? <div className="auth-alert-error rounded-2xl px-4 py-3 text-sm">{err}</div> : null}
              {notice ? <div className="auth-alert-success rounded-2xl px-4 py-3 text-sm">{notice}</div> : null}

              {isLogin ? (
                <>
                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Email</span>
                    <div className="auth-input-wrap mt-2 relative">
                      <Mail className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <input
                        value={loginForm.email}
                        onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                        className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                        placeholder="Enter your registered email"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Password</span>
                    <div className="auth-input-wrap mt-2 relative">
                      <LockKeyhole className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <input
                        value={loginForm.password}
                        type="password"
                        onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                        className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                        placeholder="Enter your password"
                      />
                    </div>
                  </label>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="auth-submit w-full rounded-full py-3 text-sm font-semibold shadow-soft disabled:opacity-60"
                  >
                    {submitting ? "Please wait..." : "Login"}
                  </button>

                  <p className="auth-muted text-center text-xs">
                    Don&apos;t have an account?{" "}
                    <button
                      type="button"
                      className="auth-link font-semibold hover:opacity-80"
                      onClick={() => switchMode("signup")}
                    >
                      Register
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Full Name (optional)</span>
                    <div className="auth-input-wrap mt-2 relative">
                      <User className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <input
                        value={signupForm.name}
                        onChange={(e) => setSignupForm((p) => ({ ...p, name: e.target.value }))}
                        className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                        placeholder="Full name"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Email</span>
                    <div className="auth-input-wrap mt-2 relative">
                      <Mail className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <input
                        value={signupForm.email}
                        onChange={(e) => setSignupForm((p) => ({ ...p, email: e.target.value }))}
                        className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                        placeholder="Email address"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Password</span>
                    <div className="auth-input-wrap mt-2 relative">
                      <LockKeyhole className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <input
                        value={signupForm.password}
                        type="password"
                        onChange={(e) => setSignupForm((p) => ({ ...p, password: e.target.value }))}
                        className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                        placeholder="Enter your password"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Confirm Password</span>
                    <div className="auth-input-wrap mt-2 relative">
                      <LockKeyhole className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <input
                        value={signupForm.confirmPassword}
                        type="password"
                        onChange={(e) => setSignupForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                        className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                        placeholder="Confirm your password"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="auth-label text-xs font-semibold">Role</span>
                    <select
                      value={signupForm.role}
                      onChange={(e) => setSignupForm((p) => ({ ...p, role: e.target.value }))}
                      className="auth-select w-full rounded-full px-4 py-2.5 text-sm outline-none"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!isOwnerRole(signupForm.role) ? (
                    <label className="block">
                      <span className="auth-label text-xs font-semibold">Register Code</span>
                      <div className="mt-2 relative">
                        <ShieldCheck className="auth-input-icon absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                        <input
                          value={signupForm.registerCode}
                          onChange={(e) =>
                            setSignupForm((p) => ({ ...p, registerCode: e.target.value.toUpperCase() }))
                          }
                          className="auth-input w-full rounded-full px-11 py-2.5 text-sm outline-none"
                          placeholder="Paste organization register code"
                        />
                      </div>
                    </label>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="auth-submit w-full rounded-full py-3 text-sm font-semibold shadow-soft disabled:opacity-60"
                  >
                    {submitting ? "Please wait..." : "Create Account"}
                  </button>

                  <p className="auth-muted text-center text-xs">
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="auth-link font-semibold hover:opacity-80"
                      onClick={() => switchMode("login")}
                    >
                      Login
                    </button>
                  </p>
                </>
              )}
            </form>
          </div>
        </div>
      </Card>
    </div>
  );
}
