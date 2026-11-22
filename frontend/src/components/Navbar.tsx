import { Link } from "react-router-dom";

interface NavbarProps {
  alarmActive?: boolean;
  hasTelemetry?: boolean;
}

export default function Navbar({ alarmActive, hasTelemetry }: NavbarProps) {
  return (
    <header className="navbar-header">
      <div className="navbar-container">
        <div className="navbar-brand">
          <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="brand-text">
              <span className="brand-eyebrow">IoT Disaster Prevention</span>
              <h1 className="brand-title">Brgy. Cagniog Fire Alarm System</h1>
            </div>
          </Link>
        </div>

        <div className="navbar-actions">
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
