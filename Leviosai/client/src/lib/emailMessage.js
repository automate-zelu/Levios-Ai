/**
 * Parse stored lead_messages email content ("Subject: …\n\nbody") into parts.
 */
export function parseEmailContent(raw) {
  const text = String(raw || "");
  const match = text.match(/^Subject:\s*(.+?)\s*(?:\r?\n\r?\n|\r?\n)([\s\S]*)$/i);
  if (match) {
    return {
      subject: match[1].trim(),
      body: (match[2] || "").trim(),
    };
  }
  // Subject-only line with no blank separator
  const single = text.match(/^Subject:\s*(.+)$/im);
  if (single && !text.includes("\n\n")) {
    const lines = text.split(/\r?\n/);
    return {
      subject: single[1].trim(),
      body: lines.slice(1).join("\n").replace(/^Subject:.*$/im, "").trim(),
    };
  }
  return { subject: "", body: text.trim() };
}

export function emailPreviewLine(raw, max = 72) {
  const { subject, body } = parseEmailContent(raw);
  const line = subject || body.replace(/\s+/g, " ");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
