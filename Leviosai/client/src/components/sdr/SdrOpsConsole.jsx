import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { COLORS, S } from "../../theme.js";
import { appointmentsApi, messagesApi, sdrApi } from "../../api.js";
import { EnrollmentSequencesPanel } from "./EnrollmentSequencesPanel.jsx";

const ACTIVE_STATUSES = new Set([
  "pending",
  "call_initiated",
  "call_connected",
  "call_answered",
  "call_no_answer",
  "call_busy",
  "call_failed",
  "sms_sent",
  "sms_replied",
  "email_sent",
  "email_replied",
  "re_enrolled",
]);

/**
 * Daily operator desk for the SDR digital employee (P3.1).
 * One agent for all industries — vertical differences live in KB only.
 */
export function SdrOpsConsole({ analytics, config, onOpenConfigure }) {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      messagesApi.threads("all", 40).catch(() => ({ threads: [] })),
      appointmentsApi.list().catch(() => []),
      sdrApi.getEnrollments({ limit: 40 }).catch(() => ({ data: [] })),
    ])
      .then(([threadsRes, appts, enr]) => {
        if (cancelled) return;
        const threads = threadsRes?.threads || [];
        setWaiting(threads.filter((t) => t.lastMessage?.direction === "inbound").slice(0, 8));
        const now = Date.now();
        setUpcoming(
          (Array.isArray(appts) ? appts : [])
            .filter(
              (a) =>
                String(a.status || "").toLowerCase() === "scheduled" &&
                new Date(a.scheduledAt).getTime() >= now
            )
            .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
            .slice(0, 6)
        );
        setEnrollments(enr?.data || []);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e.message || "Failed to load console");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const working = useMemo(
    () => enrollments.filter((e) => ACTIVE_STATUSES.has(String(e.status || ""))).slice(0, 6),
    [enrollments]
  );

  const nextActions = useMemo(() => {
    const items = [];
    if (!config?.isActive) {
      items.push({
        id: "activate",
        text: "Activate the SDR agent so it can enroll and reach out.",
        action: onOpenConfigure,
        label: "Configure",
      });
    }
    if (waiting.length > 0) {
      items.push({
        id: "waiting",
        text: `${waiting.length} conversation${waiting.length === 1 ? "" : "s"} waiting on a human reply.`,
        action: () => navigate("/inbox?filter=waiting"),
        label: "Open inbox",
      });
    }
    if (upcoming.length > 0) {
      items.push({
        id: "appts",
        text: `${upcoming.length} upcoming appointment${upcoming.length === 1 ? "" : "s"} on the calendar.`,
        action: () => navigate("/bookings"),
        label: "Calendar",
      });
    }
    if (working.length > 0) {
      items.push({
        id: "seq",
        text: `${working.length} lead${working.length === 1 ? "" : "s"} mid-sequence — review flow below.`,
        action: null,
        label: null,
      });
    }
    if (items.length === 0) {
      items.push({
        id: "empty",
        text: "No urgent work. Import leads or activate the agent when you are ready.",
        action: () => navigate("/leads"),
        label: "Leads",
      });
    }
    return items;
  }, [config?.isActive, waiting.length, upcoming.length, working.length, navigate, onOpenConfigure]);

  const openLead = (leadId) => {
    if (!leadId) return;
    navigate(`/leads/${leadId}?tab=timeline`);
  };

  const openInboxLead = (leadId) => {
    try {
      sessionStorage.setItem("inboxFocusLeadId", String(leadId));
    } catch { /* ignore */ }
    navigate("/inbox");
  };

  return (
    <div className="sdr-ops">
      <header className="sdr-ops-hero">
        <div>
          <div className="sdr-ops-kicker">Digital employee desk</div>
          <h1>SDR Console</h1>
          <p>
            One agent for every industry. Change knowledge and rules — not the screens.
            Manage leads the AI is working, handoffs, and bookings from here.
          </p>
        </div>
        <div className="sdr-ops-hero-actions">
          <button type="button" className="sdr-agent-btn sdr-agent-btn--ghost" onClick={() => navigate("/inbox")}>
            Inbox
          </button>
          <button type="button" className="sdr-agent-btn sdr-agent-btn--ghost" onClick={() => navigate("/bookings")}>
            Calendar
          </button>
          <button type="button" className="sdr-agent-btn sdr-agent-btn--primary" onClick={onOpenConfigure}>
            Configure agent
          </button>
        </div>
      </header>

      {loadErr && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: `${COLORS.red}18`, color: COLORS.red, fontSize: 13 }}>
          {loadErr}
        </div>
      )}

      <div className="sdr-ops-metrics">
        {[
          { label: "Enrollments", value: analytics?.totalEnrollments ?? "—" },
          { label: "Active sequences", value: analytics?.active ?? working.length },
          { label: "Bookings", value: analytics?.booked ?? "—" },
          { label: "Booking rate", value: analytics?.bookedRate != null ? `${analytics.bookedRate}%` : "—" },
          { label: "Needs human", value: waiting.length },
          { label: "Upcoming appts", value: upcoming.length },
        ].map((m) => (
          <div key={m.label} className="sdr-ops-metric">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
          </div>
        ))}
      </div>

      <div className="sdr-ops-grid">
        <section className="sdr-ops-card">
          <div className="sdr-ops-card-head">
            <h2>Leads being worked</h2>
            <span>{working.length}</span>
          </div>
          {working.length === 0 ? (
            <Empty hint="When the agent enrolls leads, active sequences show up here." />
          ) : (
            <ul className="sdr-ops-list">
              {working.map((e) => {
                const name = [e.leadFirstName, e.leadLastName].filter(Boolean).join(" ") || `Lead #${e.leadId}`;
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => openLead(e.leadId)}>
                      <strong>{name}</strong>
                      <span>{e.status}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="sdr-ops-card">
          <div className="sdr-ops-card-head">
            <h2>Needs human</h2>
            <span>{waiting.length}</span>
          </div>
          {waiting.length === 0 ? (
            <Empty hint="Inbound SMS/email that need a person will list here." />
          ) : (
            <ul className="sdr-ops-list">
              {waiting.map((t) => {
                const name = [t.leadFirstName, t.leadLastName].filter(Boolean).join(" ") || `Lead #${t.leadId}`;
                return (
                  <li key={t.leadId}>
                    <button type="button" onClick={() => openInboxLead(t.leadId)}>
                      <strong>{name}</strong>
                      <span>{String(t.lastMessage?.content || "").slice(0, 72) || "Inbound message"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="sdr-ops-card">
          <div className="sdr-ops-card-head">
            <h2>Appointments generated</h2>
            <button type="button" className="sdr-ops-link" onClick={() => navigate("/bookings")}>
              Full calendar →
            </button>
          </div>
          {upcoming.length === 0 ? (
            <Empty hint="Booked meetings appear here and on the calendar." />
          ) : (
            <ul className="sdr-ops-list">
              {upcoming.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => openLead(a.leadId)}>
                    <strong>{a.title || "Appointment"}</strong>
                    <span>{a.scheduledAt ? new Date(a.scheduledAt).toLocaleString() : "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sdr-ops-card">
          <div className="sdr-ops-card-head">
            <h2>Planned next actions</h2>
          </div>
          <ul className="sdr-ops-actions">
            {nextActions.map((item) => (
              <li key={item.id}>
                <p>{item.text}</p>
                {item.action && item.label && (
                  <button type="button" onClick={item.action}>
                    {item.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="sdr-ops-sequences">
        <div className="sdr-ops-card-head" style={{ marginBottom: 12 }}>
          <h2>Sequence workspace</h2>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>Pause via deactivate · take over on lead timeline</span>
        </div>
        <EnrollmentSequencesPanel />
      </section>
    </div>
  );
}

function Empty({ hint }) {
  return (
    <div style={{ padding: "20px 8px", color: COLORS.textMuted, fontSize: 13, lineHeight: 1.45 }}>
      {hint}
    </div>
  );
}
