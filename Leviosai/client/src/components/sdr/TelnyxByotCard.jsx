import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";

/**
 * Telnyx BYOT — connect API key, TeXML application id, messaging profile (optional),
 * then pick a number already on the Telnyx account.
 */
export default function TelnyxByotCard({ onChanged } = {}) {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [messagingProfileId, setMessagingProfileId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [existingNums, setExistingNums] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [usingNum, setUsingNum] = useState(null);
  const [showTest, setShowTest] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [activating, setActivating] = useState(false);

  const req = (path, opts = {}) =>
    fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("catalyst_token")}`,
        ...(opts.headers || {}),
      },
    });

  const notify = () => {
    if (typeof onChanged === "function") onChanged();
  };

  const loadStatus = () =>
    req("/api/telnyx/status")
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        if (data.connectionId) setConnectionId(data.connectionId);
        if (data.messagingProfileId) setMessagingProfileId(data.messagingProfileId);
      })
      .catch(() => {});

  const loadExisting = async () => {
    setLoadingExisting(true);
    try {
      const res = await req("/api/telnyx/numbers/existing");
      const data = await res.json();
      if (res.ok) setExistingNums(data);
      else setError(data.error || "Failed to load numbers");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingExisting(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (status?.connected && !status.phoneNumber && existingNums === null) {
      loadExisting();
    }
  }, [status?.connected, status?.phoneNumber]);

  const handleConnect = async () => {
    if (!apiKey) return;
    setConnecting(true);
    setError("");
    try {
      const res = await req("/api/telnyx/connect", {
        method: "POST",
        body: JSON.stringify({
          apiKey,
          connectionId: connectionId.trim() || undefined,
          messagingProfileId: messagingProfileId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Connection failed");
        return;
      }
      setStatus((prev) => ({ ...prev, ...data, connected: true }));
      setApiKey("");
      notify();
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Telnyx? Calling and SMS via Telnyx will stop.")) return;
    await req("/api/telnyx/connect", { method: "DELETE" });
    setStatus({ connected: false, active: false, phoneNumber: null, apiKeyMasked: null });
    setExistingNums(null);
    notify();
  };

  const handleActivate = async () => {
    setActivating(true);
    setError("");
    try {
      const res = await req("/api/telnyx/activate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to activate Telnyx");
      setStatus((prev) => ({ ...prev, active: true }));
      notify();
    } catch (e) {
      setError(e.message);
    } finally {
      setActivating(false);
    }
  };

  const handleUseExisting = async (num) => {
    setUsingNum(num.id || num.sid);
    setError("");
    try {
      const res = await req("/api/telnyx/numbers/use", {
        method: "POST",
        body: JSON.stringify({
          phoneNumber: num.phoneNumber,
          id: num.id || num.sid,
          connectionId: connectionId.trim() || num.connectionId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to activate number");
        return;
      }
      setStatus((prev) => ({
        ...prev,
        phoneNumber: data.phoneNumber,
        connectionId: data.connectionId,
        active: true,
      }));
      setExistingNums((prev) =>
        prev?.map((n) => ({ ...n, inUse: (n.id || n.sid) === (num.id || num.sid) }))
      );
      notify();
    } catch (e) {
      setError(e.message);
    } finally {
      setUsingNum(null);
    }
  };

  const handleUnassignNumber = async () => {
    if (!confirm("Unassign this number? It stays in Telnyx but won't be used here.")) return;
    await req("/api/telnyx/number/unassign", { method: "POST" });
    setStatus((prev) => ({ ...prev, phoneNumber: null }));
    setExistingNums(null);
    notify();
  };

  const openTestSms = () => {
    setTestPhone("");
    setTestResult(null);
    setError("");
    setShowTest(true);
  };

  const handleSendTestSms = async () => {
    setTestBusy(true);
    setTestResult(null);
    setError("");
    try {
      const res = await req("/api/telnyx/test-sms", {
        method: "POST",
        body: JSON.stringify({ to: testPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send test SMS");
      setTestResult({ ok: true, text: `Test SMS sent to ${data.to} from ${data.from}` });
    } catch (e) {
      setTestResult({ ok: false, text: e.message || "Failed to send test SMS" });
    } finally {
      setTestBusy(false);
    }
  };

  if (!status) {
    return (
      <div style={{ padding: "12px 0", color: COLORS.textMuted, fontSize: 13 }}>
        Loading Telnyx status…
      </div>
    );
  }

  return (
    <div
      style={{
        border: `1px solid ${status.connected ? COLORS.green : COLORS.border}`,
        borderRadius: 12,
        padding: 20,
        background: status.connected ? `${COLORS.green}06` : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>📡</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Telnyx</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>
              SMS & Voice (TeXML) — paste API key; we auto-create the TeXML app
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {status.connected ? (
            <span style={S.badge(COLORS.green)}>✓ Connected</span>
          ) : (
            <span style={{ fontSize: 11, color: COLORS.textDim }}>Not connected</span>
          )}
          {status.connected && status.active && (
            <span style={S.badge(COLORS.teal)}>Active provider</span>
          )}
          {status.connected && status.phoneNumber && !status.active && (
            <button
              type="button"
              style={{ ...S.btn("secondary"), padding: "5px 10px", fontSize: 11 }}
              onClick={handleActivate}
              disabled={activating}
            >
              {activating ? "…" : "Use Telnyx"}
            </button>
          )}
          {status.connected && status.phoneNumber && (
            <button
              type="button"
              style={{ ...S.btn("secondary"), padding: "5px 10px", fontSize: 11 }}
              onClick={openTestSms}
              disabled={testBusy}
            >
              Test SMS
            </button>
          )}
          {status.connected && (
            <button
              style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }}
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: `${COLORS.red}18`,
            color: COLORS.red,
            fontSize: 12,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {!status.connected && (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>
              API Key (v2)
            </label>
            <input
              style={S.input}
              type="password"
              placeholder="KEY…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>
                TeXML Application / Connection ID
              </label>
              <input
                style={S.input}
                placeholder="Optional now — required before calling"
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>
                Messaging Profile ID
              </label>
              <input
                style={S.input}
                placeholder="Optional — for SMS"
                value={messagingProfileId}
                onChange={(e) => setMessagingProfileId(e.target.value)}
              />
            </div>
          </div>
          <p style={{ fontSize: 11, color: COLORS.textDim, margin: 0, lineHeight: 1.5 }}>
            Paste your Telnyx API v2 key. We create or reuse a TeXML application automatically, then you
            pick a number. After linking, outbound AI calls and SMS use Telnyx for this workspace
            (account must allow the destination country / verified numbers).
          </p>
          <button
            style={{ ...S.btn("primary"), padding: "9px 22px", fontSize: 13, opacity: connecting ? 0.6 : 1 }}
            onClick={handleConnect}
            disabled={connecting || !apiKey}
          >
            {connecting ? "Verifying…" : "Connect Telnyx"}
          </button>
        </div>
      )}

      {status.connected && (
        <div>
          <div
            style={{
              background: COLORS.surfaceAlt,
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 3 }}>
                API Key
              </div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: COLORS.textMuted }}>
                {status.apiKeyMasked}
              </div>
            </div>
            {status.phoneNumber && (
              <div>
                <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 3 }}>
                  Active Number
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: COLORS.teal }}>
                  {status.phoneNumber}
                </div>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", display: "block", marginBottom: 3 }}>
                TeXML Connection ID
              </label>
              <input
                style={{ ...S.input, padding: "6px 10px", fontSize: 12 }}
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                placeholder="Required for outbound calls"
              />
            </div>
            {status.phoneNumber && (
              <button
                style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11 }}
                onClick={handleUnassignNumber}
              >
                Change Number
              </button>
            )}
          </div>

          {!status.phoneNumber && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: COLORS.textMuted }}>
                  Numbers already on your Telnyx account
                </span>
                <button
                  style={{ ...S.btn("ghost"), padding: "4px 12px", fontSize: 11 }}
                  onClick={loadExisting}
                  disabled={loadingExisting}
                >
                  {loadingExisting ? "Loading…" : "↻ Refresh"}
                </button>
              </div>
              {loadingExisting && (
                <div style={{ padding: "20px 0", textAlign: "center", color: COLORS.textMuted, fontSize: 13 }}>
                  Loading your numbers…
                </div>
              )}
              {!loadingExisting && existingNums !== null && existingNums.length === 0 && (
                <div style={{ padding: "20px 0", textAlign: "center", color: COLORS.textMuted, fontSize: 13 }}>
                  No numbers found. Purchase one in Telnyx Mission Control, then refresh.
                </div>
              )}
              {!loadingExisting && existingNums && existingNums.length > 0 && (
                <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden" }}>
                  {existingNums.map((n) => {
                    const busy = usingNum === (n.id || n.sid);
                    const isActive = !!n.inUse;
                    return (
                      <div
                        key={n.id || n.sid}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 16px",
                          background: isActive ? `${COLORS.teal}10` : "transparent",
                          borderBottom: `1px solid ${COLORS.border}22`,
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: 14,
                                fontFamily: "monospace",
                                color: isActive ? COLORS.teal : COLORS.text,
                              }}
                            >
                              {n.phoneNumber}
                            </span>
                            {isActive && <span style={S.badge(COLORS.teal)}>Active</span>}
                          </div>
                          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
                            {n.friendlyName || n.id}
                          </div>
                        </div>
                        {!isActive && (
                          <button
                            style={{
                              ...S.btn("secondary"),
                              padding: "5px 14px",
                              fontSize: 11,
                              opacity: busy ? 0.6 : 1,
                            }}
                            onClick={() => handleUseExisting(n)}
                            disabled={busy}
                          >
                            {busy ? "Activating…" : "Use This Number"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showTest && (
        <div
          role="dialog"
          aria-modal="true"
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
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Send test SMS</div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, marginTop: 0 }}>
              We’ll text from your active Telnyx number ({status.phoneNumber}) so you can confirm SMS
              delivery.
            </p>
            <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>
              Recipient phone (with country code)
            </label>
            <input
              style={{ ...S.input, marginBottom: 12 }}
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+15551234567"
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
                disabled={testBusy || !testPhone.trim()}
                onClick={handleSendTestSms}
              >
                {testBusy ? "Sending…" : "Send test SMS"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
