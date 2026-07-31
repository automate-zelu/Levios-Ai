# Leviosai AI SDR — Complete Detailed QA / Test-Out Guide

**Document type:** Manual QA runbook (checklist + step-by-step)  
**Proposal refs:** ZAI-2025-LEV-002 (SOW) · ZAI-2025-LEV-003 (Implementation Plan v3.2)  
**Build under test:** Custom multi-tenant AI SDR SaaS (state machine + BullMQ + Twilio + Deepgram + LangChain + ElevenLabs + Stripe)  
**Environment:** Production EC2 — `http://54.88.193.115`  
**Repo:** https://github.com/automate-zelu/Levios-Ai  
**Last updated:** 2026-07-31  

---

## How to use this document

1. Work **top to bottom** for a full release sign-off, or jump to a section for a focused retest.  
2. For every case: perform the **Steps**, confirm **Expected**, capture **Evidence**, then mark **Result**.  
3. Failures: open a row in [§22 Defect log](#22-defect-log) with severity, then continue if non-blocking.  
4. Timebox: full golden path ≈ **2–4 hours** (plus wait timers if you do not shorten `waitCallHrs` / `waitSmsHrs`). Fast QA uses waits of **0–1 hour**.

### Result marking

| Mark | Meaning |
|---|---|
| `[x]` | Pass — expected behavior observed with evidence |
| `[ ]` | Not run / fail — fill defect ID |
| `N/A` | Out of scope for this environment (explain why) |

### Evidence to keep for each major case

- Screenshot of UI state (before + after)  
- Browser DevTools → Network: request URL, status, response snippet (redact tokens)  
- Twilio Console Call SID / Message SID (when applicable)  
- Stripe Dashboard event ID + delivery HTTP status  
- Enrollment UUID + status timeline from UI or API  

---

## Table of contents

1. [Stack mapping (SOW → what we built)](#1-stack-mapping-sow--what-we-built)  
2. [Environment & credentials](#2-environment--credentials)  
3. [Status / glossary](#3-status--glossary)  
4. [Tester setup & test data](#4-tester-setup--test-data)  
5. [Pre-flight checks](#5-pre-flight-checks)  
6. [Auth & roles](#6-auth--roles)  
7. [Billing gate & Stripe](#7-billing-gate--stripe)  
8. [Onboarding wizard](#8-onboarding-wizard)  
9. [SDR configuration panel](#9-sdr-configuration-panel)  
10. [Lead creation & enrollment](#10-lead-creation--enrollment)  
11. [Live AI calling (Module 2)](#11-live-ai-calling-module-2)  
12. [Full sequence branches (Module 1)](#12-full-sequence-branches-module-1)  
13. [SMS follow-up](#13-sms-follow-up)  
14. [Email follow-up](#14-email-follow-up)  
15. [Calling panel, recordings, transcripts](#15-calling-panel-recordings-transcripts)  
16. [Analytics & execution logs](#16-analytics--execution-logs)  
17. [Tier limits & upgrade prompts](#17-tier-limits--upgrade-prompts)  
18. [Compliance (quiet hours, DNC, frequency)](#18-compliance-quiet-hours-dnc-frequency)  
19. [Multi-tenant isolation](#19-multi-tenant-isolation)  
20. [Admin panel](#20-admin-panel)  
21. [Security & webhooks](#21-security--webhooks)  
22. [Calendar (if enabled)](#22-calendar-if-enabled)  
23. [Reliability / ops / CI-CD](#23-reliability--ops--ci-cd)  
24. [Automated engineering gates](#24-automated-engineering-gates)  
25. [Golden-path timed script](#25-golden-path-timed-script)  
26. [Out of scope (do not fail for)](#26-out-of-scope-do-not-fail-for)  
27. [Sign-off](#27-sign-off)  
28. [Defect log](#28-defect-log)  
29. [Appendix — curl / API cheat sheet](#29-appendix--curl--api-cheat-sheet)

---

## 1. Stack mapping (SOW → what we built)

The SOW described one locked SDR agent: dormant lead → AI call → SMS → email → CRM log. That **behavior** is what you QA.

| SOW component | Built replacement | Where it lives |
|---|---|---|
| n8n workflow | Custom state machine + BullMQ jobs | `lib/sdr-state-machine.ts`, `lib/sdr-queue.ts` |
| VAPI calling | Twilio Voice + Deepgram STT + LangChain + ElevenLabs TTS | `lib/calling/*`, `routes/call.ts` |
| n8n wait nodes | BullMQ delayed jobs (`waitCallHrs`, `waitSmsHrs`) | Redis + queue processors |
| Client config UI | SDR Agent page | `/sdr` |
| Call log / recordings | AI Calling panel | `/calling` |
| Billing | Stripe Checkout + portal + webhooks | `/billing`, `POST /api/billing/webhook` |
| Reactor dormant scan | Dormant lead agent | `reactor/dormantLeadAgent.ts` |

**Do not fail QA** because n8n UI or VAPI dashboard is missing. **Do fail** if call → SMS → email → logs → billing gate → isolation do not work.

---

## 2. Environment & credentials

### 2.1 URLs

| Purpose | URL |
|---|---|
| App (UI) | http://54.88.193.115 |
| Health | http://54.88.193.115/api/health |
| SDR Agent | http://54.88.193.115/sdr |
| AI Calling | http://54.88.193.115/calling |
| Billing | http://54.88.193.115/billing |
| Admin login | http://54.88.193.115/admin-login |
| Admin panel | http://54.88.193.115/admin |
| Stripe webhook | `POST http://54.88.193.115/api/billing/webhook` |
| Twilio voice connect | `POST http://54.88.193.115/api/call/connect` |
| Twilio call status | `POST http://54.88.193.115/api/webhooks/twilio/call-status` |
| Twilio inbound SMS | `POST http://54.88.193.115/api/webhooks/twilio/sms` |
| Email reply webhook | `POST http://54.88.193.115/api/webhooks/email/reply` |

### 2.2 Accounts (seeded for QA)

| Role | Email | Password | Entry point |
|---|---|---|---|
| Normal user | `user@leviosai.com` | `LeviosaiUser2026!` | App login |
| Platform admin | `admin@leviosai.com` | `LeviosaiAdmin2026!` | `/admin-login` |

> Change passwords after client handoff if these accounts remain enabled.

### 2.3 Known infra

| Item | Value |
|---|---|
| Host | `54.88.193.115` (also used as `BASE_URL`) |
| App process | PM2 name `leviosai` |
| App dir on server | `~/leviosai` |
| Twilio number (example) | `+18258910126` |
| DB | Supabase Postgres (via `DATABASE_URL`) |
| Queue | Redis on EC2 `redis://127.0.0.1:6379` |

### 2.4 Browser setup

- Use Chrome or Edge (latest).  
- One normal window for User A; **Incognito / second profile** for User B (isolation).  
- Keep DevTools → Network open; filter `api`.  
- Disable aggressive ad-blockers that may block Stripe Checkout iframes.

---

## 3. Status / glossary

### 3.1 Enrollment statuses (state machine)

| Status | Meaning |
|---|---|
| `pending` | Enrolled; call job not finished starting |
| `call_initiated` | Outbound call placed / in progress |
| `call_connected` | Media/session connected |
| `call_answered` | Human answered; conversation ran |
| `call_no_answer` | No answer / voicemail path |
| `call_busy` | Busy; retry path |
| `call_failed` | Telephony/API failure |
| `sms_sent` | Follow-up SMS sent; waiting for reply or timeout |
| `sms_replied` | Lead replied to SMS — sequence typically completes |
| `email_sent` | Follow-up email sent |
| `email_replied` | Lead replied to email |
| `booked` | Terminal success (appointment / strong positive) |
| `exhausted` | Terminal — no engagement; re-enroll scheduled |
| `re_enrolled` | Lead re-entered after `reEnrollDays` |

**Terminal statuses:** `booked`, `exhausted`.

### 3.2 Locked vs configurable (SOW §04)

**Clients can configure:** assistant name, voice, system prompt, knowledge base, SMS template, email subject/body, dormant days, wait-after-call hours, wait-after-SMS hours, re-enroll days, activate/deactivate.

**Clients cannot change:** sequence order (call → SMS → email), branch rules, webhook architecture, infrastructure, raw API keys.

### 3.3 Tier limits (Plan §15)

| Tier | Leads / mo | Minutes / mo | Seats |
|---|---|---|---|
| Starter | 500 | 1,000 | 2 |
| Growth | 2,000 | 4,000 | 5 |
| Scale | 5,000 | 10,000 | 15 |
| Enterprise | Unlimited* | Unlimited* | Unlimited* |

\*Internally represented as a very large sentinel limit.

---

## 4. Tester setup & test data

### 4.1 Physical assets checklist

| Asset | Required for | Your value (fill in) |
|---|---|---|
| Phone #1 (E.164, e.g. `+1XXXXXXXXXX`) | Answer / miss calls, SMS reply | |
| Phone #2 (optional) | Busy / second lead | |
| Email inbox you control | Email follow-up + reply | |
| Stripe test card (if test mode) | `4242 4242 4242 4242`, any future expiry, any CVC | |
| Second browser profile | Isolation | |
| Screen recording tool | Defect evidence | |

### 4.2 Recommended QA config values (paste into SDR form)

Use these so results are easy to recognize in transcripts and messages.

**Assistant name:** `QA Alex`

**System prompt (paste):**

```text
You are QA Alex, an AI SDR for Leviosai. Be brief and professional.
Goal: confirm if the lead is still interested and offer to book a 15-minute call.
If asked about the special QA fact, say exactly: "Our QA reference code is QA-KB-TOKEN-7741."
Never invent pricing outside the knowledge base.
```

**Knowledge base (paste):**

```text
Company: Leviosai CRM
QA reference code: QA-KB-TOKEN-7741
Business hours: Monday–Friday 9am–5pm Eastern
Service area: United States
Offer: AI SDR revival for dormant leads
Pricing note for QA: Starter plan is billed monthly via Stripe.
```

**SMS template:**

```text
Hi {{lead_name}}, this is QA Alex from Leviosai. Still interested in a quick chat? Reply YES to continue or STOP to opt out.
```

**Email subject:**

```text
[QA] Quick follow-up from Leviosai for {{lead_name}}
```

**Email body:**

```text
Hi {{lead_name}},

We tried reaching you by phone. If timing was bad, reply to this email and we will reconnect.

Reference: QA-KB-TOKEN-7741

Thanks,
QA Alex — Leviosai
```

**Thresholds for fast QA:**

| Field | Fast QA | Production-like |
|---|---|---|
| `dormantDays` | `1` | `7` |
| `waitCallHrs` | `0` or `1` | `2` |
| `waitSmsHrs` | `0` or `1` | `4` |
| `reEnrollDays` | `7` | `30` |

> If UI rejects `0`, use `1` and note the wait in the defect log / test notes.

### 4.3 Lead naming convention

Create leads named so logs are searchable:

- `QA Call Answer` — will answer  
- `QA Call Miss` — will not answer (SMS path)  
- `QA Exhaust` — miss call + miss SMS + miss email  
- `QA Isolate A` / `QA Isolate B` — two workspaces  

---

## 5. Pre-flight checks

Complete before functional testing. Estimated time: **15–20 minutes**.

### 5.1 Health endpoint

**Steps**

1. Open http://54.88.193.115/api/health in the browser (or curl).  
2. Confirm HTTP 200.  
3. Confirm `"status":"ok"`.  
4. Confirm nested `services` keys are `"ok"` for: `database`, `redis`, `twilio`, `deepgram`, `openai`, `elevenlabs`, `stripe` (and others if present).

**Expected sample shape**

```json
{
  "status": "ok",
  "services": {
    "database": "ok",
    "redis": "ok",
    "twilio": "ok",
    "deepgram": "ok",
    "openai": "ok",
    "elevenlabs": "ok",
    "stripe": "ok"
  },
  "version": "1.0.0"
}
```

**Evidence:** screenshot or saved JSON.  
**Result:** [ ]

**If fail:** check PM2 (`pm2 logs leviosai`), `.env` on server, Redis service, DB connectivity. Stop QA until health is green.

### 5.2 UI loads

**Steps**

1. Open http://54.88.193.115  
2. Confirm login / app shell loads (no blank white error page).  
3. Hard refresh once (Cmd/Ctrl+Shift+R).

**Expected:** Login form or dashboard visible within a few seconds.  
**Result:** [ ]

### 5.3 Stripe webhook configuration

**Steps (Stripe Dashboard)**

1. Go to **Developers → Webhooks**.  
2. Open (or create) endpoint URL exactly:  
   `http://54.88.193.115/api/billing/webhook`  
3. Confirm these events are selected:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy Signing secret (`whsec_…`) and confirm it matches server `STRIPE_WEBHOOK_SECRET` (ops check; do not paste secret into this doc).  
5. Optional: send a Stripe “Send test webhook” and confirm delivery response **2xx**.

**Unsigned probe (must reject):**

```bash
curl -sS -i -X POST http://54.88.193.115/api/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** HTTP **400** with message about missing/invalid `stripe-signature`.  
**Result:** URL [ ] Events [ ] Secret match [ ] Unsigned rejected [ ]

### 5.4 Twilio phone configuration

**Steps (Twilio Console → Phone Numbers)**

1. Open number used for outbound (e.g. `+18258910126`).  
2. Voice & Fax → A CALL COMES IN → Webhook:  
   `http://54.88.193.115/api/call/connect` · HTTP POST  
3. Status callback URL (if configured):  
   `http://54.88.193.115/api/webhooks/twilio/call-status` · POST  
4. Messaging → A MESSAGE COMES IN (for SMS reply tests):  
   `http://54.88.193.115/api/webhooks/twilio/sms` · POST  

**Expected:** URLs saved; no Twilio validation error.  
**Result:** Voice [ ] Status [ ] SMS inbound [ ]

### 5.5 Clock / timezone note

Quiet-hours tests depend on lead timezone inference (area code) or explicit lead timezone. Note your local time when testing compliance (§18).

**Result (noted tester TZ):** [ ]

---

## 6. Auth & roles

Estimated time: **20 minutes**.

### 6.1 User login (happy path)

**Steps**

1. Open app → login.  
2. Email: `user@leviosai.com`  
3. Password: `LeviosaiUser2026!`  
4. Submit.

**Expected**

- Redirect into CRM shell.  
- Sidebar includes (names may vary slightly): **SDR Agent**, **AI Calling**, **Billing**.  
- DevTools → Application/LocalStorage or Network: auth token stored; subsequent `/api/*` calls send `Authorization: Bearer …`.  
- `GET /api/auth/me` (or equivalent session endpoint used by app) returns `role: "user"`.

**Evidence:** screenshot of sidebar + Network 200 on session.  
**Result:** [ ]

### 6.2 Wrong password

**Steps:** login with correct email, wrong password.  
**Expected:** error message; stay on login; no token.  
**Result:** [ ]

### 6.3 Unauthenticated API

```bash
curl -sS -i http://54.88.193.115/api/sdr/config
```

**Expected:** HTTP **401**.  
**Result:** [ ]

### 6.4 Register a fresh account (optional but recommended)

**Steps**

1. Register: new email, password ≥ 8 chars, first/last name, org name `QA Org 2`.  
2. Confirm login works.  
3. Confirm new workspace starts **without** active paid SDR (billing gate).

**Expected:** account created; SDR inactive / onboarding prompts subscribe.  
**Result:** [ ]

### 6.5 Admin login

**Steps**

1. Open http://54.88.193.115/admin-login  
2. Login `admin@leviosai.com` / `LeviosaiAdmin2026!`

**Expected:** redirect to `/admin`; workspace list / analytics visible.  
**Result:** [ ]

### 6.6 Role boundary

**Steps**

1. As **user**, navigate to `/admin`.  
2. As **user**, call `GET /api/admin/workspaces` with user JWT.

**Expected:** UI redirects/blocks; API **401/403**.  
**Result:** [ ]

### 6.7 Logout

**Steps:** logout from user session; revisit `/sdr`.  
**Expected:** forced back to login; protected APIs 401.  
**Result:** [ ]

---

## 7. Billing gate & Stripe

Estimated time: **30–45 minutes**.  
**Hard rule from plan:** no AI SDR calling until active paid subscription **and** completed config.

### 7.1 View plans

**Steps**

1. Login as user.  
2. Open **Billing** (`/billing`).  
3. Confirm plans listed: Starter, Growth, Scale, Enterprise (labels/prices per Stripe price IDs).

**Expected:** plans from `GET /api/billing/plans`; no raw secret keys in response.  
**Result:** [ ]

### 7.2 Checkout Starter

**Steps**

1. Click Subscribe / Checkout on **Starter**.  
2. Confirm Network: `POST /api/billing/checkout` → 200 with Stripe Checkout URL.  
3. Complete Checkout:
   - Test mode card: `4242 4242 4242 4242`  
   - Expiry any future date, CVC any 3 digits, ZIP any  
4. Wait for redirect back to `/billing?success=…` (or similar).  
5. In Stripe Dashboard → Payments / Customers: payment succeeded.  
6. In Stripe → Webhooks → recent deliveries: `checkout.session.completed` and/or `customer.subscription.*` → HTTP 2xx to prod URL.

**Expected UI after refresh**

- Subscription active / tier badge **Starter** (or mapped tier).  
- Usage bars visible (leads / minutes).  
- SDR billing gate open (onboarding can proceed / activate allowed after config).

**Evidence:** Stripe event IDs + Billing screenshot.  
**Result:** [ ]

### 7.3 Billing status API

With user JWT:

```bash
TOKEN='<paste>'
curl -sS http://54.88.193.115/api/billing \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected:** shows active subscription / tier / usage fields (shape may vary; must not be empty unpaid if checkout succeeded).  
**Result:** [ ]

### 7.4 Customer portal

**Steps:** Billing → Manage / Portal.  
**Expected:** `POST /api/billing/portal` returns portal URL; Stripe portal opens.  
**Result:** [ ]

### 7.5 Cancel auto-renew

**Steps**

1. Billing → Cancel renewal (or portal cancel at period end).  
2. Confirm UI shows cancel scheduled / `cancel_at_period_end` equivalent.  
3. Confirm SDR still usable until period end (access not immediately stripped unless product rules say otherwise).

**Result:** [ ]

### 7.6 Resume renewal

**Steps:** Resume renewal.  
**Expected:** cancel flag cleared; UI shows renewing.  
**Result:** [ ]

### 7.7 Upgrade path

**Steps:** Checkout **Growth** (or change plan in portal).  
**Expected:** after webhook, tier limits update (Growth: 2,000 leads / 4,000 min / 5 seats).  
**Result:** [ ]

### 7.8 Failed payment / deleted subscription (careful)

Only if safe in test mode:

1. Simulate `invoice.payment_failed` or cancel subscription immediately in Stripe.  
2. Confirm workspace SDR becomes inactive / paused per product rules.  
3. Confirm enroll attempts return workspace inactive / forbidden.

**Result:** [ ] / N/A

---

## 8. Onboarding wizard

Estimated time: **20 minutes**.  
Route: onboarding flow after first login (`SDROnboarding` / `/onboarding` style path if prompted).

### Step 1 — Subscribe

**Steps:** complete Checkout if not already subscribed (§7).  
**Expected:** step unlocks only when billing shows active. Polling `/api/billing` until active is OK.  
**Result:** [ ]

### Step 2 — Configure SDR

**Steps:** paste QA config from §4.2; Save.  
**Expected:** `PUT /api/sdr/config` 200; fields persist on reload; `kbEmbeddedAt` eventually set (KB indexing).  
**Result:** [ ]

### Step 3 — Complete

**Steps:** finish onboarding.  
**Expected:** `POST /api/auth/onboarding/complete` (or equivalent) succeeds; `onboardingComplete: true`; land in main app.  
**Result:** [ ]

### Onboarding skip / resume

**Steps:** refresh mid-wizard.  
**Expected:** returns to saved step or config; does not lose subscription.  
**Result:** [ ]

---

## 9. SDR configuration panel

Path: **SDR Agent** → http://54.88.193.115/sdr  
Estimated time: **25 minutes**.

### 9.1 Load config

**Steps:** open `/sdr`.  
**Expected:** form loads existing values; TierBadge visible; tabs/sections for Config / Analytics / Enrollments (as implemented).  
**Result:** [ ]

### 9.2 Save full config

**Steps**

1. Fill all fields using §4.2.  
2. Click Save.  
3. Confirm toast/message: configuration saved.  
4. Hard refresh; values still present.  
5. Network: `PUT /api/sdr/config` body includes prompt, KB, templates, thresholds.

**Expected:** 200; no 401/403 if subscribed and authenticated.  
**Result:** [ ]

### 9.3 Validation / empty required fields

**Steps:** clear system prompt or SMS template; attempt save.  
**Expected:** client and/or server validation error; no silent empty save.  
**Result:** [ ]

### 9.4 Template variables

**Steps:** ensure SMS/email contain `{{lead_name}}`.  
**Expected:** later SMS/email personalize with lead first name (see §13–14).  
**Result:** [ ] (confirmed later)

### 9.5 Activate / deactivate

**Steps**

1. Click **Activate** (only after billing + config).  
2. Confirm `PATCH /api/sdr/config/status` with `isActive: true` → 200.  
3. Badge shows active.  
4. Deactivate → `isActive: false`.  
5. Re-activate for remaining tests.

**Expected:** toggle works; inactive workspace rejects new enrolls (`workspace_inactive` / 403).  
**Result:** Activate [ ] Deactivate blocks enroll [ ] Reactivate [ ]

### 9.6 Locked engine check

**Steps:** inspect UI for any control that reorders sequence steps or edits raw workflow.  
**Expected:** **none** — only content/thresholds.  
**Result:** [ ]

### 9.7 Voice selection

**Steps:** set `assistantVoiceId` if UI exposes voices; save.  
**Expected:** persisted; later call uses selected voice (or documented default).  
**Result:** [ ]

---

## 10. Lead creation & enrollment

Estimated time: **30 minutes**.

### 10.1 Create lead in CRM

**Steps**

1. Open Leads section in the CRM UI.  
2. Create lead:
   - First / last: `QA` / `Call Answer`  
   - Phone: your E.164 number  
   - Email: your inbox  
   - Status: open / contacted (not closed/booked)  
3. Save; note numeric `leadId` from UI or Network response.

**Expected:** lead appears in list; belongs to your organization.  
**Result:** [ ] Lead ID: __________

### 10.2 Manual enroll (primary QA path)

**Steps**

1. From lead detail / SDR tools, enroll into SDR **or** call API:

```bash
TOKEN='<user jwt>'
LEAD_ID='<id>'
curl -sS -i -X POST "http://54.88.193.115/api/sdr/enroll/$LEAD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

2. Open `/sdr` enrollments list or `GET /api/sdr/enrollments`.

**Expected**

- HTTP 200/201 with enrollment id.  
- Status progresses `pending` → `call_initiated` quickly if queue healthy.  
- Phone rings (live call tests) or Twilio shows outbound call.

**Result:** [ ] Enrollment ID: __________

### 10.3 Duplicate active enrollment

**Steps:** immediately enroll same lead again.  
**Expected:** HTTP **409** `active_enrollment` (or similar); no second concurrent sequence.  
**Result:** [ ]

### 10.4 Enroll without active workspace / SDR

**Steps:** deactivate SDR; try enroll.  
**Expected:** **403** `workspace_inactive` (or equivalent).  
**Result:** [ ]

### 10.5 Opt-out / DNC lead (if fields available)

**Steps:** set lead consent opted-out or `dncClean=false`; enroll.  
**Expected:** **403** `opted_out` or `dnc`.  
**Result:** [ ] / N/A

### 10.6 Auto dormant scan (production path)

**Steps**

1. Create lead with `lastContactedAt` older than `dormantDays`.  
2. Ensure SDR active.  
3. Wait for Reactor scan (~30 min) **or** trigger scan if admin/ops hook exists.  
4. Confirm enrollment created without manual enroll.

**Expected:** new enrollment for dormant lead.  
**Result:** [ ] / Deferred (note time waited)

---

## 11. Live AI calling (Module 2)

Estimated time: **30–45 minutes** per answered call.  
Requires real phone + Twilio + AI keys healthy (§5.1).

### 11.1 Answered conversation (core)

**Steps**

1. Enroll `QA Call Answer` lead with your phone.  
2. Answer the inbound call from Twilio number.  
3. Listen for greeting using assistant name **QA Alex**.  
4. Speak: “Hi, who is this?”  
5. Speak: “What is your QA reference code?”  
6. Speak: “Yes, I’m interested — can we book something?”  
7. Allow AI to respond; then hang up politely.

**Expected**

| Checkpoint | Pass if |
|---|---|
| Ring | Call arrives within ~60s of enroll (queue dependent) |
| Greeting | Mentions QA Alex / Leviosai tone |
| STT | AI responds to your speech (not silence forever) |
| KB / RAG | Mentions `QA-KB-TOKEN-7741` when asked |
| TTS | Natural ElevenLabs voice **or** Twilio Say fallback |
| Hangup | Call ends cleanly; no stuck “ghost” session |
| Enrollment | Moves toward `call_answered` / `booked` (or answered terminal per analyser) |
| Logs | Step entries for call initiate + outcome |

**Evidence:** Twilio Call SID, `/calling` row, transcript text containing KB token.  
**Result:** [ ]

### 11.2 Transcript quality

**Steps:** open call in `/calling` → Transcript viewer.  
**Expected:** alternating agent/lead lines; your spoken phrases roughly present; no other workspace’s text.  
**Result:** [ ]

### 11.3 Recording

**Steps:** open Recording player for the same call.  
**Expected:** audio plays; URL from blob/S3 (may be signed); duration roughly matches call.  
**Result:** [ ]

### 11.4 No-answer path kickoff

**Steps:** enroll `QA Call Miss`; do **not** answer; let it ring out / go VM.  
**Expected:** status `call_no_answer` (or equivalent); SMS scheduled after `waitCallHrs`.  
**Result:** [ ]

### 11.5 Invalid phone

**Steps:** create lead with clearly invalid phone; enroll.  
**Expected:** call failure logged (`call_failed`); graceful fall-through toward SMS per design; UI shows failure reason in logs.  
**Result:** [ ]

### 11.6 TTS fallback awareness

If ElevenLabs errors appear in server logs but call continues with robotic Twilio voice, mark **Pass (fallback)**.  
If call dies with no audio and no fallback, mark **Fail**.  
**Result:** [ ] / N/A

---

## 12. Full sequence branches (Module 1)

Use separate leads per branch. Shorten waits (§4.2).

### 12.1 Branch: Answered → complete

| Step | Action | Expected status / job |
|---|---|---|
| 1 | Enroll + answer + book intent | `call_initiated` → `call_answered` / `booked` |
| 2 | Confirm no SMS after success path | No unnecessary SMS if sequence completed |
| 3 | Logs show call outcome | `sdr_logs` steps present |

**Result:** [ ]

### 12.2 Branch: No-answer → SMS

| Step | Action | Expected |
|---|---|---|
| 1 | Miss call | `call_no_answer` |
| 2 | Wait `waitCallHrs` | `SEND_SMS` job runs |
| 3 | Phone receives SMS | Personalized with lead name |
| 4 | Enrollment | `sms_sent` |

**Result:** [ ]

### 12.3 Branch: Busy → retry → SMS

| Step | Action | Expected |
|---|---|---|
| 1 | Force busy if possible (carrier/device) | `call_busy` |
| 2 | Wait ~30 min retry (or observe job) | Second `INITIATE_CALL` (max 2 retries) |
| 3 | After max busy retries | Falls to SMS path |

**Result:** [ ] / N/A (note if busy cannot be forced)

### 12.4 Branch: SMS replied → stop

| Step | Action | Expected |
|---|---|---|
| 1 | Reach `sms_sent` | SMS received |
| 2 | Reply `YES` from lead phone | Webhook `/api/webhooks/twilio/sms` |
| 3 | Enrollment | `sms_replied` (then possibly `booked`/complete) |
| 4 | Confirm | **No email** sent afterward |

**Result:** [ ]

### 12.5 Branch: SMS timeout → email

| Step | Action | Expected |
|---|---|---|
| 1 | Reach `sms_sent`; do not reply | Wait `waitSmsHrs` |
| 2 | Timeout job | `email_sent` |
| 3 | Inbox | Email with QA subject/body arrives |

**Result:** [ ]

### 12.6 Branch: Email replied → stop

| Step | Action | Expected |
|---|---|---|
| 1 | Reply to SDR email from lead inbox | `/api/webhooks/email/reply` processes |
| 2 | Enrollment | `email_replied` |
| 3 | Confirm | Not forced to `exhausted` |

**Result:** [ ] / N/A if inbound email parse not configured in this env

### 12.7 Branch: Exhausted → re-enroll gate

| Step | Action | Expected |
|---|---|---|
| 1 | Miss call + miss SMS + miss email timeouts | `exhausted`; `exhaustedAt` set |
| 2 | `nextEnrollAfter` ≈ now + `reEnrollDays` | Visible on enrollment |
| 3 | Manual re-enroll before gate | **409** `reenroll_gate` |
| 4 | After gate (or admin override if any) | Can enroll again → `re_enrolled` / new enrollment |

**Result:** [ ]

### 12.8 Illegal transition resistance

**Steps:** (engineering) attempt to force invalid status jump via API if any admin recover endpoint exists; otherwise skip.  
**Expected:** state machine rejects illegal transitions; recover endpoint only applies planned recoveries.  
**Result:** [ ] / N/A

---

## 13. SMS follow-up

### 13.1 Content checks

When SMS arrives:

- [ ] From Twilio number associated with workspace / master  
- [ ] Body matches template  
- [ ] `{{lead_name}}` replaced (not literal braces)  
- [ ] Mentions Leviosai / QA Alex as configured  

### 13.2 STOP / opt-out wording

If lead replies `STOP` (and compliance parsing supports it):

**Expected:** sequence halts; further outreach blocked for that lead.  
**Result:** [ ] / N/A

### 13.3 Wrong-number matching

Send an SMS from an unrelated phone to the Twilio number with no enrollment.

**Expected:** webhook 200 or ignored safely; **no** other enrollment mutated.  
**Result:** [ ]

---

## 14. Email follow-up

### 14.1 Delivery

- [ ] Email arrives (check spam)  
- [ ] Subject matches (with name personalization if supported in subject)  
- [ ] Body contains `QA-KB-TOKEN-7741` or template text  
- [ ] From address matches Resend/SendGrid configured sender  

### 14.2 Reply webhook

If inbound parse is configured:

1. Reply to the email.  
2. Confirm enrollment status updates within a few minutes.  
3. Confirm Stripe/Twilio unrelated.

If inbound parse **not** configured in this environment: mark N/A and note “outbound email verified only”.

**Result:** [ ] / N/A

---

## 15. Calling panel, recordings, transcripts

Path: http://54.88.193.115/calling

### 15.1 Call log table

**Steps:** open Calling panel after at least one call.  
**Expected columns (or equivalent):** date/time, lead name, duration, outcome, links to recording/transcript.  
**Result:** [ ]

### 15.2 Analytics cards

**Expected:** counts for calls / answer rate / duration move after tests (may lag briefly).  
**Result:** [ ]

### 15.3 Recording player

**Steps:** play recording; seek; pause.  
**Expected:** audible playback; errors surface as UI message (not silent fail).  
**Result:** [ ]

### 15.4 Transcript viewer

**Steps:** open transcript; scroll.  
**Expected:** readable turns; KB answer visible for answered KB test.  
**Result:** [ ]

---

## 16. Analytics & execution logs

### 16.1 SDR analytics (`GET /api/sdr/analytics`)

**Steps:** open `/sdr` analytics section; compare to API.  
**Expected:** enrollments, completions, usage vs limits, tier.  
**Result:** [ ]

### 16.2 Per-lead execution log

**Steps**

1. Pick an enrollment that went through multiple steps.  
2. Open lead logs UI or `GET /api/sdr/leads/:leadId/logs`.  
3. Verify chronological order: call → (sms) → (email).

**Expected:** each step has `stepName`, outcome, timestamp; workspace-scoped.  
**Result:** [ ]

### 16.3 Enrollment detail

`GET /api/sdr/enrollments/:id` with JWT.

**Expected:** status, timestamps (`callInitiatedAt`, `smsSentAt`, …), `callSessionId` when applicable.  
**Result:** [ ]

---

## 17. Tier limits & upgrade prompts

### 17.1 Usage bars

**Steps:** Billing + SDR analytics show used / limit for leads and minutes.  
**Expected:** numbers increase after enrolls/calls; near-limit warning around ~90% if implemented.  
**Result:** [ ]

### 17.2 Lead limit enforcement

**How to test without burning 500 leads (preferred):**

1. As **admin**, temporarily set workspace `monthlyLeadLimit` very low (e.g. 1) **or** set `monthlyLeadsUsed` high via admin reset/tier tools.  
2. As user, attempt another enroll.

**Expected:** HTTP **429** `lead_limit` + upgrade prompt in UI.  
**Restore limits after test.**  
**Result:** [ ]

### 17.3 Minute limit fall-through

If minute limit reached mid-sequence (admin-simulated):

**Expected:** call path blocked/skipped; SMS fall-through per plan logic.  
**Result:** [ ] / N/A

### 17.4 Seat limit (team invite)

**Steps:** invite seats until Starter limit (2) exceeded.  
**Expected:** invite blocked with clear reason.  
**Result:** [ ] / N/A if team UI not used

---

## 18. Compliance (quiet hours, DNC, frequency)

### 18.1 Quiet hours

**Steps**

1. Use a lead phone area code that maps to a TZ currently outside calling hours **or** set explicit lead timezone.  
2. Enroll / trigger call.

**Expected:** call deferred or blocked; log reason related to quiet hours.  
**Result:** [ ]

### 18.2 Frequency cap

**Steps:** generate more than weekly max call attempts to same lead (per `MAX_CALL_ATTEMPTS_PER_WEEK` policy).  
**Expected:** further calls blocked.  
**Result:** [ ]

### 18.3 DNC / blacklist

**Steps:** mark lead DNC / consent revoked; enroll.  
**Expected:** rejected; no Twilio call created.  
**Result:** [ ]

---

## 19. Multi-tenant isolation

**Critical for SaaS sign-off.** Use two accounts (User A = `user@leviosai.com`, User B = newly registered).

### 19.1 Different configs

**Steps**

1. User A: prompt contains `WORKSPACE-A-ONLY-STRING`.  
2. User B: prompt contains `WORKSPACE-B-ONLY-STRING`.  
3. Each enrolls their own lead and answers a short call (or dry inspect config API).

**Expected:** A’s call/transcript never contains B’s string and vice versa.  
**Result:** [ ]

### 19.2 Data access isolation

**Steps**

1. User A: copy an enrollment UUID from Network.  
2. User B JWT: `GET /api/sdr/enrollments/<A-uuid>`.

**Expected:** **403/404**, not A’s data.  
**Result:** [ ]

### 19.3 List isolation

**Steps:** each user lists enrollments.  
**Expected:** only own workspace rows.  
**Result:** [ ]

### 19.4 Concurrent enrollments

**Steps:** enroll in A and B nearly simultaneously.  
**Expected:** both process; logs never mix workspace IDs.  
**Result:** [ ]

### 19.5 Inbound SMS isolation

**Steps:** SMS reply for A’s lead must update only A’s enrollment.  
**Result:** [ ]

---

## 20. Admin panel

Login: http://54.88.193.115/admin-login  
Estimated time: **25 minutes**.

### 20.1 Workspace list

**Expected:** see workspaces with tier, usage, active flag.  
**Result:** [ ]

### 20.2 Workspace detail

**Steps:** open a workspace.  
**Expected:** detail shows config summary / enrollments / Twilio status fields as implemented.  
**Result:** [ ]

### 20.3 Stuck enrollments

**Steps:** open Stuck Enrollments; if empty, pass with note; if rows exist, run Recover on a safe test enrollment.  
**Expected:** recover moves enrollment to a valid next state or clear error.  
**Result:** [ ]

### 20.4 Platform analytics

**Expected:** aggregate charts/cards load; no API keys shown.  
**Result:** [ ]

### 20.5 Tier override / reset usage (careful)

**Steps:** change tier or reset usage on **QA workspace only**; confirm user Billing/SDR reflects change.  
**Restore** after test.  
**Result:** [ ]

### 20.6 Twilio provision controls

**Steps:** open Twilio status / provision / assign number if buttons exist.  
**Expected:** success path or clear ops error (do not fail entire release if Twilio subaccount already provisioned).  
**Result:** [ ] / N/A

### 20.7 Admin API authz

User JWT must not access admin routes (§6.6).  
**Result:** [ ]

---

## 21. Security & webhooks

### 21.1 Stripe signature

Unsigned POST → **400** (§5.3).  
**Result:** [ ]

### 21.2 Twilio signature

**Steps:** POST fake form body to `/api/webhooks/twilio/sms` without valid Twilio signature.  
**Expected:** **403**.  
**Result:** [ ]

### 21.3 JWT required on SDR routes

Unauthenticated `/api/sdr/*` → **401**.  
**Result:** [ ]

### 21.4 Secrets not leaked to frontend

**Steps:** inspect XHR responses for config/billing/analytics.  
**Expected:** no `sk_live`, `sk_test` secret key material, no Deepgram/ElevenLabs raw keys. Publishable Stripe key is OK.  
**Result:** [ ]

### 21.5 Sensitive files not public

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://54.88.193.115/IMPLEMENTATION_PLAN.md
curl -sS -o /dev/null -w "%{http_code}\n" http://54.88.193.115/.env
```

**Expected:** 404 (or non-200 without file contents).  
**Result:** [ ]

---

## 22. Calendar (if enabled)

Path: calendar connections UI inside settings / onboarding.

| Case | Steps | Expected | Result |
|---|---|---|---|
| Connect Google | OAuth | Connected status | [ ] / N/A |
| Connect Outlook | OAuth | Connected status | [ ] / N/A |
| Booking from call | Booked outcome | Event on calendar | [ ] / N/A |
| Disconnect | Remove connection | Status cleared | [ ] / N/A |

---

## 23. Reliability / ops / CI-CD

### 23.1 Process health

Ops:

```bash
ssh -i ~/Downloads/generalkeypair.pem ubuntu@54.88.193.115
pm2 list
pm2 logs leviosai --lines 100
```

**Expected:** `leviosai` online; no crash loop.  
**Result:** [ ]

### 23.2 Restart resilience

**Steps:** `pm2 restart leviosai`; wait 10s; hit health; confirm UI login still works.  
**Expected:** health ok; delayed queue jobs not permanently lost (spot-check one delayed SMS job if in flight).  
**Result:** [ ]

### 23.3 CI/CD

**Steps:** confirm latest `main` Actions run: unit tests green + Deploy to EC2 success.  
**Expected:** https://github.com/automate-zelu/Levios-Ai/actions shows success for latest push.  
**Result:** [ ]

### 23.4 Env secret sync

After `.env` changes: refresh `LEVIOSAI_ENV` GitHub secret so CI/CD stays aligned.

```bash
gh secret set LEVIOSAI_ENV -R automate-zelu/Levios-Ai < Leviosai/.env
```

**Result:** [ ] (ops)

---

## 24. Automated engineering gates

From `Leviosai/` (local or CI):

```bash
npm ci
npm run test:ci
npm run test:week5   # if dry-run / env available
npm run client:build
```

| Gate | Result |
|---|---|
| `test:ci` | [ ] |
| `test:week5` | [ ] / N/A |
| Client production build | [ ] |
| GitHub Actions deploy | [ ] |

---

## 25. Golden-path timed script

Use this as the **single continuous demo** for stakeholders.

| Time | Action | Pass checkpoint |
|---|---|---|
| 0:00 | Health + Stripe webhook + Twilio URL pre-flight | All green |
| 0:15 | Login user → Billing → Subscribe Starter | Active tier |
| 0:30 | `/sdr` paste QA config → Save → Activate | `isActive` true |
| 0:40 | Create lead with your phone/email | Lead ID noted |
| 0:45 | Manual enroll | Phone rings |
| 0:47 | Answer; ask for QA-KB-TOKEN-7741; express interest | Transcript + recording |
| 1:00 | Confirm `/calling` + enrollment logs | Status answered/booked |
| 1:10 | Second lead: miss call | `call_no_answer` |
| 1:10+wait | Receive SMS; reply YES | `sms_replied`; no email |
| 1:40 | Third lead: miss call + ignore SMS → email | Email received |
| 2:10 | Admin panel spot-check | Workspaces visible |
| 2:20 | Isolation: second user cannot read first enrollment | 403/404 |
| 2:30 | Billing cancel/resume renewal | Flags correct |
| 2:40 | Sign §27 | Done |

---

## 26. Out of scope (do not fail for)

- Missing n8n editor / Railway n8n container  
- Missing VAPI assistant UI  
- Client DIY workflow builder  
- HTTPS/custom domain (current prod may be IP HTTP — note as infra follow-up, not SDR logic fail)  
- Perfect TTS latency under all network conditions (note if >~1.5–2s consistently as P2)  

---

## 27. Sign-off

| Role | Name | Date | Verdict | Notes |
|---|---|---|---|---|
| QA tester | | | Pass / Fail / Pass with issues | |
| Leviosai reviewer | | | | |
| ZeluAI engineer | | | | |

**Overall release recommendation:** ________________________________

---

## 28. Defect log

| ID | Sev | Area | Summary | Steps to repro | Expected | Actual | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
| QA-001 | P1/P2/P3 | | | | | | | | Open |

**Severity guide**

| Sev | Definition |
|---|---|
| P1 | Blocks core path (cannot subscribe, cannot call, data leak across tenants) |
| P2 | Major feature broken with workaround (recording missing, SMS delay wrong) |
| P3 | Cosmetic / minor copy / non-blocking polish |

---

## 29. Appendix — curl / API cheat sheet

### Health

```bash
curl -sS http://54.88.193.115/api/health | jq .
```

### Login (adjust path if UI uses form-only; app uses JSON login)

```bash
curl -sS -X POST http://54.88.193.115/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@leviosai.com","password":"LeviosaiUser2026!"}' | jq .
# Copy .token
```

### Common authenticated calls

```bash
TOKEN='...'
AUTH="Authorization: Bearer $TOKEN"

curl -sS http://54.88.193.115/api/billing -H "$AUTH" | jq .
curl -sS http://54.88.193.115/api/sdr/config -H "$AUTH" | jq .
curl -sS http://54.88.193.115/api/sdr/analytics -H "$AUTH" | jq .
curl -sS http://54.88.193.115/api/sdr/enrollments -H "$AUTH" | jq .
curl -sS -X POST http://54.88.193.115/api/sdr/enroll/LEAD_ID \
  -H "$AUTH" -H "Content-Type: application/json" -d '{}' | jq .
curl -sS -X PATCH http://54.88.193.115/api/sdr/config/status \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"isActive":true}' | jq .
```

### Unsigned Stripe webhook (must fail)

```bash
curl -sS -i -X POST http://54.88.193.115/api/billing/webhook \
  -H "Content-Type: application/json" -d '{}'
```

### Key API map

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create user + org + workspace |
| POST | `/api/auth/login` | No | JWT |
| GET | `/api/billing` | JWT | Subscription + usage |
| GET | `/api/billing/plans` | JWT | Plan catalog |
| POST | `/api/billing/checkout` | JWT | Stripe Checkout session |
| POST | `/api/billing/portal` | JWT | Stripe Customer Portal |
| POST | `/api/billing/cancel-renewal` | JWT | cancel_at_period_end |
| POST | `/api/billing/resume-renewal` | JWT | resume |
| POST | `/api/billing/webhook` | Stripe sig | Billing events |
| GET/PUT | `/api/sdr/config` | JWT | Read/save SDR config |
| PATCH | `/api/sdr/config/status` | JWT | Activate/deactivate |
| GET | `/api/sdr/enrollments` | JWT | List enrollments |
| POST | `/api/sdr/enroll/:leadId` | JWT + tier | Manual enroll |
| GET | `/api/sdr/analytics` | JWT | SDR stats |
| GET | `/api/sdr/leads/:leadId/logs` | JWT | Execution log |
| POST | `/api/call/connect` | Twilio | TwiML connect |
| WS | `/api/call/stream/:sessionId` | Twilio stream | Audio pipeline |
| POST | `/api/webhooks/twilio/sms` | Twilio sig | Inbound SMS |
| POST | `/api/webhooks/twilio/call-status` | Twilio sig | Call status |
| POST | `/api/webhooks/email/reply` | Email provider | Inbound email |
| GET | `/api/admin/*` | Admin JWT | Operator tools |

---

*End of detailed QA runbook. Use §25 for demos; use §28 for every failure; do not sign §27 until P1s are closed.*
