import { Link } from "react-router-dom";
import Icon from "./Icon.jsx";
import { Notice } from "./Feedback.jsx";

const STATUS_ICONS = {
  pass: "checkCircle",
  warn: "alert",
  fail: "close",
};

const STATUS_LABELS = {
  pass: "Ready",
  warn: "Check",
  fail: "Missing",
};

function CheckRow({ entry }) {
  return (
    <li className={`check-row check-row--${entry.status}`}>
      <span className={`check-icon check-icon--${entry.status}`}>
        <Icon name={STATUS_ICONS[entry.status] || "info"} size={15} />
      </span>
      <div className="check-copy">
        <strong>{entry.label}</strong>
        <p>{entry.detail}</p>
        {entry.fix && (
          <Link to={entry.fix.href} className="text-link">
            {entry.fix.label} <Icon name="arrowRight" size={13} />
          </Link>
        )}
      </div>
      <span className={`check-status check-status--${entry.status}`}>
        {STATUS_LABELS[entry.status] || entry.status}
      </span>
    </li>
  );
}

export default function ReadinessChecklist({
  readiness,
  loading = false,
  error = null,
  loaded = false,
  onRetry,
  onDownloadPlan,
  planBusy = false,
  planNotice = null,
  requirements = null,
  onRequirementsChange = null,
  onEvaluateRequirements = null,
  requirementsBusy = false,
}) {
  if (loading) {
    return (
      <section className="card readiness-card" aria-busy="true">
        <div className="card-head">
          <div>
            <h3>Ready for Review</h3>
            <p>Checking approved material, profile gaps, and saved answers…</p>
          </div>
        </div>
        <div className="readiness-loading">
          <span className="spinner" /> Running readiness checks
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card readiness-card">
        <div className="card-head">
          <div>
            <h3>Ready for Review</h3>
            <p>Readiness could not be checked.</p>
          </div>
        </div>
        <Notice variant="warning">{error.message}</Notice>
        {onRetry && (
          <button type="button" className="button button-secondary button-small" onClick={onRetry}>
            <Icon name="refresh" size={15} /> Try again
          </button>
        )}
      </section>
    );
  }

  if (!loaded || !readiness) {
    return (
      <section className="card readiness-card">
        <div className="card-head">
          <div>
            <h3>Ready for Review</h3>
            <p>
              Start tracking this job to check the approved resume, missing profile
              details, and screening answers before you apply.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const { summary, adapter } = readiness;
  const missingAnswers = readiness.missingAnswers || [];
  const missingProfile = readiness.missingProfile || [];

  return (
    <section className="card readiness-card">
      <div className="card-head">
        <div>
          <h3>Ready for Review</h3>
          <p>
            A read-only checklist. It never changes the application status and never
            submits anything.
          </p>
        </div>
        <span
          className={`readiness-pill ${
            readiness.ready ? "readiness-pill--ready" : "readiness-pill--blocked"
          }`}
        >
          {readiness.ready
            ? "Ready for your review"
            : `${readiness.blocking.length} ${
                readiness.blocking.length === 1 ? "blocker" : "blockers"
              }`}
        </span>
      </div>

      <div className="readiness-meta">
        <span>
          <strong>{summary.passed}</strong> ready
        </span>
        <span>
          <strong>{summary.warnings}</strong> to check
        </span>
        <span>
          <strong>{summary.failures}</strong> missing
        </span>
        <span className="readiness-adapter">
          <Icon name="external" size={13} /> {adapter.name}
          {adapter.autofillSupported ? " · fill helper supported" : " · manual fallback"}
        </span>
      </div>

      {!adapter.autofillSupported && (
        <Notice variant="warning">
          {adapter.unsupportedReason ||
            "This portal has no maintained adapter. Use the manual fallback: open the employer page and paste the verified values yourself."}
        </Notice>
      )}

      <ul className="checklist">
        {readiness.checks.map((entry) => (
          <CheckRow entry={entry} key={entry.id} />
        ))}
      </ul>

      {requirements && onEvaluateRequirements && (
        <details className="readiness-requirements">
          <summary>
            <span>
              <Icon name="edit" size={15} /> Portal requirements
            </span>
            <span className="muted-small">Cover letter and screening questions</span>
          </summary>
          <div className="disclosure-body">
            <label className="field">
              <span>Cover letter</span>
              <select
                value={requirements.coverLetter}
                onChange={(event) =>
                  onRequirementsChange({
                    ...requirements,
                    coverLetter: event.target.value,
                  })
                }
              >
                <option value="recommended">Recommended</option>
                <option value="required">Required by this portal</option>
                <option value="off">Not requested</option>
              </select>
            </label>
            <label className="field">
              <span>Screening questions (one per line)</span>
              <textarea
                rows={3}
                value={requirements.questions}
                onChange={(event) =>
                  onRequirementsChange({
                    ...requirements,
                    questions: event.target.value,
                  })
                }
                placeholder={"Why do you want this role?\nDescribe a project you are proud of."}
              />
            </label>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={onEvaluateRequirements}
              disabled={requirementsBusy}
            >
              {requirementsBusy ? (
                <span className="spinner spinner--small" />
              ) : (
                <Icon name="refresh" size={14} />
              )}
              {requirementsBusy ? "Checking…" : "Re-evaluate checklist"}
            </button>
          </div>
        </details>
      )}

      {missingAnswers.length > 0 && (
        <div className="readiness-gaps">
          <h4 className="subheading">Questions without an approved answer</h4>
          <ul className="limitation-list">
            {missingAnswers.map((entry) => (
              <li key={entry.question}>
                <Icon name="alert" size={14} /> {entry.question}
              </li>
            ))}
          </ul>
          <Link to="/profile" className="text-link">
            Approve a saved answer <Icon name="arrowRight" size={13} />
          </Link>
        </div>
      )}

      {missingProfile.length > 0 && (
        <div className="readiness-gaps">
          <h4 className="subheading">Missing profile details</h4>
          <p className="muted-small">
            {missingProfile.map((entry) => entry.label).join(", ")}. Fill these in
            yourself — the app never guesses.
          </p>
          <Link to="/profile" className="text-link">
            Open profile <Icon name="arrowRight" size={13} />
          </Link>
        </div>
      )}

      <Notice variant="info">
        <strong>You click the final button.</strong> The local helper fills the
        employer&apos;s form in a visible browser and stops before Apply, Submit, or
        Send. It never bypasses CAPTCHA, OTP, MFA, or login.
      </Notice>

      {planNotice && (
        <Notice variant={planNotice.variant}>{planNotice.text}</Notice>
      )}

      <div className="button-row readiness-actions">
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={onDownloadPlan}
          disabled={planBusy || !adapter.autofillSupported}
          title={
            adapter.autofillSupported
              ? "Download the verified values and approved resume links for the local helper"
              : "No autofill adapter exists for this portal; use the manual fallback"
          }
        >
          {planBusy ? <span className="spinner spinner--small" /> : <Icon name="download" size={15} />}
          {planBusy ? "Preparing plan…" : "Download autofill plan"}
        </button>
        {onRetry && (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={onRetry}
            disabled={loading}
          >
            <Icon name="refresh" size={14} /> Recheck
          </button>
        )}
      </div>
    </section>
  );
}
