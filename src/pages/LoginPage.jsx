import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import GoogleSignInButton from "../components/GoogleSignInButton";
import Footer from "../components/Footer";
import logo from "../assets/images/site-logo.png";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState("");

  const handleSuccess = useCallback(
    (profile) => {
      login(profile);
      // Route through the loading screen again — MainPage checks
      // isAuthenticated and will forward to /logbook automatically.
      navigate("/", { replace: true, state: { from: "login" } });
    },
    [login, navigate]
  );

  const handleError = useCallback(() => {
    setError("Something went wrong signing in. Please try again.");
  }, []);

  return (
    <>
      <style>{`
        .login-page {
          min-height: 100vh;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(900px 500px at 100% -10%, rgba(14,165,233,0.12), transparent 60%),
            radial-gradient(900px 500px at -10% 110%, rgba(124,58,237,0.12), transparent 60%),
            var(--bg);
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto,
            "Helvetica Neue", Arial, sans-serif;
        }

        .login-card {
          width: 100%;
          max-width: 400px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: 0 28px 60px rgba(2, 6, 23, 0.10);
          padding: 40px 32px 32px;
          text-align: center;
        }

        .login-card__logo {
          width: 96px;
          height: 96px;
          margin: 0 auto 18px;
          border-radius: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 14px;
          background: linear-gradient(135deg,
            rgba(79, 70, 229, 0.12),
            rgba(14, 165, 233, 0.12),
            rgba(124, 58, 237, 0.12));
          border: 1px solid rgba(79, 70, 229, 0.20);
        }
        .login-card__logo img {
          width: 100%; height: 100%; object-fit: contain;
        }

        .login-card__chip {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 5px 13px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          background: rgba(79, 70, 229, 0.10);
          border: 1px solid rgba(79, 70, 229, 0.28);
          color: var(--accent);
          margin-bottom: 16px;
        }
        .login-card__chip .pulse {
          width: 7px; height: 7px; border-radius: 50%;
          background: #22c55e;
        }

        .login-card__title {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.01em;
          margin: 0 0 6px;
          color: var(--text);
        }
        .login-card__subtitle {
          font-size: 13.5px;
          color: var(--text-muted);
          margin: 0 0 28px;
          line-height: 1.5;
        }

        .google-btn-row {
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
        }
        .google-btn-slot {
          min-height: 44px;
          display: flex;
          justify-content: center;
        }
        .google-btn-missing {
          font-size: 12.5px;
          color: var(--text-muted);
          background: var(--surface-2);
          border: 1px dashed var(--border-strong);
          border-radius: 10px;
          padding: 14px 16px;
          line-height: 1.6;
        }
        .google-btn-missing code {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 5px;
          font-size: 11.5px;
        }

        .login-error {
          font-size: 12.5px;
          color: #b91c1c;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          padding: 9px 12px;
          margin-bottom: 16px;
        }

        .login-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 22px 0;
        }
        .login-divider .line {
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        .login-tip {
          display: flex;
          gap: 10px;
          text-align: left;
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px 14px;
        }
        .login-tip .icon {
          font-size: 16px;
          line-height: 1;
        }
        .login-tip .meta {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
        }
      `}</style>

      <div className="login-page">
        <div className="login-card">
          <span className="login-card__chip">
            <span className="pulse" />
            Secure sign-in
          </span>

          <div className="login-card__logo">
            <img src={logo} alt="Opol Community College Logo" />
          </div>

          <h2 className="login-card__title">Welcome to OJT Logbook</h2>
          <p className="login-card__subtitle">
            Sign in with your Google account to start logging your OJT hours.
          </p>

          {error && <div className="login-error">{error}</div>}

          <div className="google-btn-row">
            <GoogleSignInButton onSuccess={handleSuccess} onError={handleError} />
          </div>

          <div className="login-divider">
            <div className="line" />
            <div className="line" />
          </div>

          <div className="login-tip">
            <span className="icon">🔒</span>
            <div className="meta">
              Your logbook entries stay in this browser only. Nothing is sent
              to a server — Google sign-in is just used to identify you on
              this device.
            </div>
          </div>
        </div>

        <Footer />
      </div>
    </>
  );
}
