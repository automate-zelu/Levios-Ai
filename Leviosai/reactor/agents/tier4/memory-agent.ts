// ─── MEMORY AGENT ───────────────────────────────────────────────────────────
// Maintains persistent cross-channel conversation context per lead.
// Uses PostgreSQL for now; will add Redis caching with Upstash later.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class MemoryAgent extends BaseAgent {
  id = "memory";
  name = "Memory Agent";
  tier = 4 as const;
  priority = 2;
  isBlocking = false;
  timeout = 5_000;

  canHandle(event: ReactorEvent): boolean {
    return (
      event.type === "message.inbound" ||
      event.type === "outreach.result" ||
      event.type === "reply.received" ||
      event.type === "objection.detected"
    );
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) return this.ok({ stored: false, reason: "no_lead" });

    // TODO: Store structured memory in agent_memory table
    // TODO: Add Redis caching layer with Upstash
    // For now, activity log serves as memory

    await context.storage.logActivity({
      entityType: "lead",
      entityId: leadId,
      action: `memory.${event.type}`,
      details: JSON.stringify({
        channel: event.payload.channel,
        content: event.payload.content?.substring(0, 200),
        sentiment: event.payload.sentiment,
        timestamp: new Date().toISOString(),
      }),
      organizationId: event.organizationId,
    });

    return this.ok({ stored: true, leadId });
  }
}
