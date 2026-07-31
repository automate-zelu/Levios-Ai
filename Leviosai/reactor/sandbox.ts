// ─── REACTOR SANDBOX ────────────────────────────────────────────────────────
// Self-contained demo environment that simulates multi-turn SMS conversations
// using the same AI + agent logic as the live Reactor. No Twilio, no DB writes.
// Perfect for demos, testing, and validating conversation flows.

import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import {
  OBJECTION_PATTERNS,
  OPT_OUT_KEYWORDS,
  SIGNAL_WEIGHTS,
} from "./config.js";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface SandboxLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  source: string;
  industry: string;
  status: string;
  score: number;
  temperature: "hot" | "warm" | "cold" | "dead";
  reactorState: string;
  consentStatus: string;
  outreachAttempts: number;
}

export interface SandboxMessage {
  id: string;
  direction: "outbound" | "inbound";
  channel: "sms";
  content: string;
  aiGenerated: boolean;
  agentId: string | null;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface SandboxEvent {
  type: string;
  agentId: string;
  description: string;
  timestamp: Date;
  data?: Record<string, any>;
}

export interface SandboxSession {
  id: string;
  lead: SandboxLead;
  messages: SandboxMessage[];
  events: SandboxEvent[];
  agentActions: string[];
  createdAt: Date;
  status: "active" | "appointment_proposed" | "appointment_set" | "opted_out" | "objection_loop" | "completed";
  proposedAppointment?: { scheduledAt: string; leadName: string; industry: string };
}

// ─── SANDBOX ENGINE ─────────────────────────────────────────────────────────

const sessions = new Map<string, SandboxSession>();

export function createSession(overrides?: Partial<SandboxLead>): SandboxSession {
  const sessionId = crypto.randomUUID();

  const lead: SandboxLead = {
    id: `sandbox-${sessionId.substring(0, 8)}`,
    firstName: overrides?.firstName || "Jordan",
    lastName: overrides?.lastName || "Mitchell",
    phone: overrides?.phone || "+15551234567",
    email: overrides?.email || "jordan.m@example.com",
    source: overrides?.source || "aged_lead_list",
    industry: overrides?.industry || "solar",
    status: "new",
    score: 30,
    temperature: "cold",
    reactorState: "new",
    consentStatus: "prior_consent",
    outreachAttempts: 0,
  };

  const session: SandboxSession = {
    id: sessionId,
    lead,
    messages: [],
    events: [],
    agentActions: [],
    createdAt: new Date(),
    status: "active",
  };

  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): SandboxSession | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): SandboxSession[] {
  return Array.from(sessions.values());
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

// ─── STEP 1: GENERATE OUTBOUND SMS ─────────────────────────────────────────
// Simulates what the SMS Agent does: generates an AI message for the lead.

export async function sendOutbound(sessionId: string): Promise<{ message: SandboxMessage; events: SandboxEvent[] }> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.status !== "active") throw new Error(`Session is ${session.status} — cannot send outbound`);

  const step = session.lead.outreachAttempts + 1;
  const newEvents: SandboxEvent[] = [];

  // ─── Compliance check (simulates ComplianceGuardianAgent) ────────
  newEvents.push({
    type: "compliance.check",
    agentId: "compliance-guardian",
    description: `TCPA compliance check passed — lead has ${session.lead.consentStatus}, within calling hours`,
    timestamp: new Date(),
    data: { consent: session.lead.consentStatus, passed: true },
  });

  // ─── Budget check (simulates BudgetControllerAgent) ──────────────
  newEvents.push({
    type: "budget.check",
    agentId: "budget-controller",
    description: "Budget check passed — SMS cost $0.01, within daily/monthly limits",
    timestamp: new Date(),
    data: { costCents: 1, passed: true },
  });

  // ─── Generate AI message (simulates SmsAgent) ────────────────────
  const stepPrompts: Record<number, string> = {
    1: `First contact SMS for a ${session.lead.industry} lead. Be warm and casual. Mention their name (${session.lead.firstName}) and that they previously showed interest. Keep it to 2-3 sentences. Include a soft CTA. Sound like a real person texting, not a bot.`,
    2: `Follow-up SMS (they didn't respond to the first). Reference that you reached out before. Add a value prop or social proof for ${session.lead.industry}. Keep it conversational, 2-3 sentences.`,
    3: `Final SMS in the sequence. Create gentle urgency without being pushy. Mention this is the last follow-up. Offer easy opt-out. 2-3 sentences.`,
  };

  const prompt = stepPrompts[Math.min(step, 3)] || stepPrompts[1];
  let messageText: string;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("No API key");

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `You are Aria, an AI sales assistant for a ${session.lead.industry} company. Generate ONLY the SMS text, nothing else.

${prompt}

Previous messages in this conversation:
${session.messages.map((m) => `${m.direction === "outbound" ? "Aria" : session.lead.firstName}: ${m.content}`).join("\n") || "(none yet)"}

Generate the SMS message text only:`,
      }],
    });

    messageText = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    // Strip any quotes the AI might wrap around the message
    messageText = messageText.replace(/^["']|["']$/g, "").trim();
    // No hard truncation in sandbox — let demo messages read naturally
  } catch {
    messageText = step === 1
      ? `Hey ${session.lead.firstName}! This is Aria. I saw you were looking into ${session.lead.industry} services a while back. Still something you're thinking about? 😊`
      : step === 2
        ? `Hi ${session.lead.firstName}, just circling back — we've helped a bunch of folks in your area recently. Happy to chat if you're interested!`
        : `Last note from me, ${session.lead.firstName}. If timing isn't right, totally understand. We're here whenever you need us. Reply STOP to opt out.`;
  }

  const message: SandboxMessage = {
    id: crypto.randomUUID(),
    direction: "outbound",
    channel: "sms",
    content: messageText,
    aiGenerated: true,
    agentId: "sms-agent",
    timestamp: new Date(),
    metadata: { step, industry: session.lead.industry },
  };

  session.messages.push(message);
  session.lead.outreachAttempts = step;
  session.lead.status = "contacted";
  session.lead.reactorState = step === 1 ? "outreach_queued" : "contacted";

  newEvents.push({
    type: "outreach.sms.sent",
    agentId: "sms-agent",
    description: `SMS step ${step}/3 sent: "${messageText.substring(0, 50)}..."`,
    timestamp: new Date(),
    data: { step, messageLength: messageText.length },
  });

  // ─── Analytics tracking (simulates AnalyticsAgent) ──────────────
  newEvents.push({
    type: "analytics.recorded",
    agentId: "analytics",
    description: `Outreach attempt #${step} logged for lead ${session.lead.id}`,
    timestamp: new Date(),
  });

  session.events.push(...newEvents);
  session.agentActions.push(`sms-agent: Sent step ${step} SMS`);

  return { message, events: newEvents };
}

