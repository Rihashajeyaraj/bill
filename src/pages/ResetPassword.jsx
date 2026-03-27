import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authResetPassword, authValidatePasswordResetToken } from "../services/auth.service";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = String(searchParams.get("token") || "").trim();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validating, setValidating] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [tokenValid, setTokenValid] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function validate() {
      if (!token) {
        if (!mounted) return;
        setError("Reset link is missing.");
        setTokenValid(false);
        setValidating(false);
        return;
      }
      try {
        const result = await authValidatePasswordResetToken(token);
        if (!mounted) return;
        setTokenValid(true);
        setEmail(result?.email || "");
      } catch (ex) {
        if (!mounted) return;
        setError(ex?.message || "Reset link is invalid or expired.");
        setTokenValid(false);
      } finally {
        if (mounted) setValidating(false);
      }
    }
    void validate();
    return () => {
      mounted = false;
    };
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!password) {
      setError("Password is required.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await authResetPassword({ token, password });
      setNotice("Password reset successful. You can login with your new password.");
      setTokenValid(false);
      setPassword("");
      setConfirmPassword("");
    } catch (ex) {
      setError(ex?.message || "Unable to reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Reset Password</h1>
        <p className="mt-2 text-sm text-slate-500">
          {email ? `Set a new password for ${email}.` : "Set your new password."}
        </p>

        {validating ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Validating reset link...
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        {!validating && tokenValid ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">New Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-slate-200"
                autoComplete="new-password"
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Confirm Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-slate-200"
                autoComplete="new-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Updating..." : "Update Password"}
            </button>
          </form>
        ) : null}

        <div className="mt-5 text-center text-sm">
          <Link to="/login" className="font-semibold text-slate-700 hover:text-slate-900">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
