export type Telemetry = {
  deviceId: string;
  mq2Raw: number;
  mq2RawActual?: number | null;
  mq2Baseline?: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  alarmActive: boolean;
  alarmReason: string;
  wifiConnected: boolean;
  uptimeMs: number | null;
  warmupActive?: boolean;
};

interface DashboardProps {
  telemetry: Telemetry | null;
  receivedAt: string | null;
  socketConnected: boolean;
  error: string;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

interface MetricCardProps {
  type: "smoke" | "temp" | "humidity";
  label: string;
  value: string;
  unit?: string;
  note?: string;
  rangeMin: string;
  rangeMax: string;
  barPct: number;
  alert?: boolean;
  isReady?: boolean;
  warmingUp?: boolean;
}

function MetricCard({
  type,
  label,
  value,
  unit,
  note,
  rangeMin,
  rangeMax,
  barPct,
  alert,
  isReady,
  warmingUp,
}: MetricCardProps) {
  const statusText = alert
    ? "ALERT"
    : warmingUp
    ? "WARMING UP"
    : isReady
    ? "NORMAL"
    : "STANDBY";
  const statusClass = alert
    ? "badge-danger"
    : warmingUp
    ? "badge-warning"
    : isReady
    ? "badge-normal"
    : "badge-standby";
  const pct = Math.round(barPct * 100);

  return (
    <article className={`glass-card metric-card ${type}${alert ? " alert" : ""}`}>
      {/* ── Top Row: label + badge ── */}
      <div className="mc-top">
        <div className="mc-top-left">
          <span className="mc-label">{label}</span>
          <span className={`mc-badge ${statusClass}`}>{statusText}</span>
        </div>
      </div>

      {/* ── Centre: big value ── */}
      <div className="mc-center">
        <span className={`mc-value ${isReady ? "has-data" : "no-data"}`}>
          {value}
        </span>
        {unit && isReady && <span className="mc-unit">{unit}</span>}
      </div>

      {/* ── Gauge Bar ── */}
      <div className="mc-gauge">
        <div className="mc-bar-track">
          <div className="mc-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mc-range-row">
          <span className="mc-range-label">{rangeMin}</span>
          <span className="mc-pct">{isReady ? `${pct}%` : "—"}</span>
          <span className="mc-range-label">{rangeMax}</span>
        </div>
      </div>

      {/* ── Footer note ── */}
      {note && (
        <div className="mc-footer">
          <span className="mc-note">{note}</span>
        </div>
      )}
    </article>
  );
}

export default function Dashboard({
  telemetry,
  receivedAt,
  socketConnected,
  error,
}: DashboardProps) {
  const alarm = telemetry?.alarmActive ?? false;
  const isReady = telemetry != null;

  const MQ2_MAX = 4095;
  const TEMP_MAX = 80;
  const HUM_MAX = 100;

  const smokePct = telemetry ? clamp(telemetry.mq2Raw, 0, MQ2_MAX) : 0;
  const tempPct = telemetry?.temperatureC != null ? clamp(telemetry.temperatureC, 0, TEMP_MAX) : 0;
  const humPct = telemetry?.humidityPct != null ? clamp(telemetry.humidityPct, 0, HUM_MAX) : 0;

  const smokeAlert =
    Boolean(telemetry?.alarmActive && telemetry?.alarmReason?.includes("SMOKE")) ||
    (telemetry?.mq2Raw ?? 0) >= 1000;
  const tempAlert =
    Boolean(telemetry?.alarmActive && telemetry?.alarmReason?.includes("TEMPERATURE")) ||
    (telemetry?.temperatureC ?? 0) >= 40;

  const isWarmingUp = Boolean(!alarm && telemetry?.warmupActive);

  return (
    <div className="dashboard-layout">
      {error && (
        <div className="notice-banner">
          <span className="notice-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Continuous Live Status Banner ─────────── */}
      <div
        className={`condition-banner ${
          alarm ? "alarm-active" : isWarmingUp ? "warmup-active" : "safe-active"
        }`}
      >
        <div className="banner-icon-badge">
          {alarm ? "🚨" : isWarmingUp ? "⏳" : "🛡️"}
        </div>
        <div className="banner-content">
          <div className="banner-top">
            <span
              className={`banner-badge ${
                alarm ? "danger" : isWarmingUp ? "warning" : "safe"
              }`}
            >
              {alarm
                ? "HAZARD ACTIVE"
                : isWarmingUp
                ? "SENSOR WARMUP IN PROGRESS"
                : "CONTINUOUS MONITORING ACTIVE"}
            </span>
            <h2 className="banner-title">
              {alarm
                ? telemetry?.alarmReason || "EMERGENCY DETECTED"
                : isWarmingUp
                ? "MQ-2 Heater Stabilizing (Buzzer Protected)"
                : "All Sensors Operational & Reading Live"}
            </h2>
          </div>
          <div className="banner-bottom">
            <span className="banner-reason">
              {receivedAt
                ? `Last live reading: ${new Date(receivedAt).toLocaleTimeString()}`
                : "Awaiting incoming sensor stream..."}
            </span>
            <span className="banner-sep">•</span>
            <span className="banner-subtext">Continuous Auto-Sync (Every 2s)</span>
          </div>
        </div>
      </div>

      {/* ── Realtime Sensor Grid (Expanded Hero Cards) ─────────── */}
      <section className="metrics-row">
        <MetricCard
          type="smoke"
          label="Smoke / Flammable Gas"
          value={telemetry ? String(telemetry.mq2Raw) : "--"}
          unit="ADC"
          rangeMin="0"
          rangeMax="4095"
          barPct={smokePct}
          alert={smokeAlert && !telemetry?.warmupActive}
          warmingUp={Boolean(telemetry?.warmupActive)}
          isReady={isReady}
        />
        <MetricCard
          type="temp"
          label="Ambient Temperature"
          value={
            telemetry?.temperatureC != null
              ? telemetry.temperatureC.toFixed(1)
              : "--"
          }
          unit="°C"
          rangeMin="0°C"
          rangeMax="80°C"
          barPct={tempPct}
          alert={tempAlert}
          isReady={isReady && telemetry?.temperatureC != null}
        />
        <MetricCard
          type="humidity"
          label="Relative Humidity"
          value={
            telemetry?.humidityPct != null
              ? telemetry.humidityPct.toFixed(1)
              : "--"
          }
          unit="%"
          rangeMin="0%"
          rangeMax="100%"
          barPct={humPct}
          isReady={isReady && telemetry?.humidityPct != null}
        />
      </section>
    </div>
  );
}
