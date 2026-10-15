# P4.2 — Levvi voice interaction spike

**Date:** 2026-10-15  
**Decision gate:** Ship browser voice onboarding now, or defer to P5 / Realtime.

## What we spiked

| Layer | Approach | Status |
|-------|----------|--------|
| **TTS (speak Levvi)** | Web Speech API `speechSynthesis` on Welcome step (`LevviSpeakButton`) | Shipped as optional UI control |
| **STT (hear user)** | `SpeechRecognition` / `webkitSpeechRecognition` | Feasible in Chrome/Safari; not wired (noise + permissions) |
| **Realtime voice agent** | OpenAI Realtime / Deepgram + existing `TestCallStudio` | Deferred — heavier cost + latency |

## Feasibility

- **Browser TTS:** Zero API cost, works offline-ish after voices load, quality varies by OS. Good for “Levvi says hi,” not for long guided dialogs.
- **Browser STT:** Needs mic permission; flaky on iOS Safari; language packs differ. Fine for demos, weak for production onboarding.
- **Realtime:** Best UX (interruptible, natural), but adds token cost per session, WebRTC complexity, and compliance (recording consent). Reuse call studio patterns when greenlit.

## UX / product risks

1. Auto-play voice on first login feels intrusive — keep **opt-in** (“Hear Levvi”).
2. Accessibility: always provide text equivalent (already the case).
3. Enterprise clients may block mic in locked-down browsers.
4. Voice guiding every step doubles QA surface (visual + audio).

## Recommendation

**Defer full voice onboarding.** Keep the Welcome TTS spike as a demo affordance. Revisit after Anthony’s decision gate:

- **Ship lite:** Keep TTS button + optional STT on one step only.
- **Defer:** Remove spike button before public release; park Realtime under P5.

## Cost sketch (Realtime path)

- ~$0.06–0.30 / short onboarding session (provider-dependent) at low volume is fine; at scale prefer TTS-only or skip voice.