// ─── STEP 2: PROCESS INBOUND REPLY ──────────────────────────────────────────
// Simulates what happens when the lead texts back. Runs through:
// SentimentIntentAgent → ObjectionHandlingAgent → RoutingAgent → KnowledgeBaseAgent → SmsAgent

export async function processReply(
  sessionId: string,
  replyText: string
): Promise<{ analysis: any; responseMessage: SandboxMessage | null; events: SandboxEvent[] }> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const newEvents: SandboxEvent[] = [];

  // Store the inbound message
  const inboundMessage: SandboxMessage = {
    id: crypto.randomUUID(),
    direction: "inbound",
    channel: "sms",
    content: replyText,
    aiGenerated: false,
    agentId: null,
    timestamp: new Date(),
  };
  session.messages.push(inboundMessage);

  // ─── 1. Sentiment & Intent Classification ────────────────────────
  const lowerReply = replyText.toLowerCase().trim();

  // Opt-out check (hard block)
  if (OPT_OUT_KEYWORDS.some((k) => lowerReply === k || lowerReply.startsWith(k + " "))) {
    session.lead.consentStatus = "opted_out";
    session.lead.reactorState = "dnc_blocked";
    session.lead.score = Math.max(0, session.lead.score - 100);
    session.status = "opted_out";

    newEvents.push({
      type: "opt_out.detected",
      agentId: "sentiment-intent",
      description: `Lead opted out with keyword: "${lowerReply}"`,
      timestamp: new Date(),
      data: { keyword: lowerReply, sentiment: "negative", intent: "opt_out" },
    });

    session.events.push(...newEvents);
    session.agentActions.push("sentiment-intent: Detected opt-out → DNC blocked");

    return {
      analysis: { sentiment: "negative", intent: "opt_out", confidence: 1.0, optedOut: true },
      responseMessage: null,
      events: newEvents,
    };
  }

  // Classify intent
  let sentiment: "positive" | "negative" | "neutral" = "neutral";
  let intent: string = "general_reply";
  let confidence = 0.5;

  // Appointment confirmation (lead confirms proposed time)
  const confirmKeywords = ["works", "perfect", "let's do it", "sounds good", "that works", "yes", "yep", "yeah", "sure", "confirmed", "see you", "i'm in", "count me in", "book it", "lock it in", "ok", "okay", "fine", "great", "good", "absolutely", "definitely", "down", "bet", "done", "deal", "awesome", "cool", "for sure", "i can do", "i'll be there", "that time", "2pm"];
  if (session.status === "appointment_proposed" && confirmKeywords.some((k) => lowerReply.includes(k))) {
    sentiment = "positive";
    intent = "appointment_confirmed";
    confidence = 0.92;
    session.lead.score = Math.min(100, session.lead.score + SIGNAL_WEIGHTS.appointment_requested);
    session.lead.temperature = "hot";
  }
  // Appointment interest (first signal — lead wants to meet but hasn't confirmed a time)
  else {
    const apptKeywords = ["schedule", "appointment", "meeting", "book", "available", "when", "time", "interested", "let's do it", "sounds good", "set something up", "let's talk", "free to chat", "let's meet"];
    if (session.status !== "appointment_proposed" && apptKeywords.some((k) => lowerReply.includes(k))) {
      sentiment = "positive";
      intent = "appointment_interest";
      confidence = 0.85;
      session.lead.score = Math.min(100, session.lead.score + SIGNAL_WEIGHTS.sms_replied_positive);
      session.lead.temperature = "hot";
    }
  }

  // Objection detection
  let objectionCategory: string | null = null;
  for (const [category, patterns] of Object.entries(OBJECTION_PATTERNS)) {
    if (patterns.some((p) => lowerReply.includes(p))) {
      sentiment = "negative";
      intent = "objection";
      objectionCategory = category;
      confidence = 0.8;
      session.lead.score = Math.min(100, session.lead.score + SIGNAL_WEIGHTS.call_objection);
      break;
    }
  }

  // Positive general reply
  if (intent === "general_reply" && /\b(yeah|yep|ok|okay|great|thanks|cool|definitely)\b/i.test(replyText)) {
    sentiment = "positive";
    confidence = 0.7;
    session.lead.score = Math.min(100, session.lead.score + SIGNAL_WEIGHTS.sms_replied_positive);
    session.lead.temperature = session.lead.score >= 70 ? "hot" : "warm";
  }

  // Neutral reply still gets score bump
  if (intent === "general_reply" && sentiment === "neutral") {
    session.lead.score = Math.min(100, session.lead.score + SIGNAL_WEIGHTS.sms_replied_neutral);
    session.lead.temperature = session.lead.score >= 70 ? "hot" : session.lead.score >= 40 ? "warm" : "cold";
  }

  newEvents.push({
    type: "sentiment.classified",
    agentId: "sentiment-intent",
    description: `Classified: sentiment=${sentiment}, intent=${intent}, confidence=${confidence}`,
    timestamp: new Date(),
    data: { sentiment, intent, confidence, objectionCategory },
  });

  session.lead.reactorState = "engaged";
  session.agentActions.push(`sentiment-intent: ${sentiment}/${intent} (${Math.round(confidence * 100)}%)`);

  // ─── 2. Scoring signal ────────────────────────────────────────────
  newEvents.push({
    type: "scoring.signal",
    agentId: "lead-scoring",
    description: `Score updated: ${session.lead.score} (${session.lead.temperature})`,
    timestamp: new Date(),
    data: { score: session.lead.score, temperature: session.lead.temperature },
  });

  // ─── 3. Handle objection if detected ──────────────────────────────
  let objectionRebuttal: string | null = null;
  if (objectionCategory) {
    newEvents.push({
      type: "objection.detected",
      agentId: "objection-handling",
      description: `Objection category: ${objectionCategory}`,
      timestamp: new Date(),
      data: { category: objectionCategory, originalText: replyText },
    });
    session.agentActions.push(`objection-handling: Detected "${objectionCategory}" objection`);
  }

  // ─── 4. Generate AI response ──────────────────────────────────────
  let responseText: string | null = null;

  // Generate a concrete appointment time (next business day at 2pm)
  let appointmentTime: Date | null = null;

  // Pick next business day at 2pm local (used for both propose and confirm)
  const now = new Date();
  const apptDate = new Date(now);
  apptDate.setDate(apptDate.getDate() + 1);
  while (apptDate.getDay() === 0 || apptDate.getDay() === 6) {
    apptDate.setDate(apptDate.getDate() + 1);
  }
  apptDate.setHours(14, 0, 0, 0);

  if (intent === "appointment_interest") {
    // Step 1: Propose a time — don't book yet
    session.status = "appointment_proposed";
    session.lead.reactorState = "appointment_proposed";
    session.proposedAppointment = {
      scheduledAt: apptDate.toISOString(),
      leadName: `${session.lead.firstName} ${session.lead.lastName}`,
      industry: session.lead.industry,
    };

    newEvents.push({
      type: "appointment.proposed",
      agentId: "appointment-booking",
      description: `Proposed ${apptDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at 2:00 PM — awaiting lead confirmation`,
      timestamp: new Date(),
      data: { scheduledAt: apptDate.toISOString(), leadName: `${session.lead.firstName} ${session.lead.lastName}` },
    });
    session.agentActions.push("routing: Routing to appointment booking");
    session.agentActions.push(`appointment-booking: Proposed ${apptDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at 2:00 PM — waiting for confirmation`);
  } else if (intent === "appointment_confirmed" && session.proposedAppointment) {
    // Step 2: Lead confirmed — book it
    session.status = "appointment_set";
    session.lead.reactorState = "appointment_set";
    appointmentTime = new Date(session.proposedAppointment.scheduledAt);

    newEvents.push({
      type: "appointment.confirmed",
      agentId: "appointment-booking",
      description: `Appointment confirmed for ${appointmentTime.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at 2:00 PM`,
      timestamp: new Date(),
      data: { scheduledAt: appointmentTime.toISOString(), leadName: session.proposedAppointment.leadName },
    });
    session.agentActions.push(`appointment-booking: Confirmed ${appointmentTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at 2:00 PM`);
  }

  // Generate conversational response via AI
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("No API key");

    const conversationHistory = session.messages
      .map((m) => `${m.direction === "outbound" ? "Aria" : session.lead.firstName}: ${m.content}`)
      .join("\n");

    let responsePrompt: string;
    const apptDay = apptDate.toLocaleDateString("en-US", { weekday: "long" });
    if (intent === "appointment_interest") {
      responsePrompt = `The lead wants to schedule an appointment. Be enthusiastic but not over the top. Propose a specific time: "${apptDay} at 2pm". Ask if that works for their schedule. You must include the day and time. Keep it to 2-3 sentences.`;
    } else if (intent === "appointment_confirmed") {
      const confirmedDate = session.proposedAppointment ? new Date(session.proposedAppointment.scheduledAt) : apptDate;
      const confirmedDay = confirmedDate.toLocaleDateString("en-US", { weekday: "long" });
      responsePrompt = `The lead just confirmed the appointment for ${confirmedDay} at 2pm. Express excitement, confirm the details, and let them know you'll send a confirmation. Be warm and brief. Keep it to 2-3 sentences.`;
    } else if (objectionCategory) {
      const strategies: Record<string, string> = {
        price_too_high: "Acknowledge the concern. Mention the pay-per-appointment model — they only pay for results. Pivot to value.",
        not_interested: "Be graceful. Ask what changed since they originally inquired. Plant a seed without being pushy.",
        bad_timing: "Totally understand. Ask when would be better. Offer to follow up at a specific time.",
        using_competitor: "No problem! Ask how it's going. Mention what makes your service different (AI-powered, no retainer).",
        need_to_think: "Of course! Offer to send some info they can review. Reduce pressure.",
        spouse_decision: "Totally get it. Offer to include both of them in a quick call. Make it easy.",
        had_bad_experience: "Empathize genuinely. Explain how your approach is different. Offer a no-risk trial.",
      };
      responsePrompt = `The lead raised a "${objectionCategory}" objection: "${replyText}". ${strategies[objectionCategory] || "Acknowledge and redirect gently."} Keep it to 2-3 sentences. Be human, not salesy.`;
    } else if (sentiment === "positive") {
      responsePrompt = `The lead responded positively. Keep the momentum going. Ask a qualifying question or move toward booking. 2-3 sentences.`;
    } else {
      responsePrompt = `The lead sent a neutral reply. Keep the conversation going naturally. Be helpful and conversational. 2-3 sentences.`;
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `You are Aria, an AI sales assistant for a ${session.lead.industry} company. Generate ONLY the reply SMS text.

Conversation so far:
${conversationHistory}

${responsePrompt}

Reply as Aria (SMS text only, no quotes):`,
      }],
    });

    responseText = response.content[0].type === "text" ? response.content[0].text.trim() : null;
    if (responseText) {
      responseText = responseText.replace(/^["']|["']$/g, "").trim();
      // No hard truncation in sandbox — let demo messages read naturally
    }
  } catch {
    // Fallback responses
    if (intent === "appointment_confirmed") {
      responseText = `You're all set, ${session.lead.firstName}! I'll send you a confirmation for ${apptDate.toLocaleDateString("en-US", { weekday: "long" })} at 2pm. Looking forward to it! 🎉`;
    } else if (intent === "appointment_interest") {
      responseText = `That's great, ${session.lead.firstName}! How about ${apptDate.toLocaleDateString("en-US", { weekday: "long" })} at 2pm? Does that work for your schedule? 📅`;
    } else if (objectionCategory === "price_too_high") {
      responseText = `Totally hear you, ${session.lead.firstName}. The nice thing is you only pay when we deliver a confirmed appointment — zero risk.`;
    } else if (objectionCategory === "not_interested") {
      responseText = `No worries at all! Just curious — has anything changed since you first looked into it? Either way, we're here if you need us.`;
    } else if (objectionCategory === "bad_timing") {
      responseText = `Totally understand, ${session.lead.firstName}! When would be better? Happy to follow up whenever works for you.`;
    } else if (sentiment === "positive") {
      responseText = `Awesome! Would you be open to a quick 10-minute call? I can walk you through how we've helped others in ${session.lead.industry}. 🙌`;
    } else {
      responseText = `Thanks for getting back to me, ${session.lead.firstName}! Is there anything specific I can help you with?`;
    }
  }

  // Store response
  let responseMessage: SandboxMessage | null = null;
  if (responseText) {
    responseMessage = {
      id: crypto.randomUUID(),
      direction: "outbound",
      channel: "sms",
      content: responseText,
      aiGenerated: true,
      agentId: "sms-agent",
      timestamp: new Date(),
      metadata: { intent, sentiment, objectionCategory },
    };
    session.messages.push(responseMessage);

    newEvents.push({
      type: "outreach.sms.reply_sent",
      agentId: "sms-agent",
      description: `AI reply sent: "${responseText.substring(0, 50)}..."`,
      timestamp: new Date(),
      data: { intent, responseLength: responseText.length },
    });
    session.agentActions.push(`sms-agent: Sent AI reply (${intent})`);
  }

  // ─── 5. Learning agent records ────────────────────────────────────
  newEvents.push({
    type: "learning.recorded",
    agentId: "learning",
    description: `Recorded reply: sentiment=${sentiment}, intent=${intent}`,
    timestamp: new Date(),
  });

  session.events.push(...newEvents);

  return {
    analysis: {
      sentiment,
      intent,
      confidence,
      objectionCategory,
      scoreAfter: session.lead.score,
      temperatureAfter: session.lead.temperature,
      reactorState: session.lead.reactorState,
    },
    responseMessage,
    events: newEvents,
    appointment: appointmentTime ? {
      scheduledAt: appointmentTime.toISOString(),
      leadName: `${session.lead.firstName} ${session.lead.lastName}`,
      industry: session.lead.industry,
    } : null,
  };
}

