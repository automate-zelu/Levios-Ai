# P5 — External onboarding app ↔ Catalyst integration contract

**Audience:** Anthony (onboarding app) + Catalyst ops  
**Status:** Catalyst-side shipped; awaiting staging E2E with the external app  
**Principle:** One Catalyst, many knowledge bases. The external app collects intake; Catalyst owns org, workspace, Levvi, and SDR activation.

---

## Field ownership

| Field / concern | Owner | Notes |
|-----------------|-------|--------|
| Email, name, password | Catalyst `users` | Provision creates or links by email |
| Organization name, industry | Catalyst `organizations` | Prefill also written into Levvi draft |
| Workspace / SDR row | Catalyst `workspaces` (1:1 org) | Never created independently of org |
| Business / availability draft | Levvi localStorage → settings / booking prefs | Prefill via handoff JWT |
| Channels (calendar, Gmail, phone) | Catalyst OAuth / BYOT | Optional in Levvi; app may deep-link later |
| Knowledge base, prompts | Catalyst SDR config | Levvi Agent + Knowledge steps |
| Billing / Stripe | Catalyst | Not mutated by onboarding app |
| `externalOrgId` | Onboarding app | Sent on provision; echoed on webhooks |

Shared IDs: **`organizationId`** (int) and **`workspaceId`** (UUID). Always pass both after provision.

---

## Auth & security

| Secret | Purpose |
|--------|---------|
| `ONBOARDING_APP_API_KEY` | Service auth for provision / handoff / inbound events (`X-Onboarding-Api-Key`) |
| `ONBOARDING_APP_WEBHOOK_URL` | Catalyst → app outbound events |
| `ONBOARDING_APP_WEBHOOK_SECRET` | Optional header `X-Catalyst-Webhook-Secret` |
| `JWT_SECRET` | Signs session + handoff codes (same secret) |
| `APP_ORIGIN` / `PUBLIC_APP_URL` | Absolute handoff URLs |

- Handoff codes: JWT, purpose `catalyst_onboarding_handoff`, **15 min TTL**, **single-use** (`jti`).
- CORS: browser only hits `/exchange`; provision stays server-to-server.
- PII: minimize logs; do not put passwords in webhooks.

---

## API (Catalyst)

Base: same host as Catalyst CRM.

### `POST /api/integrations/onboarding/provision`

Header: `X-Onboarding-Api-Key: <key>`

```json
{
  "email": "owner@acme.com",
  "firstName": "Alex",
  "lastName": "Lee",
  "organizationName": "Acme HVAC",
  "industry": "HVAC",
  "path": "self_serve",
  "externalOrgId": "oa_123",
  "idempotencyKey": "oa_123",
  "prefill": {
    "companyName": "Acme HVAC",
    "industry": "HVAC",
    "timezone": "America/New_York",
    "weekdayStart": "09:00",
    "weekdayEnd": "17:00",
    "step": 4
  }
}
```

`path`: `self_serve` | `staff_assisted`

**Response (201 created / 200 existing):** `organizationId`, `workspaceId`, `userId`, `handoffCode`, `handoffUrl`, `temporaryPassword?`  
**Idempotent:** same email returns existing org + fresh handoff (no duplicate org).

### `POST /api/integrations/onboarding/handoff`

Mint a new code for an existing user (`email` or `userId` + optional `prefill`).

### `POST /api/integrations/onboarding/exchange` (public)

```json
{ "code": "<handoffCode>" }
```

→ Catalyst session `token` + `user` + `prefill`. Client lands on Levvi mid-wizard.

### `POST /api/integrations/onboarding/events`

Inbound ack from the app (`onboarding.completed`, etc.). Catalyst remains source of truth for `sdr.activated`.

---

## Webhooks (Catalyst → app)

`POST ONBOARDING_APP_WEBHOOK_URL`

| `type` | When |
|--------|------|
| `handoff.exchanged` | Client redeemed handoff |
| `onboarding.completed` | User finished Levvi (`/api/auth/onboarding/complete`) |
| `sdr.activated` / `sdr.deactivated` | SDR status toggle |

Payload includes `organizationId`, `workspaceId`, `userId`, `email`, `externalOrgId?`, `occurredAt`.

---

## Two paths

### Self-serve

1. App collects intake → `provision` (`path: self_serve`) + prefill  
2. Redirect browser to `handoffUrl`  
3. Catalyst exchanges code → Levvi (skips completed/prefilled steps)  
4. Client finishes Knowledge/launch → `onboarding.completed` + optional `sdr.activated`

### Staff-assisted

1. Staff (or app) `provision` with `path: staff_assisted`  
2. Ops shares `handoffUrl` (+ temp password if returned)  
3. Client continues remaining Levvi steps only  
4. Same completion webhooks

---

## Failure cases

| Case | Behavior |
|------|----------|
| Expired / bad code | `401` — show login + “request new handoff” |
| Reused code | `409` — mint new via `/handoff` |
| Duplicate email | `200` idempotent provision (no second org) |
| Partial setup | `onboardingComplete: false`; resume Levvi from stored step + draft |

---

## Env checklist (staging)

```bash
ONBOARDING_APP_API_KEY=...
ONBOARDING_APP_WEBHOOK_URL=https://onboarding-app.example/webhooks/catalyst
ONBOARDING_APP_WEBHOOK_SECRET=...
APP_ORIGIN=https://app.catalyst.example
JWT_SECRET=...
```

See also: `P5_OPS_RUNBOOK.md`.
