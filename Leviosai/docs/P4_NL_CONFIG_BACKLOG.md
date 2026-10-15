# P4.3 — Natural-language config (backlog)

**Status:** Parked — not required for P4 exit.  
**Ticket title:** NL → KB/config mutations with confirm + audit

## Problem

Operators want to say things like:

> “Add AC replacement as a service with a $189 diagnostic fee.”

…and have Catalyst update the knowledge base / agent config without opening the SDR editor.

## Proposed scope (later)

1. **Intent parse** — map NL to structured ops: `kb.append`, `kb.replace_section`, `prompt.patch`, `threshold.set`, `template.patch`.
2. **Confirm before write** — show a diff / preview; require explicit Apply.
3. **Audit log** — who said what, what changed, before/after hashes; retain ≥90 days.
4. **Safety rails** — no silent deletes; rate-limit; admin-only kill switch; never change billing via NL.
5. **One agent × many KBs** — mutations target the active workspace KB, not industry forks.

## Non-goals (P4)

- Shipping a chat console that writes config live.
- Auto-applying NL without confirmation.

## Acceptance (when pulled into a sprint)

- [ ] Spec + threat model reviewed with Anthony
- [ ] Confirm UI + audit trail
- [ ] Unit tests for intent → mutation mapping
- [ ] Feature flag default off
