// ─── REACTOR CONFIGURATION ──────────────────────────────────────────────────
// Industry pricing, TCPA compliance rules, budget limits, and agent defaults.
// Ported from agent_system.py

// ─── INDUSTRY PRICING (cents per appointment) ──────────────────────────────

export const INDUSTRY_PRICING: Record<string, { name: string; reviivCents: number }> = {
  solar:               { name: "Solar Installation",  reviivCents: 40000 },
  insurance:           { name: "Insurance",           reviivCents: 12000 },
  hvac:                { name: "HVAC",                reviivCents: 17500 },
  roofing:             { name: "Roofing",             reviivCents: 35000 },
  plumbing:            { name: "Plumbing",            reviivCents: 15000 },
  electrical:          { name: "Electrical",          reviivCents: 17500 },
  pest_control:        { name: "Pest Control",        reviivCents:  8500 },
  landscaping:         { name: "Landscaping",         reviivCents: 10000 },
  windows_doors:       { name: "Windows & Doors",     reviivCents: 27500 },
  painting:            { name: "Painting",            reviivCents: 12500 },
  home_security:       { name: "Home Security",       reviivCents: 15000 },
  general_contracting: { name: "General Contracting", reviivCents: 30000 },
  pool_spa:            { name: "Pool & Spa",          reviivCents: 22500 },
  garage_doors:        { name: "Garage Doors",        reviivCents: 12500 },
  flooring:            { name: "Flooring",            reviivCents: 15000 },
  gutters_siding:      { name: "Gutters & Siding",    reviivCents: 12500 },
  water_treatment:     { name: "Water Treatment",     reviivCents: 17500 },
  tree_service:        { name: "Tree Service",        reviivCents: 10000 },
  concrete_masonry:    { name: "Concrete & Masonry",  reviivCents: 20000 },
  fencing:             { name: "Fencing",             reviivCents: 15000 },
};

// ─── BUDGET RULES ───────────────────────────────────────────────────────────

export const BUDGET_MIN_CENTS = 500_000;        // $5,000 minimum
export const BUDGET_MAX_CENTS = 10_000_000;     // $100,000 maximum
export const BUDGET_INCREMENT_CENTS = 50_000;   // $500 increments

// ─── TCPA COMPLIANCE ────────────────────────────────────────────────────────

export const CALLING_HOURS = { start: 8, end: 21 }; // 8 AM to 9 PM local
export const MAX_CALL_ATTEMPTS_PER_WEEK = 3;
export const MAX_SMS_PER_DAY = 1;

// States requiring AI disclosure at start of call
export const AI_DISCLOSURE_STATES = ["CA", "WA", "CO", "IL", "NY"];

// ─── OPT-OUT KEYWORDS ──────────────────────────────────────────────────────

export const OPT_OUT_KEYWORDS = [
  "stop", "unsubscribe", "remove", "quit", "cancel", "opt out", "optout", "don't contact",
];

// ─── LEAD SCORING ───────────────────────────────────────────────────────────

export const SCORE_DECAY_RATE = 2; // Points per day of inactivity

export const SIGNAL_WEIGHTS: Record<string, number> = {
  email_opened: 5,
  email_clicked: 15,
  sms_replied_positive: 25,
  sms_replied_neutral: 10,
  sms_replied_negative: -10,
  call_answered: 20,
  call_positive: 30,
  call_objection: 5,
  appointment_requested: 40,
  voicemail_callback: 35,
  web_form_submitted: 30,
  no_response_24h: -5,
  no_response_72h: -10,
  opt_out: -100,
};

// Score thresholds
export const SCORE_WARM_THRESHOLD = 70;
export const SCORE_DEAD_THRESHOLD = 10;

// ─── OUTREACH COSTS (cents) ─────────────────────────────────────────────────

export const OUTREACH_COSTS = {
  sms: 1,              // ~$0.0079
  email: 0,            // ~$0.001 negligible
  voice_per_min: 12,   // $0.12/min (Twilio + ElevenLabs)
  voicemail_drop: 4,   // $0.04
  ai_score: 0,         // ~$0.003 negligible
};

// ─── EMAIL SEQUENCE ─────────────────────────────────────────────────────────

export const EMAIL_SEQUENCE_DELAYS_DAYS = [0, 2, 5, 10, 21]; // Days between emails

// ─── OBJECTION CATEGORIES ───────────────────────────────────────────────────

export const OBJECTION_PATTERNS: Record<string, string[]> = {
  price_too_high: ["expensive", "cost", "price", "afford", "cheap"],
  not_interested: ["not interested", "no thanks", "don't want", "pass"],
  bad_timing: ["busy", "not now", "later", "bad time", "call back"],
  using_competitor: ["already have", "using another", "competitor"],
  need_to_think: ["think about", "consider", "let me"],
  spouse_decision: ["wife", "husband", "spouse", "partner", "talk to"],
  had_bad_experience: ["bad experience", "scam", "ripped off"],
};

// ─── APPOINTMENT REMINDERS ──────────────────────────────────────────────────

export const REMINDER_HOURS_BEFORE = [24, 2, 0.5]; // 24h, 2h, 30min before
