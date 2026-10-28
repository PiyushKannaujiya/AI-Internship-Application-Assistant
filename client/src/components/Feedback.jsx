import { useEffect } from "react";
import Icon from "./Icon.jsx";

export function PageLoader({ label = "Loading…" }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <div className="spinner" />
      <p>{label}</p>
    </div>
  );
}

export function SkeletonCards({ count = 3 }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div className="skeleton-card" key={index}>
          <div className="skeleton-line w-40" />
          <div className="skeleton-line w-70" />
          <div className="skeleton-line w-55" />
          <div className="skeleton-line w-30" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = "briefcase", title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false }) {
  return (
    <div className={`error-state ${compact ? "error-state--compact" : ""}`} role="alert">
      <span className="error-icon">
        <Icon name="alert" size={20} />
      </span>
      <div>
        <strong>Something went wrong</strong>
        <p>{error?.message || "An unexpected error occurred."}</p>
        {error?.status === 0 && (
          <p className="muted-small">
            Is the backend running? Check <code>VITE_API_URL</code>.
          </p>
        )}
      </div>
      {onRetry && (
        <button type="button" className="button button-secondary button-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ variant = "info", children, onClose }) {
  const icons = {
    info: "info",
    success: "checkCircle",
    warning: "alert",
    error: "alert",
  };

  return (
    <div className={`notice notice--${variant}`} role={variant === "error" ? "alert" : "status"}>
      <Icon name={icons[variant]} size={18} />
      <div className="notice-content">{children}</div>
      {onClose && (
        <button type="button" className="icon-button" onClick={onClose} aria-label="Dismiss">
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? "modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = "Confirm", onConfirm, onClose, busy }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-message">{message}</p>
    </Modal>
  );
}
