export const STATUS_LABELS = {
  saved: "Saved",
  planned: "Planned",
  in_progress: "In progress",
  submitted: "Submitted",
  interview: "Interview",
  rejected: "Rejected",
  offer: "Offer",
};

export const STATUS_ORDER = [
  "saved",
  "planned",
  "in_progress",
  "submitted",
  "interview",
  "rejected",
  "offer",
];

export default function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span className={`status-badge status--${status}`}>
      <span className="status-dot" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}
