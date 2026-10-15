# P5 — Ops runbook (external onboarding handoff)

## Before go-live

1. Set `ONBOARDING_APP_API_KEY` (long random) in Catalyst staging + prod.  
2. Share the key with the onboarding-app team via a secrets manager (not Slack).  
3. Set `ONBOARDING_APP_WEBHOOK_URL` to their receiver; optional `ONBOARDING_APP_WEBHOOK_SECRET`.  
4. Set `APP_ORIGIN` to the public Catalyst URL (no trailing slash).  
5. Smoke: `curl` provision → open `handoffUrl` in a private window → land in Levvi.

## Staff-assisted onboard

1. Call provision with `path: "staff_assisted"` (or use onboarding-app UI).  
2. Copy `handoffUrl` from the response.  
3. If `temporaryPassword` is present, send it securely (password manager / SMS — not email alone if policy requires).  
4. Client opens link once within 15 minutes. If expired, re-mint with `POST .../handoff`.  
5. Confirm webhook `onboarding.completed` after they finish Levvi.

## Common failures

| Symptom | Fix |
|---------|-----|
| `503` “integration disabled” | Set `ONBOARDING_APP_API_KEY` and restart |
| `401` on provision | Wrong API key header |
| `Handoff expired or invalid` | Re-mint `/handoff`; check clock skew |
| `Handoff code already used` | Re-mint; each code is single-use |
| User stuck on Welcome | Prefill missing — include company/industry/timezone in provision |
| Duplicate org worry | Safe — email is idempotent; check `created: false` |

## Rollback

- Unset `ONBOARDING_APP_API_KEY` → provision/handoff/events return 503; exchange still validates old codes until expiry.  
- Clients can still register via Catalyst `/register` (Levvi-only path).
