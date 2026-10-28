import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fieldError } from "../api/client.js";
import { PublicOnly } from "../components/ProtectedRoute.jsx";
import Icon from "../components/Icon.jsx";
import { Notice } from "../components/Feedback.jsx";
import { useAuth } from "../context/AuthContext.jsx";

function passwordIssues(password) {
  const issues = [];
  if (password.length < 8) issues.push("at least 8 characters");
  if (!/[A-Za-z]/.test(password)) issues.push("a letter");
  if (!/[0-9]/.test(password)) issues.push("a number");
  return issues;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const issues = passwordIssues(form.password);

  async function handleSubmit(event) {
    event.preventDefault();
    setApiError(null);

    const nextErrors = {};
    if (form.name.trim().length < 2) nextErrors.name = "Enter your full name";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = "Enter a valid email";
    if (issues.length) nextErrors.password = `Password needs ${issues.join(", ")}`;
    if (form.password !== form.confirm) nextErrors.confirm = "Passwords do not match";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      navigate("/profile", { replace: true });
    } catch (error) {
      setApiError(error);
      setErrors({
        name: fieldError(error, "name"),
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
            <span className="eyebrow eyebrow--light">Start with a clear plan</span>
            <h1>Your internship search deserves a real system.</h1>
            <p>
              Build a verified profile once, then use it to save roles, measure fit,
              and prepare applications that sound like you.
            </p>
            <div className="auth-metrics">
              <div>
                <strong>7</strong>
                <span>tracking stages</span>
              </div>
              <div>
                <strong>100%</strong>
                <span>manual approval</span>
              </div>
              <div>
                <strong>0</strong>
                <span>fabricated claims</span>
              </div>
            </div>
          </div>

          <p className="auth-side-foot">
            We never sell your data. Resume files are private by default.
          </p>
        </section>

        <section className="auth-panel">
          <div className="auth-form-wrap">
            <div className="auth-heading">
              <span className="eyebrow">Create your account</span>
              <h2>Set up your workspace</h2>
              <p>Takes less than a minute. No credit card needed.</p>
            </div>

            {apiError && (
              <Notice variant="error" onClose={() => setApiError(null)}>
                {apiError.message}
              </Notice>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <label className="field">
                <span>Full name</span>
                <input
                  type="text"
                  autoComplete="name"
                  value={form.name}
                  onChange={update("name")}
                  placeholder="Asha Verma"
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name && <small className="field-error">{errors.name}</small>}
              </label>

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
                    autoComplete="new-password"
                    value={form.password}
                    onChange={update("password")}
                    placeholder="At least 8 characters"
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
                <small className={issues.length ? "field-hint" : "field-hint field-hint--ok"}>
                  {issues.length
                    ? `Needs ${issues.join(", ")}.`
                    : "Password strength looks good."}
                </small>
                {errors.password && <small className="field-error">{errors.password}</small>}
              </label>

              <label className="field">
                <span>Confirm password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={update("confirm")}
                  placeholder="Repeat your password"
                  aria-invalid={Boolean(errors.confirm)}
                />
                {errors.confirm && <small className="field-error">{errors.confirm}</small>}
              </label>

              <button type="submit" className="button button-primary button-block" disabled={busy}>
                {busy ? (
                  <>
                    <span className="spinner spinner--small" /> Creating account…
                  </>
                ) : (
                  <>
                    Create account <Icon name="arrowRight" size={17} />
                  </>
                )}
              </button>
            </form>

            <p className="auth-switch">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </div>
        </section>
      </div>
    </PublicOnly>
  );
}
