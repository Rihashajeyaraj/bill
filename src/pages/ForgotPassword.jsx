import React, { useState } from "react";
import { Link } from "react-router-dom";
import { authRequestPasswordReset, authUsingSupabase } from "../services/auth.service";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localResetLink, setLocalResetLink] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    setLocalResetLink("");
    try {
      const result = await authRequestPasswordReset({
        email,
        baseUrl: typeof window !== "undefined" ? window.location.origin : ""
      });
      setNotice(
        authUsingSupabase()
          ? "If the email exists, a reset link has been sent."
          : "Reset link generated for this local build."
      );
      if (result?.resetLink) {
        setLocalResetLink(result.resetLink);
      }
    } catch (ex) {
      setError(ex?.message || "Unable to process password reset.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Forgot Password</h1>
        <p className="mt-2 text-sm text-slate-500">
          Enter your email and we will send you a password reset link.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-slate-200"
              autoComplete="email"
              required
            />
          </label>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          {localResetLink ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              <p className="font-semibold">Reset Link</p>
              <p className="mt-2 break-all">{localResetLink}</p>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <div className="mt-5 text-center text-sm">
          <Link to="/login" className="font-semibold text-slate-700 hover:text-slate-900">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
