import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import Icon from "../components/Icon.jsx";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Notice,
  PageLoader,
} from "../components/Feedback.jsx";
import { formatBytes, formatDate } from "../utils/format.js";

const MAX_BYTES = 5 * 1024 * 1024;

function splitList(value) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function validateFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx"].includes(extension)) {
    return "Only PDF and DOCX files are supported.";
  }
  if (file.size > MAX_BYTES) {
    return "Resume must be 5 MB or smaller.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return "";
}

export default function ResumePage() {
  const { refreshUser } = useAuth();
  const [resume, setResume] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState(null);
  const [reviewDraft, setReviewDraft] = useState(null);
  const [reviewResult, setReviewResult] = useState(null);
  const [overwriteVerified, setOverwriteVerified] = useState(false);
  const [includeProjects, setIncludeProjects] = useState(true);
  const [includeCertifications, setIncludeCertifications] = useState(true);
  const [includeAchievements, setIncludeAchievements] = useState(true);
  const [applying, setApplying] = useState(false);
  const inputRef = useRef(null);

  const loadReview = useCallback(async () => {
    setReviewError(null);
    setReviewResult(null);
    try {
      const response = await api.resumes.extraction();
      const nextReview = response.data.review;
      setReview(nextReview);
      setReviewDraft({
        headline: nextReview.proposals.headline || "",
        phone: nextReview.proposals.contact.phone || "",
        linkedinUrl: nextReview.proposals.contact.linkedinUrl || "",
        githubUrl: nextReview.proposals.contact.githubUrl || "",
        portfolioUrl: nextReview.proposals.contact.portfolioUrl || "",
        skillsText: (nextReview.proposals.skills || []).join(", "),
        projects: (nextReview.proposals.projects || []).map((project) => ({
          name: project.name || "",
          description: project.description || "",
          technologiesText: (project.technologies || []).join(", "),
          accomplishments: (project.accomplishments || []).map((text) => ({
            text,
          })),
        })),
        certifications: (nextReview.proposals.certifications || []).map(
          (entry) => ({
            name: entry.name || "",
            issuer: entry.issuer || "",
            issueDate: entry.issueDate || "",
          })
        ),
        achievements: (nextReview.proposals.achievements || []).map(
          (title) => ({ title })
        ),
      });
      setOverwriteVerified(false);
      setIncludeProjects((nextReview.proposals.projects || []).length > 0);
      setIncludeCertifications(
        (nextReview.proposals.certifications || []).length > 0
      );
      setIncludeAchievements(
        (nextReview.proposals.achievements || []).length > 0
      );
    } catch (requestError) {
      setReview(null);
      setReviewDraft(null);
      setReviewError(requestError);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.resumes.get();
      setResume(response.data.resume);
      if (response.data.resume) await loadReview();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [loadReview]);

  useEffect(() => {
    load();
  }, [load]);

  async function uploadFile(file) {
    const validation = validateFile(file);
    if (validation) {
      setUploadError(validation);
      return;
    }

    setUploadError("");
    setUploading(true);
    setNotice(null);

    try {
      const response = await api.resumes.upload(file);
      setResume(response.data.resume);
      await loadReview();
      await refreshUser();
      setNotice({
        variant: "success",
        text: response.data.replaced
          ? "Resume replaced and re-parsed successfully."
          : "Resume uploaded and parsed successfully.",
      });
    } catch (requestError) {
      setUploadError(requestError.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (file) uploadFile(file);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  async function download() {
    try {
      const blob = await api.resumes.download();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = resume?.originalName || "resume";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    }
  }

  async function removeResume() {
    setDeleting(true);
    try {
      await api.resumes.remove();
      setResume(null);
      setReview(null);
      setReviewDraft(null);
      setReviewResult(null);
      setConfirmDelete(false);
      await refreshUser();
      setNotice({ variant: "success", text: "Resume deleted from private storage." });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setDeleting(false);
    }
  }

  function updateReviewEntry(listKey, index, field, value) {
    setReviewDraft((current) => ({
      ...current,
      [listKey]: current[listKey].map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function updateReviewAccomplishment(projectIndex, accomplishmentIndex, value) {
    setReviewDraft((current) => ({
      ...current,
      projects: current.projects.map((project, index) =>
        index === projectIndex
          ? {
              ...project,
              accomplishments: project.accomplishments.map(
                (entry, entryIndex) =>
                  entryIndex === accomplishmentIndex
                    ? { ...entry, text: value }
                    : entry
              ),
            }
          : project
      ),
    }));
  }

  async function applyReviewedExtraction() {
    if (!reviewDraft || !review) return;

    setApplying(true);
    setNotice(null);
    setReviewResult(null);

    try {
      const response = await api.resumes.applyExtraction({
        reviewed: true,
        overwriteVerified,
        fields: {
          headline: reviewDraft.headline.trim(),
          phone: reviewDraft.phone.trim(),
          linkedinUrl: reviewDraft.linkedinUrl.trim(),
          githubUrl: reviewDraft.githubUrl.trim(),
          portfolioUrl: reviewDraft.portfolioUrl.trim(),
        },
        skills: splitList(reviewDraft.skillsText),
        projects: includeProjects
          ? reviewDraft.projects.map((project) => ({
              name: project.name.trim(),
              description: project.description.trim(),
              technologies: splitList(project.technologiesText),
              accomplishments: project.accomplishments
                .filter((entry) => entry.text.trim())
                .map((entry) => ({
                  text: entry.text.trim(),
                  verified: false,
                })),
            }))
          : [],
        certifications: includeCertifications
          ? reviewDraft.certifications.map((entry) => ({
              name: entry.name.trim(),
              issuer: entry.issuer.trim(),
              issueDate: entry.issueDate.trim(),
            }))
          : [],
        achievements: includeAchievements
          ? reviewDraft.achievements.map(({ title }) => ({ title: title.trim() }))
          : [],
      });

      const result = response.data;
      await loadReview();
      await refreshUser();
      setReviewResult(result);
      setReviewError(null);
    } catch (requestError) {
      setReviewError(requestError);
    } finally {
      setApplying(false);
    }
  }

  if (loading) return <PageLoader label="Loading your resume…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const parsed = resume?.parsed || {};

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Private document</span>
          <h2>Your resume, parsed and ready</h2>
          <p>
            Files are stored privately and downloaded only through your
            authenticated account. Nothing is exposed on a public URL.
          </p>
        </div>
        {resume && (
          <div className="section-actions">
            <button type="button" className="button button-secondary" onClick={download}>
              <Icon name="download" size={16} /> Download
            </button>
            <button
              type="button"
              className="button button-danger-soft"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        )}
      </section>

      {notice && (
        <Notice variant={notice.variant} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      {!resume ? (
        <section className="card upload-card">
          <EmptyState
            icon="upload"
            title="Upload your resume"
            description="Add a text-based PDF or DOCX (max 5 MB). We extract skills, experience signals, and education mentions for matching."
          />
          <div
            className={`dropzone ${dragging ? "is-dragging" : ""} ${uploading ? "is-busy" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onFileChange}
              id="resume-upload"
              hidden
              disabled={uploading}
            />
            {uploading ? (
              <>
                <span className="spinner" />
                <strong>Uploading and parsing…</strong>
                <small>Extracting text can take a few seconds.</small>
              </>
            ) : (
              <>
                <span className="dropzone-icon">
                  <Icon name="upload" size={24} />
                </span>
                <strong>Drop your resume here</strong>
                <small>PDF or DOCX · up to 5 MB</small>
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose file
                </button>
              </>
            )}
          </div>
          {uploadError && <p className="field-error upload-error">{uploadError}</p>}
          <ul className="upload-tips">
            <li>Use a text-based PDF, not a screenshot or scanned image.</li>
            <li>Include skills, projects, and dates so matching has useful signals.</li>
            <li>DOCX files are parsed with formatting removed.</li>
          </ul>
        </section>
      ) : (
        <>
          <div className="resume-summary-grid">
            <section className="card resume-file-card">
              <div className="resume-file-icon">
                <Icon name="file" size={26} />
              </div>
              <div className="resume-file-copy">
                <span className="eyebrow">Current resume</span>
                <h3>{resume.originalName}</h3>
                <p>
                  {formatBytes(resume.size)} · uploaded {formatDate(resume.uploadedAt)}
                </p>
                <span className="chip chip--success">
                  <Icon name="check" size={13} /> Parsed privately
                </span>
              </div>
            </section>

            <section className="card metric-card">
              <span className="stat-icon stat-icon--teal">
                <Icon name="target" size={20} />
              </span>
              <div>
                <strong>{parsed.skills?.length || 0}</strong>
                <span>Skills detected</span>
              </div>
            </section>
            <section className="card metric-card">
              <span className="stat-icon stat-icon--violet">
                <Icon name="clock" size={20} />
              </span>
              <div>
                <strong>{parsed.experienceYears || 0} yrs</strong>
                <span>Estimated experience</span>
              </div>
            </section>
            <section className="card metric-card">
              <span className="stat-icon stat-icon--amber">
                <Icon name="file" size={20} />
              </span>
              <div>
                <strong>{parsed.wordCount || 0}</strong>
                <span>Words extracted</span>
              </div>
            </section>
          </div>

          {parsed.extractionWarning && (
            <Notice variant="warning">{parsed.extractionWarning}</Notice>
          )}

          <div className="two-column">
            <section className="card">
              <div className="card-head">
                <div>
                  <h3>Detected skills</h3>
                  <p>Used by the matching engine alongside your profile.</p>
                </div>
              </div>
              {parsed.skills?.length ? (
                <div className="chip-row chip-row--wrap">
                  {parsed.skills.map((skill) => (
                    <span className="chip" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="soft-empty">No recognized skills found. Try adding skills explicitly to your profile.</p>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h3>Education signals</h3>
                  <p>Lines detected from your document.</p>
                </div>
              </div>
              {parsed.educationMentions?.length ? (
                <ul className="plain-list">
                  {parsed.educationMentions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="soft-empty">No education lines detected.</p>
              )}
            </section>
          </div>

          {reviewError && (
            <Notice variant="warning">
              The extraction review could not be loaded or applied:{" "}
              {reviewError.message}
            </Notice>
          )}

          {reviewResult && (
            <Notice variant="success">
              Applied {reviewResult.applied.fields.length} profile field
              {reviewResult.applied.fields.length === 1 ? "" : "s"},{" "}
              {reviewResult.applied.skills.length} new skill
              {reviewResult.applied.skills.length === 1 ? "" : "s"},{" "}
              {reviewResult.applied.projects.length} project
              {reviewResult.applied.projects.length === 1 ? "" : "s"} and{" "}
              {reviewResult.applied.certifications.length} certification
              {reviewResult.applied.certifications.length === 1 ? "" : "s"}.
              {reviewResult.skipped.length > 0 && (
                <span>
                  {" "}
                  {reviewResult.skipped.length} value
                  {reviewResult.skipped.length === 1 ? " was" : "s were"} kept
                  from your verified profile.
                </span>
              )}
            </Notice>
          )}

          {review && reviewDraft && (
            <section className="card">
              <div className="card-head">
                <div>
                  <h3>Review extracted profile data</h3>
                  <p>
                    Parsing is a suggestion, not a fact. Correct or exclude
                    anything before it reaches your verified profile.
                  </p>
                </div>
              </div>

              {review.conflicts.length > 0 && (
                <div className="notice notice--warning">
                  <div className="notice-content">
                    <strong>
                      {review.conflicts.length} extracted value
                      {review.conflicts.length === 1 ? "" : "s"} differ from
                      your verified profile
                    </strong>
                    <ul className="plain-list">
                      {review.conflicts.map((conflict) => (
                        <li key={conflict.field}>
                          {conflict.label}: profile has “{conflict.current},”
                          resume says “{conflict.proposed}.”
                        </li>
                      ))}
                    </ul>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={overwriteVerified}
                        onChange={(event) =>
                          setOverwriteVerified(event.target.checked)
                        }
                      />
                      <span>
                        Replace existing verified values with the reviewed
                        extraction
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div className="form-grid">
                <label className="field field--full">
                  <span>Headline</span>
                  <input
                    value={reviewDraft.headline}
                    onChange={(event) =>
                      setReviewDraft((current) => ({
                        ...current,
                        headline: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Phone</span>
                  <input
                    value={reviewDraft.phone}
                    onChange={(event) =>
                      setReviewDraft((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>LinkedIn URL</span>
                  <input
                    value={reviewDraft.linkedinUrl}
                    onChange={(event) =>
                      setReviewDraft((current) => ({
                        ...current,
                        linkedinUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>GitHub URL</span>
                  <input
                    value={reviewDraft.githubUrl}
                    onChange={(event) =>
                      setReviewDraft((current) => ({
                        ...current,
                        githubUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Portfolio URL</span>
                  <input
                    value={reviewDraft.portfolioUrl}
                    onChange={(event) =>
                      setReviewDraft((current) => ({
                        ...current,
                        portfolioUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field field--full">
                  <span>Skills</span>
                  <input
                    value={reviewDraft.skillsText}
                    onChange={(event) =>
                      setReviewDraft((current) => ({
                        ...current,
                        skillsText: event.target.value,
                      }))
                    }
                  />
                  <small className="field-hint">
                    Comma-separated. Skills merge into your profile; none are
                    removed.
                  </small>
                </label>
              </div>

              <div className="page-stack">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={includeProjects}
                    onChange={(event) => setIncludeProjects(event.target.checked)}
                  />
                  <span>
                    Add {review.proposals.projects.length} extracted project
                    {review.proposals.projects.length === 1 ? "" : "s"}
                    {review.proposals.projects.length > 0 &&
                      `: ${review.proposals.projects
                        .map((project) => project.name)
                        .join(", ")}`}
                  </span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={includeCertifications}
                    onChange={(event) =>
                      setIncludeCertifications(event.target.checked)
                    }
                  />
                  <span>
                    Add {review.proposals.certifications.length} extracted
                    certification
                    {review.proposals.certifications.length === 1 ? "" : "s"}
                  </span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={includeAchievements}
                    onChange={(event) =>
                      setIncludeAchievements(event.target.checked)
                    }
                  />
                  <span>
                    Add {review.proposals.achievements.length} extracted
                    achievement
                    {review.proposals.achievements.length === 1 ? "" : "s"}
                  </span>
                </label>
              </div>

              {includeProjects && reviewDraft.projects.length > 0 && (
                <div className="repeat-list">
                  {reviewDraft.projects.map((project, index) => (
                    <div className="repeat-item" key={`review-project-${index}`}>
                      <div className="repeat-head">
                        <strong>Extracted project {index + 1}</strong>
                      </div>
                      <div className="form-grid">
                        <label className="field">
                          <span>Extracted project name {index + 1}</span>
                          <input
                            value={project.name}
                            onChange={(event) =>
                              updateReviewEntry(
                                "projects",
                                index,
                                "name",
                                event.target.value
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Extracted technologies {index + 1}</span>
                          <input
                            value={project.technologiesText}
                            onChange={(event) =>
                              updateReviewEntry(
                                "projects",
                                index,
                                "technologiesText",
                                event.target.value
                              )
                            }
                          />
                        </label>
                        <label className="field field--full">
                          <span>Extracted project description {index + 1}</span>
                          <textarea
                            rows={2}
                            value={project.description}
                            onChange={(event) =>
                              updateReviewEntry(
                                "projects",
                                index,
                                "description",
                                event.target.value
                              )
                            }
                          />
                        </label>
                        {project.accomplishments.map(
                          (accomplishment, accomplishmentIndex) => (
                            <label
                              className="field field--full"
                              key={`review-accomplishment-${index}-${accomplishmentIndex}`}
                            >
                              <span>
                                Extracted accomplishment {index + 1}.
                                {accomplishmentIndex + 1}
                              </span>
                              <input
                                value={accomplishment.text}
                                onChange={(event) =>
                                  updateReviewAccomplishment(
                                    index,
                                    accomplishmentIndex,
                                    event.target.value
                                  )
                                }
                              />
                            </label>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {includeCertifications &&
                reviewDraft.certifications.length > 0 && (
                  <div className="repeat-list">
                    {reviewDraft.certifications.map((entry, index) => (
                      <div className="repeat-item" key={`review-cert-${index}`}>
                        <div className="repeat-head">
                          <strong>Extracted certification {index + 1}</strong>
                        </div>
                        <div className="form-grid">
                          <label className="field field--full">
                            <span>
                              Extracted certification name {index + 1}
                            </span>
                            <input
                              value={entry.name}
                              onChange={(event) =>
                                updateReviewEntry(
                                  "certifications",
                                  index,
                                  "name",
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Extracted issuer {index + 1}</span>
                            <input
                              value={entry.issuer}
                              onChange={(event) =>
                                updateReviewEntry(
                                  "certifications",
                                  index,
                                  "issuer",
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Extracted issue date {index + 1}</span>
                            <input
                              value={entry.issueDate}
                              onChange={(event) =>
                                updateReviewEntry(
                                  "certifications",
                                  index,
                                  "issueDate",
                                  event.target.value
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {includeAchievements && reviewDraft.achievements.length > 0 && (
                <div className="repeat-list">
                  {reviewDraft.achievements.map((entry, index) => (
                    <div className="repeat-item" key={`review-achievement-${index}`}>
                      <label className="field field--full">
                        <span>Extracted achievement {index + 1}</span>
                        <input
                          value={entry.title}
                          onChange={(event) =>
                            updateReviewEntry(
                              "achievements",
                              index,
                              "title",
                              event.target.value
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <p className="field-hint">
                Correct anything the parser got wrong. Extracted accomplishments
                are saved as unverified until you tick them on your profile, and
                existing values are never replaced unless you allow it above.
              </p>

              <button
                type="button"
                className="button button-primary"
                onClick={applyReviewedExtraction}
                disabled={applying}
              >
                {applying ? (
                  <span className="spinner spinner--small" />
                ) : (
                  <Icon name="check" size={17} />
                )}
                {applying ? "Applying…" : "Apply reviewed data"}
              </button>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <div>
                <h3>Extracted text</h3>
                <p>Review what the matcher can read. Only visible to you.</p>
              </div>
            </div>
            <details className="text-details">
              <summary>Show extracted text</summary>
              <pre>{resume.text}</pre>
            </details>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h3>Replace your resume</h3>
                <p>Uploading a new file replaces the current private copy.</p>
              </div>
            </div>
            <div
              className={`dropzone dropzone--compact ${dragging ? "is-dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={onFileChange}
                hidden
                disabled={uploading}
              />
              {uploading ? (
                <>
                  <span className="spinner spinner--small" /> Uploading…
                </>
              ) : (
                <>
                  <Icon name="upload" size={18} />
                  <span>Drop a new PDF or DOCX, or</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => inputRef.current?.click()}
                  >
                    choose a file
                  </button>
                </>
              )}
            </div>
            {uploadError && <p className="field-error upload-error">{uploadError}</p>}
          </section>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete your resume?"
          message="The stored file, extracted text, and parsed skills will be removed. Your profile skills stay intact."
          confirmLabel="Delete resume"
          onConfirm={removeResume}
          onClose={() => setConfirmDelete(false)}
          busy={deleting}
        />
      )}
    </div>
  );
}
