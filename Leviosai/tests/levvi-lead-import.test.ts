import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseLeadCsv,
  splitCsvLine,
  LEAD_CSV_TEMPLATE,
} from "../client/src/lib/levvi-lead-import.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Levvi lead CSV / Sheets import", () => {
  it("parses template header format", () => {
    const rows = parseLeadCsv(LEAD_CSV_TEMPLATE);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].firstName, "Jane");
    assert.equal(rows[0].lastName, "Doe");
    assert.equal(rows[0].email, "jane@example.com");
    assert.equal(rows[1].firstName, "John");
  });

  it("parses bare Name,email,phone paste lines", () => {
    const rows = parseLeadCsv("Ada Lovelace, ada@example.com, +1555111\nGrace Hopper, grace@example.com,");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].firstName, "Ada");
    assert.equal(rows[0].lastName, "Lovelace");
    assert.equal(rows[1].phone, undefined);
  });

  it("parses Google Sheets-style quoted CSV", () => {
    const csv = `first_name,last_name,email,phone\n"Jane","Doe, Jr",jane@x.com,"+1,555"`;
    const rows = parseLeadCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lastName, "Doe, Jr");
    assert.equal(rows[0].phone, "+1,555");
  });

  it("splits quoted commas", () => {
    assert.deepEqual(splitCsvLine('"a,b",c'), ["a,b", "c"]);
  });

  it("wires upload + template UI on Levvi leads step", () => {
    const src = readFileSync(join(root, "client/src/components/onboarding/LevviSteps.jsx"), "utf8");
    assert.match(src, /Download CSV template/);
    assert.match(src, /Upload CSV \/ Sheets export/);
    assert.match(src, /downloadLeadCsvTemplate|levvi-lead-import/);
  });

  it("register resumes incomplete onboarding instead of hard-blocking", () => {
    const auth = readFileSync(join(root, "routes/auth.ts"), "utf8");
    assert.match(auth, /ONBOARDING_INCOMPLETE/);
    assert.match(auth, /resumed:\s*true/);
    assert.match(auth, /continue Levvi setup/);
    assert.match(auth, /resumeOnboarding/);
  });

  it("persists Levvi draft to settings for cross-session resume", () => {
    const shell = readFileSync(join(root, "client/src/pages/SDROnboarding.jsx"), "utf8");
    assert.match(shell, /levvi\.onboardingDraft/);
    assert.match(shell, /levvi\.onboardingStep/);
    assert.match(shell, /settingsApi/);
  });
});
