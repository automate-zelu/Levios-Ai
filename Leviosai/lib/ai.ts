import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const apiKey = process.env.ANTHROPIC_API_KEY;
let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!client && apiKey) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function isAIConfigured(): boolean {
  return !!apiKey;
}

export async function scoreLead(lead: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  source?: string | null;
  status: string;
  lastContactedAt?: Date | null;
  notes?: string;
}): Promise<{ score: number; temperature: string; objection: string | null; reasoning: string }> {
  const c = getClient();
  if (!c) {
    return { score: 50, temperature: "warm", objection: null, reasoning: "AI not configured — default score assigned" };
  }

  try {
    const response = await c.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `You are a sales AI scoring leads for a home services company. Score this lead 0-100 and classify their temperature.

Lead: ${lead.firstName} ${lead.lastName}
Email: ${lead.email}
Phone: ${lead.phone || "N/A"}
Source: ${lead.source || "Unknown"}
Current Status: ${lead.status}
Last Contacted: ${lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : "Never"}
${lead.notes ? `Notes: ${lead.notes}` : ""}

Respond in JSON format only:
{"score": <0-100>, "temperature": "<hot|warm|cold>", "objection": "<main objection or null>", "reasoning": "<1-2 sentence explanation>"}`
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { score: 50, temperature: "warm", objection: null, reasoning: "Could not parse AI response" };
  } catch (err: any) {
    return { score: 50, temperature: "warm", objection: null, reasoning: `AI error: ${err.message}` };
  }
}

export async function generateMessage(
  lead: { firstName: string; lastName: string; source?: string | null; status: string },
  channel: "sms" | "email",
  context?: string
): Promise<{ subject?: string; message: string }> {
  const c = getClient();
  if (!c) {
    const defaultMsg = channel === "sms"
      ? `Hi ${lead.firstName}, this is an AI assistant from our team. We'd love to help you with your project. Would now be a good time to chat?`
      : `Hi ${lead.firstName},\n\nI wanted to follow up regarding your inquiry. We have some great options that might interest you.\n\nWould you be available for a quick call this week?\n\nBest regards`;
    return { subject: channel === "email" ? `Following up — ${lead.firstName}` : undefined, message: defaultMsg };
  }

  try {
    const channelInstructions = channel === "sms"
      ? "Write a short SMS message (under 160 characters). Be conversational, warm, and include a clear call-to-action."
      : "Write a professional follow-up email. Include a subject line. Be warm but professional, and include a clear next step.";

    const response = await c.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a sales AI assistant for a home services company. Generate an outreach message for this lead.

Lead: ${lead.firstName} ${lead.lastName}
Source: ${lead.source || "Unknown"}
Status: ${lead.status}
${context ? `Context: ${context}` : ""}

Channel: ${channel.toUpperCase()}
${channelInstructions}

${channel === "email" ? 'Respond in JSON: {"subject": "...", "message": "..."}' : 'Respond in JSON: {"message": "..."}'}`
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { message: `Hi ${lead.firstName}, we'd love to connect with you about your project. Are you available for a quick chat?` };
  } catch (err: any) {
    return { message: `Hi ${lead.firstName}, we'd love to connect with you. When would be a good time to chat?` };
  }
}

export async function handleObjection(
  objection: string,
  leadContext: string
): Promise<{ response: string; strategy: string }> {
  const c = getClient();
  if (!c) {
    return {
      response: "I completely understand your concern. Let me share some information that might help address that.",
      strategy: "Acknowledge and redirect"
    };
  }

  try {
    const response = await c.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You are an expert sales AI. A lead has raised this objection: "${objection}"

Lead context: ${leadContext}

Provide a response that addresses this objection and a strategy label.
Respond in JSON: {"response": "...", "strategy": "..."}`
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { response: "I understand your concern. Let me help address that.", strategy: "Acknowledge" };
  } catch {
    return { response: "I understand. Let me provide some additional context that might help.", strategy: "Acknowledge and redirect" };
  }
}
