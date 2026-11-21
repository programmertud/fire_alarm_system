import { NavLink } from "react-router-dom";

interface NavbarProps {
  alarmActive?: boolean;
  hasTelemetry?: boolean;
}

export default function Navbar({ alarmActive, hasTelemetry }: NavbarProps) {
  return (
    <header className="navbar-header">
      <div className="navbar-container">
        <div className="navbar-brand">
          <div className="brand-text">
            <span className="brand-eyebrow">IoT Disaster Prevention</span>
            <h1 className="brand-title">Fire Alarm Monitor</h1>
          </div>
        </div>

        <div className="navbar-actions">
          <nav className="navbar-nav">
            <NavLink
              to="/"
              className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
              end
            >
              <span>Live Monitor</span>
            </NavLink>
            <NavLink
              to="/registered"
              className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
            >
              <span>Alert Recipients</span>
            </NavLink>
          </nav>

          <div
            className={`status-pill ${
              !hasTelemetry ? "waiting" : alarmActive ? "danger" : "safe"
            }`}
          >
            <span className="status-dot" />
            <span className="status-text">
              {!hasTelemetry
                ? "Waiting for device"
                : alarmActive
                ? "Alarm Active"
                : "All Systems Normal"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
