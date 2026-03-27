import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { authResetPassword, authValidatePasswordResetToken } from "../services/auth.service";
import twiteLogo from "../images/twite_ai_technologies_logo.jfif";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = String(searchParams.get("token") || "").trim();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    <>
      <style>{`
        .rp-root {
          min-height: 100vh;
          min-height: 100dvh;
          background: #dceef5;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: clamp(12px, 2vw, 24px);
          font-family: 'Inter', sans-serif;
          overflow-y: auto;
          box-sizing: border-box;
        }
        .rp-card {
          width: min(1100px, 100%);
          min-height: min(680px, calc(100dvh - 32px));
          display: grid;
          grid-template-columns: 1fr 0.95fr;
          overflow: hidden;
          border-radius: 34px;
          background: rgba(255,255,255,0.82);
          backdrop-filter: blur(14px);
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
          border: 1px solid rgba(255,255,255,0.75);
          margin: auto 0;
        }
        .rp-hero {
          position: relative;
          padding: 30px;
          background:
            radial-gradient(circle at top left, rgba(59,130,246,0.2), transparent 36%),
            radial-gradient(circle at bottom right, rgba(34,197,94,0.16), transparent 32%),
            linear-gradient(165deg, #f8fffc 0%, #eef6ff 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .rp-logo-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rp-logo-icon {
          width: 58px;
          height: 58px;
          border-radius: 18px;
          background: #fff;
          display: grid;
          place-items: center;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
        }
        .rp-logo-img {
          width: 40px;
          height: 40px;
          object-fit: contain;
        }
        .rp-logo-name {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
        }
        .rp-logo-sub {
          margin-top: 3px;
          font-size: 13px;
          color: #64748b;
        }
        .rp-heading {
          margin-top: 24px;
          font-size: clamp(32px, 4vw, 48px);
          line-height: 1.05;
          font-weight: 900;
          color: #0f172a;
        }
        .rp-heading .accent {
          color: #2563eb;
        }
        .rp-desc {
          margin-top: 18px;
          max-width: 430px;
          font-size: 15px;
          line-height: 1.7;
          color: #475569;
        }
        .rp-anim {
          margin: 18px 0;
          min-height: 150px;
        }
        .rp-foot {
          font-size: 12px;
          color: #64748b;
        }
        .rp-form-panel {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 36px 34px;
          background: rgba(255,255,255,0.9);
        }
        .rp-kicker {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.24em;
          color: #2563eb;
          text-transform: uppercase;
        }
        .rp-title {
          margin-top: 10px;
          font-size: 38px;
          line-height: 1.08;
          font-weight: 900;
          color: #0f172a;
        }
        .rp-subtitle {
          margin-top: 10px;
          font-size: 14px;
          line-height: 1.7;
          color: #64748b;
        }
        .rp-form {
          margin-top: 28px;
        }
        .rp-label {
          display: block;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #334155;
        }
        .rp-input-wrap {
          position: relative;
          margin-bottom: 18px;
        }
        .rp-input {
          width: 100%;
          height: 54px;
          border-radius: 18px;
          border: 1px solid #dbe4ef;
          background: #fff;
          padding: 0 54px 0 48px;
          font-size: 14px;
          color: #0f172a;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .rp-input:focus {
          border-color: #93c5fd;
          box-shadow: 0 0 0 4px rgba(147, 197, 253, 0.25);
        }
        .rp-input-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
        }
        .rp-toggle {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          border: none;
          background: transparent;
          color: #64748b;
          cursor: pointer;
        }
        .rp-submit {
          width: 100%;
          height: 54px;
          border: none;
          border-radius: 18px;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          color: #fff;
          font-size: 15px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          cursor: pointer;
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .rp-submit:hover {
          transform: translateY(-1px);
        }
        .rp-submit:disabled {
          cursor: not-allowed;
          opacity: 0.65;
          transform: none;
        }
        .rp-msg {
          margin-bottom: 16px;
          border-radius: 18px;
          padding: 14px 16px;
          font-size: 13px;
          line-height: 1.6;
        }
        .rp-msg.error {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #be123c;
        }
        .rp-msg.ok {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .rp-back {
          margin-top: 20px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #475569;
          text-decoration: none;
        }
        @media (max-width: 920px) {
          .rp-card {
            grid-template-columns: 1fr;
            min-height: auto;
          }
          .rp-hero {
            min-height: auto;
            padding: 24px;
          }
          .rp-form-panel {
            padding: 24px 20px 22px;
          }
          .rp-title {
            font-size: 32px;
          }
          .rp-anim {
            min-height: 120px;
            margin: 14px 0 10px;
          }
        }
        @media (max-width: 640px) {
          .rp-root {
            padding: 10px;
          }
          .rp-card {
            border-radius: 24px;
          }
          .rp-hero,
          .rp-form-panel {
            padding-left: 16px;
            padding-right: 16px;
          }
          .rp-heading {
            font-size: 30px;
          }
          .rp-desc {
            font-size: 14px;
            line-height: 1.6;
          }
          .rp-input,
          .rp-submit {
            height: 50px;
          }
        }
      `}</style>

      <div className="rp-root">
        <div className="rp-card">
          <div className="rp-hero">
            <div>
              <div className="rp-logo-row">
                <div className="rp-logo-icon">
                  <img src={twiteLogo} alt="Twite Billing logo" className="rp-logo-img" />
                </div>
                <div>
                  <div className="rp-logo-name">Twite Billing</div>
                  <div className="rp-logo-sub">Smart billing for growing businesses</div>
                </div>
              </div>

              <div className="rp-heading">
                <span>Set a New </span>
                <span className="accent">Password</span>
              </div>
              <p className="rp-desc">
                Your reset link is checked before the form opens. Once validated, you can securely update the password for your account.
              </p>
            </div>

            <div className="rp-anim">
              <DotLottieReact
                src="https://lottie.host/710a03f2-f726-46a8-b0cd-8a7ff41f703c/jLQlsvDDaW.lottie"
                autoplay
                loop
                style={{ width: "100%", height: "190px" }}
              />
            </div>

            <p className="rp-foot">Make sure your new password is easy for you to remember and hard for others to guess.</p>
          </div>

          <div className="rp-form-panel">
            <p className="rp-kicker">Secure Reset</p>
            <h1 className="rp-title">Reset Password</h1>
            <p className="rp-subtitle">
              {email ? `Set a new password for ${email}.` : "We’ll validate your reset link and let you continue."}
            </p>

            {validating ? <div className="rp-msg ok">Validating reset link...</div> : null}
            {error ? <div className="rp-msg error">{error}</div> : null}
            {notice ? <div className="rp-msg ok">{notice}</div> : null}

            {!validating && tokenValid ? (
              <form onSubmit={handleSubmit} className="rp-form">
                <label className="rp-label" htmlFor="reset-password">New Password</label>
                <div className="rp-input-wrap">
                  <LockKeyhole className="rp-input-icon" size={18} />
                  <input
                    id="reset-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="rp-input"
                    autoComplete="new-password"
                    required
                  />
                  <button type="button" className="rp-toggle" onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>

                <label className="rp-label" htmlFor="reset-confirm-password">Confirm Password</label>
                <div className="rp-input-wrap">
                  <KeyRound className="rp-input-icon" size={18} />
                  <input
                    id="reset-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="rp-input"
                    autoComplete="new-password"
                    required
                  />
                  <button type="button" className="rp-toggle" onClick={() => setShowConfirmPassword((value) => !value)}>
                    {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>

                <button type="submit" disabled={submitting} className="rp-submit">
                  <LockKeyhole size={17} />
                  {submitting ? "Updating..." : "Update Password"}
                </button>
              </form>
            ) : null}

            <Link to="/login" className="rp-back">
              <ArrowLeft size={16} />
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
