// ─── ANALYTICS & REPORTING AGENT ─────────────────────────────────────────────
// Listens to key events and logs them for dashboard/reporting.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

export class AnalyticsAgent extends BaseAgent {
  id = "analytics";
  name = "Analytics & Reporting";
  tier = 4 as const;
  priority = 1;
  isBlocking = false;
  timeout = 5_000;

  private readonly TRACKED_EVENTS = [
    "lead.created",
    "lead.imported",
    "scoring.complete",
    "outreach.result",
    "appointment.confirmed",
    "deal.closed",
    "budget.exhausted",
    "lead.opted_out",
  ];

  canHandle(event: ReactorEvent): boolean {
    return this.TRACKED_EVENTS.includes(event.type);
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    // Log activity for the dashboard
    const leadId = event.metadata.leadId || event.payload.leadId;

    if (leadId) {
      await context.storage.logActivity({
        entityType: "lead",
        entityId: leadId,
        action: `reactor.${event.type}`,
        details: JSON.stringify(event.payload),
        organizationId: event.organizationId,
      });
    }

    return this.ok({ tracked: true, eventType: event.type });
  }
}
