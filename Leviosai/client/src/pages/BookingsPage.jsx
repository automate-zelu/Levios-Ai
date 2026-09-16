import { useEffect, useMemo, useState } from "react";
import { appointmentsApi, calendarApi } from "../api.js";
import "./bookings.css";

const TZ = "America/New_York";

function leadName(a) {
  const n = `${a.leadFirstName || ""} ${a.leadLastName || ""}`.trim();
  return n || a.title || "Lead";
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "scheduled" || s === "confirmed") return "live";
  if (s === "cancelled") return "dead";
  if (s === "completed") return "done";
  return "wait";
}

export default function BookingsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState("");
  const [modal, setModal] = useState(null);
  const [notify, setNotify] = useState(true);
  const [newTime, setNewTime] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const load = () => {
    setLoading(true);
    appointmentsApi
      .list()
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message || "Could not load bookings"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => String(r.status || "").toLowerCase() === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      total: rows.length,
      upcoming: rows.filter((r) => String(r.status).toLowerCase() === "scheduled" && new Date(r.scheduledAt).getTime() >= now).length,
      cancelled: rows.filter((r) => String(r.status).toLowerCase() === "cancelled").length,
    };
  }, [rows]);

  const openReschedule = (row) => {
    setNotify(true);
    setNewTime(toLocalInput(row.scheduledAt));
    setModal({ type: "reschedule", row });
    setSlots([]);
    setSlotsLoading(true);
    calendarApi
      .checkAvailability({})
      .then((res) => setSlots(res?.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  };

  const runAction = async () => {
    if (!modal?.row) return;
    const id = modal.row.id;
    setBusyId(id);
    setError("");
    try {
      let result;
      if (modal.type === "cancel") {
        result = await appointmentsApi.cancel(id, { notify, timezone: TZ });
      } else if (modal.type === "delete") {
        result = await appointmentsApi.delete(id, { notify, timezone: TZ });
      } else {
        const scheduledAt = new Date(newTime).toISOString();
        result = await appointmentsApi.reschedule(id, { scheduledAt, notify, timezone: TZ });
      }
      const n = result?.notified || {};
      const bits = [];
      if (notify) {
        bits.push(n.sms ? "SMS sent" : result?.notifyErrors?.sms || "SMS not sent");
        bits.push(n.email ? "email sent" : result?.notifyErrors?.email || "email not sent");
      }
      setFlash(bits.length ? `${modal.type} complete · ${bits.join(" · ")}` : `${modal.type} complete`);
      setModal(null);
      load();
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bookings">
      <header className="bookings-hero">
        <div>
          <div className="bookings-kicker">Calendar ledger</div>
          <h1>Bookings</h1>
          <p>Every appointment the SDR booked — cancel, reschedule, or remove, and we text and email the lead.</p>
        </div>
        <div className="bookings-stats">
          <div>
            <b>{counts.total}</b>
            <span>on file</span>
          </div>
          <div>
            <b>{counts.upcoming}</b>
            <span>upcoming</span>
          </div>
          <div>
            <b>{counts.cancelled}</b>
            <span>cancelled</span>
          </div>
        </div>
      </header>

      {flash && (
        <div className="bookings-flash" role="status">
          {flash}
          <button type="button" onClick={() => setFlash("")}>
            Dismiss
          </button>
        </div>
      )}
      {error && <div className="bookings-error">{error}</div>}

      <div className="bookings-toolbar">
        {["all", "scheduled", "cancelled", "completed"].map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "is-on" : ""}
            onClick={() => setFilter(key)}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="bookings-sheet">
        {loading && rows.length === 0 ? (
          <div className="bookings-empty">Loading bookings…</div>
        ) : visible.length === 0 ? (
          <div className="bookings-empty">No bookings in this view yet. When the agent books a time, it lands here.</div>
        ) : (
          <ul className="bookings-list">
            {visible.map((row) => {
              const tone = statusTone(row.status);
              const locked = String(row.status).toLowerCase() === "completed";
              return (
                <li key={row.id} className={`bookings-row tone-${tone}`}>
                  <div className="bookings-when">
                    <time dateTime={row.scheduledAt}>{formatWhen(row.scheduledAt)}</time>
                    <span>America/New York</span>
                  </div>
                  <div className="bookings-who">
                    <strong>{leadName(row)}</strong>
                    <span>{row.title}</span>
                    <span className="bookings-meta">
                      {[row.leadPhone, row.leadEmail].filter(Boolean).join(" · ") || "No contact details"}
                      {row.calendarEventId ? " · synced to calendar" : " · CRM only"}
                    </span>
                  </div>
                  <div className={`bookings-status ${tone}`}>{row.status || "scheduled"}</div>
                  <div className="bookings-actions">
                    <button
                      type="button"
                      disabled={busyId === row.id || locked || String(row.status).toLowerCase() === "cancelled"}
                      onClick={() => {
                        setNotify(true);
                        setModal({ type: "cancel", row });
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id || locked}
                      onClick={() => openReschedule(row)}
                    >
                      Reschedule
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setNotify(true);
                        setModal({ type: "delete", row });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {modal && (
        <div className="bookings-modal" onClick={() => setModal(null)}>
          <div className="bookings-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>
              {modal.type === "cancel" && "Cancel this booking"}
              {modal.type === "reschedule" && "Move this booking"}
              {modal.type === "delete" && "Delete this booking"}
            </h2>
            <p>
              {leadName(modal.row)} · {formatWhen(modal.row.scheduledAt)}
            </p>

            {modal.type === "reschedule" && (
              <div className="bookings-resched">
                <label>
                  New time
                  <input type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                </label>
                <div className="bookings-slots">
                  {slotsLoading && <span>Loading open slots…</span>}
                  {!slotsLoading &&
                    slots.slice(0, 8).map((slot) => (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => setNewTime(toLocalInput(slot.start))}
                      >
                        {slot.label || formatWhen(slot.start)}
                      </button>
                    ))}
                </div>
              </div>
            )}

            <label className="bookings-notify">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Send SMS and email to the lead
            </label>

            <div className="bookings-dialog-actions">
              <button type="button" onClick={() => setModal(null)}>
                Back
              </button>
              <button type="button" className="primary" disabled={busyId === modal.row.id} onClick={runAction}>
                {busyId === modal.row.id ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
