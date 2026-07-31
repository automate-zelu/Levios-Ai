// ─── LEAD STATE MACHINE ─────────────────────────────────────────────────────
// Pure-function state machine. Defines valid transitions and enforces them.

import type { LeadState } from "./types.js";

// Valid transitions: state → [allowed next states]
const TRANSITIONS: Record<LeadState, LeadState[]> = {
  new:              ["validating", "error", "dnc_blocked"],
  validating:       ["ready", "error", "dnc_blocked"],
  ready:            ["outreach_queued", "error", "dnc_blocked", "budget_stopped"],
  outreach_queued:  ["contacted", "error", "dnc_blocked", "budget_stopped"],
  contacted:        ["engaged", "lost", "error", "dnc_blocked", "budget_stopped"],
  engaged:          ["appointment_set", "lost", "error", "dnc_blocked", "budget_stopped"],
  appointment_set:  ["showed", "lost", "error", "dnc_blocked"],
  showed:           ["won", "lost", "error"],
  won:              [],  // terminal
  lost:             ["new"],  // can re-enter pipeline
  error:            ["new", "validating"],  // can retry
  dnc_blocked:      [],  // terminal — only manual override
  budget_stopped:   ["ready", "outreach_queued"],  // resumes when budget refills
};

export function canTransition(from: LeadState, to: LeadState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(from: LeadState): LeadState[] {
  return TRANSITIONS[from] || [];
}

export function isTerminalState(state: LeadState): boolean {
  return TRANSITIONS[state]?.length === 0;
}

// Map new reactor states to legacy frontend status values
export function toLegacyStatus(reactorState: LeadState): string {
  switch (reactorState) {
    case "new":
    case "validating":
      return "new";
    case "ready":
    case "outreach_queued":
    case "contacted":
      return "contacted";
    case "engaged":
      return "qualified";
    case "appointment_set":
    case "showed":
      return "proposal";
    case "won":
      return "won";
    case "lost":
    case "error":
    case "dnc_blocked":
    case "budget_stopped":
      return "lost";
    default:
      return "new";
  }
}
