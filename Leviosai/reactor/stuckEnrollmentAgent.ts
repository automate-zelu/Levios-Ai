// ─── SDR STUCK ENROLLMENT RECOVERY AGENT ─────────────────────────────────────
// Reactor agent that runs on the same 30-minute schedule as the dormant lead scan.
// Event type: "sdr.recovery.scan"
//
// On each run:
//   1. Calls recoverStuckEnrollments() across all workspaces
//   2. Per-enrollment errors are caught without crashing the full scan
//   3. Logs recovered count back to the Reactor result

import { BaseAgent } from "./agents/base-agent.js";
import { recoverStuckEnrollments } from "../lib/sdr-recovery.js";
import type { ReactorEvent, AgentResult, AgentContext } from "./types.js";

export class StuckEnrollmentAgent extends BaseAgent {
  id         = "sdr-stuck-enrollment-recovery";
  name       = "SDR Stuck Enrollment Recovery";
  tier       = 4 as const;  // Background/analytics tier, non-blocking
  priority   = 0;
  isBlocking = false;
  timeout    = 60_000;  // 1-minute timeout

  canHandle(event: ReactorEvent): boolean {
    return event.type === "sdr.recovery.scan";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    context.log("info", "SDR stuck enrollment recovery scan started");

    const { recovered } = await recoverStuckEnrollments();

    context.log("info", `SDR stuck enrollment recovery complete: ${recovered} enrollments recovered`);

    return this.ok({
      recovered,
      scannedAt: new Date().toISOString(),
    });
  }
}
