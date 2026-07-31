// ─── LANGCHAIN CONVERSATION AGENT ────────────────────────────────────────────
// Manages the AI conversation for a single live call session.
// One instance is created per active WebSocket call and discarded after.
//
// Responsibilities:
//   - Per-session InMemoryChatMessageHistory (no manual array management)
//   - RAG: retrieves relevant KB passages via pgvector similarity search before each response
//   - GPT-4o response generation via LCEL chain
//   - Structured outcome detection post-call (withStructuredOutput — no keyword matching)

import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { z } from "zod";
import { searchWorkspaceKnowledgeBase } from "./langchain-kb.js";

// ─── OUTCOME SCHEMA ───────────────────────────────────────────────────────────

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

// ─── AGENT ────────────────────────────────────────────────────────────────────

export class LangChainCallAgent {
  private chain!: RunnableWithMessageHistory<any, any>;
  private sessionHistories = new Map<string, InMemoryChatMessageHistory>();
  private workspaceId!: string;

  async init(sessionId: string, systemPrompt: string, workspaceId: string): Promise<void> {
    this.workspaceId = workspaceId;

    const llm = new ChatOpenAI({
      model:       "gpt-4o",
      temperature: 0.4,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      new MessagesPlaceholder("history"),
      ["human", "{input}"],
    ]);

    const baseChain = prompt.pipe(llm);

    this.chain = new RunnableWithMessageHistory({
      runnable: baseChain,
      getMessageHistory: (id: string) => {
        if (!this.sessionHistories.has(id)) {
          this.sessionHistories.set(id, new InMemoryChatMessageHistory());
        }
        return this.sessionHistories.get(id)!;
      },
      inputMessagesKey:   "input",
      historyMessagesKey: "history",
    });

    // Pre-warm session history
    this.sessionHistories.set(sessionId, new InMemoryChatMessageHistory());
  }

  async respond(sessionId: string, leadUtterance: string): Promise<string> {
    // Retrieve relevant KB passages via pgvector similarity search
    let inputWithContext = leadUtterance;

    try {
      const kbResults = await searchWorkspaceKnowledgeBase(this.workspaceId, leadUtterance, 3);
      if (kbResults.length > 0) {
        const kbContext = kbResults.map((r) => r.pageContent).join("\n");
        inputWithContext =
          `[Relevant context from your knowledge base:]\n${kbContext}\n\n[Lead said:] ${leadUtterance}`;
      }
    } catch {
      // KB retrieval failure is non-fatal — proceed without context
    }

    const response = await this.chain.invoke(
      { input: inputWithContext },
      { configurable: { sessionId } }
    );

    return response.content as string;
  }

  async analyseOutcome(fullTranscript: string): Promise<CallOutcome> {
    const llm = new ChatOpenAI({
      model:        "gpt-4o",
      temperature:  0,
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
