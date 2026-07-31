import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { gmailApi } from "../../api.js";

/**
 * Connect the workspace owner's Gmail (OAuth) so SDR follow-up emails
 * send from their account — same BYOT model as Twilio for SMS.
 */
export default function GmailConnectCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setStatus(await gmailApi.status());
    } catch (err) {
      setError(err.message || "Failed to load Gmail status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    const reason = params.get("reason");
    const email = params.get("email");
    if (gmail === "connected") {
      setBanner({
        ok: true,
        text: email
          ? `Gmail connected as ${decodeURIComponent(email)}`
          : "Gmail connected — SDR emails will send from your account",
      });
    } else if (gmail === "error") {
      setBanner({
        ok: false,
        text: reason ? decodeURIComponent(reason) : "Gmail connection failed",
      });
    }
    if (gmail) {
      params.delete("gmail");
      params.delete("reason");
      params.delete("email");
      const next = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
    }
    load();
  }, []);

  const handleConnectClick = () => {
    setShowModal(true);
  };

  const handleConfirmConnect = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await gmailApi.startOAuth();
      window.location.href = url;
    } catch (err) {
      setError(err.message || "Could not start Gmail sign-in");
      setBusy(false);
      setShowModal(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Gmail? SDR email follow-ups will stop until you reconnect.")) return;
    setBusy(true);
    try {
      await gmailApi.disconnect();
      setStatus({ connected: false, accountEmail: null, oauthConfigured: status?.oauthConfigured });
      setBanner({ ok: true, text: "Gmail disconnected" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openTest = () => {
    setTestEmail(status?.accountEmail || "");
    setTestResult(null);
    setError("");
    setShowTest(true);
  };

  const handleSendTest = async () => {
    setTestBusy(true);
    setTestResult(null);
    setError("");
    try {
      const res = await gmailApi.testEmail(testEmail.trim());
      setTestResult({
        ok: true,
        text: `Test email sent to ${res.to}${res.from ? ` (from ${res.from})` : ""}`,
      });
    } catch (err) {
      setTestResult({ ok: false, text: err.message || "Failed to send test email" });
    } finally {
      setTestBusy(false);
    }
  };

  if (loading && !status) {
    return <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Loading Gmail status…</div>;
  }

  const connected = !!status?.connected;

  return (
    <div>
      {banner && (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 8,
            background: banner.ok ? `${COLORS.green}15` : `${COLORS.red}15`,
            border: `1px solid ${banner.ok ? COLORS.green : COLORS.red}33`,
            fontSize: 13,
            color: banner.ok ? COLORS.green : COLORS.red,
            fontWeight: 600,
          }}
        >
          {banner.ok ? "✓ " : "✗ "}
          {banner.text}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 12, fontSize: 12, color: COLORS.red }}>{error}</div>
      )}

      <div
        style={{
          border: `1px solid ${connected ? COLORS.green : COLORS.border}`,
          borderRadius: 12,
          padding: 20,
          background: connected ? `${COLORS.green}06` : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{ fontSize: 28 }}>✉️</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Gmail</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                Send SDR follow-up emails from your own Gmail (like n8n) — same idea as Twilio for SMS
              </div>
              {connected ? (
                <div style={{ fontSize: 12, color: COLORS.green, fontWeight: 600, marginTop: 4 }}>
                  Connected{status.accountEmail ? ` · ${status.accountEmail}` : ""}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>Not connected</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {connected ? (
              <>
                <button
                  type="button"
                  style={{ ...S.btn("secondary"), padding: "8px 14px", fontSize: 12 }}
                  disabled={busy || testBusy}
                  onClick={openTest}
                >
                  Test email
                </button>
                <button
                  type="button"
                  style={{ ...S.btn("ghost"), padding: "8px 14px", fontSize: 12 }}
                  disabled={busy}
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                style={{ ...S.btn("primary"), padding: "8px 16px", fontSize: 12, opacity: busy ? 0.6 : 1 }}
                disabled={busy || status?.oauthConfigured === false}
                onClick={handleConnectClick}
              >
                Connect Gmail
              </button>
            )}
          </div>
        </div>

        {status?.oauthConfigured === false && (
          <div style={{ marginTop: 12, fontSize: 12, color: COLORS.yellow }}>
            Google OAuth is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
          </div>
        )}
      </div>

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gmail-connect-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => !busy && setShowModal(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 24,
              boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="gmail-connect-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Connect Gmail for SDR email
            </div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, marginTop: 0 }}>
              You will sign in with Google and grant Leviosai permission to <strong style={{ color: COLORS.text }}>send email as you</strong>.
              Follow-up messages in the SDR sequence (after SMS timeout) are delivered from your Gmail — not from a shared platform mailbox.
            </p>

            <div
              style={{
                padding: 14,
                borderRadius: 10,
                background: COLORS.surfaceAlt,
                border: `1px solid ${COLORS.border}`,
                marginBottom: 16,
                fontSize: 12,
                color: COLORS.textMuted,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 650, color: COLORS.text, marginBottom: 8 }}>What you will see (n8n-style)</div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>Google account picker — choose the inbox that should send SDR emails</li>
                <li>Consent screen asking for <strong style={{ color: COLORS.text }}>Send email on your behalf</strong> (Gmail send)</li>
                <li>Return here with your address shown as connected</li>
              </ol>
              <div style={{ marginTop: 10 }}>
                We store encrypted OAuth tokens only. We do not read your inbox — scope is send-only plus your email address for identity.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...S.btn("ghost"), padding: "9px 16px", fontSize: 13 }}
                disabled={busy}
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{ ...S.btn("primary"), padding: "9px 18px", fontSize: 13, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={handleConfirmConnect}
              >
                {busy ? "Opening Google…" : "Continue with Google"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTest && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gmail-test-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => !testBusy && setShowTest(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 24,
              boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="gmail-test-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Send test email
            </div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, marginTop: 0 }}>
              We’ll send a short message from your connected Gmail so you can confirm delivery.
            </p>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>
              Recipient email
            </label>
            <input
              style={{ ...S.input, marginBottom: 12 }}
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={testBusy}
            />
            {testResult && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 12,
                  background: testResult.ok ? `${COLORS.green}15` : `${COLORS.red}15`,
                  color: testResult.ok ? COLORS.green : COLORS.red,
                }}
              >
                {testResult.text}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...S.btn("ghost"), padding: "9px 16px", fontSize: 13 }}
                disabled={testBusy}
                onClick={() => setShowTest(false)}
              >
                Close
              </button>
              <button
                type="button"
                style={{ ...S.btn("primary"), padding: "9px 18px", fontSize: 13, opacity: testBusy ? 0.6 : 1 }}
                disabled={testBusy || !testEmail.trim()}
                onClick={handleSendTest}
              >
                {testBusy ? "Sending…" : "Send test email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
