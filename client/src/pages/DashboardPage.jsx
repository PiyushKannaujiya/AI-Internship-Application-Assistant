import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import Icon from "../components/Icon.jsx";
import StatusBadge, { STATUS_LABELS } from "../components/StatusBadge.jsx";
import { ScoreRing } from "../components/Score.jsx";
import {
  EmptyState,
  ErrorState,
  SkeletonCards,
} from "../components/Feedback.jsx";
import { firstName, formatDate, timeAgo } from "../utils/format.js";

const STAT_CARDS = [
  { key: "savedJobs", label: "Saved jobs", icon: "briefcase", tone: "blue" },
  { key: "active", label: "Active applications", icon: "target", tone: "teal" },
  { key: "submitted", label: "Submitted", icon: "checkCircle", tone: "violet" },
  { key: "interviews", label: "Interviews", icon: "calendar", tone: "amber" },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.dashboard.get();
      setData(response.data);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="page-stack">
        <div className="hero-card hero-card--loading">
          <div className="skeleton-line w-35" />
          <div className="skeleton-line w-55 tall" />
          <div className="skeleton-line w-45" />
        </div>
        <SkeletonCards count={4} />
        <SkeletonCards count={2} />
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={load} />;
  }

  const { stats, statusBreakdown, recommendedJobs, recentActivity, recentApplications } = data;
  const maxStatus = Math.max(1, ...statusBreakdown.map((entry) => entry.count));
  const completion = data.profileCompleteness;
  const topRecommendation = recommendedJobs[0];

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow eyebrow--light">
            {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}
          </span>
          <h2>Good to see you, {firstName(user?.name)}.</h2>
          <p>
            {stats.savedJobs > 0
              ? `You have ${stats.savedJobs} saved ${
                  stats.savedJobs === 1 ? "role" : "roles"
                } and ${stats.active} active ${
                  stats.active === 1 ? "application" : "applications"
                }. Keep the momentum going.`
              : "Start by saving a role or importing a live listing. Your match scores will appear here."}
          </p>
          <div className="hero-actions">
            <Link to="/jobs" className="button button-light">
              <Icon name="search" size={17} /> Browse jobs
            </Link>
            <Link to="/resume" className="button button-glass">
              <Icon name="file" size={17} /> {data.resume ? "Review resume" : "Upload resume"}
            </Link>
          </div>
        </div>
        {data.resume ? (
          <div className="hero-panel">
            <span className="hero-panel-label">Resume ready</span>
            <div className="hero-resume">
              <span className="hero-resume-icon">
                <Icon name="file" size={22} />
              </span>
              <div>
                <strong>{data.resume.originalName}</strong>
                <small>
                  {data.resume.skills} skills detected · {formatDate(data.resume.uploadedAt)}
                </small>
              </div>
            </div>
            <div className="hero-completion">
              <div className="hero-completion-label">
                <span>Profile completion</span>
                <strong>{completion.percent}%</strong>
              </div>
              <div className="progress-track progress-track--light">
                <span className="progress-fill" style={{ width: `${completion.percent}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="hero-panel">
            <span className="hero-panel-label">Next best step</span>
            <div className="hero-resume">
              <span className="hero-resume-icon">
                <Icon name="upload" size={22} />
              </span>
              <div>
                <strong>Add your resume</strong>
                <small>Unlock skill matching and tailored drafts.</small>
              </div>
            </div>
            <Link to="/resume" className="button button-light button-small">
              Upload PDF or DOCX
            </Link>
          </div>
        )}
      </section>

      <section className="stats-grid" aria-label="Application overview">
        {STAT_CARDS.map((card) => (
          <article className={`stat-card stat-card--${card.tone}`} key={card.key}>
            <span className="stat-icon">
              <Icon name={card.icon} size={20} />
            </span>
            <div>
              <strong>{stats[card.key] ?? 0}</strong>
              <span>{card.label}</span>
            </div>
          </article>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="card pipeline-card">
          <div className="card-head">
            <div>
              <h3>Application pipeline</h3>
              <p>Every tracked role, by current stage.</p>
            </div>
            <Link to="/applications" className="text-link">
              View all <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          {stats.totalTracked === 0 ? (
            <EmptyState
              icon="layers"
              title="Your pipeline is empty"
              description="Save your first job to start tracking stages from saved to offer."
              action={
                <Link to="/jobs" className="button button-primary button-small">
                  Find your first role
                </Link>
              }
            />
          ) : (
            <div className="pipeline">
              {statusBreakdown.map((entry) => (
                <div className="pipeline-row" key={entry.status}>
                  <span className="pipeline-label">{STATUS_LABELS[entry.status]}</span>
                  <div className="pipeline-track">
                    <span
                      className={`pipeline-fill pipeline-fill--${entry.status}`}
                      style={{
                        width: entry.count ? `${Math.max(4, (entry.count / maxStatus) * 100)}%` : "0%",
                      }}
                    />
                  </div>
                  <strong>{entry.count}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card setup-card">
          <div className="card-head">
            <div>
              <h3>Application readiness</h3>
              <p>Complete the inputs that drive quality.</p>
            </div>
          </div>
          <div className="readiness">
            <ScoreRing score={completion.percent} size={82} label="complete" />
            <div className="readiness-copy">
              <strong>
                {completion.percent >= 80
                  ? "Strong foundation"
                  : completion.percent >= 45
                    ? "Good start"
                    : "Needs attention"}
              </strong>
              <p>
                {completion.missing.length === 0
                  ? "Your profile has everything needed for matching."
                  : `Missing: ${completion.missing.slice(0, 3).map((item) => item.replace(/([A-Z])/g, " $1").toLowerCase()).join(", ")}${completion.missing.length > 3 ? "…" : ""}`}
              </p>
              <Link to="/profile" className="text-link">
                Improve profile <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </div>
          <div className="readiness-divider" />
          <div className="readiness-row">
            <span className={`mini-icon ${data.resume ? "ok" : "warn"}`}>
              <Icon name={data.resume ? "check" : "upload"} size={14} />
            </span>
            <div>
              <strong>{data.resume ? "Resume parsed" : "No resume yet"}</strong>
              <small>
                {data.resume
                  ? `${data.resume.skills} skills available to matching`
                  : "Upload a text-based PDF or DOCX"}
              </small>
            </div>
            <Link to="/resume" className="text-link">
              {data.resume ? "Manage" : "Upload"}
            </Link>
          </div>
          <div className="readiness-row">
            <span className={`mini-icon ${data.ai.configured ? "ok" : ""}`}>
              <Icon name="sparkles" size={14} />
            </span>
            <div>
              <strong>{data.ai.configured ? "AI drafting enabled" : "Template drafting"}</strong>
              <small>
                {data.ai.configured
                  ? `Provider model: ${data.ai.model}`
                  : "AI is optional; drafts use verified profile data"}
              </small>
            </div>
          </div>
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Recommended for you</h3>
              <p>Ranked by the explainable match engine.</p>
            </div>
            <Link to="/jobs" className="text-link">
              All jobs <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          {recommendedJobs.length === 0 ? (
            <EmptyState
              icon="sparkles"
              title="No recommendations yet"
              description={data.recommendationNote}
              action={
                <Link to="/jobs" className="button button-primary button-small">
                  Add or import jobs
                </Link>
              }
            />
          ) : (
            <div className="recommendation-list">
              {recommendedJobs.map((job) => (
                <Link to={`/jobs/${job.id}`} key={job.id} className="recommendation">
                  <ScoreRing score={job.match.score} size={56} />
                  <div className="recommendation-copy">
                    <strong>{job.title}</strong>
                    <span>
                      {job.company} · {job.location}
                    </span>
                    <div className="chip-row">
                      {job.match.matchedSkills.slice(0, 3).map((skill) => (
                        <span className="chip chip--success" key={skill}>
                          {skill}
                        </span>
                      ))}
                      {job.match.missingSkills.slice(0, 1).map((skill) => (
                        <span className="chip chip--muted" key={skill}>
                          Missing: {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                  <StatusBadge status={job.applicationStatus} />
                </Link>
              ))}
            </div>
          )}
          {topRecommendation && (
            <p className="muted-small recommendation-note">
              Top match: {topRecommendation.match.reasons[0]}
            </p>
          )}
        </section>

        <section className="card activity-card">
          <div className="card-head">
            <div>
              <h3>Recent activity</h3>
              <p>Your latest workspace events.</p>
            </div>
          </div>

          {recentActivity.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No activity yet"
              description="Save a job or update your profile to see events here."
            />
          ) : (
            <ol className="timeline">
              {recentActivity.map((entry) => (
                <li key={entry.id}>
                  <span className="timeline-dot" />
                  <div>
                    <p>{entry.message}</p>
                    <small>{timeAgo(entry.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>Recent applications</h3>
            <p>Jump back into your latest tracked roles.</p>
          </div>
          <Link to="/applications" className="text-link">
            Manage all <Icon name="arrowRight" size={14} />
          </Link>
        </div>

        {recentApplications.length === 0 ? (
          <EmptyState
            icon="layers"
            title="Nothing tracked yet"
            description="Applications you save or prepare will show up here."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Updated</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {recentApplications.map((application) => (
                  <tr key={application.id}>
                    <td>
                      <strong>{application.job?.title || "Job removed"}</strong>
                    </td>
                    <td>{application.job?.company || "—"}</td>
                    <td>{timeAgo(application.updatedAt)}</td>
                    <td>
                      <StatusBadge status={application.status} />
                    </td>
                    <td className="table-action">
                      {application.job?.id ? (
                        <Link to={`/jobs/${application.job.id}`} className="icon-button" aria-label="Open job">
                          <Icon name="arrowRight" size={16} />
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
