// ─── SDR SMS / email template variables ──────────────────────────────────────
// Templates use {{key}} tokens. Editors insert them via @-mention — users never
// need to type braces by hand.

export interface SdrTemplateVar {
  key: string;
  label: string;
  description: string;
  /** Shown in live preview when rendering sample data. */
  sample: string;
  group: "lead" | "workspace";
  /** Strongly recommended for personalization / branding. */
  recommended?: boolean;
}

/** Canonical variable catalog — keep UI + render in sync via this list. */
export const SDR_TEMPLATE_VARS: SdrTemplateVar[] = [
  {
    key: "lead_name",
    label: "Lead first name",
    description: "Lead's first name (same as first_name). Recommended in greetings.",
    sample: "Alex",
    group: "lead",
    recommended: true,
  },
  {
    key: "first_name",
    label: "First name",
    description: "Lead's first name from CRM.",
    sample: "Alex",
    group: "lead",
    recommended: true,
  },
  {
    key: "last_name",
    label: "Last name",
    description: "Lead's last name from CRM.",
    sample: "Rivera",
    group: "lead",
  },
  {
    key: "full_name",
    label: "Full name",
    description: "First + last name.",
    sample: "Alex Rivera",
    group: "lead",
  },
  {
    key: "email",
    label: "Email",
    description: "Lead's email address.",
    sample: "alex@example.com",
    group: "lead",
  },
  {
    key: "phone",
    label: "Phone",
    description: "Lead's phone number (if on file).",
    sample: "+1 (555) 010-2000",
    group: "lead",
  },
  {
    key: "source",
    label: "Lead source",
    description: "CRM source (e.g. Website, Referral).",
    sample: "Website",
    group: "lead",
  },
  {
    key: "company_name",
    label: "Your company",
    description: "Your workspace / organization name.",
    sample: "Leviosai",
    group: "workspace",
    recommended: true,
  },
];

export type SdrTemplateContext = Record<string, string>;

export function buildSdrTemplateContext(
  lead: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    source?: string | null;
  },
  companyName?: string | null
): SdrTemplateContext {
  const first = (lead.firstName || "").trim();
  const last = (lead.lastName || "").trim();
  return {
    lead_name: first,
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(" "),
    email: (lead.email || "").trim(),
    phone: (lead.phone || "").trim(),
    source: (lead.source || "").trim(),
    company_name: (companyName || "").trim(),
  };
}

/** Sample context for editor live preview. */
export function sampleSdrTemplateContext(): SdrTemplateContext {
  const ctx: SdrTemplateContext = {};
  for (const v of SDR_TEMPLATE_VARS) ctx[v.key] = v.sample;
  return ctx;
}

/**
 * Replace {{var}} tokens (case-insensitive, optional spaces).
 * Unknown keys become empty string so bad tokens don't leak to the lead.
 */
export function renderSdrTemplate(template: string, ctx: SdrTemplateContext): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] ?? "" : "";
  });
}

export function tokenForVar(key: string): string {
  return `{{${key}}}`;
}
