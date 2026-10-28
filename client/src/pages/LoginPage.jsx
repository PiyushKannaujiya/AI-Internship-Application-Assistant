import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fieldError } from "../api/client.js";
import { PublicOnly } from "../components/ProtectedRoute.jsx";
import Icon from "../components/Icon.jsx";
import { Notice } from "../components/Feedback.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setApiError(null);

    const nextErrors = {};
    if (!form.email.trim()) nextErrors.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = "Enter a valid email";
    if (!form.password) nextErrors.password = "Password is required";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await login({ email: form.email.trim(), password: form.password });
      const destination = location.state?.from || "/dashboard";
      navigate(destination, { replace: true });
    } catch (error) {
      setApiError(error);
      setErrors({
        email: fieldError(error, "email"),
        password: fieldError(error, "password"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicOnly>
      <div className="auth-shell">
        <section className="auth-side">
          <Link to="/login" className="brand brand--light">
            <span className="brand-mark">
              <Icon name="sparkles" size={20} />
            </span>
            <span>
              <strong>ApplyPilot</strong>
              <small>AI internship assistant</small>
            </span>
          </Link>

          <div className="auth-side-copy">
            <span className="eyebrow eyebrow--light">Built for focused applications</span>
            <h1>From saved listing to submitted application — without the busywork.</h1>
            <p>
              Track opportunities, understand your resume fit, and draft better
              applications. You stay in control of every submission.
            </p>
            <ul className="auth-features">
              <li>
                <Icon name="target" size={18} /> Explainable match scores for every job
              </li>
              <li>
                <Icon name="file" size={18} /> Private resume parsing and skill extraction
              </li>
              <li>
                <Icon name="shield" size={18} /> No automatic submissions. Ever.
              </li>
            </ul>
          </div>

          <p className="auth-side-foot">
            Your resume is stored privately and only served to your authenticated account.
          </p>
        </section>

        <section className="auth-panel">
          <div className="auth-form-wrap">
            <div className="auth-heading">
              <span className="eyebrow">Welcome back</span>
              <h2>Sign in to your workspace</h2>
              <p>Pick up where you left off on your internship search.</p>
            </div>

            {apiError && (
              <Notice variant="error" onClose={() => setApiError(null)}>
                {apiError.message}
              </Notice>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={update("email")}
                  placeholder="you@example.com"
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && <small className="field-error">{errors.email}</small>}
              </label>

              <label className="field">
                <span>Password</span>
                <div className="input-with-action">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={form.password}
                    onChange={update("password")}
                    placeholder="Your password"
                    aria-invalid={Boolean(errors.password)}
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {errors.password && <small className="field-error">{errors.password}</small>}
              </label>

              <button type="submit" className="button button-primary button-block" disabled={busy}>
                {busy ? (
                  <>
                    <span className="spinner spinner--small" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in <Icon name="arrowRight" size={17} />
                  </>
                )}
              </button>
            </form>

            <p className="auth-switch">
              New to ApplyPilot? <Link to="/register">Create an account</Link>
            </p>
          </div>
        </section>
      </div>
    </PublicOnly>
  );
}
