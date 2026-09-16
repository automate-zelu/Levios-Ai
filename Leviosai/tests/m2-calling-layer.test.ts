/**
 * Module 2 — Custom AI Calling Layer tests
 *
 * Covers:
 *  - TranscriptStore accumulation / serialization
 *  - Recording path / public URL helpers
 *  - Pipeline latency measurement + timeout/reconnect policy
 *
 * Run: npx tsx --test tests/m2-calling-layer.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "path";

import {
  TranscriptStore,
  transcriptStoreFromJSON,
} from "../lib/calling/transcript-store.js";
import {
  recordingFilePath,
  recordingPublicUrl,
  getRecordingsDir,
} from "../lib/calling/recording-storage.js";
import {
  measureLatency,
  shouldReconnectDeepgram,
  withTimeout,
  mergeUtteranceFragments,
  countWords,
  shouldAcceptRestTranscript,
  accumulateRestTranscript,
  PIPELINE_LATENCY_WARN_MS,
  DEEPGRAM_MAX_RECONNECTS,
  LLM_RESPONSE_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
  LEAD_TURN_GAP_MS,
  LEAD_TURN_MIN_WORDS,
  transcriptHasLeadSpeech,
} from "../lib/calling/pipeline-helpers.js";

// ─── TranscriptStore ──────────────────────────────────────────────────────────

describe("M2 TranscriptStore", () => {
  it("appends speakers and builds a full transcript", () => {
    const store = new TranscriptStore();
    store.append("ai", "Hi, this is Aria calling.");
    store.append("lead", "Oh hi, who is this?");
    store.append("ai", "I'm following up about your inquiry.");

    assert.equal(store.lineCount, 3);
    assert.equal(store.isEmpty, false);
    assert.equal(
      store.getFullTranscript(),
      "AI: Hi, this is Aria calling.\nLEAD: Oh hi, who is this?\nAI: I'm following up about your inquiry."
    );
  });

  it("ignores blank / whitespace-only lines", () => {
    const store = new TranscriptStore();
    store.append("lead", "   ");
    store.append("ai", "");
    store.append("lead", "Hello");
    assert.equal(store.lineCount, 1);
  });

  it("serializes to JSON and rebuilds via transcriptStoreFromJSON", () => {
    const store = new TranscriptStore();
    store.append("ai", "Greeting", 1_000);
    store.append("lead", "Reply", 2_000);

    const json = store.toJSON();
    assert.equal(json.length, 2);
    assert.equal(json[0].speaker, "ai");
    assert.equal(json[0].at, 1_000);

    const rebuilt = transcriptStoreFromJSON(json);
    assert.equal(rebuilt.getFullTranscript(), store.getFullTranscript());
    assert.equal(rebuilt.getDurationMs(), 1_000);
  });

  it("clear() empties the store", () => {
    const store = new TranscriptStore();
    store.append("ai", "x");
    store.clear();
    assert.equal(store.isEmpty, true);
    assert.equal(store.getFullTranscript(), "");
  });
});

// ─── Recording storage helpers ────────────────────────────────────────────────

describe("M2 recording storage helpers", () => {
  it("sanitizes sessionId in file paths", () => {
    const p = recordingFilePath("../../evil;rm", "mp3");
    assert.ok(!p.includes(".."));
    assert.ok(!p.includes(";"));
    assert.ok(p.endsWith(".mp3"));
    assert.ok(p.startsWith(getRecordingsDir()));
  });

  it("builds a public recording URL from BASE_URL", () => {
    const prev = process.env.BASE_URL;
    process.env.BASE_URL = "https://app.leviosai.io/";
    try {
      assert.equal(
        recordingPublicUrl("abc-123"),
        "https://app.leviosai.io/api/call/recordings/abc-123"
      );
    } finally {
      if (prev === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = prev;
    }
  });

  it("uses RECORDINGS_DIR when set", () => {
    const prev = process.env.RECORDINGS_DIR;
    process.env.RECORDINGS_DIR = "/tmp/leviosai-recordings-test";
    try {
      assert.equal(getRecordingsDir(), path.resolve("/tmp/leviosai-recordings-test"));
    } finally {
      if (prev === undefined) delete process.env.RECORDINGS_DIR;
      else process.env.RECORDINGS_DIR = prev;
    }
  });
});

describe("M2 blob storage helpers", () => {
  it("builds S3 object keys safely", async () => {
    const { recordingObjectKey, isS3Configured } = await import("../lib/blob-storage.js");
    assert.equal(recordingObjectKey("abc-123"), "call-recordings/abc-123.mp3");
    assert.ok(!recordingObjectKey("../evil").includes(".."));
    // isS3Configured depends on env — just ensure the helper is callable
    assert.equal(typeof isS3Configured(), "boolean");
  });
});

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

describe("M2 pipeline helpers", () => {
  it("exports expected timeout / reconnect budgets", () => {
    assert.equal(PIPELINE_LATENCY_WARN_MS, 1500);
    assert.equal(DEEPGRAM_MAX_RECONNECTS, 2);
    assert.ok(LLM_RESPONSE_TIMEOUT_MS >= 10_000);
    assert.ok(TTS_TIMEOUT_MS >= 5_000);
    assert.ok(LEAD_TURN_GAP_MS >= 1000);
  });

  it("merges lead STT fragments into one turn", () => {
    assert.equal(
      mergeUtteranceFragments("could you", "tell me more about your business"),
      "could you tell me more about your business"
    );
    assert.equal(
      mergeUtteranceFragments("could you", "could you tell me more"),
      "could you tell me more"
    );
    assert.equal(countWords("could you tell me"), 4);
  });

  it("accepts single-word REST transcripts like yes/hello (dialogue regression)", () => {
    assert.equal(LEAD_TURN_MIN_WORDS, 1);
    assert.equal(shouldAcceptRestTranscript("yes"), true);
    assert.equal(shouldAcceptRestTranscript("Hello"), true);
    assert.equal(shouldAcceptRestTranscript("sure,"), true);
    assert.equal(shouldAcceptRestTranscript("yes please"), true);
    assert.equal(shouldAcceptRestTranscript("   "), false);
    assert.equal(shouldAcceptRestTranscript("???"), false);
    assert.equal(shouldAcceptRestTranscript(""), false);
  });

  it("accumulates short REST fragments across batches into one lead turn", () => {
    const held = accumulateRestTranscript("", "yes");
    assert.equal(held, "yes");
    assert.equal(shouldAcceptRestTranscript(held), true);

    const merged = accumulateRestTranscript("yes", "please go ahead");
    assert.equal(merged, "yes please go ahead");
    assert.equal(shouldAcceptRestTranscript(merged), true);

    // Revision: longer batch supersedes shorter prefix
    assert.equal(
      accumulateRestTranscript("could you", "could you tell me more"),
      "could you tell me more"
    );
  });

  it("models the lead-speak → AI-reply acceptance gate used on calls", () => {
    // Simulate what the pipeline does after REST STT emits text
    const turns = ["yes", "hello", "yes please", "tell me more about pricing"];
    for (const turn of turns) {
      assert.ok(
        shouldAcceptRestTranscript(turn) && countWords(turn) >= LEAD_TURN_MIN_WORDS,
        `expected lead turn to reach the LLM: "${turn}"`
      );
    }
  });

  it("measureLatency flags over-budget totals", () => {
    const sample = measureLatency(0, 800, 2000);
    assert.equal(sample.llmMs, 800);
    assert.equal(sample.ttsMs, 1200);
    assert.equal(sample.totalMs, 2000);
    assert.equal(sample.overBudget, true);
  });

  it("measureLatency is under budget for fast turns", () => {
    const sample = measureLatency(1000, 1200, 1400);
    assert.equal(sample.totalMs, 400);
    assert.equal(sample.overBudget, false);
  });

  it("shouldReconnectDeepgram respects intentional close and max attempts", () => {
    assert.equal(shouldReconnectDeepgram(true, 0), false);
    assert.equal(shouldReconnectDeepgram(false, 0), true);
    assert.equal(shouldReconnectDeepgram(false, 1), true);
    assert.equal(shouldReconnectDeepgram(false, 2), false);
  });

  it("withTimeout resolves when promise finishes in time", async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, "fast");
    assert.equal(value, 42);
  });

  it("withTimeout rejects when promise hangs", async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => {}), 50, "hang"),
      /hang timed out after 50ms/
    );
  });
});

// ─── Twilio <Say> TTS fallback (plan §18) ─────────────────────────────────────

describe("M2 Twilio Say TTS fallback", () => {
  it("escapes XML special characters for TwiML", async () => {
    const { escapeXmlForTwiml } = await import("../lib/calling/tts-fallback.js");
    assert.equal(
      escapeXmlForTwiml(`Hi & welcome <team> "folks" 'all'`),
      "Hi &amp; welcome &lt;team&gt; &quot;folks&quot; &apos;all&apos;"
    );
  });

  it("truncates long text for Twilio Say", async () => {
    const { truncateForTwilioSay, TWILIO_SAY_MAX_CHARS } = await import(
      "../lib/calling/tts-fallback.js"
    );
    const long = "a".repeat(TWILIO_SAY_MAX_CHARS + 50);
    const out = truncateForTwilioSay(long);
    assert.ok(out.length <= TWILIO_SAY_MAX_CHARS);
    assert.ok(out.endsWith("…"));
  });

  it("builds Say → Connect Stream TwiML", async () => {
    const { buildSayThenStreamTwiml, buildStreamWssUrl } = await import(
      "../lib/calling/tts-fallback.js"
    );
    const streamUrl = buildStreamWssUrl("https://app.example.com", "sess-1");
    assert.equal(streamUrl, "wss://app.example.com/api/call/stream/sess-1");

    const twiml = buildSayThenStreamTwiml('Hello <world> & co', streamUrl);
    assert.match(twiml, /<Say voice="Polly\.Joanna">Hello &lt;world&gt; &amp; co<\/Say>/);
    assert.match(twiml, /<Stream url="wss:\/\/app\.example\.com\/api\/call\/stream\/sess-1"/);
    assert.match(twiml, /<\/Connect>/);
  });

  it("tracks say-fallback redirect + stream counts for close suppression", async () => {
    const {
      markSayFallbackRedirect,
      clearSayFallbackRedirect,
      isSayFallbackRedirect,
      shouldSuppressEndOnStreamClose,
      trackStreamOpen,
      trackStreamClose,
      getActiveStreamCount,
    } = await import("../lib/calling/tts-fallback.js");

    const id = `test-say-${Date.now()}`;
    assert.equal(isSayFallbackRedirect(id), false);
    markSayFallbackRedirect(id);
    assert.equal(isSayFallbackRedirect(id), true);
    assert.equal(shouldSuppressEndOnStreamClose(id), true);

    trackStreamOpen(id);
    trackStreamOpen(id);
    assert.equal(getActiveStreamCount(id), 2);
    assert.equal(trackStreamClose(id), 1);
    assert.equal(trackStreamClose(id), 0);

    clearSayFallbackRedirect(id);
    assert.equal(isSayFallbackRedirect(id), false);
    assert.equal(shouldSuppressEndOnStreamClose(id), false);
  });
});

describe("M2 transcriptHasLeadSpeech", () => {
  it("ignores empty, greeting-only, and JSON without lead lines", () => {
    assert.equal(transcriptHasLeadSpeech(null), false);
    assert.equal(transcriptHasLeadSpeech(""), false);
    assert.equal(transcriptHasLeadSpeech("AI: Hi, this is Aria calling from NorthPeak."), false);
    assert.equal(
      transcriptHasLeadSpeech(JSON.stringify([{ speaker: "ai", text: "Hi there", at: 1 }])),
      false
    );
  });

  it("detects lead speech in plain text and JSON transcripts", () => {
    assert.equal(
      transcriptHasLeadSpeech("AI: Hi Aria here.\nLEAD: Yeah, who is this?"),
      true
    );
    assert.equal(
      transcriptHasLeadSpeech(
        JSON.stringify([
          { speaker: "ai", text: "Hi", at: 1 },
          { speaker: "lead", text: "Hello", at: 2 },
        ])
      ),
      true
    );
  });
});
