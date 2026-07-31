// ─── KNOWLEDGE BASE AGENT ───────────────────────────────────────────────────
// In-memory knowledge retrieval for sales conversations.
// Uses keyword matching + Claude AI for contextual answers.
// Future: Pinecone vector DB for full RAG with document embeddings.

import Anthropic from "@anthropic-ai/sdk";
import { BaseAgent } from "../base-agent.js";
import { INDUSTRY_PRICING, OBJECTION_PATTERNS } from "../../config.js";
import type { ReactorEvent, AgentResult, AgentContext } from "../../types.js";

// ─── IN-MEMORY KNOWLEDGE STORE ──────────────────────────────────────────────
// Per-org knowledge entries. Seeded with default sales knowledge,
// orgs can add custom entries via knowledge.ingest events.

interface KnowledgeEntry {
  id: string;
  category: string;
  keywords: string[];
  content: string;
  metadata?: Record<string, any>;
}

// Default sales knowledge available to all orgs
const DEFAULT_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "pricing-model",
    category: "pricing",
    keywords: ["price", "cost", "pricing", "how much", "expensive", "afford", "budget", "pay"],
    content: "We operate on a pay-per-appointment model. You only pay when we deliver a confirmed, qualified appointment. No monthly retainers, no setup fees. Pricing varies by industry and service area.",
  },
  {
    id: "how-it-works",
    category: "process",
    keywords: ["how", "work", "process", "what do you do", "explain", "steps"],
    content: "Our AI-powered outreach system works in 3 steps: (1) We import and validate your aged leads, (2) Our AI contacts them via SMS, email, and voice with personalized messages, (3) When a lead shows interest, we book a confirmed appointment directly on your calendar. You just show up and close.",
  },
  {
    id: "compliance",
    category: "compliance",
    keywords: ["legal", "compliant", "TCPA", "opt out", "consent", "spam", "DNC", "do not call"],
    content: "We are fully TCPA compliant. All outreach respects quiet hours (8AM-9PM local time), DNC lists, and opt-out requests. We honor STOP requests immediately. AI disclosure is provided in states that require it (CA, WA, CO, IL, NY). All leads have prior express consent from their original inquiry.",
  },
  {
    id: "guarantee",
    category: "sales",
    keywords: ["guarantee", "promise", "risk", "refund", "what if", "results"],
    content: "Because you only pay per confirmed appointment, there's zero risk. If we don't deliver appointments, you don't pay. We typically see first appointments within the first week of activation.",
  },
  {
    id: "ai-disclosure",
    category: "compliance",
    keywords: ["AI", "robot", "automated", "real person", "bot", "artificial"],
    content: "We use AI-assisted outreach to make initial contact, but every qualified appointment is confirmed by our team. Our AI, Aria, is designed to sound natural and helpful. In states requiring disclosure, we clearly identify that the initial contact is AI-assisted.",
  },
  {
    id: "lead-types",
    category: "leads",
    keywords: ["lead", "aged", "old", "stale", "dead", "revive", "reactivate"],
    content: "We specialize in reactivating aged leads — contacts who previously showed interest but went cold. These are people who already raised their hand once. Our multi-channel AI outreach re-engages them at the right time with the right message.",
  },
  {
    id: "channels",
    category: "features",
    keywords: ["SMS", "text", "email", "call", "phone", "voicemail", "channel", "outreach"],
    content: "We use a coordinated multi-channel approach: personalized SMS sequences, email drip campaigns, AI voice calls, and ringless voicemail drops. The system automatically selects the best channel based on each lead's engagement signals.",
  },
  {
    id: "timeline",
    category: "onboarding",
    keywords: ["start", "begin", "timeline", "how long", "setup", "onboard", "quick"],
    content: "Setup takes about 24 hours. You upload your leads, we configure your account, and outreach begins the next business day. Most clients see their first appointments within the first week.",
  },
  {
    id: "industries",
    category: "industries",
    keywords: ["industry", "solar", "HVAC", "roofing", "plumbing", "insurance", "home service"],
    content: `We serve 20+ home service industries including: ${Object.values(INDUSTRY_PRICING).map(i => i.name).join(", ")}. Each industry has optimized messaging and pricing.`,
  },
];

// Org-specific knowledge store (in-memory, lost on restart — future: DB-backed)
const orgKnowledge = new Map<number, KnowledgeEntry[]>();

