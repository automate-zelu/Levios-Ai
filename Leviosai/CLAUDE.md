# Leviosai CRM — Project Memory

## What This Is
A production CRM + AI SDR SaaS (Catalyst v2 → Leviosai) originally built as a Claude Artifact, now running as a standalone Vite + Express + TypeScript fullstack app. Multi-tenant: each organization gets a workspace with SDR agent, AI calling pipeline, and BYOT Twilio.

## Owner
- **Company:** Leviosai
- **Contact:** Christian — christian@leviosai.io
- **GitHub:** LeviosaiCOO/Leviosai

## Stack
- **Frontend:** React (Vite), JSX, served via Express middleware (dev) or static `client/dist` (prod)
- **Backend:** Express + TypeScript, run with `tsx watch server.ts`
- **Database:** PostgreSQL via Supabase, Drizzle ORM
- **Queue:** BullMQ + Redis (job scheduling for SDR sequences)
- **Auth:** JWT (jsonwebtoken + bcryptjs), tokens stored in localStorage as `catalyst_token`
- **Deployment:** Railway via Nixpacks builder
- **Dev port:** 3000

## Running Locally
```bash
npm run dev        # starts tsx watch server.ts on port 3000
```
launch.json points to `npm run dev` on port 3000 — use `preview_start` tool with name `"dev"`.

## Environment Variables (.env)
All secrets in `.env` (gitignored) and Railway environment variables.

**Core:**
`DATABASE_URL`, `PORT`, `JWT_SECRET`

**Twilio (master / BYOT):**
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
`TWILIO_MASTER_SID`, `TWILIO_MASTER_AUTH_TOKEN` — master account for BYOT sub-account creation
`TWILIO_WEBHOOK_SECRET` — optional HMAC secret for generic webhooks

**AI / Calling Pipeline:**
`OPENAI_API_KEY` — GPT-4o for SDR conversation agent (LangChain)
`DEEPGRAM_API_KEY` — real-time STT for AI calling
`ELEVENLABS_API_KEY` — TTS voice synthesis for AI calling
`ANTHROPIC_API_KEY` — Claude AI for lead scoring / message gen / objection handling

**Infrastructure:**
`REDIS_URL` — BullMQ job queue (required for SDR sequences)
`ENCRYPTION_KEY` — AES-256 key for encrypting BYOT Twilio credentials at rest
`BASE_URL` — public HTTPS URL (e.g. `https://leviosai.up.railway.app`) — used in Twilio webhook URLs

