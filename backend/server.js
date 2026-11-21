import express from "express";
import cors from "cors";
import http from "node:http";
import { Server } from "socket.io";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Automatically load .env file if it exists
const ENV_FILE = resolve("./.env");
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn("[env] Warning: failed to parse .env file:", err.message);
  }
}

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3001);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const corsOrigin = (!FRONTEND_ORIGIN || FRONTEND_ORIGIN === "*")
  ? true
  : FRONTEND_ORIGIN.includes(",")
  ? FRONTEND_ORIGIN.split(",").map((s) => s.trim())
  : FRONTEND_ORIGIN;

// ── TextBee SMS Config (Free Android Gateway) ───────────────────────────────────
const TEXTBEE_API_KEY   = process.env.TEXTBEE_API_KEY  || "";
const TEXTBEE_DEVICE_ID = process.env.TEXTBEE_DEVICE_ID || "";

// ── Brevo (Sendinblue) Email Config (Free Transactional Email) ──────────────────
// Sign up at https://brevo.com (Free tier includes 300 emails/day)
const BREVO_API_KEY      = process.env.BREVO_API_KEY      || "";
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "";
const BREVO_SENDER_NAME  = process.env.BREVO_SENDER_NAME  || "Fire Alarm IoT Alert System";

// Cooldown in minutes to prevent spamming while alarm remains active
const ALERT_COOLDOWN_MINUTES = Number(process.env.ALERT_COOLDOWN_MINUTES || 5);

// ── Persistence ────────────────────────────────────────────────────────────────
const SETTINGS_FILE = resolve("./settings.json");

function loadSettings() {
  if (!existsSync(SETTINGS_FILE)) return { phones: [], emails: [] };
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    return {
      phones: Array.isArray(data.phones) ? data.phones : [],
      emails: Array.isArray(data.emails) ? data.emails : [],
    };
  } catch {
    return { phones: [], emails: [] };
  }
}

function saveSettings(data) {
  writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
}

let settings = loadSettings();

// ── State ──────────────────────────────────────────────────────────────────────
let latestTelemetry = null;
let lastReceivedAt  = null;
const lastSmsSentAt = new Map();
const lastEmailSentAt = new Map();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "20kb" }));

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ["GET", "POST"] }
});

// ── Alert Message Builders ─────────────────────────────────────────────────────

function buildAlertText(telemetry) {
  const lines = [
    "🔥 FIRE AND SMOKE EMERGENCY WARNING 🔥",
    "CRITICAL FIRE / SMOKE ALERT DETECTED IN BARANGAY OFFICE",
    `Device: ${telemetry.deviceId}`,
  ];
  if (telemetry.alarmReason) lines.push(`Reason: ${telemetry.alarmReason}`);
  if (telemetry.temperatureC != null)
    lines.push(`Temperature: ${telemetry.temperatureC.toFixed(1)}°C`);
  if (telemetry.mq2Raw != null)
    lines.push(`Smoke/Gas (ADC): ${telemetry.mq2Raw}`);
  lines.push(`Time: ${new Date().toLocaleString()}`);
  lines.push("ACTION REQUIRED: Check monitored area immediately & follow fire safety protocols!");
  lines.push("— Fire Alarm IoT Alert System");
  return lines.join("\n");
}

