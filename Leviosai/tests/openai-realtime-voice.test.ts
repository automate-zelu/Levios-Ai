/**
 * OpenAI Realtime voice-stack helpers
 * Run: npx tsx --test tests/openai-realtime-voice.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapToRealtimeVoice,
  useOpenAiRealtimeVoice,
} from "../lib/calling/openai-realtime-session.js";
import { CALL_TOOL_DEFINITIONS } from "../lib/calling/call-calendar-tools.js";

describe("OpenAI Realtime voice stack", () => {
  it("maps unknown ElevenLabs voice ids to a Realtime voice", () => {
    assert.equal(mapToRealtimeVoice("alloy"), "alloy");
    assert.equal(mapToRealtimeVoice("21m00Tcm4TlvDq8ikWAM"), "marin");
    assert.equal(mapToRealtimeVoice("shimmer"), "shimmer");
    assert.equal(mapToRealtimeVoice("marin"), "marin");
    assert.equal(mapToRealtimeVoice("voice_abc123"), "voice_abc123");
  });

  it("exposes calendar tool definitions for the realtime session", () => {
    assert.ok(CALL_TOOL_DEFINITIONS.some((t) => t.name === "check_availability"));
    assert.ok(CALL_TOOL_DEFINITIONS.some((t) => t.name === "book_appointment"));
  });

  it("useOpenAiRealtimeVoice respects CALL_VOICE_STACK=classic", () => {
    const prevStack = process.env.CALL_VOICE_STACK;
    const prevKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "sk-test";
      process.env.CALL_VOICE_STACK = "classic";
      assert.equal(useOpenAiRealtimeVoice(), false);
      process.env.CALL_VOICE_STACK = "realtime";
      assert.equal(useOpenAiRealtimeVoice(), true);
      delete process.env.OPENAI_API_KEY;
      assert.equal(useOpenAiRealtimeVoice(), false);
    } finally {
      if (prevStack === undefined) delete process.env.CALL_VOICE_STACK;
      else process.env.CALL_VOICE_STACK = prevStack;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });
});
