import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

export default function Registered() {
  // ── Phone States ───────────────────────────────────────────────────────────
  const [phones, setPhones] = useState<string[]>([]);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [testingPhone, setTestingPhone] = useState<string | null>(null);
  const [phoneFeedback, setPhoneFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Email States ───────────────────────────────────────────────────────────
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [testingEmail, setTestingEmail] = useState<string | null>(null);
  const [emailFeedback, setEmailFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Feedback Timers ────────────────────────────────────────────────────────
  function flashPhone(msg: string, ok: boolean) {
    setPhoneFeedback({ msg, ok });
    setTimeout(() => setPhoneFeedback(null), 4500);
  }

  function flashEmail(msg: string, ok: boolean) {
    setEmailFeedback({ msg, ok });
    setTimeout(() => setEmailFeedback(null), 4500);
  }

  // ── Fetch Initial Data ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/settings/phones`)
      .then((r) => r.json())
      .then((d) => setPhones(d.phones ?? []))
      .catch(() => {});

    fetch(`${API_BASE}/api/settings/emails`)
      .then((r) => r.json())
      .then((d) => setEmails(d.emails ?? []))
      .catch(() => {});
  }, []);

  // ── Phone Handlers ─────────────────────────────────────────────────────────
  async function addPhone(e: React.FormEvent) {
    e.preventDefault();
    const phone = phoneInput.trim();
    if (!phone) return;
    setPhoneLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/phones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashPhone(data.error ?? "Failed to add phone number", false);
        return;
      }
      setPhones(data.phones);
      setPhoneInput("");
      flashPhone("Phone number registered successfully!", true);
    } catch {
      flashPhone("Cannot reach backend server", false);
    } finally {
      setPhoneLoading(false);
    }
  }

  async function removePhone(phone: string) {
    try {
      const res = await fetch(
        `${API_BASE}/api/settings/phones/${encodeURIComponent(phone)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        setPhones(data.phones);
        flashPhone("Phone number removed", true);
      }
    } catch {
      flashPhone("Cannot reach backend server", false);
    }
  }

  async function testPhoneSms(phone: string) {
    setTestingPhone(phone);
    try {
      const res = await fetch(`${API_BASE}/api/settings/phones/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (res.ok) flashPhone(`Test SMS queued to ${phone} via TextBee!`, true);
      else flashPhone(data.error ?? "TextBee SMS dispatch failed", false);
    } catch {
      flashPhone("Cannot reach backend server", false);
    } finally {
      setTestingPhone(null);
    }
  }

  // ── Email Handlers ─────────────────────────────────────────────────────────
  async function addEmail(e: React.FormEvent) {
    e.preventDefault();
    const email = emailInput.trim();
    if (!email) return;
    setEmailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        flashEmail(data.error ?? "Failed to add email address", false);
        return;
      }
      setEmailEmails(data.emails);
      setEmailInput("");
      flashEmail("Email recipient registered successfully!", true);
    } catch {
      flashEmail("Cannot reach backend server", false);
    } finally {
      setEmailLoading(false);
    }
  }

  function setEmailEmails(newEmails: string[]) {
    setEmails(newEmails);
  }

  async function removeEmail(email: string) {
    try {
      const res = await fetch(
        `${API_BASE}/api/settings/emails/${encodeURIComponent(email)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        setEmails(data.emails);
        flashEmail("Email address removed", true);
      }
    } catch {
      flashEmail("Cannot reach backend server", false);
    }
  }

  async function testBrevoEmail(email: string) {
    setTestingEmail(email);
    try {
      const res = await fetch(`${API_BASE}/api/settings/emails/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) flashEmail(`Test alert email sent to ${email} via Brevo!`, true);
      else flashEmail(data.error ?? "Brevo email dispatch failed", false);
    } catch {
      flashEmail("Cannot reach backend server", false);
    } finally {
      setTestingEmail(null);
    }
  }

  return (
    <div className="registered-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">ALERT DISPATCH CONFIGURATION</p>
          <h2>Emergency Notification Recipients</h2>
          <p className="subhead">
            Configure contact points for automatic emergency warnings when fire, smoke,
            or extreme heat is detected in Barangay Office.
          </p>
        </div>
        <Link to="/" className="btn btn-ghost">
          &larr; Back to Monitor
        </Link>
      </div>

      <div className="alert-grid-split">
        {/* ── CARD 1: SMS RECIPIENTS (TextBee) ── */}
        <section className="glass-card panel">
          <div className="section-heading">
            <div className="section-heading-left">
              <p className="eyebrow">PRIMARY CHANNEL</p>
              <h2>SMS Warnings 📱</h2>
            </div>
          </div>

          <form className="phone-form" onSubmit={addPhone}>
            <input
              className="phone-input"
              type="tel"
              placeholder="+639171234567"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              disabled={phoneLoading}
              aria-label="Mobile phone number"
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={phoneLoading || !phoneInput.trim()}
            >
              {phoneLoading ? "Adding…" : "＋ Register Phone"}
            </button>
          </form>

          {phoneFeedback && (
            <div
              className={`phone-feedback ${
                phoneFeedback.ok ? "phone-feedback-ok" : "phone-feedback-err"
              }`}
            >
              {phoneFeedback.ok ? "✓" : "✗"} {phoneFeedback.msg}
            </div>
          )}

          {phones.length === 0 ? (
            <div className="phone-empty">
              No mobile numbers registered. Add one above to enable instant SMS warnings.
            </div>
          ) : (
            <ul className="phone-list">
              {phones.map((phone) => (
                <li key={phone} className="phone-item">
                  <span className="phone-item-icon">📱</span>
                  <span className="phone-item-number">{phone}</span>
                  <div className="phone-item-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => testPhoneSms(phone)}
                      disabled={testingPhone === phone}
                      title="Send test SMS via TextBee"
                    >
                      {testingPhone === phone ? "Sending…" : "Test SMS"}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removePhone(phone)}
                      title="Remove number"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── CARD 2: EMAIL RECIPIENTS (Brevo Fallback) ── */}
        <section className="glass-card panel">
          <div className="section-heading">
            <div className="section-heading-left">
              <p className="eyebrow">BACKUP &amp; FALLBACK CHANNEL</p>
              <h2>Email Warnings ✉️</h2>
            </div>
          </div>

          <form className="phone-form" onSubmit={addEmail}>
            <input
              className="phone-input"
              type="email"
              placeholder="resident@gmail.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              disabled={emailLoading}
              aria-label="Email address"
            />
            <button
              className="btn btn-accent"
              type="submit"
              disabled={emailLoading || !emailInput.trim()}
            >
              {emailLoading ? "Adding…" : "＋ Register Email"}
            </button>
          </form>

          {emailFeedback && (
            <div
              className={`phone-feedback ${
                emailFeedback.ok ? "phone-feedback-ok" : "phone-feedback-err"
              }`}
            >
              {emailFeedback.ok ? "✓" : "✗"} {emailFeedback.msg}
            </div>
          )}

          {emails.length === 0 ? (
            <div className="phone-empty">
              No email addresses registered. Add one above for reliable no-load backup alerts.
            </div>
          ) : (
            <ul className="phone-list">
              {emails.map((email) => (
                <li key={email} className="phone-item">
                  <span className="phone-item-icon">✉️</span>
                  <span className="phone-item-number">{email}</span>
                  <div className="phone-item-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => testBrevoEmail(email)}
                      disabled={testingEmail === email}
                      title="Send test email via Brevo"
                    >
                      {testingEmail === email ? "Sending…" : "Test Email"}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeEmail(email)}
                      title="Remove email"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
