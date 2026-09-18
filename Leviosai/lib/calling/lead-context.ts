/** Build the CRM lead block injected into live-call agent prompts. */

export interface LeadRecordForCall {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  customFields?: string | null;
  timezone?: string | null;
}

function parseCustomFields(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickAddress(cf: Record<string, unknown>): string {
  for (const key of ["address", "serviceAddress", "street", "fullAddress", "homeAddress"]) {
    const v = cf[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const parts = ["street", "city", "state", "zip", "postalCode"]
    .map((k) => (typeof cf[k] === "string" ? String(cf[k]).trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

/**
 * System-prompt appendix so the outbound agent confirms CRM data
 * instead of re-collecting name/phone from scratch.
 */
export function buildLeadContextBlock(lead: LeadRecordForCall): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "Unknown";
  const phone = (lead.phone || "").trim() || "Unknown";
  const email = (lead.email || "").trim() || "Unknown";
  const cf = parseCustomFields(lead.customFields);
  const address = pickAddress(cf) || "Not on file";
  const notes = typeof cf.notes === "string" && cf.notes.trim() ? cf.notes.trim() : "";

  return `
## CRM LEAD ON THIS OUTBOUND CALL (already in our records)
- Full name: ${name}
- Phone: ${phone}
- Email: ${email}
- Service address: ${address}
${lead.timezone ? `- Timezone: ${lead.timezone}` : ""}
${lead.source ? `- Source: ${lead.source}` : ""}
${notes ? `- Notes: ${notes}` : ""}

## BOOKING / DATA RULES (mandatory)
- You already have their name and phone. Do NOT ask "what is your name/phone" from scratch.
- Confirm briefly once: e.g. "I have ${name} at ${phone} — want any changes?" Then move on.
- Only ask for a field if it is "Not on file", or they say they want to change it.
- If they dictate a change (new name/phone/address), acknowledge and use the new value for booking.
- Keep every spoken reply to ONE short sentence when possible (max ~20 words). Do not repeat the full appointment spiel every turn.
- Never invent address details. If address is missing and needed for an in-home visit, ask for it once.
`.trim();
}
