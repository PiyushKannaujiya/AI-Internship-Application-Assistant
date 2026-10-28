import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import Icon from "../components/Icon.jsx";
import StatusBadge, { STATUS_LABELS, STATUS_ORDER } from "../components/StatusBadge.jsx";
import { MatchBreakdown, ScoreRing } from "../components/Score.jsx";
import ReadinessChecklist from "../components/Readiness.jsx";
import {
  ErrorState,
  Modal,
  Notice,
  PageLoader,
} from "../components/Feedback.jsx";
import { formatDate, labelize, timeAgo } from "../utils/format.js";
import { sourceLabel } from "../utils/sources.js";

const EDITABLE_STATUSES = STATUS_ORDER.filter((status) => status !== "submitted");

function ProviderTag({ provider }) {
  if (!provider) return null;
  const isAi = provider === "openai";
  return (
    <span className={`provider-tag ${isAi ? "provider-tag--ai" : ""}`}>
      <Icon name={isAi ? "sparkles" : "file"} size={12} />
      {isAi ? "AI generated" : provider === "manual_edit" ? "Edited" : "Template"}
    </span>
  );
}

export default function JobDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [tone, setTone] = useState("professional");
  const [cover, setCover] = useState(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [savingCover, setSavingCover] = useState(false);

  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");

  const [questionsText, setQuestionsText] = useState("");
  const [answers, setAnswers] = useState(null);
  const [answersBusy, setAnswersBusy] = useState(false);
  const [answersError, setAnswersError] = useState("");

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [trackingBusy, setTrackingBusy] = useState(false);

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [approved, setApproved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planNotice, setPlanNotice] = useState(null);
  const [requirements, setRequirements] = useState({
    coverLetter: "recommended",
    questions: "",
  });
  const [requirementsBusy, setRequirementsBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.jobs.get(id);
      setData(response.data);
      setNotes(response.data.application?.notes || "");
      setCover(
        response.data.application?.coverLetter?.body
          ? {
              ...response.data.application.coverLetter,
              notice: "",
            }
          : null
      );
      setSuggestions(null);
      setAnswers(null);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const applicationId = data?.application?.id;

  const loadReadiness = useCallback(async () => {
    if (!applicationId) {
      setReadiness(null);
      setReadinessError(null);
      return;
    }

    setReadinessLoading(true);
    setReadinessError(null);
    try {
      const response = await api.applications.readiness(applicationId);
      setReadiness(response.data.readiness);
    } catch (requestError) {
      setReadinessError(requestError);
    } finally {
      setReadinessLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);

  const job = data?.job;
  const application = data?.application;
  const match = data?.match;

  async function generateCover() {
    setCoverBusy(true);
    setCoverError("");
    setNotice(null);
    try {
      const response = await api.ai.coverLetter({ jobId: id, tone });
      setCover(response.data.coverLetter);
      setData((current) =>
        current
          ? {
              ...current,
              application: response.data.applicationId
                ? { ...(current.application || {}), id: response.data.applicationId }
                : current.application,
            }
          : current
      );
      setNotice({
        variant: response.data.coverLetter.provider === "openai" ? "success" : "info",
        text:
          response.data.coverLetter.provider === "openai"
            ? "AI draft generated. Review and edit every claim before using it."
            : "Template draft generated from your verified profile. AI is optional.",
      });
    } catch (requestError) {
      setCoverError(requestError.message);
    } finally {
      setCoverBusy(false);
    }
  }

  async function saveCoverEdits() {
    if (!application?.id || !cover) return;
    setSavingCover(true);
    try {
      await api.applications.update(application.id, {
        coverLetter: { subject: cover.subject, body: cover.body },
      });
      setCover((current) => ({ ...current, provider: "manual_edit" }));
      setNotice({ variant: "success", text: "Cover letter edits saved for this application." });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setSavingCover(false);
    }
  }

  async function generateSuggestions() {
    setSuggestionsBusy(true);
    setSuggestionsError("");
    setNotice(null);
    try {
      const response = await api.ai.resumeSuggestions({ jobId: id });
      setSuggestions(response.data);
    } catch (requestError) {
      setSuggestionsError(requestError.message);
    } finally {
      setSuggestionsBusy(false);
    }
  }

  async function generateAnswers() {
    setAnswersError("");
    const questions = questionsText
      .split("\n")
      .map((question) => question.trim())
      .filter(Boolean);

    if (questions.length === 0) {
      setAnswersError("Add at least one question, one per line.");
      return;
    }
    if (questions.length > 10) {
      setAnswersError("Draft at most 10 questions at a time.");
      return;
    }

    setAnswersBusy(true);
    setNotice(null);
    try {
      const response = await api.ai.applicationAnswers({ jobId: id, questions });
      setAnswers(response.data);
    } catch (requestError) {
      setAnswersError(requestError.message);
    } finally {
      setAnswersBusy(false);
    }
  }

  async function changeStatus(status) {
    if (!application?.id) return;
    setStatusBusy(true);
    try {
      await api.applications.update(application.id, { status });
      setNotice({ variant: "success", text: `Status updated to ${STATUS_LABELS[status]}.` });
      await load();
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setStatusBusy(false);
    }
  }

  async function trackApplication() {
    setTrackingBusy(true);
    try {
      await api.applications.create({ jobId: id, status: "planned" });
      setNotice({ variant: "success", text: "Application tracking started." });
      await load();
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setTrackingBusy(false);
    }
  }

  async function saveNotes() {
    if (!application?.id) return;
    setSavingNotes(true);
    try {
      await api.applications.update(application.id, { notes });
      setNotice({ variant: "success", text: "Private notes saved." });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setSavingNotes(false);
    }
  }

  async function openPreview() {
    if (!application?.id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setApproved(false);
    try {
      const response = await api.applications.preview(application.id);
      setPreview(response.data);
    } catch (requestError) {
      setPreviewError(requestError);
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function evaluateRequirements() {
    if (!application?.id) return;

    setRequirementsBusy(true);
    setPlanNotice(null);
    try {
      const questions = requirements.questions
        .split("\n")
        .map((question) => question.trim())
        .filter(Boolean);

      const response = await api.applications.evaluateReadiness(application.id, {
        coverLetter: requirements.coverLetter,
        questions,
      });
      setReadiness(response.data.readiness);
      setPlanNotice({
        variant: "success",
        text: "Checklist re-evaluated with this portal's requirements.",
      });
    } catch (requestError) {
      setPlanNotice({ variant: "error", text: requestError.message });
    } finally {
      setRequirementsBusy(false);
    }
  }

  async function downloadAutofillPlan() {
    if (!application?.id || !job) return;

    setPlanBusy(true);
    setPlanNotice(null);
    try {
      const response = await api.applications.autofillPlan(application.id);
      const plan = response.data.plan;
      const slug = `${job.company}-${job.title}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "application";
      const fileName = `applypilot-autofill-${slug}.json`;

      if (typeof URL.createObjectURL !== "function") {
        throw new Error("This browser cannot create a download link.");
      }

      const blob = new Blob([JSON.stringify(plan, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);

      setPlanNotice({
        variant: plan.canAutofill ? "success" : "warning",
        text: plan.canAutofill
          ? `Plan downloaded as ${fileName}. Run: node tools/autofill/cli.js --plan <path-to-${fileName}>. The helper fills a visible browser and stops before the final button.`
          : `Plan downloaded, but autofill is blocked: ${
              plan.blockers[0]?.detail || "approve a tailored resume first."
            }`,
      });
    } catch (requestError) {
      setPlanNotice({ variant: "error", text: requestError.message });
    } finally {
      setPlanBusy(false);
    }
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ variant: "success", text: `${label} copied to clipboard.` });
    } catch {
      setNotice({ variant: "error", text: "Clipboard access was blocked. Select and copy manually." });
    }
  }

  async function recordSubmission() {
    setSubmitting(true);
    try {
      await api.applications.submit(application.id, {
        approved: true,
        confirmation: true,
        method: "assisted_manual",
      });
      setPreview(null);
      setApproved(false);
      setNotice({
        variant: "success",
        text: "Submission recorded. This app never submits applications for you.",
      });
      await load();
    } catch (requestError) {
      setPreviewError(requestError);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader label="Loading job and match…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!job) return <ErrorState error={{ message: "Job not found" }} />;

  const suggestionItems = suggestions?.suggestions || match.suggestions || [];
  const isSubmitted = application?.status === "submitted";
  const resumeReady = Boolean(data.resumeUsed);

  return (
    <div className="page-stack">
      <Link to="/jobs" className="back-link">
        <Icon name="arrowLeft" size={16} /> Back to jobs
      </Link>

      {notice && (
        <Notice variant={notice.variant} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <section className="job-header-card">
        <div className="job-header-main">
          <div className="job-header-tags">
            <StatusBadge status={application?.status} />
            <span className={`source-tag source-tag--${job.source}`}>
              {sourceLabel(job.source)}
            </span>
            {job.remote && <span className="chip chip--success">Remote</span>}
          </div>
          <h2>{job.title}</h2>
          <p className="job-company job-company--large">
            <Icon name="building" size={16} /> {job.company}
            <span className="dot-separator" />
            <Icon name="mapPin" size={16} /> {job.location}
            <span className="dot-separator" />
            <Icon name="briefcase" size={16} /> {labelize(job.jobType)}
            {job.postedAt && (
              <>
                <span className="dot-separator" />
                <Icon name="calendar" size={15} /> Posted {formatDate(job.postedAt)}
              </>
            )}
          </p>
          <div className="job-header-actions">
            <a
              href={job.applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="button button-primary"
            >
              Open application page <Icon name="external" size={16} />
            </a>
            <button type="button" className="button button-secondary" onClick={openPreview} disabled={!application}>
              <Icon name="shield" size={16} /> Review before applying
            </button>
            <Link
              to={`/jobs/${id}/tailored`}
              className="button button-secondary"
            >
              <Icon name="file" size={16} /> Tailored resume
            </Link>
            {!application && (
              <button
                type="button"
                className="button button-secondary"
                onClick={trackApplication}
                disabled={trackingBusy}
              >
                {trackingBusy ? <span className="spinner spinner--small" /> : <Icon name="plus" size={16} />}
                Track this job
              </button>
            )}
          </div>
        </div>

        <div className="job-header-score">
          <ScoreRing score={match.score} size={104} />
          <div>
            <strong>Explainable match</strong>
            <span>
              {match.matchedSkills.length} matched · {match.missingSkills.length} missing
            </span>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <ReadinessChecklist
            readiness={readiness}
            loaded={Boolean(readiness)}
            loading={readinessLoading}
            error={readinessError}
            onRetry={loadReadiness}
            onDownloadPlan={downloadAutofillPlan}
            planBusy={planBusy}
            planNotice={planNotice}
            requirements={requirements}
            onRequirementsChange={setRequirements}
            onEvaluateRequirements={evaluateRequirements}
            requirementsBusy={requirementsBusy}
          />

          <section className="card">
            <div className="card-head">
              <div>
                <h3>About the role</h3>
                <p>Imported from the original listing.</p>
              </div>
            </div>
            <div className="job-description">{job.description}</div>
            {job.skills.length > 0 && (
              <>
                <h4 className="subheading">Listed skills</h4>
                <div className="chip-row chip-row--wrap">
                  {job.skills.map((skill) => (
                    <span
                      className={`chip ${
                        match.matchedSkills.includes(skill) ? "chip--success" : ""
                      }`}
                      key={skill}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h3>Why this score</h3>
                <p>Deterministic signals you can inspect and challenge.</p>
              </div>
              <span className="method-pill">No AI required</span>
            </div>
            <div className="match-columns">
              <div>
                <h4 className="subheading">Matching skills</h4>
                {match.matchedSkills.length ? (
                  <div className="chip-row chip-row--wrap">
                    {match.matchedSkills.map((skill) => (
                      <span className="chip chip--success" key={skill}>
                        <Icon name="check" size={12} /> {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="soft-empty">No overlapping skills detected yet.</p>
                )}
                <h4 className="subheading">Gaps</h4>
                {match.missingSkills.length ? (
                  <div className="chip-row chip-row--wrap">
                    {match.missingSkills.map((skill) => (
                      <span className="chip chip--warning" key={skill}>
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="soft-empty">No missing listed skills.</p>
                )}
              </div>
              <ul className="reason-list">
                {match.reasons.map((reason) => (
                  <li key={reason}>
                    <Icon name="checkCircle" size={15} /> {reason}
                  </li>
                ))}
              </ul>
            </div>
            {!data.resumeUsed && (
              <Notice variant="warning">
                No resume is uploaded, so matching uses profile skills only.{" "}
                <Link to="/resume">Upload a resume</Link> for a stronger signal.
              </Notice>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h3>Resume suggestions</h3>
                <p>Tailored to this role, based on your verified details.</p>
              </div>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={generateSuggestions}
                disabled={suggestionsBusy || !resumeReady}
                title={!resumeReady ? "Upload a resume to enable tailored suggestions" : undefined}
              >
                {suggestionsBusy ? <span className="spinner spinner--small" /> : <Icon name="sparkles" size={15} />}
                {suggestionsBusy ? "Analyzing…" : "Tailor suggestions"}
              </button>
            </div>

            {suggestionsError && <Notice variant="error">{suggestionsError}</Notice>}

            {!resumeReady && (
              <Notice variant="warning">
                Upload a resume to unlock tailored suggestions. <Link to="/resume">Upload resume</Link>
              </Notice>
            )}

            {suggestions?.notice && (
              <Notice variant={suggestions.provider === "openai" ? "success" : "info"}>
                {suggestions.notice}
              </Notice>
            )}

            {suggestions?.summary && (
              <div className="suggestion-summary">
                <ProviderTag provider={suggestions.provider} />
                <p>{suggestions.summary}</p>
              </div>
            )}

            <div className="suggestion-list">
              {suggestionItems.map((item) => (
                <div className="suggestion" key={item.title}>
                  <span className="suggestion-index">
                    <Icon name="sparkles" size={15} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h3>Cover letter draft</h3>
                <p>Generated content is a draft. Edit every claim before using it.</p>
              </div>
              {cover?.provider && <ProviderTag provider={cover.provider} />}
            </div>

            {cover?.notice && <Notice variant="info">{cover.notice}</Notice>}

            <div className="toolbar">
              <label className="inline-field">
                <span>Tone</span>
                <select value={tone} onChange={(event) => setTone(event.target.value)}>
                  <option value="professional">Professional</option>
                  <option value="enthusiastic">Enthusiastic</option>
                  <option value="concise">Concise</option>
                </select>
              </label>
              <button
                type="button"
                className="button button-primary button-small"
                onClick={generateCover}
                disabled={coverBusy || !resumeReady}
                title={!resumeReady ? "Upload a resume to enable cover letter drafts" : undefined}
              >
                {coverBusy ? <span className="spinner spinner--small" /> : <Icon name="sparkles" size={15} />}
                {coverBusy ? "Drafting…" : cover ? "Regenerate" : "Generate draft"}
              </button>
            </div>

            {coverError && <Notice variant="error">{coverError}</Notice>}

            {!resumeReady && (
              <Notice variant="warning">
                Upload a resume to generate a cover letter. <Link to="/resume">Upload resume</Link>
              </Notice>
            )}

            {cover ? (
              <div className="cover-editor">
                <label className="field">
                  <span>Subject</span>
                  <input
                    value={cover.subject}
                    onChange={(event) =>
                      setCover((current) => ({ ...current, subject: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Body</span>
                  <textarea
                    rows={13}
                    value={cover.body}
                    onChange={(event) =>
                      setCover((current) => ({ ...current, body: event.target.value }))
                    }
                  />
                </label>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => copyText(cover.body, "Cover letter")}
                  >
                    <Icon name="copy" size={15} /> Copy body
                  </button>
                  {application?.id && (
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={saveCoverEdits}
                      disabled={savingCover}
                    >
                      {savingCover ? <span className="spinner spinner--small" /> : <Icon name="check" size={15} />}
                      Save edits
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="soft-empty">
                Generate a draft to review and edit. Without an AI key, a clearly
                labeled template based on your profile is used.
              </p>
            )}
          </section>

          <details className="card disclosure">
            <summary>
              <span>
                <Icon name="edit" size={17} /> Draft application answers
              </span>
              <span className="muted-small">Optional</span>
            </summary>
            <div className="disclosure-body">
              <label className="field">
                <span>Application questions (one per line, max 10)</span>
                <textarea
                  rows={4}
                  value={questionsText}
                  onChange={(event) => setQuestionsText(event.target.value)}
                  placeholder={"Why do you want this role?\nDescribe a project you are proud of."}
                />
              </label>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={generateAnswers}
                disabled={answersBusy || !resumeReady}
                title={!resumeReady ? "Upload a resume to enable answer drafts" : undefined}
              >
                {answersBusy ? <span className="spinner spinner--small" /> : <Icon name="sparkles" size={15} />}
                {answersBusy ? "Drafting…" : "Draft answers"}
              </button>

              {answersError && <Notice variant="error">{answersError}</Notice>}
              {!resumeReady && (
                <Notice variant="warning">
                  Upload a resume to draft application answers. <Link to="/resume">Upload resume</Link>
                </Notice>
              )}
              {answers?.notice && <Notice variant="info">{answers.notice}</Notice>}

              {answers?.answers?.map((entry, index) => (
                <div className="answer-block" key={entry.question}>
                  <div className="answer-head">
                    <strong>{entry.question}</strong>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => copyText(entry.answer, "Answer")}
                    >
                      Copy
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    value={entry.answer}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        answers: current.answers.map((answer, answerIndex) =>
                          answerIndex === index
                            ? { ...answer, answer: event.target.value }
                            : answer
                        ),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </details>
        </div>

        <aside className="detail-side">
          <section className="card sticky-card">
            <div className="card-head">
              <div>
                <h3>Match breakdown</h3>
                <p>{match.experience.userYears} yrs experience detected</p>
              </div>
            </div>
            <MatchBreakdown match={match} />
          </section>

          <section className="card sticky-card">
            <div className="card-head">
              <div>
                <h3>Application</h3>
                <p>Your tracking state for this role.</p>
              </div>
            </div>

            {application ? (
              <>
                <label className="field">
                  <span>Status</span>
                  <select
                    value={isSubmitted ? "submitted" : application.status}
                    onChange={(event) => changeStatus(event.target.value)}
                    disabled={isSubmitted || statusBusy}
                  >
                    {isSubmitted && <option value="submitted">Submitted</option>}
                    {EDITABLE_STATUSES.map((status) => (
                      <option value={status} key={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>
                {isSubmitted && (
                  <p className="muted-small">
                    Recorded {formatDate(application.submittedAt)} via {labelize(application.submissionMethod)}.
                    Submission cannot be set directly — it requires explicit confirmation.
                  </p>
                )}

                <button
                  type="button"
                  className="button button-secondary button-block"
                  onClick={openPreview}
                >
                  <Icon name="shield" size={16} /> Open application preview
                </button>

                <label className="field">
                  <span>Private notes</span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Recruiter name, follow-up date, reminders…"
                  />
                </label>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={saveNotes}
                  disabled={savingNotes}
                >
                  {savingNotes ? <span className="spinner spinner--small" /> : <Icon name="check" size={14} />}
                  Save notes
                </button>
              </>
            ) : (
              <>
                <p className="soft-empty">This job is not tracked yet.</p>
                <button
                  type="button"
                  className="button button-primary button-block"
                  onClick={trackApplication}
                  disabled={trackingBusy}
                >
                  {trackingBusy ? <span className="spinner spinner--small" /> : <Icon name="plus" size={16} />}
                  Start tracking
                </button>
              </>
            )}
          </section>

          <section className="card safety-card">
            <Icon name="shield" size={20} />
            <div>
              <strong>Manual submission only</strong>
              <p>
                ApplyPilot opens the employer's page and prepares your information.
                It never submits forms, bypasses CAPTCHAs, or automates LinkedIn.
              </p>
            </div>
          </section>
        </aside>
      </div>

      {previewLoading && <PageLoader label="Preparing your application preview…" />}
      {previewError && !preview && <ErrorState error={previewError} compact />}

      {preview && (
        <Modal
          title="Application preview"
          subtitle={`${job.title} at ${job.company}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <button type="button" className="button button-ghost" onClick={() => setPreview(null)}>
                Close
              </button>
              <a
                className="button button-secondary"
                href={preview.job.applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open employer page <Icon name="external" size={15} />
              </a>
              <button
                type="button"
                className="button button-primary"
                onClick={recordSubmission}
                disabled={!approved || submitting}
              >
                {submitting ? <span className="spinner spinner--small" /> : <Icon name="checkCircle" size={16} />}
                {submitting ? "Recording…" : "I submitted this — record it"}
              </button>
            </>
          }
        >
          <div className="preview-stack">
            <Notice variant="warning">
              {preview.workflow.instructions[0]} ApplyPilot does not submit this
              application. Complete the employer's form yourself, then record the
              submission here.
            </Notice>

            {readiness && (
              <Notice variant={readiness.ready ? "success" : "warning"}>
                {readiness.ready
                  ? "Readiness checklist is clear. Review every value below, then submit on the employer's site yourself."
                  : `Before you apply: ${readiness.blocking.length} readiness ${
                      readiness.blocking.length === 1 ? "blocker remains" : "blockers remain"
                    }. Open the Ready for Review checklist on this page for details.`}
              </Notice>
            )}

            <div className="preview-grid">
              <section>
                <h4 className="subheading">Verified prefill values</h4>
                <div className="prefill-list">
                  {preview.prefill.fields.map((field) => (
                    <div className="prefill-row" key={field.key}>
                      <span>{field.label}</span>
                      <strong>{field.value}</strong>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => copyText(field.value, field.label)}
                        aria-label={`Copy ${field.label}`}
                      >
                        <Icon name="copy" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="subheading">Cover letter</h4>
                {preview.prefill.coverLetter ? (
                  <>
                    <pre className="preview-letter">{preview.prefill.coverLetter}</pre>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => copyText(preview.prefill.coverLetter, "Cover letter")}
                    >
                      <Icon name="copy" size={14} /> Copy cover letter
                    </button>
                  </>
                ) : (
                  <p className="soft-empty">
                    No saved cover letter. Generate one from the job page, then reopen
                    this preview.
                  </p>
                )}
              </section>
            </div>

            <section>
              <h4 className="subheading">Workflow and limitations</h4>
              <ol className="workflow-list">
                {preview.workflow.instructions.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ol>
              <ul className="limitation-list">
                {preview.workflow.limitations.map((limitation) => (
                  <li key={limitation}>
                    <Icon name="info" size={14} /> {limitation}
                  </li>
                ))}
              </ul>
            </section>

            {previewError && <ErrorState error={previewError} compact />}

            <label className="approval-check">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              <span>
                I submitted this application myself on the employer&apos;s site and
                confirm the information above is accurate.
              </span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
