// ─── BUDGET CONTROLLER ──────────────────────────────────────────────────────
// BLOCKING agent. Enforces low-side budget limits. Halts outreach when budget
// would be exceeded. Checks BEFORE any cost-incurring action.

import { BaseAgent } from "../base-agent.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// Estimated costs in cents per action
const ACTION_COSTS: Record<string, number> = {
  "outreach.sms.send": 1,          // $0.0079 → ~1 cent
  "outreach.email.send": 0,        // $0.001 → negligible
  "outreach.call.initiate": 24,    // $0.12/min × 2 min avg = $0.24 → 24 cents
  "outreach.voicemail.drop": 4,    // $0.04 → 4 cents
  "scoring.requested": 0,          // $0.003 → negligible
  "appointment.request": 0,        // cost is the per-appointment fee, handled separately
};

export class BudgetControllerAgent extends BaseAgent {
  id = "budget-controller";
  name = "Budget Controller";
  tier = 3 as const;
  priority = 1; // runs right after compliance
  isBlocking = true;
  timeout = 5_000;

  canHandle(event: ReactorEvent): boolean {
    return event.type in ACTION_COSTS || event.type === "appointment.confirmed";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const { monthlyRemaining, dailyRemaining } = await context.getBudgetRemaining(event.organizationId);

    // If no budget is set, allow everything
    if (monthlyRemaining === Infinity && dailyRemaining === Infinity) {
      return this.ok({ budgetCheck: "no_budget_set", unlimited: true });
    }

    // For appointment confirmation, check per-appointment cost
    if (event.type === "appointment.confirmed") {
      return this.checkAppointmentBudget(event, context, monthlyRemaining);
    }

    // For outreach actions, check operational costs
    const estimatedCostCents = ACTION_COSTS[event.type] || 0;
    if (estimatedCostCents === 0) {
      return this.ok({ budgetCheck: "no_cost", costCents: 0 });
    }

    // Low-side enforcement: projected_total must not exceed budget
    if (estimatedCostCents > monthlyRemaining) {
      context.log("warn", `Budget HARD STOP: monthly budget exhausted for org ${event.organizationId}`, {
        monthlyRemaining,
        estimatedCostCents,
      });
      return this.fail("Monthly budget exhausted — outreach halted", {
        leadStateTransition: "budget_stopped",
        data: { monthlyRemaining, estimatedCostCents, reason: "monthly_limit" },
      });
    }

    if (estimatedCostCents > dailyRemaining) {
      context.log("warn", `Budget HARD STOP: daily budget exhausted for org ${event.organizationId}`, {
        dailyRemaining,
        estimatedCostCents,
      });
      return this.fail("Daily budget exhausted — outreach halted", {
        leadStateTransition: "budget_stopped",
        data: { dailyRemaining, estimatedCostCents, reason: "daily_limit" },
      });
    }

    // Budget OK — record the estimated cost
    return this.ok(
      { budgetCheck: "approved", estimatedCostCents, monthlyRemaining, dailyRemaining },
      { costCents: estimatedCostCents }
    );
  }

  private async checkAppointmentBudget(
    event: ReactorEvent,
    context: AgentContext,
    monthlyRemaining: number
  ): Promise<AgentResult> {
    // Get the org's per-appointment cost
    const org = await context.storage.getOrganization(event.organizationId);
    const costPerAppt = (org as any)?.costPerAppointmentCents || 0;

    if (costPerAppt === 0) {
      return this.ok({ budgetCheck: "no_appointment_cost_set" });
    }

    // Low-side: will this appointment exceed the budget?
    if (costPerAppt > monthlyRemaining) {
      context.log("warn", `Budget HARD STOP: appointment cost ($${(costPerAppt / 100).toFixed(2)}) would exceed remaining budget ($${(monthlyRemaining / 100).toFixed(2)})`, {
        costPerAppt,
        monthlyRemaining,
      });

      // Emit notification event
      context.emit({
        type: "budget.exhausted",
        organizationId: event.organizationId,
        payload: { monthlyRemaining, costPerAppt },
        metadata: { priority: 1 },
      });

      return this.fail("Appointment would exceed monthly budget — blocked", {
        data: { costPerAppt, monthlyRemaining, reason: "appointment_budget" },
      });
    }

    return this.ok(
      { budgetCheck: "approved", costPerAppt, monthlyRemaining },
      { costCents: costPerAppt }
    );
  }
}
