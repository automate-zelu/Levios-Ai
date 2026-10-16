/** Levvi onboarding — CSV / Sheets lead import helpers */

export const LEAD_CSV_TEMPLATE = `first_name,last_name,email,phone
Jane,Doe,jane@example.com,+15551234567
John,Smith,john@example.com,+15559876543
`;

export const LEAD_CSV_TEMPLATE_FILENAME = "catalyst-leads-template.csv";

/** Split a CSV line respecting double-quoted fields. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === "," || ch === "\t") && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

const NAME_KEYS = new Set(["name", "full_name", "fullname", "lead_name"]);
const FIRST_KEYS = new Set(["first_name", "firstname", "first", "given_name"]);
const LAST_KEYS = new Set(["last_name", "lastname", "last", "surname", "family_name"]);
const EMAIL_KEYS = new Set(["email", "email_address", "e_mail"]);
const PHONE_KEYS = new Set(["phone", "phone_number", "mobile", "cell", "telephone"]);

function indexMap(headers) {
  const map = { name: -1, first: -1, last: -1, email: -1, phone: -1 };
  headers.forEach((h, i) => {
    const k = normHeader(h);
    if (NAME_KEYS.has(k) && map.name < 0) map.name = i;
    if (FIRST_KEYS.has(k) && map.first < 0) map.first = i;
    if (LAST_KEYS.has(k) && map.last < 0) map.last = i;
    if (EMAIL_KEYS.has(k) && map.email < 0) map.email = i;
    if (PHONE_KEYS.has(k) && map.phone < 0) map.phone = i;
  });
  return map;
}

function rowLooksLikeHeader(cells) {
  const joined = cells.map(normHeader).join("|");
  return /email|phone|first_name|last_name|^name$/.test(joined);
}

/**
 * Parse CSV / TSV / pasted lines into lead create payloads.
 * Supports header rows (Sheets export) or bare Name,email,phone lines.
 */
export function parseLeadCsv(text, { max = 100, source = "Levvi import" } = {}) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  let start = 0;
  let map = { name: 0, first: -1, last: -1, email: 1, phone: 2 };
  const firstCells = splitCsvLine(lines[0]);
  if (rowLooksLikeHeader(firstCells)) {
    map = indexMap(firstCells);
    start = 1;
    // If header had no useful columns, fall back to positional
    if (map.name < 0 && map.first < 0 && map.email < 0 && map.phone < 0) {
      map = { name: 0, first: -1, last: -1, email: 1, phone: 2 };
    }
  }

  const out = [];
  for (let i = start; i < lines.length && out.length < max; i++) {
    const cells = splitCsvLine(lines[i]);
    if (!cells.some((c) => c)) continue;

    let firstName = map.first >= 0 ? cells[map.first] || "" : "";
    let lastName = map.last >= 0 ? cells[map.last] || "" : "";
    if (!firstName && map.name >= 0) {
      const full = cells[map.name] || "";
      const parts = full.split(/\s+/).filter(Boolean);
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ");
    }
    // Positional fallback when no name columns matched but row has 3 cells
    if (!firstName && map.name < 0 && map.first < 0 && cells[0]) {
      const parts = cells[0].split(/\s+/).filter(Boolean);
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ");
    }

    const email = map.email >= 0 ? cells[map.email] || undefined : cells[1] || undefined;
    const phone = map.phone >= 0 ? cells[map.phone] || undefined : cells[2] || undefined;

    if (!firstName && !email && !phone) continue;

    out.push({
      firstName: firstName || "Lead",
      lastName: lastName || "",
      email: email || undefined,
      phone: phone || undefined,
      source,
      status: "new",
    });
  }
  return out;
}

export function downloadLeadCsvTemplate() {
  const blob = new Blob([LEAD_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = LEAD_CSV_TEMPLATE_FILENAME;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file);
  });
}
