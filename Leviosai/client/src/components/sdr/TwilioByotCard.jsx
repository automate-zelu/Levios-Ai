import { useEffect, useState } from "react";
import { COLORS, S } from "../../theme.js";

export default function TwilioByotCard() {
  const [status, setStatus]           = useState(null);   // { connected, phoneNumber, accountSidMasked }
  const [sid, setSid]                 = useState("");
  const [token, setToken]             = useState("");
  const [connecting, setConnecting]   = useState(false);
  const [error, setError]             = useState("");
  const [numberTab, setNumberTab]     = useState("existing"); // "existing" | "new"
  // Existing numbers
  const [existingNums, setExistingNums]   = useState(null);  // null = not loaded
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [usingNum, setUsingNum]           = useState(null);  // sid being activated
  // New number search filters
  const [filters, setFilters]         = useState({ areaCode: "", contains: "", inRegion: "", inPostalCode: "" });
  const [results, setResults]         = useState(null);
  const [searching, setSearching]     = useState(false);
  const [selected, setSelected]       = useState(null);
  const [purchasing, setPurchasing]   = useState(false);
  const [showTest, setShowTest]       = useState(false);
  const [testPhone, setTestPhone]     = useState("");
  const [testBusy, setTestBusy]       = useState(false);
  const [testResult, setTestResult]   = useState(null);

  const req = (path, opts = {}) =>
    fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("catalyst_token")}`, ...(opts.headers || {}) } });

  const loadStatus = () =>
    req("/api/twilio/status").then(r => r.json()).then(setStatus).catch(() => {});

  const loadExisting = async () => {
    setLoadingExisting(true);
    try {
      const res  = await req("/api/twilio/numbers/existing");
      const data = await res.json();
      if (res.ok) setExistingNums(data);
      else setError(data.error || "Failed to load numbers");
    } catch (e) { setError(e.message); }
    finally { setLoadingExisting(false); }
  };

  useEffect(() => { loadStatus(); }, []);

  // Auto-load existing numbers when connected and tab is "existing"
  useEffect(() => {
    if (status?.connected && numberTab === "existing" && !status.phoneNumber && existingNums === null) {
      loadExisting();
    }
  }, [status?.connected, numberTab]);

  const handleConnect = async () => {
    if (!sid || !token) return;
    setConnecting(true); setError("");
    try {
      const res  = await req("/api/twilio/connect", { method: "POST", body: JSON.stringify({ accountSid: sid, authToken: token }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Connection failed"); return; }
      setStatus(data); setSid(""); setToken("");
    } catch (e) { setError(e.message); }
    finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Twilio? Calling and SMS will stop working.")) return;
    await req("/api/twilio/connect", { method: "DELETE" });
    setStatus({ connected: false, phoneNumber: null, accountSidMasked: null });
    setExistingNums(null); setResults(null); setSelected(null);
    setFilters({ areaCode: "", contains: "", inRegion: "", inPostalCode: "" });
  };

  const handleUseExisting = async (num) => {
    setUsingNum(num.sid); setError("");
    try {
      const res  = await req("/api/twilio/numbers/use", { method: "POST", body: JSON.stringify({ phoneNumber: num.phoneNumber, sid: num.sid }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to activate number"); return; }
      setStatus(prev => ({ ...prev, phoneNumber: data.phoneNumber }));
      setExistingNums(prev => prev?.map(n => ({ ...n, inUse: n.sid === num.sid })));
    } catch (e) { setError(e.message); }
    finally { setUsingNum(null); }
  };

  const handleSearch = async () => {
    setSearching(true); setResults([]); setSelected(null); setError("");
    try {
      const params = new URLSearchParams({ limit: "20" });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res  = await req(`/api/twilio/numbers?${params}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed"); return; }
      setResults(data);
    } catch (e) { setError(e.message); }
    finally { setSearching(false); }
  };

  const handlePurchase = async () => {
    if (!selected) return;
    setPurchasing(true); setError("");
    try {
      const res  = await req("/api/twilio/numbers/purchase", { method: "POST", body: JSON.stringify({ phoneNumber: selected }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Purchase failed"); return; }
      setStatus(prev => ({ ...prev, phoneNumber: data.phoneNumber }));
      setResults(null); setSelected(null); setFilters({ areaCode: "", contains: "", inRegion: "", inPostalCode: "" });
    } catch (e) { setError(e.message); }
    finally { setPurchasing(false); }
  };

  const handleReleaseNumber = async () => {
    if (!confirm("Release this phone number? It will be returned to Twilio and cannot be undone.")) return;
    await req("/api/twilio/number", { method: "DELETE" });
    setStatus(prev => ({ ...prev, phoneNumber: null }));
    setExistingNums(null);
  };

  const handleUnassignNumber = async () => {
    if (!confirm("Unassign this number? It stays in your Twilio account but won't be used for calls/SMS.")) return;
    // Just clear from workspace without releasing from Twilio
    await req("/api/twilio/number/unassign", { method: "POST" });
    setStatus(prev => ({ ...prev, phoneNumber: null }));
    setExistingNums(null);
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
      const res = await req("/api/twilio/test-sms", {
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

  const NumberRow = ({ n, isExisting }) => {
    const isSel    = selected === n.phoneNumber;
    const isActive = status?.phoneNumber === n.phoneNumber || n.inUse;
    const busy     = usingNum === n.sid;
    return (
      <div
        onClick={() => !isExisting && setSelected(isSel ? null : n.phoneNumber)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", cursor: isExisting ? "default" : "pointer",
          background: isActive ? `${COLORS.teal}10` : isSel ? `rgba(26,188,156,0.08)` : "transparent",
          borderLeft: `3px solid ${isActive ? COLORS.teal : isSel ? COLORS.teal : "transparent"}`,
          borderBottom: `1px solid ${COLORS.border}22`,
          transition: "all 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!isExisting && (
            <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${isSel ? COLORS.teal : COLORS.border}`, background: isSel ? COLORS.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {isSel && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}
            </div>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "monospace", color: isActive ? COLORS.teal : COLORS.text }}>{n.friendlyName || n.phoneNumber}</span>
              {isActive && <span style={S.badge(COLORS.teal)}>Active</span>}
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
              {n.phoneNumber}{[n.locality, n.region].filter(Boolean).length > 0 ? ` · ${[n.locality, n.region].filter(Boolean).join(", ")}` : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {n.capabilities?.voice && <span style={S.badge(COLORS.blue)}>Voice</span>}
            {n.capabilities?.sms   && <span style={S.badge(COLORS.green)}>SMS</span>}
            {n.capabilities?.mms   && <span style={S.badge(COLORS.purple)}>MMS</span>}
          </div>
          {isExisting && !isActive && (
            <button
              style={{ ...S.btn("secondary"), padding: "5px 14px", fontSize: 11, opacity: busy ? 0.6 : 1 }}
              onClick={() => handleUseExisting(n)}
              disabled={busy}
            >
              {busy ? "Activating…" : "Use This Number"}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (!status) return <div style={{ padding: "12px 0", color: COLORS.textMuted, fontSize: 13 }}>Loading Twilio status…</div>;

  return (
    <div style={{ border: `1px solid ${status.connected ? COLORS.green : COLORS.border}`, borderRadius: 12, padding: 20, background: status.connected ? `${COLORS.green}06` : "transparent" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>📱</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Twilio</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted }}>SMS & Voice — connect your own account</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {status.connected
            ? <span style={S.badge(COLORS.green)}>✓ Connected</span>
            : <span style={{ fontSize: 11, color: COLORS.textDim }}>Not connected</span>}
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
            <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={handleDisconnect}>Disconnect</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 12, marginBottom: 14 }}>{error}</div>
      )}

      {/* ── Not connected: credential form ── */}
      {!status.connected && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>Account SID</label>
              <input style={S.input} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={sid} onChange={e => setSid(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>Auth Token</label>
              <input style={S.input} type="password" placeholder="••••••••••••••••••••••••••••••••" value={token} onChange={e => setToken(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button style={{ ...S.btn("primary"), padding: "9px 22px", fontSize: 13, opacity: connecting ? 0.6 : 1 }} onClick={handleConnect} disabled={connecting || !sid || !token}>
              {connecting ? "Verifying…" : "Connect Twilio"}
            </button>
            <span style={{ fontSize: 11, color: COLORS.textDim }}>We validate and encrypt your credentials — never stored in plain text</span>
          </div>
        </div>
      )}

      {/* ── Connected: account info + number management ── */}
      {status.connected && (
        <div>
          {/* Account info bar */}
          <div style={{ background: COLORS.surfaceAlt, borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 3 }}>Account SID</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: COLORS.textMuted }}>{status.accountSidMasked}</div>
            </div>
            {status.phoneNumber && (
              <div>
                <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 3 }}>Active Number</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: COLORS.teal }}>{status.phoneNumber}</div>
              </div>
            )}
            {status.phoneNumber && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11 }} onClick={() => { setStatus(prev => ({ ...prev, phoneNumber: null })); setExistingNums(null); }}>
                  Change Number
                </button>
                <button style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11, borderColor: COLORS.red + "66", color: COLORS.red }} onClick={handleReleaseNumber}>
                  Release
                </button>
              </div>
            )}
          </div>

          {/* Number picker — only shown when no number is assigned */}
          {!status.phoneNumber && (
            <div>
              {/* Tab bar */}
              <div style={{ display: "flex", gap: 0, marginBottom: 16, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden" }}>
                {[["existing", "📋 My Numbers"], ["new", "🔍 Get New Number"]].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setNumberTab(key); if (key === "existing" && existingNums === null) loadExisting(); }}
                    style={{
                      flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                      background: numberTab === key ? COLORS.orange : "transparent",
                      color: numberTab === key ? "#fff" : COLORS.textMuted,
                      transition: "all 0.15s",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* My Numbers tab */}
              {numberTab === "existing" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: COLORS.textMuted }}>Phone numbers already in your Twilio account</span>
                    <button style={{ ...S.btn("ghost"), padding: "4px 12px", fontSize: 11 }} onClick={loadExisting} disabled={loadingExisting}>
                      {loadingExisting ? "Loading…" : "↻ Refresh"}
                    </button>
                  </div>
                  {loadingExisting && <div style={{ padding: "20px 0", textAlign: "center", color: COLORS.textMuted, fontSize: 13 }}>Loading your numbers…</div>}
                  {!loadingExisting && existingNums !== null && existingNums.length === 0 && (
                    <div style={{ padding: "20px 0", textAlign: "center", color: COLORS.textMuted, fontSize: 13 }}>
                      No numbers found in your Twilio account. Use "Get New Number" to purchase one.
                    </div>
                  )}
                  {!loadingExisting && existingNums && existingNums.length > 0 && (
                    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden" }}>
                      {existingNums.map(n => <NumberRow key={n.sid} n={n} isExisting={true} />)}
                    </div>
                  )}
                </div>
              )}

              {/* Get New Number tab */}
              {numberTab === "new" && (
                <div>
                  {/* Filter panel */}
                  <div style={{ background: COLORS.surfaceAlt, borderRadius: 8, padding: 14, marginBottom: 14 }}>
                    {/* Row 1: Area Code + Contains */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>Area Code</label>
                        <input
                          style={{ ...S.input, padding: "7px 10px" }}
                          placeholder="e.g. 415"
                          value={filters.areaCode}
                          onChange={e => setFilters(f => ({ ...f, areaCode: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                          onKeyDown={e => e.key === "Enter" && handleSearch()}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>Contains Digits</label>
                        <input
                          style={{ ...S.input, padding: "7px 10px" }}
                          placeholder="e.g. 1234 or ***-555-****"
                          value={filters.contains}
                          onChange={e => setFilters(f => ({ ...f, contains: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && handleSearch()}
                        />
                      </div>
                    </div>
                    {/* Row 2: State + Zip Code */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>State</label>
                        <select
                          style={{ ...S.input, padding: "7px 10px", cursor: "pointer" }}
                          value={filters.inRegion}
                          onChange={e => setFilters(f => ({ ...f, inRegion: e.target.value }))}
                        >
                          <option value="">Any State</option>
                          {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: COLORS.textMuted, display: "block", marginBottom: 5 }}>Postal Code</label>
                        <input
                          style={{ ...S.input, padding: "7px 10px" }}
                          placeholder="e.g. 94105"
                          value={filters.inPostalCode}
                          onChange={e => setFilters(f => ({ ...f, inPostalCode: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                          onKeyDown={e => e.key === "Enter" && handleSearch()}
                        />
                      </div>
                    </div>
                    {/* Capabilities info + clear */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: COLORS.textMuted }}>Required:</span>
                      <span style={S.badge(COLORS.blue)}>Voice</span>
                      <span style={S.badge(COLORS.green)}>SMS</span>
                      <button
                        style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11, marginLeft: "auto" }}
                        onClick={() => setFilters({ areaCode: "", contains: "", inRegion: "", inPostalCode: "" })}
                      >
                        Clear Filters
                      </button>
                    </div>
                  </div>

                  <button
                    style={{ ...S.btn("primary"), padding: "9px 24px", fontSize: 13, opacity: searching ? 0.6 : 1, marginBottom: 14, width: "100%" }}
                    onClick={handleSearch}
                    disabled={searching}
                  >
                    {searching ? "Searching…" : "Search Available Numbers"}
                  </button>

                  {results !== null && results.length === 0 && (
                    <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 10, textAlign: "center", padding: "16px 0" }}>
                      No numbers found with those filters. Try adjusting your search.
                    </div>
                  )}
                  {results && results.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>{results.length} number{results.length !== 1 ? "s" : ""} found</div>
                      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
                        {results.map(n => <NumberRow key={n.phoneNumber} n={n} isExisting={false} />)}
                      </div>
                    </>
                  )}
                  {selected && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: COLORS.textMuted }}>Selected: <strong style={{ color: COLORS.teal, fontFamily: "monospace" }}>{selected}</strong></span>
                      <button style={{ ...S.btn("teal"), padding: "8px 20px", fontSize: 13, opacity: purchasing ? 0.6 : 1 }} onClick={handlePurchase} disabled={purchasing}>
                        {purchasing ? "Purchasing…" : "Purchase This Number"}
                      </button>
                    </div>
                  )}
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
          aria-labelledby="twilio-test-title"
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
            <div id="twilio-test-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Send test SMS
            </div>
            <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.55, marginTop: 0 }}>
              We’ll text from your active Twilio number ({status.phoneNumber}) so you can confirm SMS delivery.
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