export class KnowledgeBaseAgent extends BaseAgent {
  id = "knowledge-base";
  name = "Knowledge Base Agent";
  tier = 2 as const;
  priority = 3;
  isBlocking = false;
  timeout = 20_000;

  canHandle(event: ReactorEvent): boolean {
    return event.type === "knowledge.query" || event.type === "knowledge.ingest";
  }

  protected async _execute(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    if (event.type === "knowledge.ingest") {
      return this.handleIngest(event, context);
    }
    return this.handleQuery(event, context);
  }

  // ─── QUERY: Find relevant knowledge and generate answer ───────────

  private async handleQuery(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const query = event.payload.query as string;
    if (!query) return this.fail("No query provided");

    const leadId = event.metadata.leadId || event.payload.leadId;
    const orgId = event.organizationId;

    // Retrieve relevant entries via keyword matching
    const allEntries = [...DEFAULT_KNOWLEDGE, ...(orgKnowledge.get(orgId) || [])];
    const relevant = this.search(query, allEntries);

    if (relevant.length === 0) {
      context.log("info", `No knowledge found for query: "${query.substring(0, 60)}"`);
      return this.ok({ answer: null, sources: [], reason: "no_matches" });
    }

    // Build context from top matches
    const knowledgeContext = relevant
      .map((r) => `[${r.entry.category}] ${r.entry.content}`)
      .join("\n\n");

    // Generate answer with Claude if available
    let answer: string;
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        // No AI — return raw knowledge snippets
        answer = relevant.map((r) => r.entry.content).join(" ");
      } else {
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: `You are a sales AI assistant. Answer this question using ONLY the knowledge base context below. Be concise and conversational (2-3 sentences max). If the context doesn't fully answer the question, say what you can and note what's missing.

Question: ${query}

Knowledge base context:
${knowledgeContext}

Answer concisely:`,
          }],
        });
        answer = response.content[0].type === "text" ? response.content[0].text : relevant[0].entry.content;
      }
    } catch (err: any) {
      context.log("warn", `AI answer generation failed: ${err.message}`);
      answer = relevant[0].entry.content;
    }

    // Log the query for analytics
    await context.storage.logActivity({
      organizationId: orgId,
      entityType: "knowledge",
      entityId: leadId || 0,
      action: "knowledge_query",
      details: JSON.stringify({
        query: query.substring(0, 100),
        matchCount: relevant.length,
        topCategory: relevant[0].entry.category,
      }),
    });

    return this.ok({
      answer,
      sources: relevant.map((r) => ({ id: r.entry.id, category: r.entry.category, score: r.score })),
      matchCount: relevant.length,
    });
  }

  // ─── INGEST: Add custom knowledge entries for an org ───────────────

  private async handleIngest(event: ReactorEvent, context: AgentContext): Promise<AgentResult> {
    const entries = event.payload.entries as Array<{ category: string; keywords: string[]; content: string }>;
    if (!entries || !Array.isArray(entries)) return this.fail("No entries to ingest");

    const orgId = event.organizationId;
    const existing = orgKnowledge.get(orgId) || [];

    let added = 0;
    for (const entry of entries) {
      if (!entry.content || !entry.category) continue;

      existing.push({
        id: `custom-${orgId}-${Date.now()}-${added}`,
        category: entry.category,
        keywords: entry.keywords || this.extractKeywords(entry.content),
        content: entry.content,
      });
      added++;
    }

    orgKnowledge.set(orgId, existing);
    context.log("info", `Ingested ${added} knowledge entries for org ${orgId}`);

    return this.ok({ ingested: added, totalEntries: existing.length });
  }

  // ─── Keyword search with scoring ──────────────────────────────────

  private search(query: string, entries: KnowledgeEntry[]): Array<{ entry: KnowledgeEntry; score: number }> {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    const scored = entries.map((entry) => {
      let score = 0;

      // Keyword match scoring
      for (const keyword of entry.keywords) {
        const kw = keyword.toLowerCase();
        if (queryLower.includes(kw)) score += 10;
        for (const word of queryWords) {
          if (kw.includes(word) || word.includes(kw)) score += 3;
        }
      }

      // Category match bonus
      if (queryLower.includes(entry.category)) score += 5;

      // Content substring match
      const contentLower = entry.content.toLowerCase();
      for (const word of queryWords) {
        if (contentLower.includes(word)) score += 1;
      }

      return { entry, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  // Auto-extract keywords from content
  private extractKeywords(content: string): string[] {
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"]);
    return content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 10);
  }
}
