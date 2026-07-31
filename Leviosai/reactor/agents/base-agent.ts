// ─── BASE AGENT ─────────────────────────────────────────────────────────────
// Abstract base class for all Reactor agents.
// Subclasses implement canHandle() and _execute().

import type { ReactorEvent, AgentResult, AgentContext, IAgent } from "../types.js";

export abstract class BaseAgent implements IAgent {
  abstract id: string;
  abstract name: string;
  abstract tier: 1 | 2 | 3 | 4;
  abstract priority: number;

  isBlocking: boolean = false;
  timeout: number = 30_000;

  abstract canHandle(event: ReactorEvent): boolean;
  protected abstract _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult>;

  async execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const start = Date.now();

    try {
      // Race between execution and timeout
      const result = await Promise.race([
        this._execute(event, context),
        this._timeoutPromise(event),
      ]);

      result.durationMs = Date.now() - start;
      return result;
    } catch (error: any) {
      const durationMs = Date.now() - start;
      context.log("error", `Agent ${this.id} failed on event ${event.type}: ${error.message}`, {
        eventId: event.id,
        agentId: this.id,
        error: error.message,
      });

      return {
        success: false,
        agentId: this.id,
        error: error.message,
        durationMs,
      };
    }
  }

  private _timeoutPromise(event: ReactorEvent): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Agent ${this.id} timed out after ${this.timeout}ms on event ${event.id}`));
      }, this.timeout);
    });
  }

  // Helper: create a success result
  protected ok(data?: Record<string, any>, extras?: Partial<AgentResult>): AgentResult {
    return {
      success: true,
      agentId: this.id,
      data,
      durationMs: 0, // filled in by execute()
      ...extras,
    };
  }

  // Helper: create a failure result
  protected fail(error: string, extras?: Partial<AgentResult>): AgentResult {
    return {
      success: false,
      agentId: this.id,
      error,
      durationMs: 0,
      ...extras,
    };
  }
}
