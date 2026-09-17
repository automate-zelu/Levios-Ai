import { useEffect, useState } from "react";
import { S } from "../../theme.js";
import { leadsApi } from "../../api.js";
import "./lead-edit-drawer.css";

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Aged (contacted)" },
  { value: "qualified", label: "Revived (qualified)" },
  { value: "proposal", label: "Appointment Set" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Dead (lost)" },
];

const SOURCE_OPTIONS = [
  "Manual Entry",
  "Website",
  "Referral",
  "Cold Call",
  "Facebook Ad",
  "Google Ad",
  "CSV Import",
  "Other",
];

/** Map display labels or API values → API status. */
export function toApiStatus(value) {
  if (!value) return "new";
  const map = {
    new: "new",
    contacted: "contacted",
    qualified: "qualified",
    proposal: "proposal",
    won: "won",
    lost: "lost",
    New: "new",
    Dead: "lost",
    Aged: "contacted",
    Revived: "qualified",
    "Appointment Set": "proposal",
    Won: "won",
  };
  return map[value] || "new";
}

export function parseLeadNotes(lead) {
  if (!lead) return "";
  if (typeof lead.notes === "string" && lead.notes.trim()) return lead.notes;
  if (!lead.customFields) return "";
  try {
    const cf = typeof lead.customFields === "string"
      ? JSON.parse(lead.customFields)
      : lead.customFields;
    return typeof cf?.notes === "string" ? cf.notes : "";
  } catch {
    return "";
  }
}

function mergeNotesIntoCustomFields(existing, notes) {
  let base = {};
  if (existing) {
    try {
      base = typeof existing === "string" ? JSON.parse(existing) : { ...existing };
      if (!base || typeof base !== "object") base = {};
    } catch {
      base = {};
    }
  }
  const trimmed = (notes || "").trim();
  if (trimmed) base.notes = trimmed;
  else delete base.notes;
  return Object.keys(base).length ? JSON.stringify(base) : null;
}

/**
 * HubSpot-style right sidebar form for editing lead contact properties.
 */
export default function LeadEditDrawer({ lead, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    firstName: lead.firstName || "",
    lastName: lead.lastName || "",
    email: lead.email || "",
    phone: lead.phone || "",
    source: lead.source || "",
    status: toApiStatus(lead.rawStatus || lead.status),
    notes: parseLeadNotes(lead),
    timezone: lead.timezone || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setError("");
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError("First name, last name, and email are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        source: form.source.trim() || null,
        status: toApiStatus(form.status),
        timezone: form.timezone.trim() || null,
        customFields: mergeNotesIntoCustomFields(lead.customFields, form.notes),
      };
      const updated = await leadsApi.update(lead.id, payload);
      onSaved?.(updated);
      onClose?.();
    } catch (e) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const displayName =
    [form.firstName, form.lastName].filter(Boolean).join(" ").trim()
    || lead.name
    || `Lead #${lead.id}`;

  return (
    <>
      <div className="lead-edit-overlay" onClick={onClose} aria-hidden="true" />
      <aside
        className="lead-edit-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${displayName}`}
      >
        <div className="lead-edit-drawer-head">
          <div>
            <div className="lead-edit-drawer-kicker">Edit contact</div>
            <div className="lead-edit-drawer-title">{displayName}</div>
          </div>
          <button type="button" className="lead-edit-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="lead-edit-drawer-body">
          {error && <div className="lead-edit-error">{error}</div>}

          <div className="lead-edit-row">
            <div className="lead-edit-field">
              <label htmlFor="lead-edit-first">First name *</label>
              <input id="lead-edit-first" style={S.input} value={form.firstName} onChange={setField("firstName")} autoFocus />
            </div>
            <div className="lead-edit-field">
              <label htmlFor="lead-edit-last">Last name *</label>
              <input id="lead-edit-last" style={S.input} value={form.lastName} onChange={setField("lastName")} />
            </div>
          </div>

          <div className="lead-edit-field">
            <label htmlFor="lead-edit-email">Email *</label>
            <input id="lead-edit-email" style={S.input} type="email" value={form.email} onChange={setField("email")} />
          </div>

          <div className="lead-edit-field">
            <label htmlFor="lead-edit-phone">Phone</label>
            <input id="lead-edit-phone" style={S.input} value={form.phone} onChange={setField("phone")} placeholder="+1…" />
          </div>

          <div className="lead-edit-field">
            <label htmlFor="lead-edit-source">Source</label>
            <select id="lead-edit-source" style={S.select} value={form.source} onChange={setField("source")}>
              <option value="">—</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="lead-edit-field">
            <label htmlFor="lead-edit-status">Lifecycle stage</label>
            <select id="lead-edit-status" style={S.select} value={form.status} onChange={setField("status")}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="lead-edit-field">
            <label htmlFor="lead-edit-tz">Timezone</label>
            <input
              id="lead-edit-tz"
              style={S.input}
              value={form.timezone}
              onChange={setField("timezone")}
              placeholder="America/New_York"
            />
          </div>

          <div className="lead-edit-field">
            <label htmlFor="lead-edit-notes">Notes</label>
            <textarea
              id="lead-edit-notes"
              style={{ ...S.input, minHeight: 110, fontFamily: "inherit", padding: 12, resize: "vertical" }}
              value={form.notes}
              onChange={setField("notes")}
              placeholder="Internal notes about this contact…"
            />
          </div>
        </div>

        <div className="lead-edit-drawer-foot">
          <button type="button" style={S.btn("ghost")} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" style={S.btn("primary")} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </aside>
    </>
  );
}
