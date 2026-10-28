import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import Icon from "../components/Icon.jsx";
import { ErrorState, Notice, PageLoader } from "../components/Feedback.jsx";
import { formatBytes, formatDate } from "../utils/format.js";

function splitList(value) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function revisionLabel(version) {
  return `Revision ${version.revision} — ${
    version.status === "approved" ? "Approved" : "Draft"
  }`;
}

export default function TailoredResumePage() {
  const { id: jobId } = useParams();
  const [job, setJob] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState({ headline: "", summary: "", skillsText: "" });
  const [approvedChecked, setApprovedChecked] = useState(false);

  const loadList = useCallback(
    async (preferredId) => {
      const response = await api.tailoredResumes.list({ jobId });
      const list = response.data.tailoredResumes;
      setVersions(list);

      const target =
        list.find((version) => version.id === preferredId) ||
        list.find((version) => version.isLatestRevision) ||
        list[0];

      if (!target) {
        setSelectedId(null);
        setDetail(null);
        return list;
      }

      const detailResponse = await api.tailoredResumes.get(target.id);
      setSelectedId(target.id);
      setDetail(detailResponse.data.tailoredResume);
      return list;
    },
    [jobId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobResponse] = await Promise.all([
        api.jobs.get(jobId),
        loadList(),
      ]);
      setJob(jobResponse.data.job);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [jobId, loadList]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) {
      setDraft({ headline: "", summary: "", skillsText: "" });
      setApprovedChecked(false);
      return;
    }

    setDraft({
      headline: detail.content?.headline || "",
      summary: detail.content?.summary || "",
      skillsText: (detail.content?.skills || []).join(", "),
    });
    setApprovedChecked(false);
  }, [detail?.id, detail?.status]);

  async function selectVersion(id) {
    setBusy("select");
    try {
      const response = await api.tailoredResumes.get(id);
      setSelectedId(id);
      setDetail(response.data.tailoredResume);
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    setBusy("generate");
    setNotice(null);
    try {
      const response = await api.tailoredResumes.create(jobId);
      await loadList(response.data.tailoredResume.id);
      setNotice({
        variant: "success",
        text: "Tailored draft generated from your verified profile. Review the differences and approve it only when every claim is accurate.",
      });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusy("");
    }
  }

  async function saveEdits(event) {
    event.preventDefault();
    if (!detail) return;

    setBusy("save");
    setNotice(null);
    try {
      const response = await api.tailoredResumes.update(detail.id, {
        headline: draft.headline.trim(),
        summary: draft.summary.trim(),
        skills: splitList(draft.skillsText),
      });
      setDetail(response.data.tailoredResume);
      await loadList(detail.id);
      setNotice({ variant: "success", text: "Draft updated and both files rebuilt." });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    if (!detail || !approvedChecked) return;

    setBusy("approve");
    setNotice(null);
    try {
      const response = await api.tailoredResumes.approve(detail.id);
      setDetail(response.data.tailoredResume);
      await loadList(detail.id);
      setNotice({
        variant: "success",
        text: "Tailored resume approved. It is now offered in the application preview for this job.",
      });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusy("");
    }
  }

  async function regenerate() {
    if (!detail) return;

    setBusy("regenerate");
    setNotice(null);
    try {
      const response = await api.tailoredResumes.regenerate(detail.id);
      await loadList(response.data.tailoredResume.id);
      setNotice({
        variant: "success",
        text: `Revision ${response.data.tailoredResume.revision} generated as a new draft. Earlier revisions are kept.`,
      });
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusy("");
    }
  }

  async function download(format) {
    if (!detail) return;

    setBusy(`download-${format}`);
    try {
      const blob = await api.tailoredResumes.download(detail.id, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        detail.files?.find((file) => file.format === format)?.fileName ||
        `tailored-resume.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusy("");
    }
  }

  const diff = detail?.diff || {};
  const content = detail?.content || {};
  const isApproved = detail?.status === "approved";

  const differenceCount = useMemo(() => {
    if (!detail) return 0;
    let count = 0;
    if (diff.summary?.changed) count += 1;
    if (diff.skills?.reordered) count += 1;
    if (diff.skills?.added?.length) count += diff.skills.added.length;
    if (diff.skills?.removed?.length) count += diff.skills.removed.length;
    if (diff.experience?.reordered) count += 1;
    count += diff.sourceResume?.skillsOmitted?.length || 0;
    for (const project of diff.projects || []) {
      count += project.omitted?.length || 0;
    }
    return count;
  }, [detail, diff]);

  if (loading) return <PageLoader label="Loading tailored resumes…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="page-stack">
      <Link to={`/jobs/${jobId}`} className="back-link">
        <Icon name="arrowLeft" size={16} /> Back to job
      </Link>

      <section className="section-heading">
        <div>
          <span className="eyebrow">Job-specific documents</span>
          <h2>Tailored resume</h2>
          <p>
            {job?.title || "This role"} at {job?.company || "the employer"}. Built
            only from your verified profile; unverified accomplishments are left
            out.
          </p>
        </div>
        <div className="section-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={generate}
            disabled={busy === "generate"}
          >
            {busy === "generate" ? (
              <span className="spinner spinner--small" />
            ) : (
              <Icon name="sparkles" size={16} />
            )}
            {busy === "generate" ? "Generating…" : "Generate tailored resume"}
          </button>
          {detail && (
            <button
              type="button"
              className="button button-secondary"
              onClick={regenerate}
              disabled={busy === "regenerate"}
            >
              <Icon name="sparkles" size={16} /> Regenerate
            </button>
          )}
        </div>
      </section>

      {notice && (
        <Notice variant={notice.variant} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      {versions.length === 0 ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h3>No tailored resume yet</h3>
              <p>
                Generate a version for this job. PDF and DOCX files are stored
                privately, and nothing is used in the application preview until
                you approve it.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h3>Versions</h3>
                <p>
                  Every generation is kept as a separate revision. Approving one
                  never changes the original resume.
                </p>
              </div>
            </div>
            <label className="field">
              <span>Tailored resume revision</span>
              <select
                value={selectedId || ""}
                onChange={(event) => selectVersion(event.target.value)}
                disabled={busy === "select"}
              >
                {versions.map((version) => (
                  <option value={version.id} key={version.id}>
                    {revisionLabel(version)} · {formatDate(version.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {detail && (
            <>
              <section className="card">
                <div className="card-head">
                  <div>
                    <h3>
                      Revision {detail.revision}{" "}
                      <span className={`chip ${isApproved ? "chip--success" : ""}`}>
                        {isApproved ? "Approved" : "Draft"}
                      </span>
                    </h3>
                    <p>
                      {isApproved
                        ? `Approved ${formatDate(detail.approvedAt)}. Included in the application preview for this job.`
                        : "Drafts are never used for an application. Review, edit, then approve explicitly."}
                    </p>
                  </div>
                  <div className="section-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => download("pdf")}
                      disabled={busy === "download-pdf"}
                    >
                      <Icon name="download" size={15} /> Download PDF
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => download("docx")}
                      disabled={busy === "download-docx"}
                    >
                      <Icon name="download" size={15} /> Download DOCX
                    </button>
                  </div>
                </div>

                <div className="chip-row chip-row--wrap">
                  {(detail.files || []).map((file) => (
                    <span className="chip" key={file.format}>
                      {file.format.toUpperCase()} · {formatBytes(file.size)}
                    </span>
                  ))}
                  <span className="chip">
                    Made from your original resume · {detail.provider === "openai" ? "AI-assisted summary" : "Deterministic"}
                  </span>
                </div>

                {detail.notice && <p className="field-hint">{detail.notice}</p>}

                {isApproved ? (
                  <p className="field-hint">
                    <Icon name="shield" size={15} /> Approved revisions are locked.
                    Use Regenerate to create a new draft revision.
                  </p>
                ) : (
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={approvedChecked}
                      onChange={(event) => setApprovedChecked(event.target.checked)}
                    />
                    <span>
                      I reviewed every claim and confirm this resume is accurate
                    </span>
                  </label>
                )}

                {!isApproved && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={approve}
                    disabled={!approvedChecked || busy === "approve"}
                  >
                    {busy === "approve" ? (
                      <span className="spinner spinner--small" />
                    ) : (
                      <Icon name="check" size={17} />
                    )}
                    Approve for application use
                  </button>
                )}
              </section>

              <section className="card">
                <div className="card-head">
                  <div>
                    <h3>Differences from your original</h3>
                    <p>
                      {differenceCount} change
                      {differenceCount === 1 ? "" : "s"} detected against the
                      verified profile.
                    </p>
                  </div>
                </div>

                <ul className="plain-list">
                  {diff.summary?.changed && (
                    <li>
                      <strong>Summary tailored.</strong> Added a target-specific
                      opening while keeping your existing wording.
                    </li>
                  )}
                  {diff.skills?.reordered && (
                    <li>
                      <strong>Skills reordered.</strong> Job-relevant skills are
                      shown first; no skills were added.
                    </li>
                  )}
                  {diff.skills?.added?.length > 0 && (
                    <li>
                      <strong>Skills added:</strong> {diff.skills.added.join(", ")}
                    </li>
                  )}
                  {diff.skills?.removed?.length > 0 && (
                    <li>
                      <strong>Skills omitted:</strong> {diff.skills.removed.join(", ")}
                    </li>
                  )}
                  {diff.experience?.reordered && (
                    <li>
                      <strong>Experience reordered</strong> by relevance to this
                      job; all entries are kept.
                    </li>
                  )}
                  {diff.sourceResume?.skillsOmitted?.length > 0 && (
                    <li>
                      <strong>Original document:</strong> omitted{" "}
                      {diff.sourceResume.skillsOmitted.join(", ")} because those
                      skills are not in your verified profile.
                    </li>
                  )}
                  {(diff.projects || []).map((project) =>
                    project.omitted?.length ? (
                      <li key={project.name}>
                        <strong>{project.name}:</strong> omitted{" "}
                        {project.omitted.join("; ")} because it is not marked
                        verified.
                      </li>
                    ) : null
                  )}
                  {differenceCount === 0 && (
                    <li>No content differences were detected.</li>
                  )}
                </ul>
              </section>

              <section className="card">
                <div className="card-head">
                  <div>
                    <h3>Edit this revision</h3>
                    <p>
                      Edits rebuild both files and keep the same revision. Approved
                      revisions cannot be edited.
                    </p>
                  </div>
                </div>

                <form className="page-stack" onSubmit={saveEdits}>
                  <div className="form-grid">
                    <label className="field field--full">
                      <span>Headline</span>
                      <input
                        value={draft.headline}
                        disabled={isApproved}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            headline: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field field--full">
                      <span>Summary</span>
                      <textarea
                        rows={5}
                        value={draft.summary}
                        disabled={isApproved}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            summary: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field field--full">
                      <span>Skills</span>
                      <input
                        value={draft.skillsText}
                        disabled={isApproved}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            skillsText: event.target.value,
                          }))
                        }
                      />
                      <small className="field-hint">Comma-separated</small>
                    </label>
                  </div>

                  <div className="sticky-actions">
                    <p>
                      <Icon name="shield" size={15} /> The original uploaded resume
                      is never modified.
                    </p>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={isApproved || busy === "save"}
                    >
                      {busy === "save" ? (
                        <span className="spinner spinner--small" />
                      ) : (
                        <Icon name="check" size={17} />
                      )}
                      Save changes
                    </button>
                  </div>
                </form>
              </section>

              {content.headline && (
                <p className="field-hint">
                  Current headline: {content.headline} ·{" "}
                  {(content.skills || []).length} skills ·{" "}
                  {(content.projects || []).length} projects
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
