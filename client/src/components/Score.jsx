export function scoreColor(score) {
  if (score >= 75) return "var(--accent-2)";
  if (score >= 50) return "var(--accent)";
  if (score >= 30) return "var(--warning)";
  return "var(--danger)";
}

export function ScoreRing({ score = 0, size = 68, label = "match" }) {
  const safe = Math.max(0, Math.min(100, Math.round(score)));
  const color = scoreColor(safe);

  return (
    <div
      className="score-ring"
      style={{
        "--score": `${safe * 3.6}deg`,
        "--score-color": color,
        width: size,
        height: size,
      }}
      role="img"
      aria-label={`${safe} percent ${label}`}
    >
      <div className="score-ring-inner">
        <strong>{safe}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

const COMPONENT_LABELS = {
  skills: "Skills",
  experience: "Experience",
  role: "Role fit",
  location: "Location",
};

export function MatchBreakdown({ match }) {
  if (!match) return null;

  return (
    <div className="match-breakdown">
      {Object.entries(match.components || {}).map(([key, value]) => (
        <div className="match-row" key={key}>
          <div className="match-row-label">
            <span>{COMPONENT_LABELS[key] || key}</span>
            <strong>{value}%</strong>
          </div>
          <div className="progress-track">
            <span
              className="progress-fill"
              style={{ width: `${Math.max(2, value)}%`, background: scoreColor(value) }}
            />
          </div>
        </div>
      ))}
      <p className="muted-small">
        Weighted score: skills 55%, experience 20%, role 15%, location 10%.
        Deterministic and explainable — no AI required.
      </p>
    </div>
  );
}
