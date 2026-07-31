// ─── SDR DRY-RUN FLAG ────────────────────────────────────────────────────────
// Week 5 / staging: skip live Twilio + Resend while exercising the sequence.
// Set SDR_DRY_RUN=1 (tests set this automatically).

export function isSdrDryRun(): boolean {
  const v = (process.env.SDR_DRY_RUN || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
