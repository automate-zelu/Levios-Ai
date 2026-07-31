// ─── COMPLIANCE GUARDIAN ─────────────────────────────────────────────────────
// BLOCKING agent. Runs before any outreach. Checks DNC, quiet hours, consent,
// and call frequency. Cannot be overridden.
// Uses shared lib/compliance.ts (Module 8).

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";
import {
  evaluateQuietHours,
  isFrequencyLimitReached,
  lookupDnc,
  persistDncResult,
  MAX_CALL_ATTEMPTS_PER_WEEK,
} from "../../../lib/compliance.js";

export class ComplianceGuardianAgent extends BaseAgent {
  id = "compliance-guardian";
  name = "Compliance Guardian";
  tier = 3 as const;
  priority = 0; // always first
  isBlocking = true;
  timeout = 10_000;

  // Events that require compliance checks
  private readonly OUTREACH_EVENTS = [
    "outreach.sms.send",
    "outreach.email.send",
    "outreach.call.initiate",
    "outreach.voicemail.drop",
    "appointment.request",
  ];

  canHandle(event: ReactorEvent): boolean {
    return (
      event.type === "lead.created" ||
      event.type === "lead.imported" ||
      this.OUTREACH_EVENTS.includes(event.type)
    );
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const leadId = event.metadata.leadId || event.payload.leadId;
    if (!leadId) {
      return this.ok({ reason: "No lead — compliance N/A" });
    }

    // On lead creation/import: validate the lead
    if (event.type === "lead.created" || event.type === "lead.imported") {
      return this.validateLead(leadId, context);
    }

    // On outreach: run pre-outreach compliance checks
    return this.checkOutreach(leadId, event, context);
  }

  private async validateLead(leadId: number, context: AgentContext): Promise<AgentResult> {
    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");

    const dnc = await lookupDnc(lead.phone, lead.dncClean);

    if (!dnc.clean) {
      context.log("warn", `Lead ${leadId} is on DNC list — blocking`, { phone: lead.phone });
      await context.storage.updateLead(leadId, { dncClean: false } as any);
      return this.fail("Lead is on the Do Not Call registry", {
        leadStateTransition: "dnc_blocked",
        data: { dncClean: false, source: dnc.source },
      });
    }

    await context.storage.updateLead(leadId, {
      dncClean: true,
    } as any);

    return this.ok(
      { dncClean: true, validated: true, source: dnc.source },
      { leadStateTransition: "validating" }
    );
  }

  private async checkOutreach(leadId: number, event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const lead = await context.storage.getLead(leadId);
    if (!lead) return this.fail("Lead not found");

    // 1. DNC check (re-verify for outreach)
    if (lead.dncClean === false) {
      return this.fail("Lead is DNC blocked", { leadStateTransition: "dnc_blocked" });
    }

    // 2. Quiet hours check — lead timezone (Module 8)
    if (
      event.type === "outreach.sms.send" ||
      event.type === "outreach.call.initiate" ||
      event.type === "outreach.voicemail.drop"
    ) {
      const quiet = evaluateQuietHours({
        phone: lead.phone,
        timezone: (lead as any).timezone,
        dncClean: lead.dncClean,
        consentStatus: (lead as any).consentStatus,
      });
      if (!quiet.allowed) {
        return this.fail("Quiet hours — outreach blocked (8AM-9PM local only)", {
          data: {
            reason: "quiet_hours",
            retryAfter: quiet.nextAllowedAt?.toISOString() ?? null,
            detail: quiet.detail,
          },
        });
      }
    }

    // 3. Call frequency check (max 3 attempts per 7 days)
    if (event.type === "outreach.call.initiate" || event.type === "outreach.sms.send") {
      const attempts = (lead as any).outreachAttempts || 0;
      if (isFrequencyLimitReached(attempts, MAX_CALL_ATTEMPTS_PER_WEEK)) {
        context.log("warn", `Lead ${leadId} has ${attempts} outreach attempts — frequency limit reached`);
        return this.fail("Max outreach attempts reached (3 per 7-day period)", {
          data: { attempts, limit: MAX_CALL_ATTEMPTS_PER_WEEK },
        });
      }
    }

    // 4. Consent check
    if (event.type === "outreach.call.initiate" || event.type === "outreach.sms.send") {
      const consentStatus = (lead as any).consentStatus;
      if (consentStatus === "opted_out") {
        return this.fail("Lead has opted out", { leadStateTransition: "dnc_blocked" });
      }
    }

    // 5. Live DNC API scrub on call initiate when keyed
    if (event.type === "outreach.call.initiate") {
      const dnc = await lookupDnc(lead.phone, lead.dncClean);
      if (!dnc.clean) {
        await persistDncResult(leadId, false).catch(() => {});
        return this.fail("Lead is DNC blocked", {
          leadStateTransition: "dnc_blocked",
          data: { source: dnc.source },
        });
      }
    }

    return this.ok({ compliant: true });
  }
}
