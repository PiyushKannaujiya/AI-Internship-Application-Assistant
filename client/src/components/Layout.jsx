import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Icon from "./Icon.jsx";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/jobs", label: "Jobs", icon: "briefcase" },
  { to: "/applications", label: "Applications", icon: "layers" },
  { to: "/resume", label: "Resume", icon: "file" },
  { to: "/profile", label: "Profile", icon: "user" },
];

function pageTitle(pathname) {
  if (pathname.startsWith("/jobs/")) return "Job details";
  if (pathname.startsWith("/jobs")) return "Job search";
  if (pathname.startsWith("/applications")) return "Applications";
  if (pathname.startsWith("/resume")) return "Resume";
  if (pathname.startsWith("/profile")) return "Profile";
  return "Dashboard";
}

function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <Link to="/dashboard" className="brand" aria-label="ApplyPilot dashboard">
          <span className="brand-mark">
            <Icon name="sparkles" size={20} />
          </span>
          <span>
            <strong>ApplyPilot</strong>
            <small>Internship assistant</small>
          </span>
        </Link>

        <nav className="nav" aria-label="Main navigation">
          <span className="nav-label">Workspace</span>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="safe-note">
            <Icon name="shield" size={16} />
            <span>You approve every submission manually.</span>
          </div>
          <div className="user-chip">
            <span className="avatar">{initials(user?.name)}</span>
            <span className="user-chip-text">
              <strong>{user?.name}</strong>
              <small>{user?.email}</small>
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "close" : "menu"} size={20} />
            </button>
            <div>
              <p className="eyebrow">AI Internship Assistant</p>
              <h1>{pageTitle(location.pathname)}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="system-pill">
              <span className="dot" /> Manual approval
            </span>
            <Link to="/jobs" className="button button-primary button-small">
              <Icon name="search" size={16} />
              Find jobs
            </Link>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