// ─── PRESET DEMO SCENARIOS ──────────────────────────────────────────────────
// Pre-built conversation scripts for quick demos.

export const DEMO_SCENARIOS = {
  happy_path: {
    name: "Happy Path — Lead Books Appointment",
    description: "Lead responds positively, AI proposes a time, lead confirms",
    leadOverrides: { firstName: "Sarah", lastName: "Chen", industry: "solar" },
    replies: [
      "Hey! Yeah I was thinking about solar actually",
      "That sounds great, when can we meet?",
      "That works for me! Let's do it",
    ],
  },
  objection_overcome: {
    name: "Objection Handling — Price Concern",
    description: "Lead objects on price, AI handles it, lead converts",
    leadOverrides: { firstName: "Mike", lastName: "Torres", industry: "hvac" },
    replies: [
      "Honestly it's just too expensive right now",
      "Hmm the pay-per-appointment thing is interesting though",
      "Ok yeah let's set something up, when are you free?",
      "That works, let's do it",
    ],
  },
  opt_out: {
    name: "Opt-Out Flow",
    description: "Lead opts out — system immediately blocks further contact",
    leadOverrides: { firstName: "Pat", lastName: "Rivera", industry: "roofing" },
    replies: [
      "stop",
    ],
  },
  slow_warm: {
    name: "Slow Warm-Up",
    description: "Lead is initially neutral, gradually warms up over multiple exchanges",
    leadOverrides: { firstName: "Alex", lastName: "Kim", industry: "plumbing" },
    replies: [
      "who is this?",
      "oh ok. not sure I need that right now",
      "actually wait, what kind of services?",
      "hm that's interesting. sure let's talk",
    ],
  },
  competitor: {
    name: "Using a Competitor",
    description: "Lead mentions they already have a provider, AI pivots",
    leadOverrides: { firstName: "Jamie", lastName: "Lee", industry: "insurance" },
    replies: [
      "I'm already using another company for that",
      "It's been ok I guess, nothing special",
      "What makes you guys different?",
    ],
  },
};
