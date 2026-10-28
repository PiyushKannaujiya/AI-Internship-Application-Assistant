import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import Icon from "../components/Icon.jsx";
import StatusBadge, { STATUS_LABELS, STATUS_ORDER } from "../components/StatusBadge.jsx";
import {
  EmptyState,
  ErrorState,
  Modal,
  Notice,
  SkeletonCards,
} from "../components/Feedback.jsx";
import { formatDate, timeAgo } from "../utils/format.js";
import {
  DEFAULT_DISCOVERY_SOURCES,
  DISCOVERABLE_SOURCES,
  sourceLabel,
} from "../utils/sources.js";

const EMPTY_FORM = {
  title: "",
  company: "",
  description: "",
  skills: "",
  location: "",
  jobType: "internship",
  remote: false,
  applicationUrl: "",
  postedAt: "",
};

function excerpt(text = "", length = 190) {
  if (text.length <= length) return text;
  return `${text.slice(0, length).trim()}…`;
}

export default function JobsPage() {
  const [tab, setTab] = useState("saved");
  const [filters, setFilters] = useState({
    q: "",
    location: "",
    jobType: "",
    remote: "",
    status: "",
    sort: "newest",
  });
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyJobId, setBusyJobId] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addErrors, setAddErrors] = useState({});
  const [adding, setAdding] = useState(false);

  const [discoverSearch, setDiscoverSearch] = useState("");
  // India is the default audience for this assistant; live discovery filters
  // against it unless the user explicitly widens or narrows the location.
  const [discoverLocation, setDiscoverLocation] = useState("India");
  const [discoverRemote, setDiscoverRemote] = useState("");
  const [discoverJobType, setDiscoverJobType] = useState("");
  const [discoverResults, setDiscoverResults] = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);
  const [discoverSources, setDiscoverSources] = useState(
    DEFAULT_DISCOVERY_SOURCES
  );
  const [boardTargets, setBoardTargets] = useState({
    greenhouse: "",
    lever: "",
    ashby: "",
    workable: "",
    smartrecruiters: "",
  });
  const [importingId, setImportingId] = useState(null);

  const [urlInput, setUrlInput] = useState("");
  const [urlDraft, setUrlDraft] = useState(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlError, setUrlError] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(filters.q.trim()), 350);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const hasFilters = useMemo(
    () =>
      Boolean(
        filters.q ||
          filters.location ||
          filters.jobType ||
          filters.remote ||
          filters.status ||
          filters.sort !== "newest"
      ),
    [filters]
  );

  // Server-echoed live-search filters, shown above the results so a narrow
  // query (e.g. "location india") is never mistaken for an empty feed.
  const discoverSummary = discoverResults?.filters
    ? [
        discoverResults.filters.location &&
          `location ${discoverResults.filters.location}`,
        discoverResults.filters.remote === true && "remote only",
        discoverResults.filters.remote === false && "on-site / hybrid only",
        discoverResults.filters.jobType,
      ]
          .filter(Boolean)
          .join(" · ")
    : "";

  const loadJobs = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const response = await api.jobs.list({
        q: debouncedQuery,
        location: filters.location,
        jobType: filters.jobType,
        remote: filters.remote,
        status: filters.status,
        sort: filters.sort,
        page,
        limit: 12,
      });

      if (currentRequest === requestId.current) {
        setJobs(response.data.jobs);
        setMeta(response.meta);
      }
    } catch (requestError) {
      if (currentRequest === requestId.current) setError(requestError);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [debouncedQuery, filters.location, filters.jobType, filters.remote, filters.status, filters.sort, page]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  }

  function resetFilters() {
    setFilters({
      q: "",
      location: "",
      jobType: "",
      remote: "",
      status: "",
      sort: "newest",
    });
    setPage(1);
  }

  async function toggleSave(job) {
    setBusyJobId(job.id);
    setNotice(null);
    try {
      if (job.applicationStatus) {
        await api.jobs.unsave(job.id);
        setNotice({ variant: "success", text: `Removed ${job.title} from saved jobs.` });
      } else {
        await api.jobs.save(job.id);
        setNotice({ variant: "success", text: `Saved ${job.title}.` });
      }
      await loadJobs();
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusyJobId(null);
    }
  }

  async function submitJob(event) {
    event.preventDefault();
    const nextErrors = {};
    if (addForm.title.trim().length < 2) nextErrors.title = "Enter a job title";
    if (!addForm.company.trim()) nextErrors.company = "Enter a company";
    if (addForm.description.trim().length < 10)
      nextErrors.description = "Describe the role in at least 10 characters";
    try {
      const url = new URL(addForm.applicationUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
    } catch {
      nextErrors.applicationUrl = "Enter a valid http(s) application URL";
    }

    setAddErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setAdding(true);
    try {
      const response = await api.jobs.create({
        ...addForm,
        skills: addForm.skills
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
        location: addForm.location.trim() || "Not specified",
        postedAt: addForm.postedAt || undefined,
      });
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
      setNotice({ variant: "success", text: "Job added to your saved list." });
      setTab("saved");
      setPage(1);
      await loadJobs();
      return response;
    } catch (requestError) {
      setAddErrors({
        form: requestError.message,
        title: requestError.errors?.find((entry) => entry.field === "title")?.message,
        applicationUrl: requestError.errors?.find(
          (entry) => entry.field === "applicationUrl"
        )?.message,
      });
    } finally {
      setAdding(false);
    }
  }

  function toggleSource(name) {
    setDiscoverSources((current) =>
      current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name]
    );
  }

  async function loadDiscover(event) {
    event?.preventDefault();

    if (discoverSources.length === 0) {
      setDiscoverError(null);
      setNotice({ variant: "error", text: "Choose at least one job source." });
      return;
    }

    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const response = await api.jobs.discover({
        search: discoverSearch.trim(),
        location: discoverLocation.trim(),
        remote: discoverRemote,
        jobType: discoverJobType,
        limit: 12,
        sources: discoverSources.join(","),
        greenhouse: discoverSources.includes("greenhouse")
          ? boardTargets.greenhouse.trim()
          : "",
        lever: discoverSources.includes("lever")
          ? boardTargets.lever.trim()
          : "",
        ashby: discoverSources.includes("ashby")
          ? boardTargets.ashby.trim()
          : "",
        workable: discoverSources.includes("workable")
          ? boardTargets.workable.trim()
          : "",
        smartrecruiters: discoverSources.includes("smartrecruiters")
          ? boardTargets.smartrecruiters.trim()
          : "",
      });
      setDiscoverResults(response.data);
    } catch (requestError) {
      setDiscoverError(requestError);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function readUrl(event) {
    event?.preventDefault();
    const url = urlInput.trim();
    if (!url) return;

    setUrlBusy(true);
    setUrlError(null);
    setUrlDraft(null);

    try {
      const response = await api.jobs.importUrl(url);
      setUrlDraft(response.data);
    } catch (requestError) {
      setUrlError(requestError);
    } finally {
      setUrlBusy(false);
    }
  }

  async function saveUrlDraft() {
    if (!urlDraft?.job) return;

    setUrlSaving(true);
    setUrlError(null);

    try {
      const response = await api.jobs.importUrl(urlDraft.requestedUrl, {
        save: true,
      });
      setUrlDraft(response.data);
      setNotice({
        variant: "success",
        text: response.data.created
          ? `Saved ${response.data.jobSaved.title}. It is now in your saved jobs.`
          : `${response.data.jobSaved.title} was already in your saved jobs.`,
      });
      await loadJobs();
    } catch (requestError) {
      setUrlError(requestError);
    } finally {
      setUrlSaving(false);
    }
  }

  function fillManualFromDraft() {
    const draft = urlDraft?.job;
    const prefill = draft || urlDraft?.manualImport?.prefill || {};

    setAddForm({
      ...EMPTY_FORM,
      title: prefill.title || "",
      company: prefill.company || "",
      description: prefill.description || "",
      skills: Array.isArray(draft?.skills) ? draft.skills.join(", ") : "",
      applicationUrl:
        prefill.applicationUrl || urlDraft?.finalUrl || urlInput || "",
      location:
        prefill.location && prefill.location !== "Not specified"
          ? prefill.location
          : "",
      jobType: prefill.jobType || "internship",
      remote: Boolean(prefill.remote),
    });
    setAddErrors({});
    setShowAdd(true);
  }

  async function importJob(job) {
    setImportingId(job.externalId);
    setNotice(null);
    try {
      const response = await api.jobs.import(job.externalId, {
        source: job.source,
      });
      setNotice({
        variant: "success",
        text: response.data.created
          ? `Imported ${job.title}. It is now in your saved jobs.`
          : `${job.title} was already in your saved jobs.`,
      });
      await loadJobs();
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Opportunity workspace</span>
          <h2>Find roles worth your time</h2>
          <p>
            Save listings, search your pipeline, and measure fit before you spend
            an hour on an application.
          </p>
        </div>
        <div className="section-actions">
          <button type="button" className="button button-secondary" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={16} /> Add job manually
          </button>
          <button type="button" className="button button-primary" onClick={() => setTab("discover")}>
            <Icon name="sparkles" size={16} /> Discover live jobs
          </button>
        </div>
      </section>

      {notice && (
        <Notice variant={notice.variant} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <div className="tabs" role="tablist" aria-label="Job views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "saved"}
          className={`tab ${tab === "saved" ? "active" : ""}`}
          onClick={() => setTab("saved")}
        >
          <Icon name="briefcase" size={16} /> My jobs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "discover"}
          className={`tab ${tab === "discover" ? "active" : ""}`}
          onClick={() => setTab("discover")}
        >
          <Icon name="sparkles" size={16} /> Discover live
        </button>
      </div>

      {tab === "saved" ? (
        <>
          <section className="card filter-card">
            <div className="filter-search">
              <Icon name="search" size={18} />
              <input
                type="search"
                value={filters.q}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder="Search title, company, skills, or description…"
                aria-label="Search saved jobs"
              />
            </div>
            <div className="filter-grid">
              <label className="filter-field">
                <span>Location</span>
                <input
                  value={filters.location}
                  onChange={(event) => updateFilter("location", event.target.value)}
                  placeholder="Remote, Bengaluru…"
                />
              </label>
              <label className="filter-field">
                <span>Job type</span>
                <select
                  value={filters.jobType}
                  onChange={(event) => updateFilter("jobType", event.target.value)}
                >
                  <option value="">All types</option>
                  <option value="internship">Internship</option>
                  <option value="full-time">Full-time</option>
                  <option value="part-time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="temporary">Temporary</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Work mode</span>
                <select
                  value={filters.remote}
                  onChange={(event) => updateFilter("remote", event.target.value)}
                >
                  <option value="">Any</option>
                  <option value="true">Remote</option>
                  <option value="false">On-site / hybrid</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Status</span>
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value)}
                >
                  <option value="">Any status</option>
                  {STATUS_ORDER.map((status) => (
                    <option value={status} key={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Sort</span>
                <select
                  value={filters.sort}
                  onChange={(event) => updateFilter("sort", event.target.value)}
                >
                  <option value="newest">Newest added</option>
                  <option value="oldest">Oldest added</option>
                  <option value="postedAt">Recently posted</option>
                  <option value="title">Title A–Z</option>
                  <option value="company">Company A–Z</option>
                </select>
              </label>
              <button
                type="button"
                className="button button-ghost button-small filter-reset"
                onClick={resetFilters}
                disabled={!hasFilters}
              >
                Reset filters
              </button>
            </div>
          </section>

          <div className="list-heading">
            <p>
              {meta ? `${meta.total} ${meta.total === 1 ? "job" : "jobs"}` : "Jobs"}
              {hasFilters ? " matching your filters" : " in your workspace"}
            </p>
            {meta && meta.totalPages > 1 && (
              <span>
                Page {meta.page} of {meta.totalPages}
              </span>
            )}
          </div>

          {loading ? (
            <SkeletonCards count={3} />
          ) : error ? (
            <ErrorState error={error} onRetry={loadJobs} />
          ) : jobs.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="briefcase"
                title={hasFilters ? "No jobs match those filters" : "No saved jobs yet"}
                description={
                  hasFilters
                    ? "Try a broader search or reset the filters."
                    : "Add a role manually, import one from a live source, or paste a job link."
                }
                action={
                  hasFilters ? (
                    <button type="button" className="button button-secondary button-small" onClick={resetFilters}>
                      Reset filters
                    </button>
                  ) : (
                    <div className="button-row">
                      <button type="button" className="button button-primary button-small" onClick={() => setShowAdd(true)}>
                        Add a job
                      </button>
                      <button type="button" className="button button-secondary button-small" onClick={() => setTab("discover")}>
                        Browse live jobs
                      </button>
                    </div>
                  )
                }
              />
            </div>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="job-card-main">
                    <div className="job-card-head">
                      <div>
                        <div className="job-title-row">
                          <h3>
                            <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                          </h3>
                          <StatusBadge status={job.applicationStatus} />
                        </div>
                        <p className="job-company">
                          <Icon name="building" size={15} /> {job.company}
                          <span className="dot-separator" />
                          <Icon name="mapPin" size={15} /> {job.location}
                          {job.remote && <span className="chip chip--success">Remote</span>}
                        </p>
                      </div>
                      <span className={`source-tag source-tag--${job.source}`}>
                        {sourceLabel(job.source)}
                      </span>
                    </div>

                    <p className="job-excerpt">{excerpt(job.description)}</p>

                    <div className="job-card-meta">
                      <span className="chip chip--muted">{job.jobType}</span>
                      {job.skills.slice(0, 5).map((skill) => (
                        <span className="chip" key={skill}>
                          {skill}
                        </span>
                      ))}
                      {job.skills.length > 5 && (
                        <span className="chip chip--muted">+{job.skills.length - 5}</span>
                      )}
                      <span className="job-date">
                        <Icon name="clock" size={13} /> Added {timeAgo(job.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="job-card-actions">
                    <Link to={`/jobs/${job.id}`} className="button button-secondary button-small">
                      View details <Icon name="arrowRight" size={15} />
                    </Link>
                    {!job.applicationStatus ? (
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={() => toggleSave(job)}
                        disabled={busyJobId === job.id}
                      >
                        <Icon name="plus" size={15} /> Save
                      </button>
                    ) : job.applicationStatus === "saved" ? (
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() => toggleSave(job)}
                        disabled={busyJobId === job.id}
                      >
                        {busyJobId === job.id ? <span className="spinner spinner--small" /> : <Icon name="trash" size={15} />}
                        Remove
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <nav className="pagination" aria-label="Job pagination">
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={!meta.hasPreviousPage}
              >
                <Icon name="chevronLeft" size={15} /> Previous
              </button>
              <span>
                Page {meta.page} of {meta.totalPages}
              </span>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => setPage((current) => current + 1)}
                disabled={!meta.hasNextPage}
              >
                Next <Icon name="chevronRight" size={15} />
              </button>
            </nav>
          )}
        </>
      ) : (
        <section className="discover-panel">
          <div className="card discover-intro">
            <div>
              <span className="eyebrow">Live providers</span>
              <h3>Search public job boards</h3>
              <p>
                Remotive, Jobicy, Arbeitnow, and Remote OK are queried directly.
                Adzuna's official India jobs API is queried once its free keys
                are set (ADZUNA_APP_ID / ADZUNA_APP_KEY in server/.env).
                Greenhouse, Lever, and Ashby are read only for the company boards
                you name. Filter by location (try “India”) or work mode, import a
                role to save it, score the match, and track the application.
              </p>
            </div>
            <form className="discover-form" onSubmit={loadDiscover}>
              <div className="discover-search">
                <div className="filter-search">
                  <Icon name="search" size={18} />
                  <input
                    type="search"
                    value={discoverSearch}
                    onChange={(event) => setDiscoverSearch(event.target.value)}
                    placeholder="Search live roles, e.g. backend intern"
                    aria-label="Search live jobs"
                  />
                </div>
                <button type="submit" className="button button-primary" disabled={discoverLoading}>
                  {discoverLoading ? <span className="spinner spinner--small" /> : <Icon name="search" size={16} />}
                  Search live
                </button>
              </div>
              <div className="filter-grid filter-grid--compact discover-filters">
                <label className="filter-field">
                  <span>Location</span>
                  <input
                    value={discoverLocation}
                    onChange={(event) => setDiscoverLocation(event.target.value)}
                    placeholder="India, Bengaluru, Remote…"
                    aria-label="Filter live jobs by location"
                  />
                </label>
                <label className="filter-field">
                  <span>Work mode</span>
                  <select
                    value={discoverRemote}
                    onChange={(event) => setDiscoverRemote(event.target.value)}
                    aria-label="Filter live jobs by work mode"
                  >
                    <option value="">Any</option>
                    <option value="true">Remote</option>
                    <option value="false">On-site / hybrid</option>
                  </select>
                </label>
                <label className="filter-field">
                  <span>Job type</span>
                  <select
                    value={discoverJobType}
                    onChange={(event) => setDiscoverJobType(event.target.value)}
                    aria-label="Filter live jobs by job type"
                  >
                    <option value="">All types</option>
                    <option value="internship">Internship</option>
                    <option value="full-time">Full-time</option>
                    <option value="part-time">Part-time</option>
                    <option value="contract">Contract</option>
                    <option value="temporary">Temporary</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="discover-intro">
              <div>
                <h3>Sources</h3>
                <p>
                  Choose which sources to query. Company boards only return results
                  when you name them.
                </p>
              </div>
            </div>
            <div className="source-picker" role="group" aria-label="Job sources">
              {DISCOVERABLE_SOURCES.map((source) => (
                <div className="source-option" key={source.name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={discoverSources.includes(source.name)}
                      onChange={() => toggleSource(source.name)}
                    />
                    <span>{source.label}</span>
                  </label>
                  {source.requiresTarget && discoverSources.includes(source.name) && (
                    <input
                      className="source-target"
                      value={boardTargets[source.name]}
                      onChange={(event) =>
                        setBoardTargets((current) => ({
                          ...current,
                          [source.name]: event.target.value,
                        }))
                      }
                      placeholder={source.targetPlaceholder}
                      aria-label={`${source.label} board names`}
                    />
                  )}
                  {source.requiresKey && discoverSources.includes(source.name) && (
                    <small className="muted-small source-key-hint">{source.keyHint}</small>
                  )}
                </div>
              ))}
            </div>
          </div>

          {discoverResults?.shortcuts?.length > 0 && (
            <div className="card">
              <div className="discover-intro">
                <div>
                  <span className="eyebrow">Not integrated by API</span>
                  <h3>Search on the platform instead</h3>
                  <p>
                    LinkedIn, Internshala, Naukri, Wellfound, Unstop, Cutshort,
                    and Foundit do not offer a public listing API, so they cannot
                    appear in live results. These verified shortcuts open their
                    own listings with your current filters applied where the
                    platform supports it.
                  </p>
                </div>
              </div>
              <div className="shortcut-grid" role="group" aria-label="Platform search shortcuts">
                {discoverResults.shortcuts.map((shortcut) => (
                  <a
                    key={shortcut.id}
                    href={shortcut.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shortcut-card"
                    title={shortcut.note}
                  >
                    <span>
                      <strong>{shortcut.label}</strong>
                      <span className="muted-small shortcut-note">Platform search · not a live feed</span>
                    </span>
                    <Icon name="external" size={14} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {discoverResults?.sources?.some((entry) => entry.status !== "ok") && (
            <Notice variant="warning">
              {discoverResults.sources
                .filter((entry) => entry.status !== "ok")
                .map((entry) => (
                  <p key={`${entry.source}-${entry.target || "all"}`}>
                    <strong>{entry.label || sourceLabel(entry.source)}</strong>
                    {entry.target ? ` (${entry.target})` : ""}:{" "}
                    {entry.error?.message || "No results were returned"}
                  </p>
                ))}
            </Notice>
          )}

          <div className="card">
            <div className="discover-intro">
              <div>
                <span className="eyebrow">Import from a URL</span>
                <h3>Paste a job link</h3>
                <p>
                  Company career pages and public LinkedIn, Internshala, or
                  Wellfound postings can be read straight from the page that is
                  public to you. None of those platforms is integrated through an
                  API, and nothing signs in, solves a CAPTCHA, or bypasses access
                  controls for you.
                </p>
              </div>
            </div>
            <form className="url-import-row" onSubmit={readUrl}>
              <div className="filter-search">
                <Icon name="external" size={18} />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  placeholder="https://company.example/careers/role"
                  aria-label="Job URL to import"
                />
              </div>
              <button
                type="submit"
                className="button button-secondary"
                disabled={urlBusy || !urlInput.trim()}
              >
                {urlBusy ? <span className="spinner spinner--small" /> : <Icon name="search" size={16} />}
                Read page
              </button>
            </form>

            {urlError && <Notice variant="error">{urlError.message}</Notice>}

            {urlDraft && (
              <div className="url-draft">
                <p className="muted-small">
                  {urlDraft.platform?.label || "Web page"}
                  {urlDraft.extracted
                    ? ` · ${urlDraft.strategy} extraction (${urlDraft.confidence} confidence)`
                    : " · automatic extraction unavailable"}
                  {" · URL reading only, no platform API"}
                </p>

                {urlDraft.job ? (
                  <>
                    <div className="job-card-head">
                      <div>
                        <div className="job-title-row">
                          <h3>{urlDraft.job.title}</h3>
                          <span className={`source-tag source-tag--${urlDraft.job.source}`}>
                            {sourceLabel(urlDraft.job.source)}
                          </span>
                        </div>
                        <p className="job-company">
                          <Icon name="building" size={15} /> {urlDraft.job.company}
                          <span className="dot-separator" />
                          <Icon name="mapPin" size={15} /> {urlDraft.job.location}
                        </p>
                      </div>
                    </div>
                    <p className="job-excerpt">{excerpt(urlDraft.job.description, 220)}</p>
                    {urlDraft.notes?.length > 0 && (
                      <ul className="draft-notes">
                        {urlDraft.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    )}
                    <div className="job-card-actions">
                      <a
                        href={urlDraft.finalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button button-ghost button-small"
                      >
                        Original page <Icon name="external" size={14} />
                      </a>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={fillManualFromDraft}
                      >
                        <Icon name="edit" size={15} /> Review in form
                      </button>
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={saveUrlDraft}
                        disabled={urlSaving || urlDraft.saved}
                      >
                        {urlSaving ? <span className="spinner spinner--small" /> : <Icon name="plus" size={15} />}
                        {urlDraft.saved ? "Saved" : "Save job"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <Notice variant="warning">
                      {urlDraft.manualImport?.note ||
                        "Automatic extraction was not possible for this page."}
                      {urlDraft.notes?.length > 0 && (
                        <ul className="draft-notes">
                          {urlDraft.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      )}
                    </Notice>
                    <div className="job-card-actions">
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={fillManualFromDraft}
                      >
                        <Icon name="plus" size={15} /> Fill the form manually
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {discoverError && (
            <ErrorState error={discoverError} onRetry={loadDiscover} compact />
          )}

          {discoverResults && !discoverLoading && (
            <p className="discover-summary">
              {discoverResults.jobs.length} live result
              {discoverResults.jobs.length === 1 ? "" : "s"}
              {discoverSummary ? ` · ${discoverSummary}` : ""}
              {" · refreshed "}
              {timeAgo(discoverResults.searchedAt)}
              {discoverResults.cached ? " (cached)" : ""}
            </p>
          )}

          {discoverLoading ? (
            <SkeletonCards count={3} />
          ) : discoverResults === null ? (
            <div className="card">
              <EmptyState
                icon="sparkles"
                title="Search the live job feed"
                description="Try “backend”, “data”, “frontend”, or leave the search blank for recent remote roles."
                action={
                  <button type="button" className="button button-primary button-small" onClick={loadDiscover}>
                    Load recent roles
                  </button>
                }
              />
            </div>
          ) : discoverResults.jobs.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="search"
                title="No live listings found"
                description="Try a different search term or widen the location, work-mode, and job-type filters. You can always add a job manually from a URL you found."
              />
            </div>
          ) : (
            <div className="job-list">
              {discoverResults.jobs.map((job) => (
                <article className="job-card job-card--live" key={job.externalId}>
                  <div className="job-card-main">
                    <div className="job-card-head">
                      <div>
                        <div className="job-title-row">
                          <h3>{job.title}</h3>
                          <span className="chip chip--success">Live</span>
                        </div>
                        <p className="job-company">
                          <Icon name="building" size={15} /> {job.company}
                          <span className="dot-separator" />
                          <Icon name="mapPin" size={15} /> {job.location}
                          {job.postedAt && (
                            <>
                              <span className="dot-separator" />
                              <Icon name="calendar" size={14} /> {formatDate(job.postedAt)}
                            </>
                          )}
                        </p>
                      </div>
                      <span className={`source-tag source-tag--${job.source}`}>
                        {sourceLabel(job.source)}
                      </span>
                    </div>
                    <p className="job-excerpt">{excerpt(job.description, 220)}</p>
                    <div className="job-card-meta">
                      <span className="chip chip--muted">{job.jobType}</span>
                      {job.skills.slice(0, 5).map((skill) => (
                        <span className="chip" key={skill}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="job-card-actions">
                    <a
                      href={job.applicationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="button button-ghost button-small"
                    >
                      Original listing <Icon name="external" size={14} />
                    </a>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      onClick={() => importJob(job)}
                      disabled={importingId === job.externalId}
                    >
                      {importingId === job.externalId ? (
                        <span className="spinner spinner--small" />
                      ) : (
                        <Icon name="plus" size={15} />
                      )}
                      Import & save
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {discoverResults && (
            <p className="attribution">
              {discoverResults.attribution
                .split(/(https?:\/\/[^\s|)]+)/)
                .map((part, index) =>
                  /^https?:\/\//.test(part) ? (
                    <a
                      href={part}
                      key={index}
                      target="_blank"
                      rel="noopener noreferrer follow"
                    >
                      {part}
                    </a>
                  ) : (
                    <span key={index}>{part}</span>
                  )
                )}
              . Please verify details on the original listing before applying.
            </p>
          )}
        </section>
      )}

      {showAdd && (
        <Modal
          title="Add a job manually"
          subtitle="Use a listing you found on a company site or job board."
          onClose={() => setShowAdd(false)}
          wide
          footer={
            <>
              <button type="button" className="button button-ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" form="add-job-form" className="button button-primary" disabled={adding}>
                {adding ? <span className="spinner spinner--small" /> : <Icon name="plus" size={16} />}
                Save job
              </button>
            </>
          }
        >
          <form id="add-job-form" onSubmit={submitJob} className="form-grid" noValidate>
            {addErrors.form && (
              <div className="field--full">
                <Notice variant="error">{addErrors.form}</Notice>
              </div>
            )}
            <label className="field">
              <span>Job title *</span>
              <input
                value={addForm.title}
                onChange={(event) => setAddForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Backend Engineering Intern"
              />
              {addErrors.title && <small className="field-error">{addErrors.title}</small>}
            </label>
            <label className="field">
              <span>Company *</span>
              <input
                value={addForm.company}
                onChange={(event) => setAddForm((current) => ({ ...current, company: event.target.value }))}
                placeholder="Acme Systems"
              />
            </label>
            <label className="field field--full">
              <span>Application URL *</span>
              <input
                value={addForm.applicationUrl}
                onChange={(event) =>
                  setAddForm((current) => ({ ...current, applicationUrl: event.target.value }))
                }
                placeholder="https://company.example/careers/role"
              />
              {addErrors.applicationUrl && (
                <small className="field-error">{addErrors.applicationUrl}</small>
              )}
            </label>
            <label className="field field--full">
              <span>Description *</span>
              <textarea
                rows={4}
                value={addForm.description}
                onChange={(event) =>
                  setAddForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Paste the role responsibilities and requirements."
              />
              {addErrors.description && (
                <small className="field-error">{addErrors.description}</small>
              )}
            </label>
            <label className="field field--full">
              <span>Skills</span>
              <input
                value={addForm.skills}
                onChange={(event) => setAddForm((current) => ({ ...current, skills: event.target.value }))}
                placeholder="JavaScript, Node.js, MongoDB"
              />
              <small className="field-hint">Comma-separated</small>
            </label>
            <label className="field">
              <span>Location</span>
              <input
                value={addForm.location}
                onChange={(event) => setAddForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="Remote"
              />
            </label>
            <label className="field">
              <span>Job type</span>
              <select
                value={addForm.jobType}
                onChange={(event) => setAddForm((current) => ({ ...current, jobType: event.target.value }))}
              >
                <option value="internship">Internship</option>
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="temporary">Temporary</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field">
              <span>Date posted</span>
              <input
                type="date"
                value={addForm.postedAt}
                onChange={(event) => setAddForm((current) => ({ ...current, postedAt: event.target.value }))}
              />
            </label>
            <label className="checkbox-field field--full">
              <input
                type="checkbox"
                checked={addForm.remote}
                onChange={(event) => setAddForm((current) => ({ ...current, remote: event.target.checked }))}
              />
              <span>This is a remote role</span>
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}
