import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import Icon from "../components/Icon.jsx";
import StatusBadge, { STATUS_LABELS, STATUS_ORDER } from "../components/StatusBadge.jsx";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Notice,
  SkeletonCards,
} from "../components/Feedback.jsx";
import { formatDate, timeAgo } from "../utils/format.js";

const EDITABLE_STATUSES = STATUS_ORDER.filter((status) => status !== "submitted");

export default function ApplicationsPage() {
  const [applications, setApplications] = useState([]);
  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.applications.list({
        status,
        q: debouncedQuery,
        page,
        limit: 15,
      });
      setApplications(response.data.applications);
      setMeta(response.meta);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [status, debouncedQuery, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(application, nextStatus) {
    if (nextStatus === application.status) return;
    setBusyId(application.id);
    setNotice(null);
    try {
      await api.applications.update(application.id, { status: nextStatus });
      setNotice({
        variant: "success",
        text: `${application.job?.title || "Application"} moved to ${
          STATUS_LABELS[nextStatus]
        }.`,
      });
      await load();
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteApplication() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.applications.remove(deleteTarget.id);
      setDeleteTarget(null);
      setNotice({
        variant: "success",
        text: "Tracking record deleted. The saved job remains in your workspace.",
      });
      await load();
    } catch (requestError) {
      setNotice({ variant: "error", text: requestError.message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Pipeline</span>
          <h2>Every application, one honest view</h2>
          <p>
            Update stages as things move. Marking an application submitted requires
            explicit confirmation on the job page.
          </p>
        </div>
        <Link to="/jobs" className="button button-primary">
          <Icon name="plus" size={16} /> Add a job
        </Link>
      </section>

      {notice && (
        <Notice variant={notice.variant} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <section className="card filter-card">
        <div className="filter-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search role, company, location…"
            aria-label="Search applications"
          />
        </div>
        <div className="filter-grid filter-grid--compact">
          <label className="filter-field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {STATUS_ORDER.map((value) => (
                <option value={value} key={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {(status || query) && (
            <button
              type="button"
              className="button button-ghost button-small filter-reset"
              onClick={() => {
                setStatus("");
                setQuery("");
                setPage(1);
              }}
            >
              Reset filters
            </button>
          )}
        </div>
      </section>

      <div className="list-heading">
        <p>
          {meta ? `${meta.total} tracked ${meta.total === 1 ? "application" : "applications"}` : "Applications"}
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
        <ErrorState error={error} onRetry={load} />
      ) : applications.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="layers"
            title={status || query ? "Nothing matches those filters" : "No applications tracked yet"}
            description={
              status || query
                ? "Try clearing the filters to see your full pipeline."
                : "Save a job to create a tracking record, then move it through the pipeline as you apply."
            }
            action={
              status || query ? (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => {
                    setStatus("");
                    setQuery("");
                    setPage(1);
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <Link to="/jobs" className="button button-primary button-small">
                  Browse jobs
                </Link>
              )
            }
          />
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table data-table--applications">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Stage</th>
                  <th>Updated</th>
                  <th>Submitted</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const isSubmitted = application.status === "submitted";
                  return (
                    <tr key={application.id}>
                      <td>
                        <div className="table-role">
                          <strong>{application.job?.title || "Job removed"}</strong>
                          <span>{application.job?.company || "—"}</span>
                        </div>
                      </td>
                      <td>{application.job?.location || "—"}</td>
                      <td>
                        <div className="status-select-wrap">
                          <StatusBadge status={application.status} />
                          {isSubmitted ? (
                            <span className="muted-small">Locked</span>
                          ) : (
                            <select
                              className="status-select"
                              value={application.status}
                              onChange={(event) => updateStatus(application, event.target.value)}
                              disabled={busyId === application.id}
                              aria-label={`Change status for ${application.job?.title || "application"}`}
                            >
                              {EDITABLE_STATUSES.map((value) => (
                                <option value={value} key={value}>
                                  {STATUS_LABELS[value]}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                      <td>{timeAgo(application.updatedAt)}</td>
                      <td>
                        {application.submittedAt ? formatDate(application.submittedAt) : "—"}
                      </td>
                      <td>
                        <div className="table-actions">
                          {application.job?.id ? (
                            <Link
                              to={`/jobs/${application.job.id}`}
                              className="button button-ghost button-small"
                            >
                              Open <Icon name="arrowRight" size={14} />
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            className="icon-button icon-button--danger"
                            onClick={() => setDeleteTarget(application)}
                            aria-label="Delete tracking record"
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <nav className="pagination" aria-label="Application pagination">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
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

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this tracking record?"
          message={`This removes your pipeline entry for ${
            deleteTarget.job?.title || "this job"
          }. The job itself stays saved, so you can track it again later.`}
          confirmLabel="Delete record"
          busy={deleting}
          onConfirm={deleteApplication}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
