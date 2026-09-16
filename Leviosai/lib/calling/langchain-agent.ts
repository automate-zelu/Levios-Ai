// ─── LANGCHAIN CONVERSATION AGENT ────────────────────────────────────────────
// Manages the AI conversation for a single live call session.
// Supports Vapi-style calendar tools when the SDR prompt includes the calendar block.

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { isClaudeModel } from "../agent-stack.js";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { searchWorkspaceKnowledgeBase } from "./langchain-kb.js";
import {
  getCalendarAvailability,
  getCalendarBookingPrefs,
  bookAppointmentWithCalendar,
} from "../calendar/service.js";
import { hasCalendarPromptBlock } from "../calendar/prompt-block.js";

const MAX_TOOL_ROUNDS = 3;

function createCallLlm(model: string, temperature: number): ChatOpenAI | ChatAnthropic {
  const id = model || "gpt-4o";
  if (isClaudeModel(id) && process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: id,
      temperature,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return new ChatOpenAI({
    model: isClaudeModel(id) ? "gpt-4o" : id,
    temperature,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
}

const outcomeSchema = z.object({
  outcome: z.enum(["booked", "qualified", "answered", "no_answer", "voicemail"]),
  summary: z.string().describe("2-3 sentence summary of the call outcome and key points discussed"),
  scheduledAt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "If outcome is booked and a specific date/time was agreed, ISO-8601 datetime (UTC). Otherwise null."
    ),
  appointmentTitle: z
    .string()
    .nullable()
    .optional()
    .describe("Short appointment title if booked, otherwise null"),
});

export type CallOutcome = z.infer<typeof outcomeSchema>;

export interface CallAgentInitOpts {
  sessionId: string;
  systemPrompt: string;
  workspaceId: string;
  organizationId: number;
  leadId: number | null;
  llmModel?: string | null;
}

export class LangChainCallAgent {
  private sessionHistories = new Map<string, InMemoryChatMessageHistory>();
  private workspaceId = "";
  private organizationId = 0;
  private leadId: number | null = null;
  private systemPrompt = "";
  private toolsEnabled = false;
  private llm!: ChatOpenAI | ChatAnthropic;
  private llmWithTools: ReturnType<ChatOpenAI["bindTools"]> | ReturnType<ChatAnthropic["bindTools"]> | null = null;
  private tools: DynamicStructuredTool[] = [];
  private midCallBooking: { scheduledAt: Date; appointmentId: number } | null = null;
  private llmModel = "gpt-4o";

  async init(opts: CallAgentInitOpts | string, systemPrompt?: string, workspaceId?: string): Promise<void> {
    const normalized: CallAgentInitOpts =
      typeof opts === "string"
        ? {
            sessionId: opts,
            systemPrompt: systemPrompt || "",
            workspaceId: workspaceId || "",
            organizationId: 0,
            leadId: null,
          }
        : opts;

    this.workspaceId = normalized.workspaceId;
    this.organizationId = normalized.organizationId;
    this.leadId = normalized.leadId;
    this.systemPrompt = normalized.systemPrompt;
    this.midCallBooking = null;
    this.toolsEnabled =
      !!normalized.organizationId && hasCalendarPromptBlock(normalized.systemPrompt);

    this.llmModel = normalized.llmModel || "gpt-4o";
    this.llm = createCallLlm(this.llmModel, 0.4);

    this.tools = this.buildTools();
    this.llmWithTools =
      this.toolsEnabled && this.tools.length > 0
        ? this.llm.bindTools(this.tools)
        : null;

    this.sessionHistories.set(normalized.sessionId, new InMemoryChatMessageHistory());
  }

  getMidCallBooking(): { scheduledAt: Date; appointmentId: number } | null {
    return this.midCallBooking;
  }

  private buildTools(): DynamicStructuredTool[] {
    const self = this;

    return [
      new DynamicStructuredTool({
        name: "check_availability",
        description:
          "Check the connected Google Calendar for open appointment slots. Call this before offering times. Returns real open slots only.",
        schema: z.object({
          daysAhead: z.number().int().min(1).max(14).optional(),
          durationMinutes: z.number().int().min(15).max(120).optional(),
        }),
        func: async ({ daysAhead, durationMinutes }) => {
          if (!self.organizationId) {
            return JSON.stringify({
              error: "Calendar not available for this call",
              slots: [],
              hint: "Apologize briefly and ask the lead to share preferred times, or offer to follow up by SMS later.",
            });
          }
          try {
            const prefs = await getCalendarBookingPrefs(self.organizationId);
            const result = await getCalendarAvailability({
              organizationId: self.organizationId,
              daysAhead,
              durationMinutes,
            });
            const offerCount = prefs.offerCount || 3;
            const slots = result.slots.slice(0, Math.max(offerCount + 2, offerCount));

            if (result.error || !result.connected) {
              return JSON.stringify({
                connected: result.connected,
                timezone: result.timezone,
                error: result.error || "Calendar unavailable",
                slots: [],
                hint:
                  "Tell the lead the calendar is temporarily unavailable, ask them for preferred times, and say you will confirm shortly or they can try again later. Do not invent open slots.",
              });
            }

            return JSON.stringify({
              connected: result.connected,
              timezone: result.timezone,
              error: result.error,
              slots,
              prefs: {
                daysAhead: prefs.daysAhead,
                durationMinutes: prefs.durationMinutes,
                offerCount,
              },
              hint: slots.length
                ? `Offer up to ${offerCount} of these slots in natural speech. Do not invent other times. If they ask about a time not listed, say that slot is not available.`
                : "No open slots found — say nothing is free in that window, ask for preferred days, or offer to follow up by SMS.",
            });
          } catch (err: any) {
            return JSON.stringify({
              connected: false,
              error: err?.message || "Availability check failed",
              slots: [],
              hint: "Apologize, say you cannot check the calendar right now, and ask them to try again later or share preferred times for a follow-up.",
            });
          }
        },
      }),
      new DynamicStructuredTool({
        name: "book_appointment",
        description:
          "Book an appointment on the connected calendar after the lead confirms a specific slot. Pass ISO-8601 start time from check_availability.",
        schema: z.object({
          scheduledAt: z.string().describe("ISO-8601 datetime for the appointment start"),
          title: z.string().optional(),
          durationMinutes: z.number().int().min(15).max(120).optional(),
        }),
        func: async ({ scheduledAt, title, durationMinutes }) => {
          if (!self.organizationId || !self.leadId) {
            return JSON.stringify({
              ok: false,
              error: "Missing organization or lead for booking",
              hint: "Apologize and ask them to try again later or confirm by SMS.",
            });
          }
          const when = new Date(scheduledAt);
          if (Number.isNaN(when.getTime())) {
            return JSON.stringify({
              ok: false,
              error: "Invalid scheduledAt datetime",
              hint: "Ask the lead to confirm one of the offered slots again.",
            });
          }
          if (self.midCallBooking) {
            return JSON.stringify({
              ok: true,
              alreadyBooked: true,
              appointmentId: self.midCallBooking.appointmentId,
              scheduledAt: self.midCallBooking.scheduledAt.toISOString(),
              hint: "Confirm the already-booked time verbally.",
            });
          }

          try {
            const prefs = await getCalendarBookingPrefs(self.organizationId);
            const result = await bookAppointmentWithCalendar({
              organizationId: self.organizationId,
              leadId: self.leadId,
              title: title || "Consultation",
              scheduledAt: when,
              durationMinutes: durationMinutes ?? prefs.durationMinutes,
            });

            if (!result.synced) {
              return JSON.stringify({
                ok: false,
                appointmentId: result.appointmentId,
                syncedToCalendar: false,
                syncError: result.syncError,
                scheduledAt: when.toISOString(),
                hint:
                  "Tell the lead booking failed on the calendar. Apologize, ask them to try again later, or offer to confirm by SMS/email. Do not say the meeting is confirmed.",
              });
            }

            self.midCallBooking = {
              scheduledAt: when,
              appointmentId: result.appointmentId,
            };

            return JSON.stringify({
              ok: true,
              appointmentId: result.appointmentId,
              syncedToCalendar: true,
              scheduledAt: when.toISOString(),
              message: "Booked on CRM and calendar. Confirm the time verbally with the lead.",
              hint: "Confirm the booking succeeded and restate the time clearly.",
            });
          } catch (err: any) {
            return JSON.stringify({
              ok: false,
              error: err?.message || "Booking failed",
              hint: "Apologize, say booking failed, and ask them to try again later or follow up by SMS.",
            });
          }
        },
      }),
    ];
  }

  private contentToText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join("");
    }
    return String(content ?? "");
  }

  /** Rebuild LLM chat history after stream reconnect / process resume. */
  async seedFromTranscript(
    sessionId: string,
    lines: ReadonlyArray<{ speaker: "ai" | "lead"; text: string }>
  ): Promise<void> {
    if (!this.sessionHistories.has(sessionId)) {
      this.sessionHistories.set(sessionId, new InMemoryChatMessageHistory());
    }
    const history = this.sessionHistories.get(sessionId)!;
    const existing = await history.getMessages();
    if (existing.length > 0) return;

    for (const line of lines) {
      const text = (line.text || "").trim();
      if (!text) continue;
      if (line.speaker === "lead") {
        await history.addMessage(new HumanMessage(text));
      } else {
        await history.addMessage(new AIMessage(text));
      }
    }
    console.log(
      `🤖 Seeded ${lines.length} transcript lines into LLM history for session ${sessionId}`
    );
  }

  /** Keep history aligned when we shorten/truncate the spoken greeting. */
  async replaceLastAiMessage(sessionId: string, text: string): Promise<void> {
    const history = this.sessionHistories.get(sessionId);
    if (!history) return;
    const msgs = await history.getMessages();
    if (!msgs.length) {
      await history.addMessage(new AIMessage(text));
      return;
    }
    // InMemoryChatMessageHistory has no splice API — clear + rewrite
    const rebuilt = [...msgs];
    const last = rebuilt[rebuilt.length - 1];
    const lastType =
      typeof (last as any)?.getType === "function"
        ? (last as any).getType()
        : (last as any)?._getType?.();
    if (lastType === "ai") {
      rebuilt[rebuilt.length - 1] = new AIMessage(text);
    } else {
      rebuilt.push(new AIMessage(text));
    }
    await history.clear();
    for (const m of rebuilt) await history.addMessage(m);
  }

  async respond(sessionId: string, leadUtterance: string): Promise<string> {
    const trimmed = (leadUtterance || "").trim();
    // Control cues like [CALL_CONNECTED] must not be stored as if the lead spoke them.
    const isSystemCue = trimmed.startsWith("[") && trimmed.includes("]");

    let inputForModel = trimmed;
    if (!isSystemCue) {
      try {
        const kbResults = await searchWorkspaceKnowledgeBase(this.workspaceId, trimmed, 3);
        if (kbResults.length > 0) {
          const kbContext = kbResults.map((r) => r.pageContent).join("\n");
          inputForModel =
            `[Relevant context from your knowledge base — use only if needed, do not recite verbatim:]\n${kbContext}\n\n[Lead said:] ${trimmed}`;
        }
      } catch {
        // non-fatal
      }
    } else {
      inputForModel =
        `${trimmed}\n\n(This is an internal instruction for you, not something the lead said.)`;
    }

    if (!this.sessionHistories.has(sessionId)) {
      this.sessionHistories.set(sessionId, new InMemoryChatMessageHistory());
    }
    const history = this.sessionHistories.get(sessionId)!;
    const prior = await history.getMessages();

    // No calendar tools — simple turn
    if (!this.llmWithTools) {
      const aiMsg = await this.llm.invoke([
        new SystemMessage(this.systemPrompt),
        ...prior,
        new HumanMessage(inputForModel),
      ]);
      const text = this.contentToText(aiMsg.content);
      if (!isSystemCue) {
        await history.addMessage(new HumanMessage(trimmed));
      }
      await history.addMessage(new AIMessage(text));
      return text;
    }

    const messages: any[] = [
      new SystemMessage(this.systemPrompt),
      ...prior,
      new HumanMessage(inputForModel),
    ];

    const toolsByName = Object.fromEntries(this.tools.map((t) => [t.name, t]));
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds += 1;
      const aiMsg: any = await this.llmWithTools.invoke(messages);
      const toolCalls = aiMsg.tool_calls || [];

      if (!toolCalls.length) {
        const text = this.contentToText(aiMsg.content);
        if (!isSystemCue) {
          await history.addMessage(new HumanMessage(trimmed));
        }
        await history.addMessage(new AIMessage(text));
        return text;
      }

      messages.push(aiMsg);

      for (const call of toolCalls) {
        const tool = toolsByName[call.name];
        let observation = JSON.stringify({ error: `Unknown tool ${call.name}` });
        if (tool) {
          try {
            const raw = await tool.invoke(call.args);
            observation = typeof raw === "string" ? raw : JSON.stringify(raw);
          } catch (err: any) {
            observation = JSON.stringify({ error: err?.message || "Tool failed" });
          }
        }
        messages.push(
          new ToolMessage({
            content: observation,
            tool_call_id: call.id || `${call.name}-${rounds}`,
          })
        );
      }
    }

    // Cap reached — force a spoken reply
    const final = await this.llm.invoke([
      ...messages,
      new HumanMessage("Respond to the lead now in concise spoken language. Do not call tools."),
    ]);
    const text = this.contentToText(final.content);
    if (!isSystemCue) {
      await history.addMessage(new HumanMessage(trimmed));
    }
    await history.addMessage(new AIMessage(text));
    return text;
  }

  async analyseOutcome(fullTranscript: string): Promise<CallOutcome> {
    if (this.midCallBooking) {
      return {
        outcome: "booked",
        summary: "Appointment booked during the live call via calendar tools.",
        scheduledAt: this.midCallBooking.scheduledAt.toISOString(),
        appointmentTitle: "Consultation",
      };
    }

    const llm = createCallLlm(this.llmModel || "gpt-4o", 0);

    const structured = llm.withStructuredOutput(outcomeSchema);

    return structured.invoke(
      `Analyse this sales call transcript and return the outcome and a brief summary.
If an appointment was clearly booked, set outcome to "booked" and include scheduledAt as an ISO-8601 datetime when the time was agreed.
If booked but no specific time was set, leave scheduledAt null.
If the lead never spoke (AI greeting only, voicemail, or silence), outcome must be "no_answer" or "voicemail" — never "answered".

Transcript:
${fullTranscript}`
    );
  }

  cleanup(sessionId: string): void {
    this.sessionHistories.delete(sessionId);
  }
}
