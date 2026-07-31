/**
 * Mirror of lib/sdr-template-vars.ts — keep keys/labels in sync.
 * Editors insert {{key}} via @-mention; runtime replaces from CRM + workspace.
 * {{lead_name}} still renders for older templates but is not offered in the picker.
 */
export const SDR_TEMPLATE_VARS = [
  {
    key: "first_name",
    label: "First name",
    description: "Lead's first name from CRM.",
    sample: "Alex",
    group: "lead",
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
  },
];

export function tokenForVar(key) {
  return `{{${key}}}`;
}

export function sampleTemplateContext() {
  const ctx = {
    // still resolve older templates in preview
    lead_name: "Alex",
  };
  for (const v of SDR_TEMPLATE_VARS) ctx[v.key] = v.sample;
  return ctx;
}

export function renderTemplatePreview(template) {
  if (!template) return "";
  const ctx = sampleTemplateContext();
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, rawKey) => {
    const key = String(rawKey).toLowerCase();
    return Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : "";
  });
}