**Email / Billing / Monitoring:**
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`
`SENTRY_DSN`

## Database — Supabase
- **Host:** Supabase connection pooler (port 6543, NOT the direct host)
- **User:** dotted username format — must use `new URL()` parse in db.ts, not raw pg connection string
- db.ts uses explicit host/user/password/port fields to avoid pg stripping the dotted username
- All credentials in `.env` and Railway env vars

## Railway Deployment
- Builder: Nixpacks (NOT Dockerfile)
- Start command: `npx tsx server.ts`
- Health check: `/api/health` — returns `{status, services, timestamp, version}`; 503 if DB down
- Deploy: `railway up` from project root
- Set env vars: `railway vars set "KEY=value"`
- Login expires often — may need `railway login` before commands

## Key Files
| File | Purpose |
|------|---------|
| `server.ts` | Entry point, mounts all routes, Vite middleware, Sentry init, WebSocket upgrade for AI calling |
| `lib/db.ts` | pg Pool with URL parsing fix |
| `lib/schema.ts` | Drizzle schema — users, organizations, leads, workspaces, sdrConfigs, sdrEnrollments, sdrCallSessions, etc. |
| `lib/storage.ts` | All DB query functions (org-scoped) |
| `lib/twilio.ts` | SMS + voice, graceful degradation |
| `lib/resend.ts` | Email via Resend, graceful degradation |
| `lib/ai.ts` | Claude AI — lead scoring, message gen, objection handling |
| `lib/stripe.ts` | Stripe billing — checkout, portal, webhook + workspace SDR activation on subscription events |
| `lib/rate-limit.ts` | Rate limiters (auth, API, AI, messaging) |
| `lib/sentry.ts` | Sentry error monitoring init |
| `lib/redis.ts` | BullMQ Redis connection + `isRedisReady()` health check |
| `lib/crypto.ts` | AES-256-GCM encrypt/decrypt for BYOT credentials |
| `lib/sdr-state-machine.ts` | SDR enrollment state transitions (new→calling→sms_sent→email_sent→exhausted/booked) |
| `lib/sdr-queue.ts` | BullMQ job helpers: `enqueueJob`, `cancelJob` |
| `lib/sdr-admin.ts` | Workspace provisioning: `setWorkspaceActive`, `changeWorkspaceTier`, `resetWorkspaceUsage` |
| `lib/calling/audio-pipeline.ts` | Full AI calling pipeline — Deepgram STT → LangChain agent → ElevenLabs TTS |
| `lib/calling/call-orchestrator.ts` | Orchestrates outbound calls — DNC/consent check, Twilio dial, session creation |
| `lib/calling/elevenlabs-client.ts` | ElevenLabs TTS client + voice listing |
| `routes/auth.ts` | POST /api/auth/register, /login, GET /api/auth/me + `requireAuth` middleware |
| `routes/billing.ts` | Stripe checkout, portal, billing status, webhook |
| `routes/webhooks.ts` | Twilio inbound SMS (+ SDR reply gate) + call status + SendGrid email reply webhook |
| `routes/messaging.ts` | SMS, email, call endpoints |
| `routes/ai.ts` | AI scoring, message generation, objection endpoints |
| `routes/call.ts` | AI calling routes — TwiML connect, WebSocket stream, status/recording callbacks, session history, analytics |
| `routes/sdr.ts` | SDR workspace management — configs, enrollments, analytics |
| `routes/admin.ts` | Internal admin — org/workspace management, usage stats |
| `routes/twilio-byot.ts` | BYOT Twilio — sub-account creation, phone number provisioning, credential storage |
| `middleware/workspaceScope.ts` | Resolves `req.workspace` from JWT — enforces `isActive` + tier limits |
| `middleware/twilioSignature.ts` | Validates `X-Twilio-Signature` on inbound webhooks — per-workspace BYOT token resolution |
| `client/src/api.js` | Full frontend API client with token management |
| `client/src/App.jsx` | Main React app — all pages, real API wiring |

## API Endpoints Summary
**Auth (no auth required):**
- `POST /api/auth/register` — create user + org, returns JWT
- `POST /api/auth/login` — returns JWT
- `GET /api/auth/me` — restore session

**Protected (requires Bearer token):**
- `GET /api/dashboard` — stats with SDR analytics (org-scoped)
- `GET /api/leads` — list with status/search filters (org-scoped)
- `POST /api/leads/:id/sms` — send SMS via Twilio
- `POST /api/leads/:id/email` — send email via Resend
- `POST /api/leads/:id/call` — initiate Twilio voice call
- `POST /api/leads/:id/score` — AI lead scoring
- `POST /api/leads/:id/generate-message` — AI message generation
- `POST /api/ai/objection` — AI objection handling
- `POST /api/leads/score-all` — batch score up to 10 leads
- `GET /api/integrations/status` — `{twilio, resend}`
- `GET /api/billing` — current plan + subscription status
- `GET /api/billing/plans` — available plans
- `POST /api/billing/checkout` — create Stripe checkout session
- `POST /api/billing/portal` — create Stripe billing portal session

**SDR (requires auth + workspace scope):**
- `GET /api/sdr/config` — workspace SDR configuration
- `PATCH /api/sdr/config` — update SDR config (voice, timing, scripts)
- `GET /api/sdr/enrollments` — list active enrollments with lead join
- `POST /api/sdr/enroll` — enroll a lead into the SDR sequence
- `DELETE /api/sdr/enrollments/:id` — unenroll lead
- `GET /api/sdr/analytics` — monthly stats (calls, SMS, emails, booked, reply rates)

**AI Calling (requires auth + workspace scope):**
- `GET /api/call/sessions` — paginated call history (with lead name/phone via JOIN)
- `GET /api/call/sessions/:id` — single session with transcript, recording, AI summary
- `GET /api/call/voices` — ElevenLabs voice list for dropdown
- `GET /api/call/analytics` — call funnel metrics (answer rate, booking rate, avg duration)

**Admin (internal — separate auth):**
- `GET /api/admin/orgs` — list all organizations
- `GET /api/admin/workspaces` — list all workspaces with usage
- `POST /api/admin/workspaces/:id/activate` — activate workspace
- `POST /api/admin/workspaces/:id/deactivate` — deactivate workspace
- `POST /api/admin/workspaces/:id/tier` — change workspace tier

**BYOT Twilio (requires auth):**
- `POST /api/twilio/provision` — create Twilio sub-account + buy number, store encrypted creds
- `GET /api/twilio/status` — workspace Twilio provisioning status

**Webhooks (no auth — called by external services):**
- `POST /api/billing/webhook` — Stripe: activates/deactivates workspace SDR on subscription events, resets usage on invoice.paid
- `POST /api/webhooks/twilio/sms` — inbound SMS: stores CRM message, cancels SMS_TIMEOUT job, transitions enrollment to sms_replied
- `POST /api/webhooks/twilio/call-status` — call status updates, routes to Reactor
- `POST /api/webhooks/twilio/voice` — TwiML for outbound calls
- `POST /api/webhooks/email/reply` — SendGrid inbound parse: cancels EMAIL_TIMEOUT job, transitions enrollment to email_replied
- `POST /api/call/connect/:sessionId` — TwiML: opens bidirectional media stream (Twilio signs this)
- `POST /api/call/status/:sessionId` — Twilio call completion callback (updates duration, transitions state machine)
- `POST /api/call/recording/:sessionId` — Twilio recording ready callback

**Public:**
- `GET /api/ai/status` — `{configured}`
- `GET /api/health` — per-service health: `{status, services:{database,redis,twilio,deepgram,openai,elevenlabs,anthropic,resend,stripe}, timestamp, version}` — HTTP 503 if DB down

## Integrations Status
- ✅ **Twilio** — SMS + voice + BYOT sub-accounts, signature validation on all webhooks
- ✅ **Claude AI (Anthropic)** — lead scoring, message generation, objection handling (model: claude-sonnet-4-20250514)
- ✅ **OpenAI** — GPT-4o SDR conversation agent via LangChain
- ✅ **Deepgram** — real-time STT in AI calling pipeline
- ✅ **ElevenLabs** — TTS voice synthesis in AI calling pipeline
- ✅ **Stripe** — checkout, billing portal, webhook activates/deactivates workspace SDR
- ✅ **BullMQ/Redis** — job scheduling for SDR sequences (SMS/email timeouts, call retries)
- ⚠️ **Resend** — API key set, but `leviosai.io` domain needs DNS verification in Resend dashboard
  - DNS provider: **Netlify**
  - Go to resend.com/domains → Add Domain → add TXT records in Netlify DNS settings

## SDR Architecture
Multi-step outreach sequence per lead enrollment:
1. `new` → `INITIATE_CALL` job → AI call placed via Twilio + Deepgram + LangChain + ElevenLabs
2. Call outcomes: `booked` (done), `no_answer`/`busy` → `SEND_SMS` job after configurable wait
3. `sms_sent` → `SMS_TIMEOUT` job → if no reply within window → `SEND_EMAIL` job
4. `email_sent` → `EMAIL_TIMEOUT` job → if no reply → `exhausted`
5. Inbound SMS reply → cancels `SMS_TIMEOUT`, transitions to `sms_replied`
6. Inbound email reply (SendGrid parse) → cancels `EMAIL_TIMEOUT`, transitions to `email_replied`
7. DNC/consent check before every call: `dncClean === false` → skip call, go to SMS; `consentStatus === "opted_out"` → exhaust enrollment

**State machine transitions** (`lib/sdr-state-machine.ts`):
`new → calling → call_answered → booked`
`calling → call_no_answer → sms_sent → sms_replied`
`sms_sent → email_sent → email_replied`
`* → exhausted`

**Workspace tiers** (via `lib/sdr-admin.ts`):
| Tier | Lead limit | Call minutes/mo |
|------|-----------|-----------------|
| starter | 25 | 30 |
| growth | 500 | 300 |
| enterprise | unlimited | unlimited |

**Stripe → SDR tier mapping:**
`free → starter`, `pro → growth`, `enterprise → enterprise`

## Twilio Signature Validation
`middleware/twilioSignature.ts` validates `X-Twilio-Signature` on all inbound Twilio webhooks:
- Skipped on `localhost` / `NODE_ENV !== production`
- SMS webhooks: resolve token by workspace `twilioPhoneNumber` from `req.body.To`
- Call session webhooks: resolve token by session ID → workspace
- Falls back to `TWILIO_AUTH_TOKEN` / `TWILIO_MASTER_AUTH_TOKEN` env vars
- No token found → logs warning, allows through (so misconfigured envs don't break prod silently)

## Lead Status Mapping (Frontend ↔ Backend)
| Frontend Label | Backend Value |
|----------------|---------------|
| Dead | lost |
| Aged | contacted |
| Revived | qualified |

## Completed Phases
- **Phase 1** — Frontend ↔ backend wiring, real JWT auth, session restore, all pages hooked to real APIs
- **Phase 2** — Twilio SMS/voice, Resend email, Claude AI integrations (all with graceful degradation)
- **Phase 3** — Rate limiting, multi-tenant org auth, Stripe billing, Twilio webhooks, Sentry error monitoring
- **M1** — SDR state machine, BullMQ job queue, sdrEnrollments + sdrConfigs schema, sequence runner
- **M2** — AI calling pipeline: Deepgram STT + LangChain GPT-4o agent + ElevenLabs TTS + Twilio Voice Stream WebSocket
- **M3** — SDR Config Panel UI (voice, timing, scripts), SDR enrollment management, BYOT Twilio provisioning
- **M4** — CallingPanel UI, SDR History tab in lead detail, SDR + call analytics on Dashboard
- **M5** — Inbound SMS→SDR integration, SendGrid email reply webhook, DNC/consent gate, Twilio signature validation on all webhooks
- **M6** — Stripe→workspace SDR activation on all subscription events, enhanced `/api/health` endpoint, CLAUDE.md documentation update

## Pending / Next Up
- [ ] Customer onboarding flow
- [ ] Admin dashboard UI (usage, billing, org management)
- [ ] CRM OAuth integrations (HubSpot, Salesforce)
- [ ] Custom domain on Railway
- [ ] Verify leviosai.io domain in Resend dashboard (add DNS TXT records in Netlify)
