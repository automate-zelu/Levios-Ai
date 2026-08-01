import { useEffect, useMemo, useState } from "react";
import { COLORS, S } from "../../theme.js";
import { sdrApi } from "../../api.js";
import { SdrFlowTimeline, STATUS_COLORS, groupLogsByDial, sliceDialFlow } from "./SdrFlowTimeline.jsx";

/**
 * Professional enrollments + sequence flow panel for AI Calling.
 * Each dial attempt is shown separately — stuck recoveries are hidden.
 */
export function EnrollmentSequencesPanel() {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dialIndex, setDialIndex] = useState(-1); // -1 = latest

  const load = () => {
    setLoading(true);
    setError("");
    sdrApi
      .getEnrollments({ limit: 40 })
      .then((enr) => {
        const list = enr?.data || [];
        setEnrollments(list);
        if (!selectedId && list.length > 0) setSelectedId(list[0].id);
      })
      .catch((e) => setError(e.message || "Failed to load sequences"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDialIndex(-1);
    sdrApi
      .getEnrollment(selectedId)
      .then(setDetail)
      .catch((e) => setError(e.message || "Failed to load sequence flow"))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const dialGroups = useMemo(
    () => groupLogsByDial(detail?.logs || [], detail?.callSessions || []),
    [detail]
  );

  const activeDial = useMemo(() => {
    if (!dialGroups.length) return null;
    const idx = dialIndex < 0 ? dialGroups.length - 1 : Math.min(dialIndex, dialGroups.length - 1);
    return dialGroups[idx];
  }, [dialGroups, dialIndex]);

  const dialView = useMemo(() => {
    if (!activeDial) {
      return {
        logs: (detail?.logs || []).filter((l) => l.stepName !== "stuck_recovery"),
        messages: detail?.messages || [],
        callSessions: detail?.callSessions || [],
      };
    }
    if (activeDial.session) {
      return {
        ...sliceDialFlow({
          logs: detail?.logs || [],
          messages: detail?.messages || [],
          session: activeDial.session,
        }),
        callSessions: [activeDial.session],
      };
    }
    return {
      logs: activeDial.logs,
      messages: detail?.messages || [],
      callSessions: detail?.callSessions || [],
    };
  }, [activeDial, detail]);

  const filtered = enrollments.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = `${e.leadFirstName || ""} ${e.leadLastName || ""}`.toLowerCase();
    const contact = `${e.leadEmail || ""} ${e.leadPhone || ""}`.toLowerCase();
    return name.includes(q) || contact.includes(q) || String(e.status || "").includes(q);
  });

  const selected = enrollments.find((e) => e.id === selectedId) || detail?.enrollment || null;
  const selectedName = selected
    ? [selected.leadFirstName, selected.leadLastName].filter(Boolean).join(" ")
      || [detail?.lead?.firstName, detail?.lead?.lastName].filter(Boolean).join(" ")
      || `Lead #${selected.leadId || detail?.lead?.id || ""}`
    : "";

  if (loading) {
    return (
      <div style={{ ...S.card, textAlign: "center", color: COLORS.textMuted, padding: 48 }}>
        Loading sequences…
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 360px) 1fr",
          gap: 0,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          overflow: "hidden",
          minHeight: "min(68vh, 620px)",
          background: COLORS.surface,
        }}
        className="sequences-grid"
      >
        <div style={{ borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 12, borderBottom: `1px solid ${COLORS.border}`, display: "flex", gap: 8 }}>
            <input
              style={{ ...S.input, flex: 1 }}
              placeholder="Search lead, phone, status…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" style={{ ...S.btn("ghost"), padding: "8px 12px", fontSize: 12 }} onClick={load}>
              ↻
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 28, color: COLORS.textMuted, fontSize: 13, textAlign: "center", lineHeight: 1.5 }}>
                No enrollments yet.
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Activate the SDR Agent to enroll dormant leads into the call → SMS → email sequence.
                </div>
              </div>
            ) : (
              filtered.map((e) => {
                const name = [e.leadFirstName, e.leadLastName].filter(Boolean).join(" ") || `Lead #${e.leadId}`;
                const active = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "14px 14px",
                      border: "none",
                      borderBottom: `1px solid ${COLORS.border}55`,
                      background: active ? `${COLORS.orange}14` : "transparent",
                      cursor: "pointer",
                      color: "inherit",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                      <span style={{ fontWeight: 650, fontSize: 13 }}>{name}</span>
                      <span style={S.badge(STATUS_COLORS[e.status] || COLORS.textMuted)}>{e.status}</span>
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>
                      {[e.leadEmail, e.leadPhone].filter(Boolean).join(" · ") || `Lead ${e.leadId}`}
                    </div>
                    <div style={{ fontSize: 10, color: COLORS.textDim }}>
                      Updated {new Date(e.updatedAt || e.enrolledAt).toLocaleString()}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: COLORS.bg, minHeight: 0 }}>
          {!selectedId ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 13 }}>
              Select a sequence to inspect the call flow
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: `1px solid ${COLORS.border}`,
                  background: COLORS.surface,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                      Sequence
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{selectedName || "Lead"}</div>
                    <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
                      {[selected?.leadEmail || detail?.lead?.email, selected?.leadPhone || detail?.lead?.phone]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={S.badge(STATUS_COLORS[selected?.status || detail?.enrollment?.status] || COLORS.textMuted)}>
                      {selected?.status || detail?.enrollment?.status || "—"}
                    </span>
                  </div>
                </div>

                {dialGroups.length > 1 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                    {dialGroups.map((g, i) => {
                      const active = (dialIndex < 0 ? dialGroups.length - 1 : dialIndex) === i;
                      const when = g.startedAt ? new Date(g.startedAt).toLocaleString() : g.label;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setDialIndex(i)}
                          style={{
                            ...S.btn(active ? "primary" : "ghost"),
                            padding: "6px 12px",
                            fontSize: 12,
                          }}
                        >
                          {g.label}
                          <span style={{ opacity: 0.75, marginLeft: 6, fontWeight: 500 }}>{when}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 12,
                    marginTop: 16,
                  }}
                >
                  <Stat
                    label="This dial"
                    value={
                      activeDial?.session?.outcome
                        ? String(activeDial.session.outcome).replace(/_/g, " ")
                        : activeDial
                          ? activeDial.label
                          : "—"
                    }
                  />
                  <Stat
                    label="Duration"
                    value={
                      activeDial?.session?.durationSeconds != null
                        ? `${activeDial.session.durationSeconds}s`
                        : "—"
                    }
                  />
                  <Stat
                    label="SMS"
                    value={dialView.logs.some((l) => l.stepName === "sms_sent") ? "Sent" : "—"}
                  />
                  <Stat
                    label="Email"
                    value={dialView.logs.some((l) => l.stepName === "email_sent") ? "Sent" : "—"}
                  />
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                {detailLoading && !detail ? (
                  <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
                    Loading call flow…
                  </div>
                ) : (
                  <SdrFlowTimeline
                    title={activeDial ? `${activeDial.label} flow` : "Dial flow"}
                    logs={dialView.logs}
                    messages={dialView.messages}
                    callSessions={dialView.callSessions}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .sequences-grid {
            grid-template-columns: 1fr !important;
            min-height: auto !important;
          }
          .sequences-grid > div:first-child {
            max-height: 280px;
            border-right: none !important;
            border-bottom: 1px solid ${COLORS.border};
          }
          .sequences-grid > div:last-child {
            min-height: 480px;
          }
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: COLORS.surfaceAlt,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 650, marginTop: 4, textTransform: "capitalize" }}>{value}</div>
    </div>
  );
}
