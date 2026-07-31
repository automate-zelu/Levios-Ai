// ─── TYPED EVENT BUS ────────────────────────────────────────────────────────
// Internal pub/sub for Reactor components. Not for agent-to-agent communication
// (agents communicate through the event queue).

import { EventEmitter } from "events";
import type { ReactorEvent, AgentResult } from "./types.js";

export interface ReactorBusEvents {
  "event.enqueued": (event: ReactorEvent) => void;
  "event.processing": (event: ReactorEvent) => void;
  "event.processed": (event: ReactorEvent, results: AgentResult[]) => void;
  "event.blocked": (event: ReactorEvent, agentId: string, reason: string) => void;
  "event.errored": (event: ReactorEvent, error: Error) => void;
  "agent.timeout": (agentId: string, event: ReactorEvent) => void;
  "state.transition": (leadId: number, from: string, to: string, reason: string) => void;
  "reactor.started": () => void;
  "reactor.stopped": () => void;
}

class ReactorEventBus extends EventEmitter {
  emitTyped<K extends keyof ReactorBusEvents>(
    event: K,
    ...args: Parameters<ReactorBusEvents[K]>
  ): boolean {
    return this.emit(event, ...args);
  }

  onTyped<K extends keyof ReactorBusEvents>(
    event: K,
    listener: ReactorBusEvents[K]
  ): this {
    return this.on(event, listener as (...args: any[]) => void);
  }
}

// Singleton
export const eventBus = new ReactorEventBus();
eventBus.setMaxListeners(50);
