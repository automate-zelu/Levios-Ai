// ─── SDR DORMANT LEAD AGENT ──────────────────────────────────────────────────
// Reactor agent that triggers the SDR dormant lead scan.
// Event type: "sdr.dormant.scan"
// Schedule:   Every 30 minutes (emitted by server.ts via setInterval).
//
// On each run:
//   1. Calls scanDormantLeads() across all active workspaces
//   2. Respects per-workspace monthly tier limits — skips workspaces at limit
//   3. Per-lead errors are caught without crashing the full scan
//   4. Logs enrolled count back to the Reactor result

import { BaseAgent } from "./agents/base-agent.js";
import { scanDormantLeads } from "../lib/sdr-dormant.js";
import type { ReactorEvent, AgentResult, AgentContext } from "./types.js";

export class DormantLeadAgent extends BaseAgent {
  id         = "sdr-dormant-lead-scanner";
  name       = "SDR Dormant Lead Scanner";
  tier       = 4 as const;  // Tier 4 — background/analytics tier, non-blocking
  priority   = 0;
  isBlocking = false;
  timeout    = 120_000;  // 2-minute timeout — scanning all workspaces can take time

  canHandle(event: ReactorEvent): boolean {
    return event.type === "sdr.dormant.scan";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    context.log("info", "SDR dormant lead scan started");

    const result = await scanDormantLeads();

    context.log(
      "info",
      `SDR dormant lead scan complete: ${result.enrolled} enrolled (${result.reenrolled} re-enrolls), ` +
        `${result.skipped} skipped, ${result.workspacesSkippedLimit} workspaces at lead limit, ` +
        `${result.workspacesScanned} workspaces scanned`
    );

    return this.ok({
      ...result,
      scannedAt: new Date().toISOString(),
    });
  }
}
