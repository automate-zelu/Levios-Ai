// ─── AGENT REGISTRY ─────────────────────────────────────────────────────────
// Collects and exports all 17 agents for the Reactor.

import type { IAgent } from "../types.js";

// Tier 1 — Outreach
import { SmsAgent } from "./tier1/sms-agent.js";
import { EmailAgent } from "./tier1/email-agent.js";
import { VoiceAgent } from "./tier1/voice-agent.js";
import { VoicemailDropAgent } from "./tier1/voicemail-drop-agent.js";
import { AppointmentBookingAgent } from "./tier1/appointment-booking-agent.js";

// Tier 2 — Intelligence
import { LeadScoringAgent } from "./tier2/lead-scoring-agent.js";
import { ObjectionHandlingAgent } from "./tier2/objection-handling-agent.js";
import { KnowledgeBaseAgent } from "./tier2/knowledge-base-agent.js";
import { SentimentIntentAgent } from "./tier2/sentiment-intent-agent.js";

// Tier 3 — Operations
import { ComplianceGuardianAgent } from "./tier3/compliance-guardian-agent.js";
import { BudgetControllerAgent } from "./tier3/budget-controller-agent.js";
import { RoutingAgent } from "./tier3/routing-agent.js";
import { DataIngestionAgent } from "./tier3/data-ingestion-agent.js";
import { WebhookHandlerAgent } from "./tier3/webhook-handler-agent.js";

// Tier 4 — Learning & Analytics
import { LearningAgent } from "./tier4/learning-agent.js";
import { AnalyticsAgent } from "./tier4/analytics-agent.js";
import { MemoryAgent } from "./tier4/memory-agent.js";

// SDR — Dormant Lead Scanner
import { DormantLeadAgent } from "../dormantLeadAgent.js";

// SDR — Stuck Enrollment Recovery
import { StuckEnrollmentAgent } from "../stuckEnrollmentAgent.js";

export function createAllAgents(): IAgent[] {
  return [
    // Tier 3 — Operations (loaded first, blocking agents run first)
    new ComplianceGuardianAgent(),
    new BudgetControllerAgent(),
    new RoutingAgent(),
    new DataIngestionAgent(),
    new WebhookHandlerAgent(),

    // Tier 2 — Intelligence
    new LeadScoringAgent(),
    new ObjectionHandlingAgent(),
    new KnowledgeBaseAgent(),
    new SentimentIntentAgent(),

    // Tier 1 — Outreach
    new SmsAgent(),
    new EmailAgent(),
    new VoiceAgent(),
    new VoicemailDropAgent(),
    new AppointmentBookingAgent(),

    // Tier 4 — Learning & Analytics
    new LearningAgent(),
    new AnalyticsAgent(),
    new MemoryAgent(),

    // SDR — Dormant Lead Scanner (scheduled via server.ts setInterval)
    new DormantLeadAgent(),

    // SDR — Stuck Enrollment Recovery (scheduled via server.ts setInterval)
    new StuckEnrollmentAgent(),
  ];
}
