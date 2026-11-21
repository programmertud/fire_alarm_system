import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { io } from "socket.io-client";
import Navbar from "./components/Navbar";
import Dashboard, { type Telemetry } from "./pages/Dashboard";
import Registered from "./pages/Registered";

type TelemetryEvent = {
  telemetry: Telemetry | null;
  receivedAt: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

export default function App() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const socket = io(API_BASE, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      setSocketConnected(true);
      setError("");
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () =>
      setError("Cannot connect to backend server. Make sure port 3001 is running.")
    );
    socket.on("telemetry", (event: TelemetryEvent) => {
      if (event.telemetry) setTelemetry(event.telemetry);
      setReceivedAt(event.receivedAt);
    });

    fetch(`${API_BASE}/api/telemetry/latest`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<TelemetryEvent>;
      })
      .then((e) => {
        if (e.telemetry) setTelemetry(e.telemetry);
        setReceivedAt(e.receivedAt);
      })
      .catch(() => setError("Waiting for backend connection…"));

    return () => {
      socket.close();
    };
  }, []);

  const alarmActive = telemetry?.alarmActive ?? false;

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Navbar alarmActive={alarmActive} hasTelemetry={Boolean(telemetry)} />

        <main className="main-viewport">
          <div className="content-container">
            <Routes>
              <Route
                path="/"
                element={
                  <Dashboard
                    telemetry={telemetry}
                    receivedAt={receivedAt}
                    socketConnected={socketConnected}
                    error={error}
                  />
                }
              />
              <Route path="/registered" element={<Registered />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

        <footer className="app-footer">
          <div className="footer-container">
            <span>Barangay Cagniog Fire Alarm System</span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
