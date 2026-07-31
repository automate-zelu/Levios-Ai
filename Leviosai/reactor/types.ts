// ─── REACTOR TYPES ──────────────────────────────────────────────────────────
// All shared types for the Reactor agent orchestrator

import { storage } from "../lib/storage.js";

// ─── LEAD STATES ────────────────────────────────────────────────────────────

export type LeadState =
  | "new"
  | "validating"
  | "ready"
  | "outreach_queued"
  | "contacted"
  | "engaged"
  | "appointment_set"
  | "showed"
  | "won"
  | "lost"
  | "error"
  | "dnc_blocked"
  | "budget_stopped";

// ─── EVENTS ─────────────────────────────────────────────────────────────────

export type EventPriority = 1 | 2 | 3 | 4 | 5;

export interface ReactorEvent {
  id: string;
  type: string;
  organizationId: number;
  payload: Record<string, any>;
  metadata: {
    leadId?: number;
    agentSource?: string;
    correlationId: string;
    parentEventId?: string;
    priority: EventPriority;
    createdAt: Date;
    ttlMs?: number;
  };
}

// Simplified event creation (Reactor fills in the rest)
export interface EmitEventInput {
  type: string;
  organizationId: number;
  payload: Record<string, any>;
  metadata?: {
    leadId?: number;
    agentSource?: string;
    correlationId?: string;
    parentEventId?: string;
    priority?: EventPriority;
    ttlMs?: number;
  };
}

// ─── AGENT INTERFACE ────────────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  agentId: string;
  data?: Record<string, any>;
  emitEvents?: EmitEventInput[];
  leadStateTransition?: LeadState;
  costCents?: number;
  error?: string;
  durationMs: number;
}

export interface AgentContext {
  storage: typeof storage;
  emit: (event: EmitEventInput) => void;
  getLeadState: (leadId: number) => Promise<LeadState | null>;
  transitionLead: (leadId: number, toState: LeadState, reason: string, agentId: string) => Promise<boolean>;
  getBudgetRemaining: (organizationId: number) => Promise<{ monthlyRemaining: number; dailyRemaining: number }>;
  recordCost: (organizationId: number, agentId: string, eventId: string, actionType: string, costCents: number) => Promise<void>;
  log: (level: "info" | "warn" | "error", message: string, data?: any) => void;
}

export interface IAgent {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  priority: number;       // lower = runs first within tier
  isBlocking: boolean;     // true = can halt event processing
  timeout: number;         // ms

  canHandle(event: ReactorEvent): boolean;
  execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult>;
}

// ─── REACTOR STATUS ─────────────────────────────────────────────────────────

export interface ReactorStatus {
  running: boolean;
  queueSize: number;
  agentsLoaded: string[];
  eventsProcessed: number;
  eventsBlocked: number;
  eventsErrored: number;
  uptimeMs: number;
}
