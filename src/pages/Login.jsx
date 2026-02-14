import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, Mail, ReceiptIndianRupee, User } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import Card from "../components/Card";
import { authLogin, authRegister } from "../services/auth.service";
import { api } from "../lib/api";
import { invoiceTemplateIsCompleted, setInvoiceTemplateCompleted } from "../lib/templateStore";
import { companyIsCompleted, companySetCompleted } from "../services/company.service";
import { UI } from "../theme/tokens";

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState("login");
  const isLogin = mode === "login";

  const [loginForm, setLoginForm] = useState({
    email: "owner@demo.com",
    password: "owner123"
  });
  const [signupForm, setSignupForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "Owner"
  });

  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  function switchMode(next, nextNotice = "") {
    setMode(next);
    setErr("");
    setNotice(nextNotice);
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setErr("");
    setNotice("");
    try {
      authLogin({ email: loginForm.email, password: loginForm.password });
      let me = null;
      try {
        const res = await api.get("/api/me");
        me = res.data;
      } catch {
        me = null;
      }

      const companyDone =
        typeof me?.company_setup_completed === "boolean" ? me.company_setup_completed : companyIsCompleted();
      const invoiceDone =
        typeof me?.invoice_template_completed === "boolean"
          ? me.invoice_template_completed
          : invoiceTemplateIsCompleted();

      companySetCompleted(companyDone);
      setInvoiceTemplateCompleted(invoiceDone);

      if (!companyDone) nav("/company-setup", { replace: true });
      else if (!invoiceDone) nav("/invoice-template-setup", { replace: true });
      else nav("/dashboard", { replace: true });
    } catch (ex) {
      setErr(ex.message || "Login failed");
    }
  }

  function handleSignupSubmit(e) {
    e.preventDefault();
    setErr("");
    setNotice("");
    if (!signupForm.name.trim()) {
      setErr("Full name is required.");
      return;
    }
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

    try {
      authRegister({
        name: signupForm.name,
        email: signupForm.email,
        password: signupForm.password,
        role: signupForm.role
      });
      setLoginForm((prev) => ({ ...prev, email: signupForm.email, password: "" }));
      switchMode("login", "Account created. Please log in.");
    } catch (ex) {
      setErr(ex.message || "Sign up failed");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: UI.COLORS.bg }}>
      <Card className="w-full max-w-5xl p-0 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div
            className={`relative p-8 md:p-10 text-white transition-all duration-500 ease-out ${
              isLogin ? "md:order-1" : "md:order-2"
            }`}
            style={{ background: "#1F7A4A" }}
          >
            <div className="absolute -right-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-white/10" />
            <div className="absolute -left-20 -top-20 h-56 w-56 rounded-full bg-white/10" />
            <div className="absolute right-10 -bottom-16 h-44 w-44 rounded-full bg-white/10" />
            <div className="relative z-10 flex h-full flex-col gap-6">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-white/15 flex items-center justify-center">
                  <ReceiptIndianRupee className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold">BillJoy</p>
                  <p className="text-xs text-white/70">Billing software</p>
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-semibold">
                  {isLogin ? "Welcome Back!" : "Create Your Account"}
                </h2>
                <p className="mt-3 text-sm text-white/85 max-w-sm">
                  Create invoices, manage GST/VAT, track payments,
                  <br />
                  and review reports in one secure place.
                  <br />
                  Built for owners and managers.
                </p>
              </div>

              <div className="mt-1 flex-1 min-h-[230px] overflow-hidden rounded-3xl border border-white/25 bg-white/10 p-3 backdrop-blur-sm">
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
            className={`p-8 md:p-10 bg-white transition-all duration-500 ease-out ${
              isLogin ? "md:order-2" : "md:order-1"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              {isLogin ? "WELCOME" : "GET STARTED"}
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              {isLogin ? "Login" : "Create Account"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {isLogin ? "Login to your billing account to continue" : "Create an account to start billing"}
            </p>

            <form className="mt-6 space-y-4" onSubmit={isLogin ? handleLoginSubmit : handleSignupSubmit}>
              {err ? (
                <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {err}
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {notice}
                </div>
              ) : null}

              {isLogin ? (
                <>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Email</span>
                    <div className="mt-2 relative">
                      <Mail className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={loginForm.email}
                        onChange={(e) => setLoginForm((p) => ({ ...p, email: e.target.value }))}
                        className="w-full rounded-full border border-slate-100 bg-slate-50 px-11 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                        placeholder="Enter your registered email"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Password</span>
                    <div className="mt-2 relative">
                      <LockKeyhole className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={loginForm.password}
                        type="password"
                        onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                        className="w-full rounded-full border border-slate-100 bg-slate-50 px-11 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                        placeholder="Enter your password"
                      />
                    </div>
                  </label>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <button type="button" className="font-semibold hover:opacity-80" style={{ color: "#1F7A4A" }}>
                      Forgot password?
                    </button>
                    <button type="button" className="font-semibold hover:opacity-80" style={{ color: "#1F7A4A" }}>
                      Need help?
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-full py-3 text-sm font-semibold text-white shadow-soft hover:opacity-95 active:opacity-90"
                    style={{ background: "#1F7A4A" }}
                  >
                    Login
                  </button>

                  <p className="text-xs text-slate-500 text-center">
                    Don't have an account?{" "}
                    <button
                      type="button"
                      className="font-semibold hover:opacity-80"
                      style={{ color: "#1F7A4A" }}
                      onClick={() => switchMode("signup")}
                    >
                      Sign up
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Full Name</span>
                    <div className="mt-2 relative">
                      <User className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={signupForm.name}
                        onChange={(e) => setSignupForm((p) => ({ ...p, name: e.target.value }))}
                        className="w-full rounded-full border border-slate-100 bg-slate-50 px-11 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                        placeholder="Full name"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Email</span>
                    <div className="mt-2 relative">
                      <Mail className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={signupForm.email}
                        onChange={(e) => setSignupForm((p) => ({ ...p, email: e.target.value }))}
                        className="w-full rounded-full border border-slate-100 bg-slate-50 px-11 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                        placeholder="Email address"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Password</span>
                    <div className="mt-2 relative">
                      <LockKeyhole className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={signupForm.password}
                        type="password"
                        onChange={(e) => setSignupForm((p) => ({ ...p, password: e.target.value }))}
                        className="w-full rounded-full border border-slate-100 bg-slate-50 px-11 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                        placeholder="Enter your password"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Confirm Password</span>
                    <div className="mt-2 relative">
                      <LockKeyhole className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={signupForm.confirmPassword}
                        type="password"
                        onChange={(e) => setSignupForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                        className="w-full rounded-full border border-slate-100 bg-slate-50 px-11 py-2.5 text-sm outline-none focus:ring-4"
                        style={{ "--tw-ring-color": UI.COLORS.ring }}
                        placeholder="Confirm your password"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold text-slate-600">Role</span>
                    <select
                      value={signupForm.role}
                      onChange={(e) => setSignupForm((p) => ({ ...p, role: e.target.value }))}
                      className="w-full rounded-full border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-4"
                      style={{ "--tw-ring-color": UI.COLORS.ring }}
                    >
                      <option value="Owner">Owner</option>
                      <option value="Manager">Manager</option>
                    </select>
                  </label>

                  <button
                    type="submit"
                    className="w-full rounded-full py-3 text-sm font-semibold text-white shadow-soft hover:opacity-95 active:opacity-90"
                    style={{ background: "#1F7A4A" }}
                  >
                    Create Account
                  </button>

                  <p className="text-xs text-slate-500 text-center">
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="font-semibold hover:opacity-80"
                      style={{ color: "#1F7A4A" }}
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
