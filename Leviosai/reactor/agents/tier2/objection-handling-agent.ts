// ─── OBJECTION HANDLING AGENT ────────────────────────────────────────────────
// Agent 7: Classifies objections by category, generates industry-specific
// rebuttals, and records outcomes for learning.
// Ported from Python ObjectionAgent with categorization and feedback loop.

import { BaseAgent } from "../base-agent.js";
import { handleObjection } from "../../../lib/ai.js";
import { OBJECTION_PATTERNS } from "../../config.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// Rebuttal strategies per category (from Python agent_system.py)
const REBUTTAL_STRATEGIES: Record<string, string> = {
  price_too_high: `Address price concerns by focusing on ROI and value:
- Break down cost savings over time
- Compare to cost of NOT doing it (energy bills, repairs, etc.)
- Mention financing options if available
- Share specific dollar savings from recent customers`,

  not_interested: `Handle "not interested" by finding the REAL objection:
- Acknowledge their feeling: "I totally understand"
- Ask ONE diagnostic question: "Just curious — was it the timing, or something else?"
- If they give a reason, address THAT instead
- If firm, respect it and offer to be available later`,

  bad_timing: `Address timing concerns with flexibility:
- "Totally get it — when would be a better time?"
- Mention seasonal urgency if applicable
- Offer a no-pressure callback at their convenience
- "I'll send you a quick text in [timeframe] — sound good?"`,

  using_competitor: `Handle competitor objection without badmouthing:
- "Great that you're getting it handled!"
- Ask about their experience (find pain points)
- Differentiate on service, warranty, or reviews — not price
- Plant a seed: "If anything changes, we'd love to earn your business"`,

  need_to_think: `Handle "need to think" by reducing friction:
- "Of course — what questions can I answer to help you decide?"
- Offer a no-commitment next step (free estimate, quick call)
- "Most folks who think it over have questions about [common concern]"
- Set a follow-up: "Mind if I check back in a couple days?"`,

  spouse_decision: `Handle spouse/partner decision:
- "Absolutely — it's a big decision for both of you"
- Offer to include them: "Would it help if I sent some info you can review together?"
- Suggest a time when both can be on the line
- Don't push — respect the dynamic`,

  had_bad_experience: `Handle bad experience with empathy and differentiation:
- "I'm sorry to hear that — that's frustrating"
- Ask what happened (shows you care)
- Explain how you're different (reviews, warranty, guarantees)
- Offer something low-risk: free estimate, satisfaction guarantee`,
};

export class ObjectionHandlingAgent extends BaseAgent {
  id = "objection-handling";
  name = "Objection Handling Agent";
  tier = 2 as const;
  priority = 1;
  isBlocking = false;
  timeout = 30_000;

  canHandle(event: ReactorEvent): boolean {
    return event.type === "objection.detected" || event.type === "objection.feedback";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    if (event.type === "objection.feedback") {
      return this.recordFeedback(event, context);
    }

    const { objection, leadId } = event.payload;
    if (!objection) return this.fail("No objection text provided");

    // Step 1: Classify the objection
    const category = this.classifyObjection(objection);

    // Step 2: Get strategy for this category
    const strategy = REBUTTAL_STRATEGIES[category] || REBUTTAL_STRATEGIES["not_interested"];

    // Step 3: Build context from lead data
    let leadContext = event.payload.leadContext || "";
    if (leadId) {
      const lead = await context.storage.getLead(leadId);
      if (lead) {
        const org = await context.storage.getOrganization(event.organizationId);
        leadContext = `Lead: ${lead.firstName} ${lead.lastName}
Industry: ${(org as any)?.industry || "home services"}
Source: ${lead.source || "unknown"}
Current status: ${lead.status}
Previous interactions: ${(lead as any).outreachAttempts || 0} attempts
Their objection: "${objection}"

Strategy to use:
${strategy}`;
      }
    }

    // Step 4: Generate AI rebuttal with category-specific guidance
    const result = await handleObjection(objection, leadContext);

    // Step 5: Score signal — objections are actually a sign of engagement
    if (leadId) {
      context.emit({
        type: "scoring.signal",
        organizationId: event.organizationId,
        payload: { leadId, signal: "call_objection", value: 5 },
        metadata: { leadId, priority: 3, agentSource: this.id },
      });
    }

    // Step 6: Emit response for the channel agent to deliver
    const emitEvents: any[] = [];
    if (event.payload.channel && leadId) {
      emitEvents.push({
        type: "ai.generate_response",
        organizationId: event.organizationId,
        payload: {
          leadId,
          response: result.response,
          channel: event.payload.channel,
          context: "objection_rebuttal",
          category,
        },
        metadata: { leadId, priority: 2, agentSource: this.id },
      });
    }

    return this.ok(
      {
        category,
        response: result.response,
        strategy: result.strategy,
        confidence: this.getClassificationConfidence(objection, category),
      },
      { emitEvents }
    );
  }

  // ─── Objection Classification ─────────────────────────────────────────

  private classifyObjection(text: string): string {
    const lower = text.toLowerCase();
    let bestCategory = "not_interested";
    let bestMatchCount = 0;

    for (const [category, patterns] of Object.entries(OBJECTION_PATTERNS)) {
      const matchCount = patterns.filter((p) => lower.includes(p)).length;
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  private getClassificationConfidence(text: string, category: string): number {
    const patterns = OBJECTION_PATTERNS[category] || [];
    const lower = text.toLowerCase();
    const matchCount = patterns.filter((p) => lower.includes(p)).length;

    if (matchCount >= 3) return 0.95;
    if (matchCount === 2) return 0.8;
    if (matchCount === 1) return 0.6;
    return 0.3;
  }

  // ─── Feedback Loop (for learning agent) ───────────────────────────────

  private async recordFeedback(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const { leadId, category, outcome } = event.payload;
    // outcome: "accepted" | "rejected" | "escalated"

    context.log("info", `Objection feedback: lead ${leadId}, category ${category}, outcome: ${outcome}`);

    // Log for the learning agent to process
    if (leadId) {
      await context.storage.logActivity({
        entityType: "lead",
        entityId: leadId,
        action: "objection_feedback",
        details: JSON.stringify({ category, outcome }),
        organizationId: event.organizationId,
      });
    }

    return this.ok({ recorded: true, category, outcome });
  }
}
