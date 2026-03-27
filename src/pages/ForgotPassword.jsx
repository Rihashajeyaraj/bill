import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { authRequestPasswordReset, authUsingSupabase } from "../services/auth.service";
import twiteLogo from "../images/twite_ai_technologies_logo.jfif";

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
    <>
      <style>{`
        .fp-root {
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
        .fp-card {
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
        .fp-hero {
          position: relative;
          padding: 30px;
          background:
            radial-gradient(circle at top left, rgba(34,197,94,0.22), transparent 36%),
            radial-gradient(circle at bottom right, rgba(59,130,246,0.18), transparent 32%),
            linear-gradient(165deg, #f8fffc 0%, #eef6ff 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .fp-logo-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .fp-logo-icon {
          width: 58px;
          height: 58px;
          border-radius: 18px;
          background: #fff;
          display: grid;
          place-items: center;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
        }
        .fp-logo-img {
          width: 40px;
          height: 40px;
          object-fit: contain;
        }
        .fp-logo-name {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
        }
        .fp-logo-sub {
          margin-top: 3px;
          font-size: 13px;
          color: #64748b;
        }
        .fp-heading {
          margin-top: 24px;
          font-size: clamp(32px, 4vw, 48px);
          line-height: 1.05;
          font-weight: 900;
          color: #0f172a;
        }
        .fp-heading .accent {
          color: #16a34a;
        }
        .fp-desc {
          margin-top: 18px;
          max-width: 430px;
          font-size: 15px;
          line-height: 1.7;
          color: #475569;
        }
        .fp-anim {
          margin: 18px 0;
          min-height: 150px;
        }
        .fp-foot {
          font-size: 12px;
          color: #64748b;
        }
        .fp-form-panel {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 36px 34px;
          background: rgba(255,255,255,0.9);
        }
        .fp-kicker {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.24em;
          color: #16a34a;
          text-transform: uppercase;
        }
        .fp-title {
          margin-top: 10px;
          font-size: 38px;
          line-height: 1.08;
          font-weight: 900;
          color: #0f172a;
        }
        .fp-subtitle {
          margin-top: 10px;
          font-size: 14px;
          line-height: 1.7;
          color: #64748b;
        }
        .fp-form {
          margin-top: 28px;
        }
        .fp-label {
          display: block;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 700;
          color: #334155;
        }
        .fp-input-wrap {
          position: relative;
          margin-bottom: 18px;
        }
        .fp-input {
          width: 100%;
          height: 54px;
          border-radius: 18px;
          border: 1px solid #dbe4ef;
          background: #fff;
          padding: 0 16px;
          font-size: 14px;
          color: #0f172a;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .fp-input:focus {
          border-color: #86efac;
          box-shadow: 0 0 0 4px rgba(134, 239, 172, 0.25);
        }
        .fp-submit {
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
        .fp-submit:hover {
          transform: translateY(-1px);
        }
        .fp-submit:disabled {
          cursor: not-allowed;
          opacity: 0.65;
          transform: none;
        }
        .fp-msg,
        .fp-linkbox {
          margin-bottom: 16px;
          border-radius: 18px;
          padding: 14px 16px;
          font-size: 13px;
          line-height: 1.6;
        }
        .fp-msg.error {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #be123c;
        }
        .fp-msg.ok {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .fp-linkbox {
          border: 1px solid #bae6fd;
          background: #f0f9ff;
          color: #0f172a;
          word-break: break-all;
        }
        .fp-back {
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
          .fp-card {
            grid-template-columns: 1fr;
            min-height: auto;
          }
          .fp-hero {
            min-height: auto;
            padding: 24px;
          }
          .fp-form-panel {
            padding: 24px 20px 22px;
          }
          .fp-title {
            font-size: 32px;
          }
          .fp-anim {
            min-height: 120px;
            margin: 14px 0 10px;
          }
        }
        @media (max-width: 640px) {
          .fp-root {
            padding: 10px;
          }
          .fp-card {
            border-radius: 24px;
          }
          .fp-hero,
          .fp-form-panel {
            padding-left: 16px;
            padding-right: 16px;
          }
          .fp-heading {
            font-size: 30px;
          }
          .fp-desc {
            font-size: 14px;
            line-height: 1.6;
          }
          .fp-input,
          .fp-submit {
            height: 50px;
          }
        }
      `}</style>

      <div className="fp-root">
        <div className="fp-card">
          <div className="fp-hero">
            <div>
              <div className="fp-logo-row">
                <div className="fp-logo-icon">
                  <img src={twiteLogo} alt="Twite Billing logo" className="fp-logo-img" />
                </div>
                <div>
                  <div className="fp-logo-name">Twite Billing</div>
                  <div className="fp-logo-sub">Smart billing for growing businesses</div>
                </div>
              </div>

              <div className="fp-heading">
                <span>Recover </span>
                <span className="accent">Access</span>
              </div>
              <p className="fp-desc">
                Enter your registered email address and we will help you continue securely with a password reset link.
              </p>
            </div>

            <div className="fp-anim">
              <DotLottieReact
                src="https://lottie.host/710a03f2-f726-46a8-b0cd-8a7ff41f703c/jLQlsvDDaW.lottie"
                autoplay
                loop
                style={{ width: "100%", height: "190px" }}
              />
            </div>

            <p className="fp-foot">Use the same account email you use for login.</p>
          </div>

          <div className="fp-form-panel">
            <p className="fp-kicker">Account Recovery</p>
            <h1 className="fp-title">Forgot Password</h1>
            <p className="fp-subtitle">We’ll generate a secure reset link for your account.</p>

            <form onSubmit={handleSubmit} className="fp-form">
              {error ? <div className="fp-msg error">{error}</div> : null}
              {notice ? <div className="fp-msg ok">{notice}</div> : null}
              {localResetLink ? (
                <div className="fp-linkbox">
                  <strong>Reset Link</strong>
                  <div style={{ marginTop: 8 }}>{localResetLink}</div>
                </div>
              ) : null}

              <label className="fp-label" htmlFor="forgot-email">Email</label>
              <div className="fp-input-wrap">
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your registered email"
                  className="fp-input"
                  autoComplete="email"
                  required
                />
              </div>

              <button type="submit" disabled={submitting} className="fp-submit">
                <Send size={17} />
                {submitting ? "Sending..." : "Send Reset Link"}
              </button>
            </form>

            <Link to="/login" className="fp-back">
              <ArrowLeft size={16} />
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
