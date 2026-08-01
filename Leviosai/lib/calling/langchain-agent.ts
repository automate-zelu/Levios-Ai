// ─── LANGCHAIN CONVERSATION AGENT ────────────────────────────────────────────
// Manages the AI conversation for a single live call session.
// Supports Vapi-style calendar tools when the SDR prompt includes the calendar block.

import { ChatOpenAI } from "@langchain/openai";
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
  bookAppointmentWithCalendar,
} from "../calendar/service.js";
import { hasCalendarPromptBlock } from "../calendar/prompt-block.js";

const MAX_TOOL_ROUNDS = 3;

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
}

export class LangChainCallAgent {
  private sessionHistories = new Map<string, InMemoryChatMessageHistory>();
  private workspaceId = "";
  private organizationId = 0;
  private leadId: number | null = null;
  private systemPrompt = "";
  private toolsEnabled = false;
  private llm!: ChatOpenAI;
  private llmWithTools: ReturnType<ChatOpenAI["bindTools"]> | null = null;
  private tools: DynamicStructuredTool[] = [];
  private midCallBooking: { scheduledAt: Date; appointmentId: number } | null = null;

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

    this.llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.4,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

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
            return JSON.stringify({ error: "Calendar not available for this call", slots: [] });
          }
          const result = await getCalendarAvailability({
            organizationId: self.organizationId,
            daysAhead: daysAhead ?? 5,
            durationMinutes: durationMinutes ?? 30,
            maxSlots: 6,
          });
          return JSON.stringify({
            connected: result.connected,
            timezone: result.timezone,
            error: result.error,
            slots: result.slots,
            hint: result.slots.length
              ? "Offer 2-3 of these slots in natural speech. Do not invent other times."
              : "No open slots found — ask the lead for preferred days or offer to follow up by SMS.",
          });
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
            return JSON.stringify({ ok: false, error: "Missing organization or lead for booking" });
          }
          const when = new Date(scheduledAt);
          if (Number.isNaN(when.getTime())) {
            return JSON.stringify({ ok: false, error: "Invalid scheduledAt datetime" });
          }
          if (self.midCallBooking) {
            return JSON.stringify({
              ok: true,
              alreadyBooked: true,
              appointmentId: self.midCallBooking.appointmentId,
              scheduledAt: self.midCallBooking.scheduledAt.toISOString(),
            });
          }

          const result = await bookAppointmentWithCalendar({
            organizationId: self.organizationId,
            leadId: self.leadId,
            title: title || "Consultation",
            scheduledAt: when,
            durationMinutes: durationMinutes ?? 30,
          });

          self.midCallBooking = {
            scheduledAt: when,
            appointmentId: result.appointmentId,
          };

          return JSON.stringify({
            ok: true,
            appointmentId: result.appointmentId,
            syncedToCalendar: result.synced,
            syncError: result.syncError,
            scheduledAt: when.toISOString(),
            message: result.synced
              ? "Booked on CRM and calendar. Confirm the time verbally with the lead."
              : "Booked in CRM; calendar sync may have failed — still confirm the time with the lead.",
          });
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

  async respond(sessionId: string, leadUtterance: string): Promise<string> {
    let inputWithContext = leadUtterance;

    try {
      const kbResults = await searchWorkspaceKnowledgeBase(this.workspaceId, leadUtterance, 3);
      if (kbResults.length > 0) {
        const kbContext = kbResults.map((r) => r.pageContent).join("\n");
        inputWithContext =
          `[Relevant context from your knowledge base:]\n${kbContext}\n\n[Lead said:] ${leadUtterance}`;
      }
    } catch {
      // non-fatal
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
        new HumanMessage(inputWithContext),
      ]);
      const text = this.contentToText(aiMsg.content);
      await history.addMessage(new HumanMessage(inputWithContext));
      await history.addMessage(new AIMessage(text));
      return text;
    }

    const messages: any[] = [
      new SystemMessage(this.systemPrompt),
      ...prior,
      new HumanMessage(inputWithContext),
    ];

    const toolsByName = Object.fromEntries(this.tools.map((t) => [t.name, t]));
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds += 1;
      const aiMsg: any = await this.llmWithTools.invoke(messages);
      const toolCalls = aiMsg.tool_calls || [];

      if (!toolCalls.length) {
        const text = this.contentToText(aiMsg.content);
        await history.addMessage(new HumanMessage(inputWithContext));
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
    await history.addMessage(new HumanMessage(inputWithContext));
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

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const structured = llm.withStructuredOutput(outcomeSchema);

    return structured.invoke(
      `Analyse this sales call transcript and return the outcome and a brief summary.
If an appointment was clearly booked, set outcome to "booked" and include scheduledAt as an ISO-8601 datetime when the time was agreed.
If booked but no specific time was set, leave scheduledAt null.

Transcript:
${fullTranscript}`
    );
  }

  cleanup(sessionId: string): void {
    this.sessionHistories.delete(sessionId);
  }
}
