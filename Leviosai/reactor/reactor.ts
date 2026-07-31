// ─── THE REACTOR ────────────────────────────────────────────────────────────
// Event-driven orchestrator. Routes events between agents via priority queue.
// Singleton — access via Reactor.getInstance()

import crypto from "crypto";
import { eq, sql, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { leads, leadStateLog, budgetLedger, reactorEventLog, organizations } from "../lib/schema.js";
import { storage } from "../lib/storage.js";
import { createQueue, IPriorityQueue } from "./queue.js";
import { canTransition, toLegacyStatus } from "./state-machine.js";
import { eventBus } from "./event-bus.js";
import type {
  ReactorEvent,
  EmitEventInput,
  AgentResult,
  AgentContext,
  IAgent,
  ReactorStatus,
  LeadState,
} from "./types.js";

export class Reactor {
  private static instance: Reactor;

  private queue: IPriorityQueue = createQueue();
  private agents: IAgent[] = [];
  private running = false;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private startedAt: Date | null = null;
  private stats = { processed: 0, blocked: 0, errored: 0 };

  private constructor() {}

  static getInstance(): Reactor {
    if (!Reactor.instance) {
      Reactor.instance = new Reactor();
    }
    return Reactor.instance;
  }

  // ─── AGENT REGISTRATION ─────────────────────────────────────────────

  registerAgent(agent: IAgent): void {
    this.agents.push(agent);
    // Sort: blocking agents first within same tier, then by priority
    this.agents.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.isBlocking !== b.isBlocking) return a.isBlocking ? -1 : 1;
      return a.priority - b.priority;
    });
    console.log(`  🔌 Agent registered: ${agent.id} (tier ${agent.tier}, ${agent.isBlocking ? "BLOCKING" : "normal"})`);
  }

  registerAgents(agents: IAgent[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  // ─── EVENT EMISSION ─────────────────────────────────────────────────

  emit(input: EmitEventInput): string {
    const event: ReactorEvent = {
      id: crypto.randomUUID(),
      type: input.type,
      organizationId: input.organizationId,
      payload: input.payload,
      metadata: {
        leadId: input.metadata?.leadId,
        agentSource: input.metadata?.agentSource,
        correlationId: input.metadata?.correlationId || crypto.randomUUID(),
        parentEventId: input.metadata?.parentEventId,
        priority: input.metadata?.priority || 3,
        createdAt: new Date(),
        ttlMs: input.metadata?.ttlMs,
      },
    };

    Promise.resolve(this.queue.enqueue(event)).catch((err) =>
      console.error("Queue enqueue error:", err.message)
    );
    eventBus.emitTyped("event.enqueued", event);
    return event.id;
  }

  // ─── LIFECYCLE ──────────────────────────────────────────────────────

  start(tickMs = 100): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date();

    this.tickInterval = setInterval(() => this.tick(), tickMs);
    eventBus.emitTyped("reactor.started");
    console.log(`⚡ Reactor started (${this.agents.length} agents, ${tickMs}ms tick)`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = null;
    eventBus.emitTyped("reactor.stopped");
    console.log("⚡ Reactor stopped");
  }

  getStatus(): ReactorStatus {
    return {
      running: this.running,
      queueSize: 0, // async size not awaited here
      agentsLoaded: this.agents.map((a) => a.id),
      eventsProcessed: this.stats.processed,
      eventsBlocked: this.stats.blocked,
      eventsErrored: this.stats.errored,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
    };
  }

  // ─── TICK LOOP ──────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    try {
      const event = await Promise.resolve(this.queue.dequeue());
      if (!event) return;

      // Check TTL expiry
      if (event.metadata.ttlMs) {
        const age = Date.now() - event.metadata.createdAt.getTime();
        if (age > event.metadata.ttlMs) {
          await this.logEvent(event, [], "expired");
          return;
        }
      }

      await this.processEvent(event);
    } catch (err: any) {
      this.stats.errored++;
      console.error("⚠️  Reactor tick error:", err.message);
    }
  }

  // ─── EVENT PROCESSING ───────────────────────────────────────────────

  private async processEvent(event: ReactorEvent): Promise<void> {
    const start = Date.now();
    eventBus.emitTyped("event.processing", event);

    // Find agents that can handle this event
    const handlers = this.agents.filter((a) => a.canHandle(event));
    if (handlers.length === 0) {
      await this.logEvent(event, [], "processed");
      return;
    }

    const context = this.createContext(event);
    const results: AgentResult[] = [];
    const followUpEvents: EmitEventInput[] = [];

    for (const agent of handlers) {
      const result = await agent.execute(event, context);
      results.push(result);

      // Blocking agent failed = halt entire event
      if (agent.isBlocking && !result.success) {
        this.stats.blocked++;
        eventBus.emitTyped("event.blocked", event, agent.id, result.error || "blocked");

        // Apply state transition if the blocking agent requested one (e.g., dnc_blocked)
        if (result.leadStateTransition && event.metadata.leadId) {
          await this.doTransition(event.metadata.leadId, result.leadStateTransition, result.error || "blocked", agent.id, event.id);
        }

        await this.logEvent(event, results, "blocked");
        return;
      }

      // Collect follow-up events
      if (result.emitEvents) {
        for (const followUp of result.emitEvents) {
          followUpEvents.push({
            ...followUp,
            metadata: {
              ...followUp.metadata,
              parentEventId: event.id,
              correlationId: event.metadata.correlationId,
            },
          });
        }
      }

      // Apply state transition
      if (result.success && result.leadStateTransition && event.metadata.leadId) {
        await this.doTransition(event.metadata.leadId, result.leadStateTransition, `Agent ${agent.id}`, agent.id, event.id);
      }

      // Record cost
      if (result.success && result.costCents && result.costCents > 0) {
        await this.recordCost(event.organizationId, agent.id, event.id, event.type, result.costCents);
      }
    }

    // Enqueue follow-up events
    for (const followUp of followUpEvents) {
      this.emit(followUp);
    }

    this.stats.processed++;
    eventBus.emitTyped("event.processed", event, results);
    await this.logEvent(event, results, "processed");
  }

  // ─── AGENT CONTEXT ──────────────────────────────────────────────────

  private createContext(event: ReactorEvent): AgentContext {
    return {
      storage,
      emit: (input: EmitEventInput) => {
        this.emit({
          ...input,
          metadata: {
            ...input.metadata,
            parentEventId: event.id,
            correlationId: event.metadata.correlationId,
          },
        });
      },
      getLeadState: (leadId: number) => this.getLeadState(leadId),
      transitionLead: (leadId, toState, reason, agentId) =>
        this.doTransition(leadId, toState, reason, agentId, event.id),
      getBudgetRemaining: (orgId: number) => this.getBudgetRemaining(orgId),
      recordCost: (orgId, agentId, eventId, actionType, costCents) =>
        this.recordCost(orgId, agentId, eventId, actionType, costCents),
      log: (level, message, data) => {
        const prefix = `[Reactor:${event.type}]`;
        if (level === "error") console.error(prefix, message, data || "");
        else if (level === "warn") console.warn(prefix, message, data || "");
        else console.log(prefix, message, data || "");
      },
    };
  }

  // ─── STATE TRANSITIONS ──────────────────────────────────────────────

  private async getLeadState(leadId: number): Promise<LeadState | null> {
    const [lead] = await db
      .select({ reactorState: leads.reactorState })
      .from(leads)
      .where(eq(leads.id, leadId));
    return (lead?.reactorState as LeadState) || null;
  }

  private async doTransition(
    leadId: number,
    toState: LeadState,
    reason: string,
    agentId: string,
    eventId: string
  ): Promise<boolean> {
    const currentState = await this.getLeadState(leadId);
    if (!currentState) return false;

    if (!canTransition(currentState as LeadState, toState)) {
      console.warn(`⚠️  Invalid transition: ${currentState} → ${toState} for lead ${leadId}`);
      return false;
    }

    // Update lead
    await db
      .update(leads)
      .set({
        reactorState: toState,
        status: toLegacyStatus(toState),
        lastAgentId: agentId,
      })
      .where(eq(leads.id, leadId));

    // Write state log
    const [lead] = await db.select({ orgId: leads.organizationId }).from(leads).where(eq(leads.id, leadId));
    await db.insert(leadStateLog).values({
      leadId,
      organizationId: lead?.orgId,
      fromState: currentState,
      toState,
      reason,
      agentId,
      eventId,
    });

    eventBus.emitTyped("state.transition", leadId, currentState, toState, reason);
    return true;
  }

  // ─── BUDGET ─────────────────────────────────────────────────────────

  private async getBudgetRemaining(orgId: number): Promise<{ monthlyRemaining: number; dailyRemaining: number }> {
    const [org] = await db
      .select({
        monthlyBudgetCents: organizations.monthlyBudgetCents,
        dailyBudgetCents: organizations.dailyBudgetCents,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId));

    if (!org) return { monthlyRemaining: Infinity, dailyRemaining: Infinity };

    const today = new Date().toISOString().split("T")[0];
    const monthPrefix = today.substring(0, 7); // YYYY-MM

    const [dailySpend] = await db
      .select({ total: sql<number>`coalesce(sum(cost_cents), 0)::int` })
      .from(budgetLedger)
      .where(and(eq(budgetLedger.organizationId, orgId), eq(budgetLedger.dailyDate, today)));

    const [monthlySpend] = await db
      .select({ total: sql<number>`coalesce(sum(cost_cents), 0)::int` })
      .from(budgetLedger)
      .where(and(
        eq(budgetLedger.organizationId, orgId),
        sql`${budgetLedger.dailyDate} LIKE ${monthPrefix + "%"}`
      ));

    return {
      monthlyRemaining: (org.monthlyBudgetCents || Infinity) - (monthlySpend?.total || 0),
      dailyRemaining: (org.dailyBudgetCents || Infinity) - (dailySpend?.total || 0),
    };
  }

  private async recordCost(orgId: number, agentId: string, eventId: string, actionType: string, costCents: number): Promise<void> {
    const today = new Date().toISOString().split("T")[0];
    await db.insert(budgetLedger).values({
      organizationId: orgId,
      agentId,
      eventId,
      actionType,
      costCents,
      dailyDate: today,
    });
  }

  // ─── EVENT LOGGING ──────────────────────────────────────────────────

  private async logEvent(event: ReactorEvent, results: AgentResult[], status: string): Promise<void> {
    try {
      await db.insert(reactorEventLog).values({
        eventId: event.id,
        eventType: event.type,
        organizationId: event.organizationId,
        leadId: event.metadata.leadId,
        payload: JSON.stringify(event.payload),
        agentResults: JSON.stringify(results.map((r) => ({
          agentId: r.agentId,
          success: r.success,
          durationMs: r.durationMs,
          error: r.error,
        }))),
        status,
        processingMs: Date.now() - event.metadata.createdAt.getTime(),
      });
    } catch (err: any) {
      console.error("Failed to log reactor event:", err.message);
    }
  }
}
