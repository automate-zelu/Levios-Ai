# P4.2 — Levvi voice interaction spike

**Date:** 2026-10-15  
**Status:** Spike complete — recommend **defer** full voice onboarding pending Anthony decision gate.

## What we spiked

1. **Browser Web Speech API (TTS)** — shipped as `LevviSpeakButton` on the Levvi Welcome step.
   - Pros: zero cost, no API keys, works offline-ish after voices load, trivial UX.
   - Cons: voice quality varies by OS/browser; no conversational turn-taking; poor mobile Safari consistency; no STT pairing in this spike.

2. **Existing product voice path** — `TestCallStudio` + SDR voice / Realtime calling already handles live agent voice for leads.
   - Reusing that stack for *onboarding guidance* would mean a guided call script, not a wizard overlay.
   - Cost: per-minute Realtime / telephony; higher latency; needs mic permissions and quiet environment.

## Feasibility

| Approach | UX fit for wizard | Cost | Risk |
|----------|-------------------|------|------|
| Web Speech TTS (current) | Narrate steps only | ~$0 | Low; quality uneven |
| Web Speech STT + TTS | “Talk to Levvi” Q&A | ~$0 | Medium; accuracy, accents, iOS limits |
| OpenAI Realtime / Vapi-style | Conversational onboarding | High | High; cost, support burden, partial completion |
| Defer voice; keep text wizard | Best for P4 exit | $0 | None |

## Recommendation

- **Ship text Levvi wizard now** (P4.1). Keep the optional “Hear Levvi” TTS button as a demo of presence.
- **Defer** mic + STT / Realtime voice onboarding until after P5 external onboarding app discovery.
- **Decision gate for Anthony:** ship narrated TTS only, or fund a Realtime Levvi guide (estimate: 1–2 weeks + ongoing usage cost).

## UX risks if we expand voice now

- Users mid-form lose place when speech errors interrupt.
- Quiet-hours / office environments make mic awkward.
- Accessibility: must always keep full keyboard + visual path (WCAG).
- Partial setup if voice session drops — resume already solved for text steps.

## Next step

Anthony: choose **A)** TTS-only presence, **B)** STT+TTS browser spike v2, or **C)** defer all voice onboarding to post-P5.