function buildAlertEmailHtml(telemetry) {
  const temp = telemetry.temperatureC != null ? `${telemetry.temperatureC.toFixed(1)}°C` : "N/A";
  const smoke = telemetry.mq2Raw != null ? `${telemetry.mq2Raw}` : "N/A";
  const humidity = telemetry.humidityPct != null ? `${telemetry.humidityPct.toFixed(1)}%` : "N/A";
  const reason = telemetry.alarmReason || "Smoke / High temperature threshold exceeded";
  const timeStr = new Date().toLocaleString();

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fire Alarm Emergency Warning</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; margin: 0; padding: 24px; color: #f3f4f6; }
      .container { max-width: 600px; margin: 0 auto; background: #111827; border: 2px solid #ef4444; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(239,68,68,0.25); }
      .header { background: linear-gradient(135deg, #b91c1c, #dc2626); padding: 24px; text-align: center; color: white; }
      .header h1 { margin: 0; font-size: 22px; letter-spacing: 1px; text-transform: uppercase; }
      .content { padding: 24px; }
      .alert-box { background: rgba(239,68,68,0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 14px 18px; border-radius: 8px; font-weight: bold; margin-bottom: 20px; font-size: 15px; }
      .grid { width: 100%; border-collapse: collapse; margin-bottom: 22px; background: rgba(255,255,255,0.03); border-radius: 8px; overflow: hidden; }
      .grid td { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 14px; }
      .grid tr:last-child td { border-bottom: none; }
      .label { color: #9ca3af; width: 45%; }
      .value { color: #f3f4f6; font-weight: 600; }
      .urgent-value { color: #f87171; font-weight: 800; font-size: 16px; }
      .action-box { background: rgba(245,158,11,0.12); border-left: 4px solid #f59e0b; padding: 16px; border-radius: 6px; font-size: 13px; color: #fef3c7; line-height: 1.6; }
      .footer { background: #090d16; padding: 16px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid rgba(255,255,255,0.08); }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🔥 FIRE & SMOKE EMERGENCY WARNING</h1>
      </div>
      <div class="content">
        <div class="alert-box">
          ⚠️ Hazard Detected: ${reason}
        </div>
        <table class="grid">
          <tr>
            <td class="label">Device Name / ID</td>
            <td class="value">${telemetry.deviceId}</td>
          </tr>
          <tr>
            <td class="label">Smoke / Gas (ADC)</td>
            <td class="value urgent-value">${smoke} / 4095</td>
          </tr>
          <tr>
            <td class="label">Temperature (DHT22)</td>
            <td class="value urgent-value">${temp}</td>
          </tr>
          <tr>
            <td class="label">Humidity</td>
            <td class="value">${humidity}</td>
          </tr>
          <tr>
            <td class="label">Alert Timestamp</td>
            <td class="value">${timeStr}</td>
          </tr>
        </table>
        <div class="action-box">
          <strong>Recommended Immediate Actions:</strong><br>
          1. Safely inspect the monitored location immediately.<br>
          2. Check for smoke, burning odor, or electrical hazards.<br>
          3. Evacuate occupants safely if fire is confirmed and contact local emergency responders (BFP / 911).
        </div>
      </div>
      <div class="footer">
        Automated alert generated by Barangay Cagniog Fire Alarm System.
      </div>
    </div>
  </body>
  </html>
  `;
}

// ── SMS Sending (TextBee) ──────────────────────────────────────────────────────

async function sendViaTextBee(recipients, message) {
  if (!TEXTBEE_API_KEY) {
    throw new Error("TEXTBEE_API_KEY is not configured.");
  }

  const payload = { recipients, message };
  if (TEXTBEE_DEVICE_ID) payload.deviceId = TEXTBEE_DEVICE_ID;

  const res = await fetch("https://api.textbee.dev/api/v1/gateway/send-sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": TEXTBEE_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || JSON.stringify(data));
  }
  return data;
}

// ── Email Sending (Brevo API v3) ───────────────────────────────────────────────

async function sendViaBrevo(recipientEmail, subject, htmlContent) {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is not configured in backend environment.");
  }
  if (!BREVO_SENDER_EMAIL) {
    throw new Error("BREVO_SENDER_EMAIL is not configured. Set your verified Brevo sender email.");
  }

  const payload = {
    sender: {
      name: BREVO_SENDER_NAME,
      email: BREVO_SENDER_EMAIL,
    },
    to: [
      { email: recipientEmail }
    ],
    subject: subject,
    htmlContent: htmlContent,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || JSON.stringify(data));
  }
  return data;
}

// ── Unified Alert Dispatcher (SMS + Email Fallback / Parallel) ─────────────────

async function triggerAlerts(telemetry) {
  const phones = settings.phones ?? [];
  const emails = settings.emails ?? [];
  const now = Date.now();
  const cooldownMs = ALERT_COOLDOWN_MINUTES * 60 * 1000;

  let smsFailedOrNoLoad = false;

  // 1. Send SMS to due phones
  if (phones.length > 0) {
    const duePhones = phones.filter(p => (now - (lastSmsSentAt.get(p) ?? 0)) >= cooldownMs);
    if (duePhones.length > 0) {
      try {
        console.log(`[sms] Dispatching TextBee SMS to ${duePhones.join(", ")}...`);
        const msg = buildAlertText(telemetry);
        await sendViaTextBee(duePhones, msg);
        duePhones.forEach(p => lastSmsSentAt.set(p, now));
        console.log(`[sms] Successfully queued TextBee SMS for ${duePhones.length} recipient(s).`);
      } catch (err) {
        console.error(`[sms] TextBee SMS failed (possible no load/device offline/error): ${err.message}`);
        smsFailedOrNoLoad = true;
      }
    }
  } else {
    smsFailedOrNoLoad = true;
  }

  // 2. Dispatch Email alerts via Brevo
  // Send email to all registered emails (acts as primary safeguard & fallback if SMS lacks load/fails)
  if (emails.length > 0) {
    const dueEmails = emails.filter(e => (now - (lastEmailSentAt.get(e) ?? 0)) >= cooldownMs);
    if (dueEmails.length > 0) {
      const subject = `🔥 DANGER ALERT: Fire / Smoke Detected by ${telemetry.deviceId}`;
      const html = buildAlertEmailHtml(telemetry);

      for (const email of dueEmails) {
        try {
          console.log(`[email] Sending Brevo alert email to ${email}...`);
          await sendViaBrevo(email, subject, html);
          lastEmailSentAt.set(email, now);
          console.log(`[email] Brevo alert successfully sent to ${email}`);
        } catch (err) {
          console.error(`[email] Failed to send Brevo email to ${email}:`, err.message);
        }
      }
    }
  }
}

// ── API Routes ─────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "fire-alarm-backend",
    time: new Date().toISOString(),
    smsConfigured: Boolean(TEXTBEE_API_KEY),
    emailConfigured: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL),
    registeredPhones: (settings.phones ?? []).length,
    registeredEmails: (settings.emails ?? []).length,
  });
});

app.get("/api/telemetry/latest", (_req, res) => {
  res.json({ telemetry: latestTelemetry, receivedAt: lastReceivedAt });
});

app.post("/api/telemetry", async (req, res) => {
  const body = req.body ?? {};

  if (typeof body.deviceId !== "string" ||
      typeof body.mq2Raw !== "number" ||
      typeof body.alarmActive !== "boolean") {
    return res.status(400).json({
      error: "Required fields: deviceId (string), mq2Raw (number), alarmActive (boolean)"
    });
  }

  const prevAlarm = latestTelemetry?.alarmActive ?? false;

  latestTelemetry = {
    deviceId:      body.deviceId,
    mq2Raw:        body.mq2Raw,
    mq2RawActual:  Number.isFinite(body.mq2RawActual) ? body.mq2RawActual : null,
    mq2Baseline:   Number.isFinite(body.mq2Baseline)  ? body.mq2Baseline  : null,
    temperatureC:  Number.isFinite(body.temperatureC) ? body.temperatureC : null,
    humidityPct:   Number.isFinite(body.humidityPct)  ? body.humidityPct  : null,
    alarmActive:   Boolean(body.alarmActive),
    alarmReason:   typeof body.alarmReason === "string" ? body.alarmReason : "NORMAL",
    wifiConnected: Boolean(body.wifiConnected || body.wifiStatus === "CONNECTED"),
    uptimeMs:      Number.isFinite(body.uptimeMs) ? body.uptimeMs : null,
  };
  lastReceivedAt = new Date().toISOString();

  const event = { telemetry: latestTelemetry, receivedAt: lastReceivedAt };
  io.emit("telemetry", event);

  // Trigger alert dispatch on alarm rising edge
  if (!prevAlarm && body.alarmActive) {
    triggerAlerts(latestTelemetry).catch(err => {
      console.error("[alert] Error in alert trigger dispatcher:", err);
    });
  }

  return res.status(202).json({ accepted: true });
});

// ── Phone Number Settings ──────────────────────────────────────────────────────

app.get("/api/settings/phones", (_req, res) => {
  res.json({ phones: settings.phones ?? [] });
});

app.post("/api/settings/phones", (req, res) => {
  const { phone } = req.body ?? {};
  if (typeof phone !== "string" || !/^\+?[0-9\s\-()]{7,20}$/.test(phone.trim())) {
    return res.status(400).json({ error: "Provide a valid phone number (e.g. +639171234567)" });
  }
  const normalized = phone.trim();
  settings.phones = settings.phones ?? [];
  if (settings.phones.includes(normalized)) {
    return res.status(409).json({ error: "Phone number already registered" });
  }
  settings.phones.push(normalized);
  saveSettings(settings);
  return res.json({ ok: true, phones: settings.phones });
});

app.delete("/api/settings/phones/:phone", (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  settings.phones = (settings.phones ?? []).filter(p => p !== phone);
  saveSettings(settings);
  return res.json({ ok: true, phones: settings.phones });
});

app.post("/api/settings/phones/test", async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Provide a valid phone number" });
  }
  try {
    await sendViaTextBee([phone.trim()], [
      "✅ TEST ALERT: Fire Alarm IoT System",
      "TextBee SMS notifications are connected.",
      "You will receive danger warnings if smoke or high temperature is detected.",
      "— Fire Alarm IoT Dashboard"
    ].join("\n"));
    res.json({ ok: true, message: "Test SMS successfully sent via TextBee!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Email Settings (Brevo) ─────────────────────────────────────────────────────

app.get("/api/settings/emails", (_req, res) => {
  res.json({ emails: settings.emails ?? [] });
});

app.post("/api/settings/emails", (req, res) => {
  const { email } = req.body ?? {};
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof email !== "string" || !emailRegex.test(email.trim())) {
    return res.status(400).json({ error: "Provide a valid email address (e.g. resident@example.com)" });
  }
  const normalized = email.trim().toLowerCase();
  settings.emails = settings.emails ?? [];
  if (settings.emails.includes(normalized)) {
    return res.status(409).json({ error: "Email address already registered" });
  }
  settings.emails.push(normalized);
  saveSettings(settings);
  return res.json({ ok: true, emails: settings.emails });
});

app.delete("/api/settings/emails/:email", (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  settings.emails = (settings.emails ?? []).filter(e => e !== email);
  saveSettings(settings);
  return res.json({ ok: true, emails: settings.emails });
});

app.post("/api/settings/emails/test", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Provide a valid email address" });
  }
  try {
    const mockTelemetry = {
      deviceId: "TEST-ESP32-S3",
      mq2Raw: 450,
      temperatureC: 28.4,
      humidityPct: 58.2,
      alarmReason: "Routine Test Notification"
    };
    const html = buildAlertEmailHtml(mockTelemetry);
    await sendViaBrevo(email.trim(), "✅ Test Alert: Brevo Email Notification Connected", html);
    res.json({ ok: true, message: "Test email successfully sent via Brevo!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Socket.IO ──────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);
  socket.emit("telemetry", { telemetry: latestTelemetry, receivedAt: lastReceivedAt });
  socket.on("disconnect", () => console.log(`[socket] disconnected: ${socket.id}`));
});

// ── Server Listen ──────────────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Fire Alarm API listening at http://0.0.0.0:${PORT}`);
  console.log(`   Frontend origin  → ${FRONTEND_ORIGIN}`);
  console.log(`   TextBee SMS      → ${TEXTBEE_API_KEY ? "Configured ✓" : "Not configured"}`);
  console.log(`   Brevo Email      → ${BREVO_API_KEY && BREVO_SENDER_EMAIL ? "Configured ✓" : "Not configured"}`);
  console.log(`   Phones: ${(settings.phones ?? []).length} | Emails: ${(settings.emails ?? []).length}`);
});
